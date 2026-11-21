import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { googleEventLinks, googleExceptions, personalEvents } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { common } from "@/i18n/messages/common";
import { settings } from "@/i18n/messages/settings";
import type { User } from "./auth";
import type { CalendarTime, CalendarTiming } from "./calendar-types";
import { instant, personalTimes, timingOf } from "./calendar-timing";
import { sharedEventsFor } from "./group-events";
import { isPublicHoliday } from "./holidays";
import { kindLabel } from "./kinds";
import { EVENT_NOTICE_MINUTES } from "./notification-timing";
import { currentSemester, examsForUser, occurrenceMoves, placeResolver, studentWeek, type Semester } from "./schedule";
import { TIME_ZONE, addDays, describeWeeks, formatDate, isDatedMeeting, mondayOf, weekMatches, weekday } from "./time";

/**
 * Calendar-neutral description of a student's timetable, shared by the .ics feed and
 * the Google Calendar sync. Weekly classes become one recurring item whose exceptions
 * remove holidays and the weeks an odd/even-week class does not run.
 */
export interface ExportItem {
  uid: string;
  calendarTiming?: CalendarTiming;
  excludedStarts?: CalendarTime[];
  title: string;
  description: string;
  location: string;
  /** First occurrence. */
  date: string;
  startMin: number;
  endMin: number;
  /** Weekly recurrence until this date (inclusive), skipping `exdates`. */
  until?: string;
  exdates?: string[];
  /** Reminders, in minutes before the start. */
  alarms?: number[];
}

/** Exams remind a day and two hours before, so phones alert even with the app closed. */
export const EXAM_ALARMS = [1440, 120];

/** Kinds named in parentheses after a class title; "other" gets no label. */
const LABELLED_KINDS = new Set(["course", "seminar", "lab", "project"]);

function recurring(semester: Semester, day: number, weeks: string): { first: string; until: string; exdates: string[] } | null {
  if (isDatedMeeting(weeks)) {
    const first = addDays(mondayOf(weeks), day - 1);
    return isPublicHoliday(first) ? null : { first, until: first, exdates: [] };
  }
  const dates = semester.weeks
    .map((monday, i) => ({ date: addDays(monday, day - 1), week: i + 1 }))
    .filter((d) => weekMatches(weeks, d.week) && d.date >= semester.startDate && d.date <= semester.endDate)
    .map((d) => d.date);
  const wanted = new Set(dates.filter((date) => !isPublicHoliday(date)));
  if (!wanted.size) return null;
  const first = dates[0];
  const until = dates[dates.length - 1];
  const exdates: string[] = [];
  for (let d = first; d <= until; d = addDays(d, 7)) if (!wanted.has(d)) exdates.push(d);
  return { first, until, exdates };
}

/**
 * The student's calendar as export items. Titles and descriptions are in `locale`: the
 * account's language when it has one, else English (callers serving a request pass the
 * request's language).
 */
export function sourceItems(user: User, locale: Locale = user.locale ?? "en"): ExportItem[] {
  const t = settings[locale].calendarFile;
  const time = common[locale].time;
  const semester = currentSemester();
  const place = placeResolver(user.facultyId);
  const where = (room: string | null) => {
    const p = place(room);
    return [room, p?.name, p?.address].filter(Boolean).join(", ");
  };
  const items: ExportItem[] = [];

  if (semester && user.groupId) {
    const once = [...occurrenceMoves(user.id).values()];
    for (const e of studentWeek(user, semester)) {
      const r = recurring(semester, e.day, e.weeks);
      const title = `${e.title}${LABELLED_KINDS.has(e.kind) ? ` (${kindLabel(e.kind, locale)})` : ""}`;
      const moves = once.filter((o) => o.entryId === e.entryId);
      if (r && (r.first !== r.until || !moves.some((o) => o.date === r.first))) {
        items.push({
          uid: `entry-${e.entryId}`,
          title,
          description: [e.teacher, describeWeeks(e.weeks, locale), e.endMin === e.startMin ? time.endTimeUnpublished : null, e.note].filter(Boolean).join(" · "),
          location: where(e.room),
          date: r.first,
          startMin: e.startMin,
          endMin: e.endMin,
          until: r.first === r.until ? undefined : r.until,
          // Weeks moved to another time are left out of the series and exported on their own.
          exdates: [...new Set([...r.exdates, ...moves.map((o) => o.date)])].sort(),
        });
      }
      for (const o of moves) {
        if (isPublicHoliday(o.newDate)) continue;
        items.push({
          uid: `entry-${e.entryId}-${o.date}`,
          title,
          description: [e.teacher, t.movedFrom(formatDate(o.date, { weekday: "short", day: "numeric", month: "long" }, locale))].filter(Boolean).join(" · "),
          location: where(o.room ?? e.room),
          date: o.newDate,
          startMin: o.startMin,
          endMin: o.endMin,
        });
      }
    }
  }
  for (const x of examsForUser(user)) {
    items.push({
      uid: `exam-${x.id}`,
      title: t.exam(`${x.courseName}${x.room ? ` · ${x.room}` : ""}`),
      description: [x.room ? t.room(x.room) : null, x.teacher, x.audience, x.endMin === x.startMin ? time.endTimeUnpublished : null, t.goodLuck]
        .filter(Boolean)
        .join(" · "),
      location: where(x.room),
      date: x.date,
      startMin: x.startMin,
      endMin: x.endMin,
      alarms: EXAM_ALARMS,
    });
  }
  const horizon = semester ? (semester.examEnd ?? semester.endDate) : addDays(new Date().toISOString().slice(0, 10), 120);
  for (const p of getDb().select().from(personalEvents).where(eq(personalEvents.userId, user.id)).all()) {
    if (p.date) {
      items.push({ uid: `personal-${p.id}`, title: p.title, description: p.description ?? "", calendarTiming: p.calendarTiming ?? undefined, location: p.location ?? "", date: p.date, startMin: p.startMin, endMin: p.endMin });
    } else if (p.day) {
      const start = semester?.startDate ?? new Date().toISOString().slice(0, 10);
      const first = addDays(start, (p.day - weekday(start) + 7) % 7);
      items.push({ uid: `personal-${p.id}`, title: p.title, description: "", location: p.location ?? "", date: first, startMin: p.startMin, endMin: p.endMin, until: horizon, exdates: [] });
    }
  }
  for (const e of sharedEventsFor(user.id)) {
    items.push({ uid: `group-${e.id}`, title: e.title, location: e.location ?? "", description: common[locale].kinds.shared,
      date: e.date, startMin: e.startMin, endMin: e.endMin });
  }
  return items.map((item) => ({ ...item, alarms: item.alarms ?? [EVENT_NOTICE_MINUTES] }));
}

/** Include the student's Google changes in their read-only subscription and calendar files. */
export function exportItems(user: User, locale: Locale = user.locale ?? "en"): ExportItem[] {
  const items = sourceItems(user, locale);
  const db = getDb();
  const links = db.select().from(googleEventLinks).where(eq(googleEventLinks.userId, user.id)).all();
  if (!links.length) return items;
  const byUid = new Map(links.map(link => [link.uid, link]));
  const exceptions = db.select().from(googleExceptions).where(eq(googleExceptions.userId, user.id)).all();
  return items.flatMap((item): ExportItem[] => {
    const link = byUid.get(item.uid);
    if (!link) return [item];
    if (link.remote?.status === "cancelled") return [];
    const changes = link.overrides;
    const timing = changes?.timing;
    const master = { ...item, title: changes?.summary ?? item.title, location: changes?.location ?? item.location,
      description: changes?.description ?? item.description, ...(timing ? { ...personalTimes(timing), calendarTiming: timing, until: undefined, exdates: undefined } : {}),
      ...(changes?.reminders ? { alarms: changes.reminders.overrides?.filter(o => o.method === "popup").map(o => o.minutes) } : {}),
    };
    const instances = exceptions.filter(ex => ex.parentId === link.googleId);
    const excludedStarts = instances.flatMap(ex => ex.event.originalStartTime ? [ex.event.originalStartTime] : []);
    const moved = instances.flatMap(({ event }): ExportItem[] => {
      if (event.status === "cancelled") return [];
      const timing = timingOf(event);
      return [{ uid: "instance-" + event.id, title: event.summary ?? master.title, location: event.location ?? master.location,
        description: event.description ?? master.description, ...personalTimes(timing), calendarTiming: timing, alarms: master.alarms }];
    });
    return [{ ...master, excludedStarts }, ...moved];
  });
}

/* ───────────────────────────── iCalendar ───────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** "20261120T080000" — local wall-clock time, paired with a TZID. */
export function localStamp(date: string, minutes: number): string {
  if (minutes === 1440) return localStamp(addDays(date, 1), 0);
  return `${date.replace(/-/g, "")}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

function escapeText(s: string): string {
  // RFC 5545 TEXT: backslash, semicolon and comma are escaped; newlines become "\n".
  const BACKSLASH = String.fromCharCode(92);
  return s
    .replaceAll(BACKSLASH, BACKSLASH + BACKSLASH)
    .replaceAll(";", `${BACKSLASH};`)
    .replaceAll(",", `${BACKSLASH},`)
    .replace(/\r?\n/g, `${BACKSLASH}n`);
}

/** RFC 5545 limits lines to 75 octets; longer ones continue on a line starting with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, "utf8");
    if (size + len > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += ch;
    size += len;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TIME_ZONE}`,
  "BEGIN:STANDARD",
  "DTSTART:19701025T040000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0200",
  "TZNAME:EET",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0300",
  "TZNAME:EEST",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

function icsPoint(name: string, point: CalendarTime) {
  if (point.date) return name + ";VALUE=DATE:" + point.date.replaceAll("-", "");
  if (point.timeZone) return name + ";TZID=" + point.timeZone + ":" + instant(point).toFormat("yyyyMMdd'T'HHmmss");
  return name + ":" + instant(point).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

export function toICS(items: ExportItem[], calendarName = "Poli"): string {
  const stamp = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Poli//Timetable//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${TIME_ZONE}`,
    ...VTIMEZONE,
  ];
  for (const item of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.uid}@upt-orar`,
      `DTSTAMP:${stamp}`,
      ...(item.calendarTiming ? [icsPoint("DTSTART", item.calendarTiming.start), ...(item.calendarTiming.endTimeUnspecified ? [] : [icsPoint("DTEND", item.calendarTiming.end)]), ...(item.calendarTiming.recurrence ?? [])] : [
        `DTSTART;TZID=${TIME_ZONE}:${localStamp(item.date, item.startMin)}`,
        ...(item.endMin === item.startMin ? [] : [`DTEND;TZID=${TIME_ZONE}:${localStamp(item.date, item.endMin)}`]),
      ]),
      `SUMMARY:${escapeText(item.title)}`,
    );
    if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
    if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`);
    if (item.until) {
      // UNTIL is in UTC; the end of that day in UTC is safely after the last class.
      lines.push(`RRULE:FREQ=WEEKLY;UNTIL=${item.until.replace(/-/g, "")}T235959Z`);
      if (item.exdates?.length) {
        lines.push(`EXDATE;TZID=${TIME_ZONE}:${item.exdates.map((d) => localStamp(d, item.startMin)).join(",")}`);
      }
    }
    for (const start of item.excludedStarts ?? []) lines.push(icsPoint("EXDATE", start));
    for (const before of item.alarms ?? []) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(`${item.title}${item.location ? ` – ${item.location}` : ""}`)}`,
        `TRIGGER:-PT${before}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
