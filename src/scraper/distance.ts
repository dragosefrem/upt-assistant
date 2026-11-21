import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { weekday } from "@/lib/time";
import { fetchText } from "./http";
import { norm, squash } from "./text";
import type { DiscoveredSource, NormalizedGroup, NormalizedTimetable, SemesterRef } from "./types";

const programmes: Record<string, { prefix: string; name: string; mode: "ID" | "IFR" }> = {
  RIA: { prefix: "INFO", name: "Informatică", mode: "ID" },
  ETcTI: { prefix: "TST", name: "Tehnologii și sisteme de telecomunicații", mode: "ID" },
  FSC: { prefix: "CRP", name: "Comunicare și relații publice", mode: "ID" },
  MEC: { prefix: "TCM", name: "Tehnologia construcţiilor de maşini", mode: "IFR" },
};

export function distanceSource(faculty: string, semester: SemesterRef): DiscoveredSource | null {
  const programme = programmes[faculty];
  if (!programme) return null;
  const term = semester.academicYear + "-" + semester.number;
  return { reader: "distance", format: "html", kind: "timetable", academicYear: semester.academicYear, semester: semester.number,
    label: programme.name + " (" + programme.mode + ")",
    url: "https://elearning.upt.ro/ro/calendar-cvupt/?term=" + term + "#" + programme.prefix.toLowerCase(),
    context: "Calendar CVUPT" };
}

interface Meeting { shortname: string; fullname: string; eventname: string; date: string; description: string }

export async function loadDistanceCalendar(from: string, to: string) {
  const meetings: Meeting[] = [];
  let year = Number(from.slice(0, 4)), month = Number(from.slice(5, 7));
  while (year * 100 + month <= Number(to.slice(0, 7).replace("-", ""))) {
    // This is the monthly endpoint used by the university's public calendar. Its
    // older index.php endpoint returns different clock times for the same meetings.
    const { text } = await fetchText("https://cv.upt.ro/local/calext/index2.php?luna=" + year + "-" + month);
    const json = /^\s*\(([\s\S]+)\);?\s*$/.exec(text);
    if (!json) throw new Error("The public Campus Virtual calendar returned an unreadable month.");
    const payload: unknown = JSON.parse(json[1]);
    if (!payload || typeof payload !== "object") throw new Error("Unexpected Campus Virtual calendar format.");
    for (const value of Object.values(payload)) {
      if (!value || !["shortname", "fullname", "eventname", "date", "description"].every((key) => typeof value[key] === "string")) {
        throw new Error("Campus Virtual returned a meeting without its published fields.");
      }
      const date = value.date.slice(0, 10);
      if (date >= from && date <= to) meetings.push(value as Meeting);
    }
    if (++month === 13) { year++; month = 1; }
  }
  return meetings;
}

const groupPattern = /(?<!\p{L})gr(?:upa|\.)?\s*(\d+(?:\s*[+&,/]\s*\d+)*)/giu;
function groupNumbers(text: string) {
  return [...new Set([...text.matchAll(groupPattern)].flatMap((m) => m[1].match(/\d+/g) ?? []))];
}

function location(text: string) {
  if (/\bonline\b/i.test(text)) return "online";
  const named = /\b(?:sal[aă]|amf\.?)\s+([\p{L}\d .-]{1,40}?)(?=[,;()\n]|$)/iu.exec(text);
  if (named) return squash(named[1]);
  return /^([A-Z]{1,4}\s?-?\d{1,4}[a-z]?(?:\s*-\s*[A-Z]+\d+)?)(?=[\s,.)-]|$)/u.exec(text)?.[1] ?? null;
}

export function distanceTimetable(calendar: Meeting[], faculty: string, semester: SemesterRef) {
  const programme = programmes[faculty];
  const spec = { name: programme.name, degree: "bachelor" as const, language: "RO, " + programme.mode };
  const meetings = calendar.flatMap((meeting) => {
    const code = /^S(1|2|12)-ID-([A-Z]+)([1-6])-(.+)$/i.exec(meeting.shortname);
    if (!code || (code[1] !== "12" && +code[1] !== semester.number) || code[2] !== programme.prefix) return [];
    const stamp = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d):\d{2}$/.exec(meeting.date);
    if (!stamp) throw new Error("Campus Virtual published an invalid meeting time.");
    const $ = cheerio.load(meeting.description);
    $("a,script,style").remove();
    $("br").replaceWith(" ");
    const detail = squash($.root().text());
    if (/se va recupera|se reprogrameaza|se anuleaza|anulat|cancelled|postponed/.test(norm(detail + " " + meeting.eventname))) return [];
    const groups = groupNumbers(meeting.eventname);
    const rooms = [...detail.matchAll(/(?<!\p{L})gr(?:upa|\.)?\s*(\d+(?:\s*[+&,/]\s*\d+)*)\s*\(([^)]+)\)/giu)];
    const audiences = rooms.length ? rooms.map((m) => ({ groups: groupNumbers(m[0]), room: location(m[2].trim()) }))
      : [{ groups, room: location(detail) ?? location(meeting.eventname) }];
    return audiences.map((audience) => ({ ...audience, date: stamp[1], minute: +stamp[2] * 60 + +stamp[3],
      year: +code[3], title: squash(meeting.fullname), abbr: code[4].replace(/^O-/, ""), label: squash(meeting.eventname),
      optional: /restanta|optional|facultativ/.test(norm(meeting.fullname)) || /^LS2[FG]$/i.test(code[4]) }));
  });
  // A class without a group qualifier is shared by all published groups of that year.
  const groups: NormalizedGroup[] = [];
  for (const year of new Set(meetings.map((m) => m.year))) {
    const numbers = [...new Set(meetings.filter((m) => m.year === year).flatMap((m) => m.groups))].sort((a, b) => +a - +b);
    for (const name of numbers.length ? numbers : [""]) groups.push({ spec, year, series: "", name });
  }
  const table: NormalizedTimetable = { groups, warnings: [], entries: meetings.map((m) => ({
    sheet: programme.prefix, day: weekday(m.date), startMin: m.minute, endMin: m.minute, weeks: m.date,
    courseName: m.title, courseAbbr: m.abbr, kind: /^curs/i.test(m.label) ? "course" : "other", room: m.room,
    teacher: null, rawText: m.label, isSlotOption: false, publishedOptional: m.optional,
    groups: groups.flatMap((g, i) => g.year === m.year && (!m.groups.length || m.groups.includes(g.name)) ? [i] : []),
  })) };
  return { table, hash: createHash("sha1").update(JSON.stringify(table)).digest("hex") };
}
