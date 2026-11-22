import type { CalendarFields, CalendarTime, CalendarTiming, GoogleEvent } from "./calendar-types";
import { sameTiming, timingOf } from "./calendar-timing";
import { localStamp, type ExportItem } from "./export";
import { TIME_ZONE, addDays, formatMinutes } from "./time";

export const fieldNames = ["summary", "location", "description", "timing", "reminders"] as const;
export type Field = typeof fieldNames[number];

export function localFields(item: ExportItem): CalendarFields {
  const at = (minutes: number) => ({
    dateTime: (minutes >= 1440 ? addDays(item.date, 1) : item.date) + "T" + formatMinutes(minutes % 1440) + ":00",
    timeZone: TIME_ZONE,
  });
  const recurrence: string[] = [];
  if (item.until) {
    recurrence.push("RRULE:FREQ=WEEKLY;UNTIL=" + item.until.replaceAll("-", "") + "T235959Z");
    if (item.exdates?.length) recurrence.push("EXDATE;TZID=" + TIME_ZONE + ":" + item.exdates.map(d => localStamp(d, item.startMin)).join(","));
  }
  const unspecified = item.startMin === item.endMin;
  const timing: CalendarTiming = item.calendarTiming ?? {
    start: at(item.startMin), end: at(unspecified ? item.startMin + 1 : item.endMin),
    ...(unspecified ? { endTimeUnspecified: true } : {}), ...(recurrence.length ? { recurrence } : {}),
  };
  return { summary: item.title, location: item.location, description: item.description, timing,
    ...(item.transparent ? { transparency: "transparent" } : {}),
    reminders: item.alarms?.length ? { useDefault: false, overrides: item.alarms.map(minutes => ({ method: "popup", minutes })) } : { useDefault: true } };
}

export function remoteFields(event: GoogleEvent): CalendarFields {
  return { summary: event.summary ?? "", location: event.location ?? "", description: event.description ?? "",
    timing: timingOf(event), reminders: event.reminders ?? { useDefault: true } };
}

export function equalField(key: Field, a: Partial<CalendarFields>, b: Partial<CalendarFields>) {
  if (key === "timing") return !!a.timing && !!b.timing && sameTiming(a.timing, b.timing);
  if (key === "reminders") {
    const reminders = (v: CalendarFields["reminders"] | undefined) =>
      v?.useDefault ? "default" : (v?.overrides ?? []).map(o => o.method + ":" + o.minutes).sort().join(",");
    return reminders(a.reminders) === reminders(b.reminders);
  }
  return a[key] === b[key];
}

export function googleBody(fields: Partial<CalendarFields>, patch = false) {
  const { timing, ...body } = fields;
  const patchPoint = (point: CalendarTime) => point.date ? { date: point.date, dateTime: null, timeZone: null } : { ...point, date: null };
  return { ...body, ...timing,
    ...(patch && timing ? { start: patchPoint(timing.start), end: patchPoint(timing.end), recurrence: timing.recurrence ?? [], endTimeUnspecified: timing.endTimeUnspecified ?? false } : {}),
  };
}
