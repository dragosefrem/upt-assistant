import { DateTime } from "luxon";
import { rrulestr } from "rrule";
import type { CalendarTime, CalendarTiming } from "./calendar-types";
import { TIME_ZONE, addDays, daysBetween } from "./time";

const stampFormat = "yyyyMMdd'T'HHmmss";
const clock = (date: DateTime) => date.hour * 60 + date.minute;

/** Google sometimes returns an offset, sometimes a local wall time with an IANA zone. */
export function instant(point: CalendarTime) {
  return DateTime.fromISO(point.date ?? point.dateTime ?? "", { zone: point.timeZone ?? TIME_ZONE });
}

export function timingOf(event: Partial<CalendarTiming>): CalendarTiming {
  if (!event.start || !event.end || !instant(event.start).isValid || !instant(event.end).isValid) {
    throw new Error("Google Calendar returned an invalid event interval.");
  }
  return {
    start: event.start, end: event.end,
    ...(event.recurrence?.length ? { recurrence: event.recurrence } : {}),
    ...(event.endTimeUnspecified ? { endTimeUnspecified: true } : {}),
  };
}

function pointKey(point: CalendarTime) {
  return point.date ?? instant(point).toUTC().toISO({ suppressMilliseconds: true });
}

export function sameTiming(a: CalendarTiming, b: CalendarTiming) {
  return pointKey(a.start) === pointKey(b.start) && pointKey(a.end) === pointKey(b.end)
    && Boolean(a.endTimeUnspecified) === Boolean(b.endTimeUnspecified)
    && (!a.recurrence?.length || (a.start.timeZone ?? TIME_ZONE) === (b.start.timeZone ?? TIME_ZONE))
    && JSON.stringify([...(a.recurrence ?? [])].sort()) === JSON.stringify([...(b.recurrence ?? [])].sort());
}

export function campusDate(point: CalendarTime) {
  return point.date ?? instant(point).setZone(TIME_ZONE).toISODate()!;
}

export function personalTimes(timing: CalendarTiming) {
  const a = instant(timing.start).setZone(TIME_ZONE);
  const b = instant(timing.end).setZone(TIME_ZONE);
  return { date: campusDate(timing.start), day: null, startMin: timing.start.date ? 0 : clock(a),
    endMin: timing.start.date || campusDate(timing.end) > campusDate(timing.start) ? 1440 : clock(b) };
}

export function editorInterval(timing: CalendarTiming) {
  const date = campusDate(timing.start);
  const allDay = Boolean(timing.start.date);
  const endDate = allDay ? addDays(timing.end.date!, -1) : campusDate(timing.end);
  return { date, endDate, allDay, startMin: allDay ? 0 : clock(instant(timing.start).setZone(TIME_ZONE)),
    endMin: allDay ? 1440 : clock(instant(timing.end).setZone(TIME_ZONE)) };
}

export function editedInterval(date: string, endDate: string, start: number, end: number, allDay: boolean, prior?: CalendarTiming | null): CalendarTiming {
  const at = (day: string, minutes: number, zone?: string): CalendarTime => {
    const local = DateTime.fromISO(day, { zone: TIME_ZONE }).plus({ days: minutes === 1440 ? 1 : 0 })
      .set({ hour: Math.floor(minutes % 1440 / 60), minute: minutes % 60 });
    const timeZone = zone ?? TIME_ZONE;
    return { dateTime: local.setZone(timeZone).toISO({ suppressMilliseconds: true })!, timeZone };
  };
  return {
    start: allDay ? { date } : at(date, start, prior?.start.timeZone),
    end: allDay ? { date: addDays(endDate, 1) } : at(endDate, end, prior?.end.timeZone),
    ...(prior?.recurrence?.length ? { recurrence: prior.recurrence } : {}),
  };
}

// Let RRule expand wall-clock occurrences in the series' own zone. Convert to real instants
// afterwards so the same 09:00 class survives both DST and changes of server time zone.
function recurrenceLines(lines: string[], zone: string, start: DateTime) {
  const localStamp = (value: string, sourceZone: string) => {
    const date = DateTime.fromISO(value, { zone: sourceZone });
    return date.setZone(zone).toFormat(stampFormat);
  };
  return ["DTSTART:" + start.toFormat(stampFormat), ...lines.map((line) => {
    const colon = line.indexOf(":");
    const header = line.slice(0, colon);
    const values = line.slice(colon + 1);
    if (/^(EXDATE|RDATE)(;|$)/i.test(header)) {
      const sourceZone = /;TZID=([^;]+)/i.exec(header)?.[1] ?? zone;
      return header.split(";")[0] + ":" + values.split(",").map((s) => localStamp(s, sourceZone)).join(",");
    }
    return line.replace(/UNTIL=(\d{8}T\d{6}Z)/ig, (_, until: string) => "UNTIL=" + localStamp(until, "UTC"));
  })].join("\n");
}

export interface CalendarSlice { date: string; startMin: number; endMin: number; originalDate: string; occurrence: string; allDay: boolean }

export function occurrenceKey(point: CalendarTime) {
  return point.date ?? instant(point).toUTC().toISO({ suppressMilliseconds: true })!;
}

/** Expand and clip to inclusive campus dates, splitting overnight and all-day events at midnight. */
export function calendarSlices(timing: CalendarTiming, from: string, to: string): CalendarSlice[] {
  const allDay = Boolean(timing.start.date);
  const zone = timing.start.timeZone ?? (allDay ? TIME_ZONE : instant(timing.start).zoneName!) ?? TIME_ZONE;
  const start = instant(timing.start).setZone(zone);
  const end = instant(timing.end).setZone(zone);
  const daySpan = allDay ? daysBetween(timing.start.date!, timing.end.date!) : 0;
  const duration = timing.endTimeUnspecified ? 0 : Math.max(0, end.toMillis() - start.toMillis());
  const starts: DateTime[] = [];
  if (timing.recurrence?.length) {
    const daysBack = Math.max(daySpan, Math.ceil(duration / 86400000)) + 2;
    const min = new Date(addDays(from, -daysBack) + "T00:00:00Z");
    const max = new Date(addDays(to, 2) + "T23:59:59Z");
    const rules = rrulestr(recurrenceLines(timing.recurrence, zone, start), { forceset: true });
    for (const date of rules.between(min, max, true)) {
      starts.push(DateTime.fromJSDate(date, { zone: "UTC" }).setZone(zone, { keepLocalTime: true }));
    }
  } else {
    starts.push(start);
  }
  const result: CalendarSlice[] = [];
  for (const occurrence of starts) {
    const a = occurrence.setZone(TIME_ZONE);
    const b = allDay ? a.plus({ days: daySpan }) : a.plus({ milliseconds: duration });
    const first = a.toISODate()!;
    const finalDate = b.toISODate()!;
    const last = finalDate > first && clock(b) === 0 && b.second === 0 ? addDays(finalDate, -1) : finalDate;
    const key = allDay ? first : occurrence.toUTC().toISO({ suppressMilliseconds: true })!;
    for (let date = first > from ? first : from; date <= last && date <= to; date = addDays(date, 1)) {
      result.push({ date, originalDate: first, occurrence: key, allDay,
        startMin: date === first ? clock(a) : 0, endMin: date === finalDate ? clock(b) : 1440 });
    }
  }
  return result;
}
