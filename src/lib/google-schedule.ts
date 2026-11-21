import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { googleEventLinks, googleExceptions } from "@/db/schema";
import type { CalendarFields } from "./calendar-types";
import { calendarSlices, campusDate, occurrenceKey, timingOf } from "./calendar-timing";
import type { CalEvent } from "./schedule";
import { addDays } from "./time";

function sourceUid(e: CalEvent) {
  if (e.entryId) return "entry-" + e.entryId + (e.originalDate ? "-" + e.originalDate : "");
  if (e.examId) return "exam-" + e.examId;
  if (e.personalId) return "personal-" + e.personalId;
  return "group-" + e.groupEventId;
}

function applyText(event: CalEvent, fields: Partial<CalendarFields>): CalEvent {
  return { ...event, privateCalendarEdit: event.privateCalendarEdit || fields.summary !== undefined || fields.location !== undefined || fields.description !== undefined, ...(fields.summary !== undefined ? { title: fields.summary, abbr: null } : {}),
    ...(fields.location !== undefined ? { room: fields.location || null, place: null, campusRoom: undefined } : {}),
    ...(fields.description !== undefined ? { note: fields.description || null } : {}) };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const group = groups.get(id);
    if (group) group.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}

export function googleHiddenClasses(userId: string) {
  return getDb().select().from(googleEventLinks).where(eq(googleEventLinks.userId, userId)).all()
    .filter(link => link.remote?.status === "cancelled" && /^entry-\d+$/.test(link.uid)).map(link => Number(link.uid.slice(6)));
}

/** Make a restored class visible immediately and send its original fields on the next sync. */
export function resetGoogleClass(userId: string, entryId?: number, onlyHidden = false) {
  const db = getDb();
  const links = db.select().from(googleEventLinks).where(eq(googleEventLinks.userId, userId)).all();
  let changed = false;
  db.transaction(tx => {
    for (const link of links) {
      if (!/^entry-\d+$/.test(link.uid) || (entryId !== undefined && link.uid !== "entry-" + entryId)) continue;
      const where = and(eq(googleEventLinks.userId, userId), eq(googleEventLinks.uid, link.uid));
      if (link.remote?.status === "cancelled") {
        tx.delete(googleExceptions).where(and(eq(googleExceptions.userId, userId), eq(googleExceptions.parentId, link.googleId))).run();
        tx.delete(googleEventLinks).where(where).run();
        changed = true;
      } else if (!onlyHidden && link.overrides && Object.keys(link.overrides).length) {
        tx.update(googleEventLinks).set({ base: { ...link.base, ...link.overrides }, overrides: null, pending: null }).where(where).run();
        changed = true;
      }
    }
  });
  return changed;
}

/** Academic data and RSVPs are shared. Google edits are applied to this student's view only. */
export function applyGoogleSchedule(userId: string, from: string, to: string, raw: CalEvent[],
  readOriginal: (from: string, to: string) => CalEvent[]) {
  const db = getDb();
  const links = db.select().from(googleEventLinks).where(eq(googleEventLinks.userId, userId)).all();
  if (!links.length) return raw;
  const exceptions = db.select().from(googleExceptions).where(eq(googleExceptions.userId, userId)).all();
  const byParent = groupBy(exceptions, e => e.parentId);
  const groups = groupBy(raw, sourceUid);
  for (const link of links) {
    const edits = link.overrides ?? {};
    const changes = byParent.get(link.googleId) ?? [];
    if (!Object.keys(edits).length && !changes.length && link.remote?.status !== "cancelled") continue;
    const native = groups.get(link.uid) ?? [];
    if (link.remote?.status === "cancelled") { groups.delete(link.uid); continue; }
    const template = (date: string) => native[0] ?? readOriginal(date, date).find(e => sourceUid(e) === link.uid)
      ?? readOriginal(campusDate(link.base.timing.start), addDays(campusDate(link.base.timing.start), 34)).find(e => sourceUid(e) === link.uid);
    const excluded = new Set(changes.map(x => occurrenceKey(x.event.originalStartTime!)));
    const result: CalEvent[] = [];
    if (edits.timing) {
      const original = template(campusDate(link.base.timing.start));
      if (original) for (const slice of calendarSlices(edits.timing, from, to)) {
        if (excluded.has(slice.occurrence)) continue;
        result.push(applyText({ ...original, ...slice, originalDate: undefined, moved: true, privateCalendarEdit: true,
          attendanceOccurrence: edits.timing.recurrence?.length ? slice.occurrence : undefined,
          id: original.seriesKey + ":" + slice.occurrence + ":" + slice.date }, edits));
      }
    } else {
      for (const event of native) {
        const key = event.occurrence ?? occurrenceKey({ dateTime: event.date + "T" + String(Math.floor(event.startMin / 60)).padStart(2, "0") + ":" + String(event.startMin % 60).padStart(2, "0") });
        if (!excluded.has(key)) result.push(applyText({ ...event, moved: event.moved || !!edits.summary || !!edits.location || !!edits.description }, edits));
      }
    }
    for (const { event } of changes) {
      if (event.status === "cancelled") continue;
      const slices = calendarSlices(timingOf(event), from, to);
      if (!slices.length) continue;
      const originalDate = campusDate(event.originalStartTime!);
      const original = template(originalDate);
      if (!original) continue;
      for (const slice of slices) {
        result.push(applyText({ ...original, ...slice, originalDate: undefined, privateCalendarEdit: true,
          attendanceOccurrence: original.personalEditor?.pattern || edits.timing?.recurrence?.length ? occurrenceKey(event.originalStartTime!) : originalDate,
          moved: original.moved, id: "google:" + event.id + ":" + slice.date }, { ...edits, summary: event.summary, location: event.location, description: event.description }));
      }
    }
    groups.set(link.uid, result);
  }
  return [...groups.values()].flat();
}
