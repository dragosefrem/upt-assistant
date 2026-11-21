import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { personalEvents } from "@/db/schema";
import type { User } from "./auth";
import { currentSemester, examsForUser, placeResolver, studentWeek, type Semester } from "./schedule";
import { TIME_ZONE, addDays, describeWeeks, weekMatches, weekday } from "./time";

/**
 * Calendar-neutral description of a student's timetable, shared by the .ics feed and
 * the Google Calendar sync. Weekly classes become one recurring item whose exceptions
 * remove holidays and the weeks an odd/even-week class does not run.
 */
export interface ExportItem {
  uid: string;
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

const KIND_LABEL: Record<string, string> = { course: "Lecture", seminar: "Seminar", lab: "Lab", project: "Project", other: "" };

function recurring(semester: Semester, day: number, weeks: string): { first: string; until: string; exdates: string[] } | null {
  const dates = semester.weeks
    .map((monday, i) => ({ date: addDays(monday, day - 1), week: i + 1 }))
    .filter((d) => weekMatches(weeks, d.week) && d.date >= semester.startDate && d.date <= semester.endDate)
    .map((d) => d.date);
  if (!dates.length) return null;
  const first = dates[0];
  const until = dates[dates.length - 1];
  const wanted = new Set(dates);
  const exdates: string[] = [];
  for (let d = first; d <= until; d = addDays(d, 7)) if (!wanted.has(d)) exdates.push(d);
  return { first, until, exdates };
}

export function exportItems(user: User): ExportItem[] {
  const semester = currentSemester();
  const place = placeResolver(user.facultyId);
  const where = (room: string | null) => {
    const p = place(room);
    return [room, p?.name, p?.address].filter(Boolean).join(", ");
  };
  const items: ExportItem[] = [];

  if (semester && user.groupId) {
    for (const e of studentWeek(user, semester)) {
      const r = recurring(semester, e.day, e.weeks);
      if (!r) continue;
      items.push({
        uid: `entry-${e.entryId}`,
        title: `${e.title}${KIND_LABEL[e.kind] ? ` (${KIND_LABEL[e.kind]})` : ""}`,
        description: [e.teacher, describeWeeks(e.weeks), e.note].filter(Boolean).join(" · "),
        location: where(e.room),
        date: r.first,
        startMin: e.startMin,
        endMin: e.endMin,
        until: r.until,
        exdates: r.exdates,
      });
    }
  }
  for (const x of examsForUser(user)) {
    items.push({
      uid: `exam-${x.id}`,
      title: `Exam: ${x.courseName}${x.room ? ` · ${x.room}` : ""}`,
      description: [x.room ? `Room ${x.room}` : null, x.teacher, x.audience, "Good luck! 🍀"].filter(Boolean).join(" · "),
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
      items.push({ uid: `personal-${p.id}`, title: p.title, description: "", location: p.location ?? "", date: p.date, startMin: p.startMin, endMin: p.endMin });
    } else if (p.day) {
      const start = semester?.startDate ?? new Date().toISOString().slice(0, 10);
      const first = addDays(start, (p.day - weekday(start) + 7) % 7);
      items.push({ uid: `personal-${p.id}`, title: p.title, description: "", location: p.location ?? "", date: first, startMin: p.startMin, endMin: p.endMin, until: horizon, exdates: [] });
    }
  }
  return items;
}

/* ───────────────────────────── iCalendar ───────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** "20261120T080000" — local wall-clock time, paired with a TZID. */
export function localStamp(date: string, minutes: number): string {
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
      // UIDs keep the old domain so subscribed calendars update instead of duplicating.
      `UID:${item.uid}@upt-orar`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TIME_ZONE}:${localStamp(item.date, item.startMin)}`,
      `DTEND;TZID=${TIME_ZONE}:${localStamp(item.date, item.endMin)}`,
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
