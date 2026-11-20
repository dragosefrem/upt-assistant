import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { buildings, exams, faculties, personalEvents, userOverrides } from "@/db/schema";
import type { User } from "../auth";
import { planTrip, type LatLng } from "../directions";
import {
  currentSemester,
  describeGroup,
  eventsBetween,
  examsForUser,
  findGroups,
  freeSlots,
  groupBusy,
  placeResolver,
  studentWeek,
  teachingWeek,
  type CalEvent,
  type WeekEntry,
} from "../schedule";
import { DAY_NAMES, addDays, formatMinutes, nowLocal, weekday } from "../time";

/**
 * The assistant's capabilities. The same handlers serve Claude (as custom tools) and
 * the built-in keyword assistant, so both give answers from identical data.
 */

export interface ToolContext {
  user: User;
  /** Browser geolocation, when the student has shared it. */
  location: LatLng | null;
  /** Set by a handler that changed the student's timetable, so the UI can refresh. */
  changed: boolean;
}

export interface AssistantTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(input: Record<string, unknown>, ctx: ToolContext): unknown;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function parseClock(v: unknown): number | undefined {
  const m = typeof v === "string" ? /^(\d{1,2})(?::(\d{2}))?$/.exec(v.trim()) : null;
  if (!m) return undefined;
  const minutes = +m[1] * 60 + +(m[2] ?? 0);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : undefined;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function brief(e: CalEvent) {
  return {
    type: e.type,
    kind: e.kind,
    title: e.title,
    date: e.date,
    weekday: DAY_NAMES[weekday(e.date)],
    start: formatMinutes(e.startMin),
    end: formatMinutes(e.endMin),
    room: e.room,
    building: e.place?.name ?? null,
    address: e.place?.address ?? null,
    teacher: e.teacher,
    note: e.note,
  };
}

/** Weekly entries whose course matches a free-text name or acronym. */
function matchEntries(week: WeekEntry[], course: string, kind?: string, day?: number): WeekEntry[] {
  const q = fold(course);
  return week.filter((e) => {
    const names = [fold(e.title), fold(e.abbr ?? "")];
    const hit = names.some((n) => n && (n === q || n.includes(q) || (q.length > 3 && q.includes(n) && n.length > 2)));
    return hit && (!kind || e.kind === kind) && (!day || e.day === day);
  });
}

function upsertOverride(userId: string, entryId: number, patch: Partial<typeof userOverrides.$inferInsert>) {
  getDb()
    .insert(userOverrides)
    .values({ userId, entryId, ...patch })
    .onConflictDoUpdate({ target: [userOverrides.userId, userOverrides.entryId], set: { ...patch, updatedAt: new Date().toISOString() } })
    .run();
}

export const TOOLS: AssistantTool[] = [
  {
    name: "get_schedule",
    description:
      "The student's own timetable (classes, exams, personal events) between two dates, already filtered to their group, optional courses and personal changes. Use for any question about what they have on a day or in a week.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day, YYYY-MM-DD." },
        to: { type: "string", description: "Last day, YYYY-MM-DD. Defaults to `from`. At most 31 days after `from`." },
      },
      required: ["from"],
    },
    run(input, { user }) {
      if (!isDate(input.from)) return { error: "from must be YYYY-MM-DD" };
      const to = isDate(input.to) && input.to >= input.from ? input.to : input.from;
      const capped = to > addDays(input.from, 31) ? addDays(input.from, 31) : to;
      const semester = currentSemester();
      return {
        from: input.from,
        to: capped,
        teaching_week: semester ? teachingWeek(semester, input.from) : null,
        events: eventsBetween(user, input.from, capped).map(brief),
      };
    },
  },
  {
    name: "get_next_event",
    description: "What the student is in right now and what comes next today or on the following days.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      const now = nowLocal();
      const upcoming = eventsBetween(user, now.date, addDays(now.date, 14));
      const current = upcoming.find((e) => e.date === now.date && e.startMin <= now.minutes && e.endMin > now.minutes);
      const next = upcoming.find((e) => e.date > now.date || (e.date === now.date && e.startMin > now.minutes));
      return { now: `${now.date} ${formatMinutes(now.minutes)}`, current: current ? brief(current) : null, next: next ? brief(next) : null };
    },
  },
  {
    name: "find_exams",
    description:
      "Exam dates, times and rooms. By default returns the student's own exams; pass `course` to filter by course name or acronym, or `everyone: true` to search every exam of the faculty.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or acronym to look for." },
        everyone: { type: "boolean", description: "Search all exams of the faculty, not only the student's." },
      },
    },
    run(input, { user }) {
      const place = placeResolver(user.facultyId);
      const course = str(input.course);
      let list = examsForUser(user);
      if (input.everyone === true || (course && !list.some((x) => fold(`${x.courseName} ${x.courseAbbr ?? ""}`).includes(fold(course))))) {
        list = user.facultyId
          ? getDb().select().from(exams).where(eq(exams.facultyId, user.facultyId)).all()
          : [];
      }
      if (course) list = list.filter((x) => fold(`${x.courseName} ${x.courseAbbr ?? ""}`).includes(fold(course)));
      list.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
      return {
        count: list.length,
        exams: list.slice(0, 40).map((x) => ({
          course: x.courseName,
          acronym: x.courseAbbr,
          date: x.date,
          weekday: DAY_NAMES[weekday(x.date)],
          start: formatMinutes(x.startMin),
          end: formatMinutes(x.endMin),
          room: x.room,
          building: place(x.room)?.name ?? null,
          address: place(x.room)?.address ?? null,
          teacher: x.teacher,
          for: x.audience,
        })),
        note: list.length ? undefined : "No exam is scheduled yet for this query. Sessions are published by the faculty closer to the exam period.",
      };
    },
  },
  {
    name: "find_free_slots",
    description:
      "Free time between classes on weekdays. Without `group` it uses the student's own timetable; with `group` (e.g. \"TI 3.2\", \"Calculatoare anul 3 1.1\") it uses that group's shared timetable. Use it to suggest when to meet or study.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day, YYYY-MM-DD." },
        to: { type: "string", description: "Last day, YYYY-MM-DD (at most 14 days after `from`)." },
        min_minutes: { type: "number", description: "Shortest gap worth reporting. Default 60." },
        group: { type: "string", description: "Another group to check instead of the student." },
        day_start: { type: "string", description: "Earliest hour to consider, HH:MM. Default 08:00." },
        day_end: { type: "string", description: "Latest hour to consider, HH:MM. Default 20:00." },
      },
      required: ["from"],
    },
    run(input, { user }) {
      if (!isDate(input.from)) return { error: "from must be YYYY-MM-DD" };
      let to = isDate(input.to) && input.to >= input.from ? input.to : input.from;
      if (to > addDays(input.from, 14)) to = addDays(input.from, 14);
      const opts = {
        minMinutes: num(input.min_minutes) ?? 60,
        dayStart: parseClock(input.day_start) ?? 8 * 60,
        dayEnd: parseClock(input.day_end) ?? 20 * 60,
      };
      let who = "you";
      let busy: Array<{ date: string; startMin: number; endMin: number }>;
      const groupQuery = str(input.group);
      if (groupQuery) {
        const [match] = findGroups(groupQuery, user.facultyId, user.year);
        if (!match) return { error: `No group matches "${groupQuery}".` };
        const info = describeGroup(match.group.id)!;
        who = `${info.spec.name}, year ${info.group.year}, ${info.label}`;
        busy = groupBusy(match.group.id, input.from, to);
      } else {
        busy = eventsBetween(user, input.from, to);
      }
      return {
        for: who,
        from: input.from,
        to,
        free: freeSlots(busy, input.from, to, opts).map((s) => ({
          date: s.date,
          weekday: DAY_NAMES[weekday(s.date)],
          start: formatMinutes(s.startMin),
          end: formatMinutes(s.endMin),
          minutes: s.endMin - s.startMin,
        })),
      };
    },
  },
  {
    name: "get_directions",
    description:
      "How to get from the student's current location to a room, a building, or their next class/exam. `destination` is a room code (\"A204\"), a building or faculty name, or \"next\" for the next event.",
    input_schema: {
      type: "object",
      properties: { destination: { type: "string", description: "Room, building, faculty, or \"next\"." } },
      required: ["destination"],
    },
    run(input, { user, location }) {
      const wanted = str(input.destination) ?? "next";
      const resolve = placeResolver(user.facultyId);
      let place = null as ReturnType<typeof resolve>;
      let event: CalEvent | undefined;
      if (/^(next|urm[aă]tor)/i.test(wanted)) {
        const now = nowLocal();
        event = eventsBetween(user, now.date, addDays(now.date, 14)).find(
          (e) => e.place && (e.date > now.date || e.endMin > now.minutes),
        );
        place = event?.place ?? null;
      } else {
        const db = getDb();
        const q = fold(wanted);
        const building = db.select().from(buildings).all().find((b) => fold(`${b.code} ${b.name}`).includes(q) && b.code !== "ONLINE");
        const faculty = db.select().from(faculties).all().find((f) => fold(`${f.name} ${f.shortName ?? ""}`).includes(q) && f.lat != null);
        if (building) place = { name: building.name, address: building.address, lat: building.lat, lng: building.lng, approximate: /approx/i.test(building.notes ?? "") };
        else if (faculty) place = { name: faculty.name, address: faculty.address, lat: faculty.lat!, lng: faculty.lng!, approximate: false };
        else place = resolve(wanted);
      }
      if (!place) return { error: `No known location for "${wanted}".` };
      const base = {
        destination: place.name,
        address: place.address,
        position_is_approximate: place.approximate,
        event: event ? brief(event) : undefined,
      };
      if (!location) {
        return {
          ...base,
          location_shared: false,
          maps_url: `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`,
          hint: "The student has not shared their location; ask them to press the location button for travel times.",
        };
      }
      const trip = planTrip(location, place);
      return {
        ...base,
        location_shared: true,
        distance_m: trip.distanceMeters,
        summary: trip.summary,
        options: trip.options.map((o) => ({ how: o.label, minutes: o.minutes, maps_url: o.mapsUrl })),
        leave_by: event ? formatMinutes(Math.max(0, event.startMin - trip.leaveMinutesBefore)) : undefined,
      };
    },
  },
  {
    name: "list_my_courses",
    description: "The courses in the student's weekly timetable with their activities (type, weekday, time, room). Use it to resolve which class the student means before changing anything.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      const semester = currentSemester();
      if (!semester) return { error: "No semester configured." };
      return {
        activities: studentWeek(user, semester).map((e) => ({
          course: e.title,
          acronym: e.abbr,
          kind: e.kind,
          weekday: DAY_NAMES[e.day],
          start: formatMinutes(e.startMin),
          end: formatMinutes(e.endMin),
          room: e.room,
          weeks: e.weeks,
          moved_by_student: e.moved,
        })),
      };
    },
  },
  {
    name: "hide_class",
    description: "Remove a recurring class from the student's personal timetable (for example a lecture they do not attend). Only affects this student. Reversible with restore_class.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or acronym." },
        kind: { type: "string", enum: ["course", "seminar", "lab", "project", "other"], description: "Only this activity type." },
        weekday: { type: "number", description: "Only the occurrence on this weekday (1 = Monday … 7 = Sunday)." },
      },
      required: ["course"],
    },
    run(input, ctx) {
      const semester = currentSemester();
      if (!semester) return { error: "No semester configured." };
      const hits = matchEntries(studentWeek(ctx.user, semester), str(input.course) ?? "", str(input.kind), num(input.weekday));
      if (!hits.length) return { error: "No matching class in the timetable." };
      for (const e of hits) upsertOverride(ctx.user.id, e.entryId, { hidden: true });
      ctx.changed = true;
      return { hidden: hits.map((e) => `${e.title} (${e.kind}) ${DAY_NAMES[e.day]} ${formatMinutes(e.startMin)}`) };
    },
  },
  {
    name: "move_class",
    description: "Move one recurring class in the student's personal timetable to another weekday, time or room (for example when they attend a lab with another group). Only affects this student.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or acronym." },
        kind: { type: "string", enum: ["course", "seminar", "lab", "project", "other"] },
        from_weekday: { type: "number", description: "Current weekday, if the course has several activities of that kind." },
        to_weekday: { type: "number", description: "New weekday (1 = Monday … 7 = Sunday)." },
        start: { type: "string", description: "New start time, HH:MM." },
        end: { type: "string", description: "New end time, HH:MM. Defaults to keeping the same duration." },
        room: { type: "string", description: "New room, if it changes." },
      },
      required: ["course"],
    },
    run(input, ctx) {
      const semester = currentSemester();
      if (!semester) return { error: "No semester configured." };
      const hits = matchEntries(studentWeek(ctx.user, semester), str(input.course) ?? "", str(input.kind), num(input.from_weekday));
      if (!hits.length) return { error: "No matching class in the timetable." };
      if (hits.length > 1) {
        return {
          error: "Several classes match; ask which one.",
          candidates: hits.map((e) => ({ course: e.title, kind: e.kind, weekday: e.day, start: formatMinutes(e.startMin) })),
        };
      }
      const [e] = hits;
      const day = num(input.to_weekday) ?? e.day;
      const startMin = parseClock(input.start) ?? e.startMin;
      const endMin = parseClock(input.end) ?? startMin + (e.endMin - e.startMin);
      if (day < 1 || day > 7 || endMin <= startMin) return { error: "Invalid weekday or time." };
      upsertOverride(ctx.user.id, e.entryId, { hidden: false, day, startMin, endMin, room: str(input.room) ?? null });
      ctx.changed = true;
      return { moved: `${e.title} (${e.kind})`, to: `${DAY_NAMES[day]} ${formatMinutes(startMin)}–${formatMinutes(endMin)}`, room: str(input.room) ?? e.room };
    },
  },
  {
    name: "restore_class",
    description: "Undo the student's personal changes (hidden or moved classes). With `course`, only for that course; without it, for everything.",
    input_schema: { type: "object", properties: { course: { type: "string" } } },
    run(input, ctx) {
      const db = getDb();
      const course = str(input.course);
      const mine = db.select().from(userOverrides).where(eq(userOverrides.userId, ctx.user.id)).all();
      let ids = mine.map((o) => o.id);
      if (course) {
        const semester = currentSemester();
        if (!semester) return { error: "No semester configured." };
        // Hidden entries are absent from the effective week, so match on the raw group data.
        const all = studentWeek({ id: "", groupId: ctx.user.groupId, year: ctx.user.year }, semester);
        const wanted = new Set(matchEntries(all, course).map((e) => e.entryId));
        ids = mine.filter((o) => wanted.has(o.entryId)).map((o) => o.id);
      }
      for (const id of ids) db.delete(userOverrides).where(and(eq(userOverrides.id, id), eq(userOverrides.userId, ctx.user.id))).run();
      if (ids.length) ctx.changed = true;
      return { restored: ids.length };
    },
  },
  {
    name: "add_personal_event",
    description: "Add the student's own event to their calendar: either once on a date or every week on a weekday.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD for a one-off event." },
        weekday: { type: "number", description: "1 = Monday … 7 = Sunday for a weekly event (instead of `date`)." },
        start: { type: "string", description: "HH:MM" },
        end: { type: "string", description: "HH:MM" },
        location: { type: "string" },
      },
      required: ["title", "start", "end"],
    },
    run(input, ctx) {
      const title = str(input.title);
      const startMin = parseClock(input.start);
      const endMin = parseClock(input.end);
      const day = num(input.weekday);
      const date = isDate(input.date) ? input.date : undefined;
      if (!title || startMin === undefined || endMin === undefined || endMin <= startMin) return { error: "A title and a valid start/end time are required." };
      if (!date && !(day && day >= 1 && day <= 7)) return { error: "Give either a date or a weekday." };
      getDb()
        .insert(personalEvents)
        .values({ userId: ctx.user.id, title, date: date ?? null, day: date ? null : day!, startMin, endMin, location: str(input.location) ?? null })
        .run();
      ctx.changed = true;
      return { added: title, when: date ? `${date} ${formatMinutes(startMin)}–${formatMinutes(endMin)}` : `every ${DAY_NAMES[day!]} ${formatMinutes(startMin)}–${formatMinutes(endMin)}` };
    },
  },
  {
    name: "remove_personal_event",
    description: "Delete personal events (ones the student added) whose title contains the given text.",
    input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    run(input, ctx) {
      const q = fold(str(input.title) ?? "");
      if (!q) return { error: "A title is required." };
      const db = getDb();
      const hits = db.select().from(personalEvents).where(eq(personalEvents.userId, ctx.user.id)).all().filter((p) => fold(p.title).includes(q));
      for (const p of hits) db.delete(personalEvents).where(eq(personalEvents.id, p.id)).run();
      if (hits.length) ctx.changed = true;
      return { removed: hits.map((p) => p.title) };
    },
  },
];

export function runTool(name: string, input: unknown, ctx: ToolContext): unknown {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return tool.run((input && typeof input === "object" ? input : {}) as Record<string, unknown>, ctx);
  } catch (err) {
    return { error: (err as Error).message };
  }
}
