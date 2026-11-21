import { z } from "zod";

// Keep only display fields and the calendar occurrence offered for rescheduling.
const date = z.iso.date();
const clock = z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/);
const label = z.string().max(254);
const timeAndPlace = {
  date, start: clock, end: clock.nullable(), room: label.nullable(), building: label.nullable(), approximate: z.boolean().optional(),
};
const move = z.object({ occurrence: z.string().max(80), scope: z.enum(["once", "series", "choose"]) });
const event = z.object({ ...timeAndPlace, title: label, kind: label, campus_room: label.optional(), move: move.optional() });
const proposed = z.object({ date: date.optional(), start: clock.optional(), end: clock.optional() });
const exam = z.object({ ...timeAndPlace, course: label, for: label.nullable(), teacher: label.nullable() });
const slot = z.object({ date, start: clock, end: clock, minutes: z.number().int().positive() });

const MAX_ROWS = 40;
const count = z.number().int().positive();
const base = { textIsTranscript: z.literal(true).optional() };
const cardSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("schedule"), from: date, to: date, count,
    events: z.array(event).min(1).max(MAX_ROWS), holidays: z.array(z.object({ date, name: label })) }),
  z.object({ ...base, type: z.literal("move"), count, events: z.array(event.extend({ move })).min(1).max(MAX_ROWS), proposed: proposed.optional() }),
  z.object({ ...base, type: z.literal("next"), now: z.templateLiteral([date, " ", clock]), current: event.nullable(), next: event.nullable() })
    .refine((c) => c.current !== null || c.next !== null),
  z.object({ ...base, type: z.literal("exams"), count, exams: z.array(exam).min(1).max(MAX_ROWS) }),
  z.object({ ...base, type: z.literal("free"), from: date, to: date, for: label, count, free: z.array(slot).min(1).max(MAX_ROWS) }),
]);

export type ReplyCard = z.infer<typeof cardSchema>;
export type CardEvent = z.infer<typeof event>;
export type CardSlot = z.infer<typeof slot>;

function validated(value: unknown): ReplyCard | undefined {
  const parsed = cardSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const lookups = new Map<string, { type: ReplyCard["type"]; rows?: string }>([
  ["get_schedule", { type: "schedule", rows: "events" }],
  ["choose_event_to_move", { type: "move", rows: "events" }],
  ["get_next_event", { type: "next" }],
  ["find_exams", { type: "exams", rows: "exams" }],
  ["find_free_slots", { type: "free", rows: "free" }],
]);

/** Take a snapshot of the actual lookup, including the total when it exceeds the displayed rows. */
export function cardForLookup(tool: string, result: unknown): ReplyCard | undefined {
  const lookup = lookups.get(tool);
  if (!lookup || !result || typeof result !== "object") return undefined;
  const data = result as Record<string, unknown>;
  if (!lookup.rows) return validated({ ...data, type: lookup.type });
  const rows = data[lookup.rows];
  if (!Array.isArray(rows)) return undefined;
  return validated({ ...data, type: lookup.type, count: data.count ?? rows.length, [lookup.rows]: rows.slice(0, MAX_ROWS) });
}

export function parseReplyCard(json: string | null): ReplyCard | undefined {
  if (!json) return undefined;
  try {
    return validated(JSON.parse(json));
  } catch {
    return undefined;
  }
}
