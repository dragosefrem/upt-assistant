import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { assistant } from "@/i18n/messages/assistant";
import type { User } from "../auth";
import { queueGoogleSync } from "../google-worker";
import { dayName, formatDate, weekday } from "../time";
import { parsePreview, type StoredPreview } from "./choices";
import { latestMessage, sameSource } from "./preview";
import { runTool, type ToolContext } from "./tools";

export type AcceptResult = { ok: true; reply: string; changed: boolean } | { ok: false; status: number; error: string };

type Any = Record<string, unknown>;

/** When the change takes effect, in Romanian; English uses the tool's own wording. */
function whenRo(preview: StoredPreview): string {
  const span = `${preview.start}–${preview.end}`;
  if (preview.weekly) return `în fiecare ${dayName(weekday(preview.date), "ro").toLowerCase()}, ${span}`;
  return `${formatDate(preview.date, { weekday: "long", day: "numeric", month: "long" }, "ro")}, ${span}`;
}

/** The confirmation written into the chat once a change is saved. */
function confirmation(preview: StoredPreview, result: Any, locale: Locale): string {
  const t = assistant[locale].accept;
  const main =
    preview.action === "add"
      ? t.added(String(result.added), locale === "ro" ? whenRo(preview) : String(result.when))
      : t.moved(String(result.moved), locale === "ro" ? whenRo(preview) : String(result.to));
  const overlaps = Array.isArray(result.overlaps) ? (result.overlaps as Any[]).map((e) => `${e.title} (${e.start}–${e.end})`) : [];
  return overlaps.length ? main + t.overlaps(overlaps.join(", ")) : main;
}

/**
 * Applies the change previewed in the student's latest assistant message, exactly as
 * shown. The Accept button calls this directly, so no AI round trip sits between what
 * the student saw and what is saved.
 */
export function acceptPreview(user: User, messageId: number, locale: Locale = "en", answer = "✓ Accepted",
  chatTurn?: { userMessageId: number; proposal: StoredPreview }): AcceptResult {
  const t = assistant[locale].accept;
  const db = getDb();
  return db.transaction((): AcceptResult => {
    let latest = latestMessage(user.id);
    if (chatTurn) {
      if (latest?.id !== chatTurn.userMessageId || latest.role !== "user") return { ok: false, status: 409, error: t.outOfDate };
      latest = db.select().from(chatMessages).where(and(eq(chatMessages.userId, user.id), eq(chatMessages.id, messageId))).get();
    }
    if (latest?.id !== messageId || latest.role !== "assistant") return { ok: false, status: 409, error: t.outOfDate };
    const preview = parsePreview(latest.preview);
    if (!preview) return { ok: false, status: 404, error: t.nothing };
    if (preview.status !== "pending") return { ok: false, status: 409, error: t.already };
    if (chatTurn) {
      const proposed = chatTurn.proposal;
      const sameEvent = (["id", "entry_id", "original_date", "location"] as const).every((key) => preview.change.args[key] === proposed.change.args[key]);
      if (!sameEvent || !sameSource(preview, proposed) || preview.change.tool !== proposed.change.tool ||
        preview.date !== proposed.date || preview.start !== proposed.start || preview.end !== proposed.end) {
        return { ok: false, status: 409, error: t.outOfDate };
      }
    }

    // Re-read the source and conflicts under the same SQLite write lock as the save.
    const ctx: ToolContext = { user, location: null, changed: false, locale };
    const { tool, args } = preview.change;
    runTool(tool, { ...args, confirmed: false }, ctx);
    const fresh = ctx.preview;
    if (!fresh || !sameSource(preview, fresh) || fresh.date !== preview.date || fresh.start !== preview.start || fresh.end !== preview.end) {
      return { ok: false, status: 409, error: t.outOfDate };
    }
    const conflicts = (p: StoredPreview) => [
      ...p.events.filter((e) => e.overlaps).map((e) => ({ ...e, date: p.date })), ...(p.otherClashes ?? []),
    ].map((e) => JSON.stringify([e.date, e.start, e.end, e.title]));
    const seen = new Set(conflicts(preview));
    if (conflicts(fresh).some((key) => !seen.has(key))) return { ok: false, status: 409, error: t.newConflict };

    const result = runTool(tool, { ...args, confirmed: true, allow_overlap: true }, ctx) as Any;
    if (!ctx.changed) return { ok: false, status: 409, error: t.notSaved(String(result.error ?? t.outOfDate)) };
    if (user.googleRefreshToken) queueGoogleSync(user.id);
    const reply = confirmation(preview, result, locale);
    db.update(chatMessages).set({ preview: JSON.stringify({ ...preview, status: "accepted" }) }).where(eq(chatMessages.id, latest.id)).run();
    if (!chatTurn) db.insert(chatMessages).values([{ userId: user.id, role: "user", content: answer }, { userId: user.id, role: "assistant", content: reply }]).run();
    return { ok: true, reply, changed: true };
  }, { behavior: "immediate" });
}
