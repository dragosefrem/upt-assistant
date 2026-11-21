import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import type { User } from "../auth";
import { parsePreview } from "./choices";
import { runTool, type ToolContext } from "./tools";

export type AcceptResult = { ok: true; reply: string; changed: boolean } | { ok: false; status: number; error: string };

type Any = Record<string, unknown>;

/** The confirmation written into the chat once a change is saved. */
function confirmation(action: "add" | "move", result: Any): string {
  const main = action === "add" ? `Done: ${result.added} is in your calendar, ${result.when}.` : `Done: ${result.moved} is now ${result.to}.`;
  const overlaps = Array.isArray(result.overlaps) ? (result.overlaps as Any[]).map((e) => `${e.title} (${e.start}–${e.end})`) : [];
  return overlaps.length ? `${main} It overlaps ${overlaps.join(", ")}.` : main;
}

/**
 * Applies the change previewed in the student's latest assistant message, exactly as
 * shown. The Accept button calls this directly, so no AI round trip sits between what
 * the student saw and what is saved.
 */
export async function acceptPreview(user: User, messageId: number): Promise<AcceptResult> {
  const db = getDb();
  const latest = db
    .select({ id: chatMessages.id, role: chatMessages.role, preview: chatMessages.preview })
    .from(chatMessages)
    .where(eq(chatMessages.userId, user.id))
    .orderBy(desc(chatMessages.id))
    .limit(1)
    .get();
  if (!latest || latest.id !== messageId || latest.role !== "assistant") {
    return { ok: false, status: 409, error: "This preview is out of date. Ask the assistant again." };
  }
  const preview = parsePreview(latest.preview);
  if (!preview) return { ok: false, status: 404, error: "There is nothing to accept." };
  if (preview.status !== "pending") return { ok: false, status: 409, error: "This change was already accepted." };

  // Claim it first, so a double click cannot apply the change twice.
  const claimed = db
    .update(chatMessages)
    .set({ preview: JSON.stringify({ ...preview, status: "accepted" }) })
    .where(and(eq(chatMessages.id, latest.id), eq(chatMessages.preview, latest.preview!)))
    .run();
  if (claimed.changes === 0) return { ok: false, status: 409, error: "This change was already accepted." };

  const ctx: ToolContext = { user, location: null, changed: false };
  // The student saw any overlaps in the preview, so accepting it accepts them.
  const result = (await runTool(preview.change.tool, { ...preview.change.args, confirmed: true, allow_overlap: true }, ctx)) as Any;
  if (result.error) {
    db.update(chatMessages).set({ preview: latest.preview }).where(eq(chatMessages.id, latest.id)).run();
    return { ok: false, status: 409, error: `It could not be saved: ${String(result.error)}` };
  }

  const reply = confirmation(preview.action, result);
  db.insert(chatMessages).values({ userId: user.id, role: "user", content: "✓ Accepted" }).run();
  db.insert(chatMessages).values({ userId: user.id, role: "assistant", content: reply }).run();
  return { ok: true, reply, changed: ctx.changed };
}
