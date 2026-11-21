import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { assistant } from "@/i18n/messages/assistant";
import type { User } from "../auth";
import { isPublicHoliday } from "../holidays";
import { eventsBetween } from "../schedule";
import { formatDate, weekday } from "../time";
import { parsePreview, publicPreview, type StoredPreview } from "./choices";
import { parseReplyCard, type CardEvent } from "./reply-card";
import { brief, modelResult } from "./toolkit";
import { runTool, type ToolContext } from "./tools";

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const previewRequest = z.object({
  id: z.number().int().positive(), occurrence: z.string().max(80).optional(), weekly: z.boolean().optional(),
  date: z.iso.date(), start: clock, end: z.union([clock, z.literal("24:00")]),
}).refine((edit) => edit.end > edit.start);

export function latestMessage(userId: string) {
  return getDb().select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(desc(chatMessages.id)).limit(1).get();
}

export function sameSource(a: StoredPreview, b: StoredPreview) {
  return a.title === b.title && a.weekly === b.weekly && a.roomChange?.from === b.roomChange?.from && a.roomChange?.to === b.roomChange?.to && a.from?.date === b.from?.date
    && a.from?.start === b.from?.start && a.from?.end === b.from?.end;
}

type Edit = z.infer<typeof previewRequest>;
type Change = StoredPreview["change"];

/** The browser can identify a row from its last reply, never supply a tool or its arguments. */
function changeForRow(user: User, row: CardEvent | undefined, edit: Edit): Change | undefined {
  if (!row?.move || (edit.weekly && row.move.scope === "once")) return;
  const occurrence = row.move.occurrence;
  const event = eventsBetween(user, row.date, row.date).find((e) => e.id === occurrence);
  if (!event) return;
  const current = modelResult(brief(event)) as CardEvent;
  if (!current.move || current.move.scope !== row.move.scope) return;
  if (current.title !== row.title || current.kind !== row.kind || current.room !== row.room || current.start !== row.start || current.end !== row.end) return;
  if (event.type === "personal" && event.personalId && !!event.recurring === (row.move.scope === "series")) {
    return { tool: "move_personal_event", args: { id: event.personalId } };
  }
  if (event.type === "class" && event.entryId) {
    if (edit.weekly) return event.recurring ? { tool: "move_class", args: { entry_id: event.entryId } } : undefined;
    return { tool: "move_class_once", args: { entry_id: event.entryId, date: event.date, original_date: event.originalDate ?? event.date } };
  }
}

function withTime(change: Change, edit: Edit, weekly: boolean): Change {
  const { date, start, end } = edit;
  const day = weekday(date);
  let target: Record<string, unknown>;
  switch (change.tool) {
    case "move_personal_event": target = { new_date: weekly ? undefined : date, new_weekday: weekly ? day : undefined, new_start: start, new_end: end }; break;
    case "move_class_once": target = { to_date: date, start, end }; break;
    case "move_class": target = { to_weekday: day, start, end }; break;
    case "add_personal_event": target = { date: weekly ? undefined : date, weekday: weekly ? day : undefined, start, end }; break;
  }
  return { tool: change.tool, args: { ...change.args, ...target } };
}

export function reviewTime(user: User, edit: Edit, locale: Locale, spokenChoice?: string) {
  const t = assistant[locale];
  const stale = { ok: false, status: 409, error: t.accept.outOfDate } as const;
  const db = getDb();
  return db.transaction(() => {
    const last = latestMessage(user.id);
    if (last?.id !== edit.id || last.role !== "assistant") return stale;
    const prior = parsePreview(last.preview);
    let weekly = prior?.weekly ?? false;
    let change: Change | undefined;
    if (edit.occurrence) {
      const card = parseReplyCard(last.card);
      const rows = card?.type === "next" ? [card.current, card.next] : card?.type === "schedule" || card?.type === "move" ? card.events : [];
      const row = rows.find((e) => e?.move?.occurrence === edit.occurrence);
      change = changeForRow(user, row ?? undefined, edit);
      weekly = row?.move?.scope === "series" || edit.weekly === true;
    } else if (prior?.status === "pending") {
      change = prior.change;
    }
    if (!change) return stale;
    if (change.tool === "move_class_once" && isPublicHoliday(edit.date)) {
      return { ok: false, status: 422, error: t.preview.holiday } as const;
    }
    const updated = withTime(change, edit, weekly);
    const ctx: ToolContext = { user, location: null, locale, changed: false };
    const result = runTool(updated.tool, { ...updated.args, confirmed: false }, ctx) as { error?: string };
    const preview = ctx.preview;
    if (!preview) return result.error === "That is already its time."
      ? { ok: false, status: 422, error: t.preview.sameTime } as const : stale;
    if (prior && !sameSource(prior, preview)) return stale;
    preview.textIsTranscript = true;

    const day = formatDate(preview.date, weekly ? { weekday: "long" } : undefined, locale);
    const when = t.preview.when(day, preview.start, preview.end, weekly);
    const selection = spokenChoice ?? t.preview.request(preview.title, when);
    const overlaps = [...preview.events.filter((e) => e.overlaps), ...(preview.otherClashes ?? [])]
      .map((e) => `${e.title} (${e.start}–${e.end})`);
    const reply = [t.preview.review(preview.title, when), ...(overlaps.length ? [t.preview.overlaps(overlaps.join(", ")) + "."] : [])].join(" ");
    db.insert(chatMessages).values({ userId: user.id, role: "user", content: selection }).run();
    const saved = db.insert(chatMessages).values({ userId: user.id, role: "assistant", content: reply, preview: JSON.stringify(preview) })
      .returning({ id: chatMessages.id }).get();
    return { ok: true, selection, reply, id: saved.id, preview: publicPreview(preview) } as const;
  }, { behavior: "immediate" });
}
