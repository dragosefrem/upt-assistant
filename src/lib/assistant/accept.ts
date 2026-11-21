import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { assistant } from "@/i18n/messages/assistant";
import type { User } from "../auth";
import { dayName, formatDate, weekday } from "../time";
import { parsePreview, type StoredPreview } from "./choices";
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
export async function acceptPreview(user: User, messageId: number, locale: Locale = "en"): Promise<AcceptResult> {
  const t = assistant[locale].accept;
  const db = getDb();
  const latest = db
    .select({ id: chatMessages.id, role: chatMessages.role, preview: chatMessages.preview })
    .from(chatMessages)
    .where(eq(chatMessages.userId, user.id))
    .orderBy(desc(chatMessages.id))
    .limit(1)
    .get();
  if (!latest || latest.id !== messageId || latest.role !== "assistant") {
    return { ok: false, status: 409, error: t.outOfDate };
  }
  const preview = parsePreview(latest.preview);
  if (!preview) return { ok: false, status: 404, error: t.nothing };
  if (preview.status !== "pending") return { ok: false, status: 409, error: t.already };

  // Claim it first, so a double click cannot apply the change twice.
  const claimed = db
    .update(chatMessages)
    .set({ preview: JSON.stringify({ ...preview, status: "accepted" }) })
    .where(and(eq(chatMessages.id, latest.id), eq(chatMessages.preview, latest.preview!)))
    .run();
  if (claimed.changes === 0) return { ok: false, status: 409, error: t.already };

  const ctx: ToolContext = { user, location: null, changed: false, locale };
  // The student saw any overlaps in the preview, so accepting it accepts them.
  const result = (await runTool(preview.change.tool, { ...preview.change.args, confirmed: true, allow_overlap: true }, ctx)) as Any;
  if (result.error) {
    db.update(chatMessages).set({ preview: latest.preview }).where(eq(chatMessages.id, latest.id)).run();
    return { ok: false, status: 409, error: t.notSaved(String(result.error)) };
  }

  const reply = confirmation(preview, result, locale);
  db.insert(chatMessages).values({ userId: user.id, role: "user", content: "✓ Accepted" }).run();
  db.insert(chatMessages).values({ userId: user.id, role: "assistant", content: reply }).run();
  return { ok: true, reply, changed: ctx.changed };
}
