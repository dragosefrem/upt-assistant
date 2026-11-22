import "server-only";
import { examAudience } from "../exam-audience";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { isLocale } from "@/i18n/config";
import { buildings, exams, faculties, occurrenceOverrides, personalEvents, userOverrides } from "@/db/schema";
import { normalizeEmail, type User } from "../auth";
import { editedInterval, editorInterval, personalTimes } from "../calendar-timing";
import { planTrip } from "../directions";
import { emailCalendar, isEmail } from "../export-email";
import { holidaysBetween, isPublicHoliday } from "../holidays";
import {
  currentSemester,
  describeGroup,
  eventsBetween,
  examsForUser,
  findGroups,
  freeSlots,
  groupBusy,
  groupWeek,
  overlaps,
  ownCohort,
  placeResolver,
  studentWeek,
  suggestSlots,
  teachingWeek,
  type CalEvent,
  type WeekEntry,
} from "../schedule";
import { DAY_NAMES, addDays, formatMinutes, isDatedMeeting, nowLocal, weekday } from "../time";
import { matchGroups, saveContact, SAVED_NAME_MAX } from "../saved-contacts";
import { tentativeTimesFor } from "../group-events";
import { listPeople, personBusy } from "../people";
import type { AssistantChoice, StoredPreview } from "./choices";
import { APP_TOOLS } from "./tools-app";
import { PEOPLE_TOOLS, resolvePeople } from "./tools-people";
import { STUDY_TOOLS } from "./tools-study";
import { cardForLookup } from "./reply-card";
import { brief, canMovePersonalInChat, fold, isDate, modelResult, num, parseClock, str, strList, type AssistantTool, type ToolContext } from "./toolkit";

export type { AssistantTool, ToolContext } from "./toolkit";

/**
 * The assistant's capabilities. The same handlers serve Claude (as custom tools) and
 * the built-in keyword assistant, so both give answers from identical data.
 */

/** Weekly entries whose course matches a free-text name or acronym. */
function matchEntries(week: WeekEntry[], course: string, kind?: string, day?: number): WeekEntry[] {
  const q = fold(course);
  if (!q.trim()) return [];
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

const PREVIEW_NOTE =
  "The student now sees a preview with Accept, Edit time and any available alternatives. Say in one short sentence what you propose, mentioning any overlap. If they confirm in words, use the exact details they accepted.";

/** The next date (today included) that falls on a weekday. */
function nextOnWeekday(day: number): string {
  const today = nowLocal().date;
  return addDays(today, (day - weekday(today) + 7) % 7);
}

/** Closest time of the same length in each free gap on the proposed day. */
function alternativeTimes(busy: CalEvent[], date: string, start: number, end: number, oldStart?: number) {
  const now = nowLocal();
  if (date < now.date) return [];
  const duration = end - start;
  const gaps = freeSlots(busy.map((e) => ({ ...e, date })), date, date, {
    minMinutes: duration, weekdaysOnly: false, dayStart: Math.max(8 * 60, date === now.date ? now.minutes : 0),
  });
  const nearest = (a: number, b: number) => Math.abs(a - start) - Math.abs(b - start) || a - b;
  const starts: number[] = [];
  for (const gap of gaps) {
    const options: number[] = [];
    for (let s = Math.ceil(gap.startMin / 15) * 15; s + duration <= gap.endMin; s += 15) {
      if (s !== oldStart) options.push(s);
    }
    if (options.length) starts.push(options.sort(nearest)[0]);
  }
  return starts.sort(nearest).slice(0, 2).sort((a, b) => a - b).map((s) => ({ start: formatMinutes(s), end: formatMinutes(s + duration) }));
}

/** That day's timeline with the proposed change, for the student to accept. */
function dayPreview(
  user: User,
  p: {
    action: "add" | "move";
    title: string;
    when: { date: string } | { weekday: number };
    startMin: number;
    endMin: number;
    from?: { date: string; startMin: number; endMin: number };
    roomChange?: StoredPreview["roomChange"];
    skip?: (e: CalEvent) => boolean;
    change: StoredPreview["change"];
  },
): StoredPreview {
  const date = "date" in p.when ? p.when.date : nextOnWeekday(p.when.weekday);
  const range = { startMin: p.startMin, endMin: p.endMin };
  const weekly = !("date" in p.when);
  const busy = eventsBetween(user, date, weekly ? addDays(date, 7) : date)
    .filter((e) => weekday(e.date) === weekday(date) && !p.skip?.(e));
  const clashes = busy.filter((e) => overlaps(e, range));
  const alternatives = clashes.length ? alternativeTimes(busy, date, p.startMin, p.endMin, p.from?.date === date ? p.from.startMin : undefined) : [];
  return {
    status: "pending",
    action: p.action,
    title: p.title,
    date,
    weekly,
    roomChange: p.roomChange,
    start: formatMinutes(p.startMin),
    end: formatMinutes(p.endMin),
    from: p.from ? { date: p.from.date, start: formatMinutes(p.from.startMin), end: formatMinutes(p.from.endMin) } : undefined,
    events: busy.filter((e) => e.date === date)
      .map((e) => ({ title: e.title, kind: e.kind, start: formatMinutes(e.startMin), end: formatMinutes(e.endMin), room: e.room, overlaps: overlaps(e, range) })),
    ...(weekly ? { otherClashes: clashes.filter((e) => e.date !== date).map((e) => ({
      title: e.title, date: e.date, start: formatMinutes(e.startMin), end: formatMinutes(e.endMin),
    })) } : {}),
    ...(alternatives.length ? { alternatives } : {}),
    change: p.change,
  };
}

const OVERLAP_HINT =
  "Nothing was changed. Tell the student what this clashes with and ask whether to go ahead anyway (then call again with allow_overlap: true) or pick another time.";

/**
 * Events in the student's calendar that overlap a time range: on one date, or, for
 * something weekly, on that weekday over the next two weeks (covering odd/even weeks).
 */
function overlapsFor(
  user: User,
  when: { date: string } | { weekday: number },
  startMin: number,
  endMin: number,
  skip: (e: CalEvent) => boolean = () => false,
) {
  const range = { startMin, endMin };
  if ("date" in when) return eventsBetween(user, when.date, when.date).filter((e) => !skip(e) && overlaps(e, range)).map(brief);
  const today = nowLocal().date;
  const seen = new Set<string>();
  return eventsBetween(user, today, addDays(today, 13))
    .filter((e) => weekday(e.date) === when.weekday && !skip(e) && overlaps(e, range))
    .filter((e) => {
      // A weekly class shows up once per week; report it once.
      const key = `${e.type}:${e.title}:${e.startMin}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(brief);
}

type PersonalRow = typeof personalEvents.$inferSelect;

function describePersonal(p: Pick<PersonalRow, "id" | "title" | "date" | "day" | "startMin" | "endMin" | "location">) {
  const time = `${formatMinutes(p.startMin)}–${formatMinutes(p.endMin)}`;
  return {
    personal_event_id: p.id,
    title: p.title,
    when: p.date ? `${DAY_NAMES[weekday(p.date)]} ${p.date} ${time}` : `every ${DAY_NAMES[p.day ?? 0]} ${time}`,
    location: p.location,
  };
}

/** "YYYY-MM-DD HH:MM" (or with a "T") → a slot start. */
function parseSlotKey(v: unknown): Array<{ date: string; startMin: number }> {
  const m = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/.exec(v.trim()) : null;
  const startMin = m ? parseClock(m[2]) : undefined;
  return m && startMin !== undefined ? [{ date: m[1], startMin }] : [];
}

function sanitizeChoices(v: unknown): AssistantChoice[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 6).flatMap((c): AssistantChoice[] => {
    if (!c || typeof c !== "object") return [];
    const r = c as Record<string, unknown>;
    const label = str(r.label)?.slice(0, 80);
    const reply = (str(r.reply) ?? label)?.slice(0, 300);
    if (!label || !reply) return [];
    const choice: AssistantChoice = { label, reply };
    const start = parseClock(r.start);
    const end = parseClock(r.end);
    if (isDate(r.date) && start !== undefined) {
      choice.date = r.date;
      choice.start = formatMinutes(start);
      if (end !== undefined && end > start) choice.end = formatMinutes(end);
    }
    return [choice];
  });
}

const showCard = { type: "boolean", description: "Show these results in chat (default true). Set false for a supplementary lookup so it leaves the student's card in place." };

function moveOptions(events: CalEvent[], date: unknown, start: unknown, end: unknown) {
  const toClock = (value: unknown) => {
    const minutes = parseClock(value);
    return minutes === undefined ? undefined : formatMinutes(minutes);
  };
  return {
    events: events.map(brief).filter((e) => e.move),
    proposed: { date: isDate(date) ? date : undefined, start: toClock(start), end: toClock(end) },
  };
}

const CORE_TOOLS: AssistantTool[] = [
  {
    name: "choose_event_to_move",
    description: "Show the student's matching personal events and class occurrences as selectable rows with a date/time editor. Use for open-ended rescheduling, a missing time, or multiple matches. Pass any known destination separately. The student can select, edit and preview the change directly in chat.",
    input_schema: { type: "object", properties: {
      from: { type: "string", format: "date", description: "Earliest CURRENT event date, default today." },
      to: { type: "string", format: "date", description: "Last current date, default two weeks ahead or the specified from day." },
      title: { type: "string", description: "Part of the actual event title or course acronym, if known." },
      kind: { type: "string", description: "Optional activity kind, e.g. personal or lab." },
      new_date: { type: "string", format: "date" }, new_start: { type: "string" }, new_end: { type: "string" },
      show_card: showCard,
    } },
    run(input, { user }) {
      const from = isDate(input.from) ? input.from : nowLocal().date;
      const to = isDate(input.to) ? input.to : input.from ? from : addDays(from, 13);
      const query = fold(str(input.title) ?? "");
      const kind = str(input.kind);
      const events = eventsBetween(user, from, to < addDays(from, 31) ? to : addDays(from, 31))
        .filter((e) => (!kind || e.kind === kind || e.type === kind) && (!query || fold(e.title).includes(query) || fold(e.abbr ?? "") === query));
      return moveOptions(events, input.new_date, input.new_start, input.new_end);
    },
  },
  {
    name: "get_schedule",
    description:
      "The student's own timetable (classes, exams, personal events) between two dates, already filtered to their group, optional courses and personal changes. Use for any question about what they have on a day or in a week.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date", description: "First day, YYYY-MM-DD." },
        to: { type: "string", format: "date", description: "Last day, YYYY-MM-DD. Defaults to `from`. At most 31 days after `from`." },
        language: { type: "string", enum: ["ro", "en"], description: "Language of the student's question, for holiday names." },
        show_card: showCard,
      },
      required: ["from"],
    },
    run(input, { user, locale }) {
      if (!isDate(input.from)) return { error: "from must be YYYY-MM-DD" };
      const to = isDate(input.to) && input.to >= input.from ? input.to : input.from;
      const capped = to > addDays(input.from, 31) ? addDays(input.from, 31) : to;
      const semester = currentSemester();
      return {
        from: input.from,
        to: capped,
        teaching_week: semester ? teachingWeek(semester, input.from) : null,
        holidays: holidaysBetween(input.from, capped, isLocale(input.language) ? input.language : locale),
        events: eventsBetween(user, input.from, capped).map(brief),
      };
    },
  },
  {
    name: "get_next_event",
    description: "What the student is in right now and what comes next today or on the following days.",
    input_schema: { type: "object", properties: { show_card: showCard } },
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
        from: { type: "string", format: "date", description: "Only sittings on or after this date." },
        to: { type: "string", format: "date", description: "Only sittings on or before this date." },
        next_only: { type: "boolean", description: "Return only the next upcoming sitting, including exams tied at that time." },
        show_card: showCard,
      },
    },
    run(input, { user, locale }) {
      const place = placeResolver(user.facultyId);
      const course = str(input.course);
      let list = examsForUser(user);
      if (input.everyone === true || (course && !list.some((x) => fold(`${x.courseName} ${x.courseAbbr ?? ""}`).includes(fold(course))))) {
        list = user.facultyId
          ? getDb().select().from(exams).where(eq(exams.facultyId, user.facultyId)).all()
          : [];
      }
      if (course) list = list.filter((x) => fold(`${x.courseName} ${x.courseAbbr ?? ""}`).includes(fold(course)));
      const { from, to } = input;
      if (isDate(from)) list = list.filter((x) => x.date >= from);
      if (isDate(to)) list = list.filter((x) => x.date <= to);
      list.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
      if (input.next_only === true) {
        const now = nowLocal();
        const next = list.find((x) => x.date > now.date || (x.date === now.date && x.startMin >= now.minutes));
        list = next ? list.filter((x) => x.date === next.date && x.startMin === next.startMin) : [];
      }
      return {
        count: list.length,
        exams: list.slice(0, 40).map((x) => {
          const building = place(x.room);
          return {
            course: x.courseName,
            acronym: x.courseAbbr,
            date: x.date,
            weekday: DAY_NAMES[weekday(x.date)],
            start: formatMinutes(x.startMin),
            end: x.endMin === x.startMin ? null : formatMinutes(x.endMin),
            room: x.room,
            building: building?.name ?? null,
            address: building?.address ?? null,
            ...(building?.guessed ? { approximate: true } : {}),
            teacher: x.teacher,
            // "Prezentarea 2" rather than the Campus Virtual event name it comes from.
            for: examAudience(x.audience, locale ?? user.locale ?? "ro"),
          };
        }),
        note: list.length ? undefined : "No exam is scheduled yet for this query. Sessions are published by the faculty closer to the exam period.",
      };
    },
  },
  {
    name: "find_free_slots",
    description:
      "Free time between classes on weekdays, as whole gaps. Without `group` it uses the student's own timetable; with `group` (e.g. \"TI 3.2\", \"Calculatoare anul 3 1.1\") it uses that group's shared timetable. Use it for \"when am I free on Monday?\"; to propose concrete times for an activity or a meeting, use find_meeting_slots.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date", description: "First day, YYYY-MM-DD." },
        to: { type: "string", format: "date", description: "Last day, YYYY-MM-DD (at most 14 days after `from`)." },
        min_minutes: { type: "number", description: "Shortest gap worth reporting. Default 60." },
        group: { type: "string", description: "Another group to check instead of the student." },
        show_card: showCard,
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
        const [match] = findGroups(groupQuery, user.facultyId, user.year, 8, ownCohort(user));
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
    name: "find_meeting_slots",
    description:
      "Concrete times when the student is free for an activity of a given length, earliest first and never in the past. Use it for \"when is the earliest I can…\", \"when can I meet <person>?\", \"when are Ana, Mihai and I all free?\", or to plan sport, study or an appointment. With `with` (one or more contacts by name, or groups such as \"TI 3.2\") it only returns times when those people are free too: a linked account is checked against that person's real calendar, a saved person or a group against the group's published timetable. Each option comes from a different free gap where possible; pass the options already offered in `exclude` to get new ones. To check one given time instead, use who_is_free.",
    input_schema: {
      type: "object",
      properties: {
        duration_minutes: { type: "number", description: "Length of the activity in minutes. Default 60." },
        from: { type: "string", format: "date", description: "First day to search, YYYY-MM-DD. Default today." },
        to: { type: "string", format: "date", description: "Last day to search, YYYY-MM-DD. Default 13 days after `from`; at most 31." },
        with: { type: "array", items: { type: "string" }, description: "People to meet: contacts by name, or groups such as \"TI 3.2\"." },
        earliest: { type: "string", description: "Earliest start on any day, HH:MM. Default 08:00." },
        latest: { type: "string", description: "Time by which it must end on any day, HH:MM. Default 20:00." },
        weekdays: { type: "array", items: { type: "number" }, description: "Only these weekdays (1 = Monday … 7 = Sunday). Default every day." },
        exclude: { type: "array", items: { type: "string" }, description: "Start times already offered or turned down, as \"YYYY-MM-DD HH:MM\"." },
        count: { type: "number", description: "How many options to return. Default 3, at most 6." },
      },
    },
    run(input, ctx) {
      const { user } = ctx;
      const now = nowLocal();
      const from = isDate(input.from) && input.from > now.date ? input.from : now.date;
      let to = isDate(input.to) && input.to >= from ? input.to : addDays(from, 13);
      if (to > addDays(from, 31)) to = addDays(from, 31);
      const duration = Math.round(num(input.duration_minutes) ?? 60);
      if (duration < 15 || duration > 12 * 60) return { error: "duration_minutes must be between 15 and 720." };
      const dayStart = parseClock(input.earliest) ?? 8 * 60;
      const dayEnd = parseClock(input.latest) ?? 20 * 60;
      if (dayEnd - dayStart < duration) return { error: "The daily time window is shorter than the activity." };
      const weekdays = Array.isArray(input.weekdays) ? input.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7) : [];
      const exclude = Array.isArray(input.exclude) ? input.exclude.flatMap(parseSlotKey) : [];
      const count = Math.min(Math.max(Math.round(num(input.count) ?? 3), 1), 6);

      const busy: Array<{ date: string; startMin: number; endMin: number }> = [...eventsBetween(user, from, to), ...tentativeTimesFor(user.id, from, to)];
      let who = "you";
      let caveat: string | undefined;
      const others = strList(input.with);
      if (others.length) {
        const resolved = resolvePeople(ctx, others);
        if (resolved.ambiguous.length) return { error: "Several contacts match a name; ask which one.", several_people_match: resolved.ambiguous };
        if (resolved.unknown.length) {
          return {
            error: `Unknown person or group: ${resolved.unknown.map((n) => `"${n}"`).join(", ")}.`,
            known_contacts: listPeople(user.id).map((p) => p.name),
            hint: "Ask which group they are in (for example \"TI 3.2\") and store it with save_contact, or have the student invite them by e-mail (invite_contact). If they are not a UPT student, search without `with`.",
          };
        }
        who = `you and ${resolved.people.map((p) => p.name).join(", ")}`;
        for (const person of resolved.people) busy.push(...personBusy(person, from, to));
        if (resolved.people.some((p) => p.kind === "saved")) caveat = "For saved people and groups only the published timetable is known; they may have other plans.";
      }
      const slots = suggestSlots(busy, { from, to, durationMin: duration, dayStart, dayEnd, notBefore: now, weekdays, exclude, count });
      return {
        for: who,
        duration_minutes: duration,
        searched: `${from} to ${to}, ${formatMinutes(dayStart)}–${formatMinutes(dayEnd)}`,
        slots: slots.map((s) => ({ date: s.date, weekday: DAY_NAMES[weekday(s.date)], start: formatMinutes(s.startMin), end: formatMinutes(s.endMin) })),
        note: slots.length ? undefined : "No free time of that length in this period. Suggest other hours, days or a later week.",
        caveat,
      };
    },
  },
  {
    name: "save_contact",
    description:
      "Remember which group someone the student meets is in (\"Andreea is in TI 3.2\"), so find_meeting_slots can plan around that group's timetable. Saving the same name again updates it. Only the name and group are stored.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The person's name as the student calls them." },
        group: { type: "string", description: "Their group, e.g. \"TI 3.2\" or \"Calculatoare anul 2 2.1\"." },
        group_id: { type: "integer", description: "The chosen groupId when the group search was ambiguous." },
      },
      required: ["name", "group"],
    },
    run(input, ctx) {
      const name = str(input.name);
      const group = str(input.group);
      if (!name || !group) return { error: "A name and a group are required." };
      if (name.length > SAVED_NAME_MAX) return { error: `Use at most ${SAVED_NAME_MAX} characters for a name.` };
      const matches = matchGroups(group, ctx.user.facultyId, ctx.user.year);
      const choice = input.group_id === undefined ? (matches.length === 1 ? matches[0] : undefined) : matches.find(m => m.groupId === input.group_id);
      if (!choice) return { error: matches.length ? "Ask which group before saving; pass the same search and its group_id." : "No matching group.", candidates: matches };
      const saved = saveContact(ctx.user.id, name, choice.groupId);
      ctx.changed = true;
      return { saved: saved.name, group: choice.group, faculty: choice.faculty };
    },
  },
  {
    name: "check_conflicts",
    description:
      "What in the student's calendar overlaps a proposed time: on a date, or on a weekday for something weekly. Use it on any time the student proposes themselves, before asking them to confirm it.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", format: "date", description: "YYYY-MM-DD, for a one-off time." },
        weekday: { type: "number", description: "1 = Monday … 7 = Sunday, for a weekly time (instead of `date`)." },
        start: { type: "string", description: "HH:MM" },
        end: { type: "string", description: "HH:MM" },
      },
      required: ["start", "end"],
    },
    run(input, { user }) {
      const startMin = parseClock(input.start);
      const endMin = parseClock(input.end);
      if (startMin === undefined || endMin === undefined || endMin <= startMin) return { error: "Give a valid start and end, HH:MM." };
      const day = num(input.weekday);
      const when = isDate(input.date) ? { date: input.date } : day && day >= 1 && day <= 7 ? { weekday: day } : null;
      if (!when) return { error: "Give a date or a weekday." };
      const list = overlapsFor(user, when, startMin, endMin);
      return { free: list.length === 0, overlaps: list };
    },
  },
  {
    name: "show_choices",
    description:
      "Show tappable buttons under your reply: time slots to choose from (give date, start and end so they render as calendar options), or quick answers to a question. A tapped button sends its `reply` as the student's next message. Call it at most once per reply. Not for confirming a change: add_personal_event and move_personal_event show their own preview with an Accept button.",
    input_schema: {
      type: "object",
      properties: {
        choices: {
          type: "array",
          description: "1 to 6 choices, in the order to show them.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short button text, e.g. \"Tue 25 Nov · 18:00–19:00\" or \"Other times\"." },
              reply: { type: "string", description: "The message sent for the student when tapped, in the conversation's language, e.g. \"Tuesday 25 November, 18:00–19:00 works for me\" or \"Yes, add it\"." },
              date: { type: "string", format: "date", description: "YYYY-MM-DD, for a time slot." },
              start: { type: "string", description: "HH:MM, for a time slot." },
              end: { type: "string", description: "HH:MM, for a time slot." },
            },
            required: ["label", "reply"],
          },
        },
      },
      required: ["choices"],
    },
    run(input, ctx) {
      const choices = sanitizeChoices(input.choices);
      if (!choices.length) return { error: "Give 1 to 6 choices, each with a label and a reply." };
      ctx.choices = choices;
      return { shown: choices.length, note: "The buttons appear under your reply; the student's tap arrives as their next message." };
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
          end: e.endMin === e.startMin ? null : formatMinutes(e.endMin),
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
    description:
      "Preview moving a recurring class to another weekday, time or room for the entire series in the student's own timetable. For one occurrence use move_class_once. Only save after the student confirms the preview.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or acronym." },
        kind: { type: "string", enum: ["course", "seminar", "lab", "project", "other"] },
        from_weekday: { type: "number", description: "Current weekday, if the course has several activities of that kind." },
        entry_id: { type: "integer", description: "Exact class entry when known." },
        to_weekday: { type: "number", description: "New weekday (1 = Monday … 7 = Sunday)." },
        start: { type: "string", description: "New start time, HH:MM." },
        end: { type: "string", description: "New end time, HH:MM. Defaults to keeping the same duration." },
        room: { type: "string", description: "New room, if it changes." },
        confirmed: { type: "boolean", description: "Save only after the student accepts the preview." },
        allow_overlap: { type: "boolean", description: "Move even if the new time overlaps other events; only after the student agreed." },
      },
    },
    run(input, ctx) {
      const semester = currentSemester();
      if (!semester) return { error: "No semester configured." };
      const week = studentWeek(ctx.user, semester);
      const hits = input.entry_id !== undefined ? week.filter((e) => e.entryId === input.entry_id)
        : matchEntries(week, str(input.course) ?? "", str(input.kind), num(input.from_weekday));
      if (!hits.length) return { error: "No matching class in the timetable." };
      if (hits.length > 1) {
        return {
          error: "Several classes match; ask which one.",
          candidates: hits.map((e) => ({ course: e.title, kind: e.kind, weekday: e.day, start: formatMinutes(e.startMin) })),
        };
      }
      const [e] = hits;
      if (isDatedMeeting(e.weeks)) return { error: "This is a dated class. Use move_class_once." };
      const day = num(input.to_weekday) ?? e.day;
      const startMin = parseClock(input.start) ?? e.startMin;
      const endMin = parseClock(input.end) ?? startMin + (e.endMin - e.startMin);
      if (!Number.isInteger(day) || day < 1 || day > 7 || endMin <= startMin || endMin > 1440) return { error: "Invalid weekday or time." };
      const room = str(input.room) ?? e.room;
      if (day === e.day && startMin === e.startMin && endMin === e.endMin && room === e.room) return { error: "That is already its time." };
      const target = `${DAY_NAMES[day]} ${formatMinutes(startMin)}–${formatMinutes(endMin)}`;
      const itself = (x: CalEvent) => x.entryId === e.entryId && !x.originalDate;
      const clash = overlapsFor(ctx.user, { weekday: day }, startMin, endMin, itself);
      if (input.confirmed !== true) {
        ctx.preview = dayPreview(ctx.user, {
          action: "move", title: `${e.title} (${e.kind})`, when: { weekday: day }, startMin, endMin, skip: itself,
          from: { date: nextOnWeekday(e.day), startMin: e.startMin, endMin: e.endMin },
          roomChange: room && room !== e.room ? { from: e.room, to: room } : undefined,
          change: { tool: "move_class", args: { entry_id: e.entryId, to_weekday: day, start: formatMinutes(startMin), end: formatMinutes(endMin), room: str(input.room) } },
        });
        return { preview_shown: { class: ctx.preview.title, to: target, whole_series: true }, overlaps: clash.length ? clash : undefined, note: PREVIEW_NOTE };
      }
      if (clash.length && input.allow_overlap !== true) return { not_moved: `${e.title} (${e.kind})`, to: target, overlaps: clash, hint: OVERLAP_HINT };
      upsertOverride(ctx.user.id, e.entryId, { hidden: false, day, startMin, endMin, ...(str(input.room) ? { room } : {}) });
      ctx.changed = true;
      return { moved: `${e.title} (${e.kind})`, to: target, room: str(input.room) ?? e.room, overlaps: clash.length ? clash : undefined };
    },
  },
  {
    name: "move_class_once",
    description:
      "Move a single occurrence of a class (for example only next Wednesday's lab) to another date or time in the student's own calendar; every other week stays as it is. Use it whenever the student means one particular day; use move_class only when they want every week changed. Without `confirmed` it changes nothing and shows the student a preview of the new day to accept; use that first.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or acronym." },
        kind: { type: "string", enum: ["course", "seminar", "lab", "project", "other"], description: "Which activity, if the course has several that day." },
        date: { type: "string", format: "date", description: "The date of the occurrence to move, YYYY-MM-DD (as it is now in the calendar)." },
        to_date: { type: "string", format: "date", description: "New date, YYYY-MM-DD. Defaults to the same day." },
        start: { type: "string", description: "New start time, HH:MM. Defaults to the current one." },
        end: { type: "string", description: "New end time, HH:MM. Defaults to keeping the same duration." },
        room: { type: "string", description: "New room, if it changes." },
        confirmed: { type: "boolean", description: "Move now. Only after the student said yes to the preview in words." },
        allow_overlap: { type: "boolean", description: "Move even if the new time overlaps other events; only after the student agreed." },
        entry_id: { type: "number", description: "Internal id of the class, when known; replaces `course` and `kind`." },
        original_date: { type: "string", format: "date", description: "Original occurrence date when multiple weeks now fall on the same day." },
      },
      required: ["date"],
    },
    run(input, ctx) {
      if (!isDate(input.date)) return { error: "date must be YYYY-MM-DD." };
      const date = input.date;
      const course = str(input.course);
      const kind = str(input.kind);
      const entryId = num(input.entry_id);
      if (!course && entryId === undefined) return { error: "Say which class: its course name or acronym." };
      const q = course ? fold(course) : "";
      const matches = (e: CalEvent) =>
        e.type === "class" &&
        (entryId !== undefined
          ? e.entryId === entryId
          : [fold(e.title), fold(e.abbr ?? "")].some((n) => n && (n === q || n.includes(q) || (q.length > 3 && q.includes(n) && n.length > 2))) &&
            (!kind || e.kind === kind));
      const onDay = eventsBetween(ctx.user, date, date);
      const hits = onDay.filter((e) => matches(e) && !e.occurrence && (!input.original_date || (e.originalDate ?? e.date) === input.original_date));
      if (!hits.length) {
        return {
          error: `No matching class on ${DAY_NAMES[weekday(date)]} ${date}.`,
          classes_that_day: onDay.filter((e) => e.type === "class").map((e) => `${e.title} (${e.kind}) ${formatMinutes(e.startMin)}–${formatMinutes(e.endMin)}`),
        };
      }
      if (hits.length > 1) {
        const options = moveOptions(hits, input.to_date, input.start, input.end);
        ctx.card = cardForLookup("choose_event_to_move", modelResult(options));
        return { error: "Several classes match. Ask the student to pick one in the event picker already shown.", candidates: options.events };
      }

      const [e] = hits;
      // An occurrence moved before keeps its original date as its identity.
      const original = e.originalDate ?? e.date;
      const toDate = isDate(input.to_date) ? input.to_date : e.date;
      if (isPublicHoliday(toDate)) return { error: "Timetable classes do not run on a public holiday. Ask for another date.", holidays: holidaysBetween(toDate, toDate, ctx.locale) };
      const startMin = parseClock(input.start) ?? e.startMin;
      const endMin = parseClock(input.end) ?? startMin + (e.endMin - e.startMin);
      if (endMin <= startMin || endMin > 24 * 60) return { error: "Invalid new time." };
      const room = str(input.room) ?? e.room;
      if (toDate === e.date && startMin === e.startMin && endMin === e.endMin && room === e.room) return { error: "That is already its time." };

      const label = `${e.title} (${e.kind})`;
      const fromText = `${DAY_NAMES[weekday(e.date)]} ${e.date} ${formatMinutes(e.startMin)}–${formatMinutes(e.endMin)}`;
      const toText = `${DAY_NAMES[weekday(toDate)]} ${toDate} ${formatMinutes(startMin)}–${formatMinutes(endMin)}`;
      const itself = (x: CalEvent) => x.id === e.id;
      const clash = overlapsFor(ctx.user, { date: toDate }, startMin, endMin, itself);
      if (input.confirmed !== true) {
        ctx.preview = dayPreview(ctx.user, {
          action: "move",
          title: label,
          when: { date: toDate },
          startMin,
          endMin,
          from: { date: e.date, startMin: e.startMin, endMin: e.endMin },
          skip: itself,
          roomChange: room && room !== e.room ? { from: e.room, to: room } : undefined,
          change: { tool: "move_class_once", args: { entry_id: e.entryId, date: e.date, original_date: original, to_date: toDate, start: formatMinutes(startMin), end: formatMinutes(endMin), room: str(input.room) } },
        });
        return { preview_shown: { class: label, from: fromText, to: toText, only_this_week: true }, overlaps: clash.length ? clash : undefined, note: PREVIEW_NOTE };
      }
      if (clash.length && input.allow_overlap !== true) return { not_moved: label, from: fromText, to: toText, overlaps: clash, hint: OVERLAP_HINT };

      getDb()
        .insert(occurrenceOverrides)
        .values({ userId: ctx.user.id, entryId: e.entryId!, date: original, newDate: toDate, startMin, endMin, room })
        .onConflictDoUpdate({
          target: [occurrenceOverrides.userId, occurrenceOverrides.entryId, occurrenceOverrides.date],
          set: { newDate: toDate, startMin, endMin, room },
        })
        .run();
      ctx.changed = true;
      return { moved: label, from: fromText, to: toText, overlaps: clash.length ? clash : undefined, note: "Only this week; the other weeks keep the usual time." };
    },
  },
  {
    name: "restore_class",
    description:
      "Undo the student's personal changes to a named course (hidden or moved classes). Without a course, this undoes every class change. Ask first and pass confirmed: true only after the student agrees to restore everything.",
    input_schema: { type: "object", properties: { course: { type: "string" }, confirmed: { type: "boolean" } } },
    run(input, ctx) {
      const db = getDb();
      const course = str(input.course);
      const weekly = db.select().from(userOverrides).where(eq(userOverrides.userId, ctx.user.id)).all();
      const once = db.select().from(occurrenceOverrides).where(eq(occurrenceOverrides.userId, ctx.user.id)).all();
      let wanted: Set<number> | null = null;
      if (course) {
        const semester = currentSemester();
        if (!semester) return { error: "No semester configured." };
        // Hidden entries are absent from the effective week, so match on the raw group data.
        const all = ctx.user.groupId ? groupWeek(ctx.user.groupId, semester, { includeOptions: true }) : [];
        wanted = new Set(matchEntries(all, course).map((e) => e.entryId));
      }
      const pick = <T extends { entryId: number }>(rows: T[]) => (wanted ? rows.filter((o) => wanted.has(o.entryId)) : rows);
      const weeklyHits = pick(weekly);
      const onceHits = pick(once);
      const restored = weeklyHits.length + onceHits.length;
      if (!course && restored && input.confirmed !== true) return {
        needs_confirmation: "Ask whether to undo every hidden or moved class, including one-off moves. Call again with confirmed: true only after a yes.",
        weekly_changes: weeklyHits.length, one_off_moves: onceHits.length,
      };
      db.transaction((tx) => {
        if (weeklyHits.length) tx.delete(userOverrides).where(and(eq(userOverrides.userId, ctx.user.id), inArray(userOverrides.id, weeklyHits.map((o) => o.id)))).run();
        if (onceHits.length) tx.delete(occurrenceOverrides).where(and(eq(occurrenceOverrides.userId, ctx.user.id), inArray(occurrenceOverrides.id, onceHits.map((o) => o.id)))).run();
      });
      if (restored) ctx.changed = true;
      return { restored };
    },
  },
  {
    name: "add_personal_event",
    description:
      "Add the student's own event to their calendar: either once on a date or every week on a weekday. Without `confirmed` it saves nothing and shows the student a preview of that day to accept; use that first. With confirmed: true it saves, refusing an overlap unless allow_overlap is true.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", format: "date", description: "YYYY-MM-DD for a one-off event." },
        weekday: { type: "number", description: "1 = Monday … 7 = Sunday for a weekly event (instead of `date`)." },
        start: { type: "string", description: "HH:MM" },
        end: { type: "string", description: "HH:MM" },
        location: { type: "string" },
        confirmed: { type: "boolean", description: "Save now. Only after the student said yes to the preview in words." },
        allow_overlap: { type: "boolean", description: "Add even if it overlaps other events; only after the student agreed." },
      },
      required: ["title", "start", "end"],
    },
    run(input, ctx) {
      const title = str(input.title)?.slice(0, 120);
      const startMin = parseClock(input.start);
      const endMin = parseClock(input.end);
      const day = num(input.weekday);
      const date = isDate(input.date) ? input.date : undefined;
      if (!title || startMin === undefined || endMin === undefined || endMin <= startMin) return { error: "A title and a valid start/end time are required." };
      if (!date && !(day && Number.isInteger(day) && day >= 1 && day <= 7)) return { error: "Give either a date or a weekday." };
      const when = date ? `${DAY_NAMES[weekday(date)]} ${date} ${formatMinutes(startMin)}–${formatMinutes(endMin)}` : `every ${DAY_NAMES[day!]} ${formatMinutes(startMin)}–${formatMinutes(endMin)}`;
      const clash = overlapsFor(ctx.user, date ? { date } : { weekday: day! }, startMin, endMin);
      const location = str(input.location) ?? null;
      if (input.confirmed !== true) {
        ctx.preview = dayPreview(ctx.user, {
          action: "add",
          title,
          when: date ? { date } : { weekday: day! },
          startMin,
          endMin,
          change: {
            tool: "add_personal_event",
            args: { title, date, weekday: date ? undefined : day, start: formatMinutes(startMin), end: formatMinutes(endMin), location: location ?? undefined },
          },
        });
        return { preview_shown: { title, when }, overlaps: clash.length ? clash : undefined, note: PREVIEW_NOTE };
      }
      if (clash.length && input.allow_overlap !== true) return { not_added: title, when, overlaps: clash, hint: OVERLAP_HINT };
      getDb()
        .insert(personalEvents)
        .values({ userId: ctx.user.id, title, date: date ?? null, day: date ? null : day!, startMin, endMin, location })
        .run();
      ctx.changed = true;
      return { added: title, when, overlaps: clash.length ? clash : undefined };
    },
  },
  {
    name: "move_personal_event",
    description:
      "Reschedule one of the student's own events (ones they added, such as appointments or meetings) to another time or day. Identify it by `id` (personal_event_id from get_schedule) or by title, a date it is on, and its current start. A weekly event moves as a whole series. Without `confirmed` it changes nothing and shows the student a preview of the day to accept; use that first. With confirmed: true it moves, refusing an overlap unless allow_overlap is true.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "personal_event_id from get_schedule." },
        title: { type: "string", description: "Part of the event's title." },
        date: { type: "string", format: "date", description: "A date the event is on now, YYYY-MM-DD." },
        start: { type: "string", description: "Its current start time, HH:MM." },
        new_date: { type: "string", format: "date", description: "New date for a one-off event, YYYY-MM-DD." },
        new_weekday: { type: "number", description: "New weekday for a weekly event (1 = Monday … 7 = Sunday)." },
        new_start: { type: "string", description: "New start time, HH:MM. Defaults to the current one." },
        new_end: { type: "string", description: "New end time, HH:MM. Defaults to keeping the same duration." },
        confirmed: { type: "boolean", description: "Move now. Only after the student said yes to the preview in words." },
        allow_overlap: { type: "boolean", description: "Move even if the new time overlaps other events; only after the student agreed." },
      },
    },
    run(input, ctx) {
      const id = num(input.id);
      const title = str(input.title);
      const onDate = isDate(input.date) ? input.date : undefined;
      const currentStart = parseClock(input.start);
      if (id === undefined && !title && !onDate && currentStart === undefined) return { error: "Say which event: its id, title, or date and start time." };

      const db = getDb();
      const hits = db
        .select()
        .from(personalEvents)
        .where(eq(personalEvents.userId, ctx.user.id))
        .all()
        .filter(
          (p) =>
            (id === undefined || p.id === id) &&
            (!title || fold(p.title).includes(fold(title))) &&
            (!onDate || (p.date ? p.date === onDate : p.day === weekday(onDate))) &&
            (currentStart === undefined || p.startMin === currentStart),
        );
      if (!hits.length) {
        return {
          error: "None of the student's own events matches.",
          hint: "Only events the student added move this way; look at get_schedule. Classes use move_class, and exams cannot be moved.",
        };
      }
      if (hits.length > 1) {
        const dates = new Set(hits.map((p) => p.date ?? onDate ?? nextOnWeekday(p.day!)));
        const ids = new Set(hits.map((p) => p.id));
        const events = [...dates].sort().flatMap((d) => eventsBetween(ctx.user, d, d).filter((e) => e.personalId && ids.has(e.personalId)));
        ctx.card = cardForLookup("choose_event_to_move", modelResult(moveOptions(events, input.new_date, input.new_start, input.new_end)));
        return { error: "Several events match. Ask the student to pick one in the event picker already shown.", candidates: hits.map(describePersonal) };
      }

      const [p] = hits;
      const timing = p.calendarTiming;
      if (timing && !canMovePersonalInChat(editorInterval(timing), !!timing.recurrence?.length)) {
        return { error: "Open this event in the calendar to edit its dates or recurrence." };
      }
      const startMin = parseClock(input.new_start) ?? p.startMin;
      const endMin = parseClock(input.new_end) ?? startMin + (p.endMin - p.startMin);
      if (endMin <= startMin || endMin > 24 * 60) return { error: "Invalid new time." };
      let date = p.date;
      let day = p.day;
      if (p.date) {
        if (isDate(input.new_date)) date = input.new_date;
        else if (input.new_weekday !== undefined) return { error: "This is a one-off event; give new_date instead of new_weekday." };
      } else {
        const newDay = num(input.new_weekday) ?? (isDate(input.new_date) ? weekday(input.new_date) : undefined);
        if (newDay !== undefined) {
          if (!Number.isInteger(newDay) || newDay < 1 || newDay > 7) return { error: "new_weekday must be 1 (Monday) to 7 (Sunday)." };
          day = newDay;
        }
      }
      if (date === p.date && day === p.day && startMin === p.startMin && endMin === p.endMin) return { error: "That is already its time." };

      const before = describePersonal(p);
      const after = describePersonal({ ...p, date, day, startMin, endMin });
      const clash = overlapsFor(ctx.user, date ? { date } : { weekday: day ?? 0 }, startMin, endMin, (e) => e.personalId === p.id);
      if (input.confirmed !== true) {
        ctx.preview = dayPreview(ctx.user, {
          action: "move",
          title: p.title,
          when: date ? { date } : { weekday: day ?? 0 },
          startMin,
          endMin,
          from: { date: p.date ?? nextOnWeekday(p.day ?? 1), startMin: p.startMin, endMin: p.endMin },
          skip: (e) => e.personalId === p.id,
          change: {
            tool: "move_personal_event",
            args: { id: p.id, new_date: p.date ? date : undefined, new_weekday: p.date ? undefined : day, new_start: formatMinutes(startMin), new_end: formatMinutes(endMin) },
          },
        });
        return { preview_shown: { title: p.title, from: before.when, to: after.when }, overlaps: clash.length ? clash : undefined, note: PREVIEW_NOTE };
      }
      if (clash.length && input.allow_overlap !== true) {
        return { not_moved: p.title, from: before.when, to: after.when, overlaps: clash, hint: OVERLAP_HINT };
      }
      const updatedTiming = timing && date ? editedInterval(date, date, startMin, endMin, false, timing) : null;
      db.update(personalEvents)
        .set(updatedTiming ? { calendarTiming: updatedTiming, ...personalTimes(updatedTiming) } : { date, day, startMin, endMin })
        .where(and(eq(personalEvents.id, p.id), eq(personalEvents.userId, ctx.user.id)))
        .run();
      ctx.changed = true;
      return {
        moved: p.title,
        from: before.when,
        to: after.when,
        overlaps: clash.length ? clash : undefined,
        note: p.date ? undefined : "Weekly event: every week moved.",
      };
    },
  },
  {
    name: "remove_personal_event",
    description:
      "Delete one personal event by id or part of its title. If several match, ask which one. For all matches pass all: true, show the count and ask for a yes before calling again with confirmed: true.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "personal_event_id from get_schedule." },
        title: { type: "string", description: "Part of the event's title." },
        all: { type: "boolean", description: "Delete every matching event; only when the student asked for all of them." },
        confirmed: { type: "boolean", description: "Only after the student confirmed deleting the matches." },
      },
    },
    run(input, ctx) {
      const id = num(input.id);
      const q = fold(str(input.title) ?? "");
      if (id === undefined && !q) return { error: "Give the event's id or part of its title." };
      const db = getDb();
      const hits = db
        .select()
        .from(personalEvents)
        .where(eq(personalEvents.userId, ctx.user.id))
        .all()
        .filter((p) => (id === undefined || p.id === id) && (!q || fold(p.title).includes(q)));
      if (hits.length > 1 && input.all !== true) return { error: "Several events match; ask which one.", candidates: hits.map(describePersonal) };
      if (input.all === true && hits.length && input.confirmed !== true) return {
        needs_confirmation: "Ask whether to delete all the matching events. Call again with confirmed: true only after the student says yes.",
        count: hits.length, matches: hits.map(describePersonal),
      };
      if (hits.length) db.delete(personalEvents).where(and(eq(personalEvents.userId, ctx.user.id), inArray(personalEvents.id, hits.map((p) => p.id)))).run();
      if (hits.length) ctx.changed = true;
      return { removed: hits.map((p) => describePersonal(p)) };
    },
  },
  {
    name: "email_calendar",
    description:
      "E-mail the student's .ics calendar. The saved export and sign-in addresses need no confirmation. For any other address call without confirmed first, ask whether to share this calendar with that exact recipient, then pass confirmed: true only after a yes.",
    input_schema: { type: "object", properties: { to: { type: "string", description: "The exact recipient requested. Defaults to the saved export or sign-in address." }, confirmed: { type: "boolean" } } },
    async run(input, { user, locale }) {
      const to = str(input.to);
      if (input.to !== undefined && (!to || !isEmail(to))) return { error: "Ask for one valid e-mail address." };
      const knownAddress = to && [user.email, user.exportEmail].find((address) => address && normalizeEmail(address) === normalizeEmail(to));
      if (to && !knownAddress && input.confirmed !== true) return {
        needs_confirmation: "Ask whether to share the calendar attachment with this recipient. Call again with this address and confirmed: true only after a yes.",
        recipient: to,
      };
      const result = await emailCalendar(user, knownAddress || to, undefined, user.locale ?? locale ?? "en", { rememberAddress: false });
      if (!result.ok) return { error: result.error };
      return {
        sent_to: result.sentTo,
        note: "Tell them where it went, that they can open the attachment or import it (the e-mail explains how), and that the address can be changed in Settings.",
      };
    },
  },
];

/** Every tool the assistant can call: the calendar core, then studying, people and app settings. */
export const TOOLS: AssistantTool[] = [...CORE_TOOLS, ...STUDY_TOOLS, ...PEOPLE_TOOLS, ...APP_TOOLS];
const previewTools = new Set<string>(["add_personal_event", "move_personal_event", "move_class_once", "move_class"]);

/** Runs a tool; for an asynchronous tool the result is a promise, which callers await. */
export function runTool(name: string, input: unknown, ctx: ToolContext): unknown {
  const tool = TOOLS.find((t) => t.name === name);
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const supportsCard = tool && "show_card" in tool.input_schema.properties;
  const background = supportsCard && args.show_card === false;
  // A new lookup of the same kind supersedes the previous result. Looking up a supporting fact
  // keeps the card the student asked for: in the background, or with a tool that shows no card
  // of its own ("what do I have tomorrow, and how do I get to ASPC?"). A change or a choice in
  // the same turn hides the card where the reply is put together.
  if (supportsCard ? !background : !tool) ctx.card = undefined;
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    for (const [key, schema] of Object.entries(tool.input_schema.properties)) {
      if (schema && typeof schema === "object" && "format" in schema && schema.format === "date" && args[key] !== undefined && !isDate(args[key])) {
        return { error: `${key} must be a real calendar date (YYYY-MM-DD). Ask the student to correct it.` };
      }
    }
    const changesCalendar = previewTools.has(tool.name);
    if (changesCalendar || name === "choose_event_to_move") {
      ctx.preview = undefined;
      ctx.choices = undefined;
    }
    let result: unknown;
    if (changesCalendar && args.confirmed === true && ctx.confirmPreview) {
      result = tool.run({ ...args, confirmed: false }, ctx);
      const saved = ctx.preview && ctx.confirmPreview(ctx.preview);
      if (saved) {
        ctx.preview = undefined;
        ctx.changed = true;
        ctx.savedReply = saved;
        result = { saved: true, confirmation: saved };
      }
    } else {
      result = tool.run(args, ctx);
    }
    if (result instanceof Promise) return result.then((value) => modelResult(value)).catch((err: Error) => modelResult({ error: err.message }));
    const value = modelResult(result);
    if (supportsCard && value && typeof value === "object") {
      if (!background) ctx.card = cardForLookup(name, value);
      return { ...value, chat_card: ctx.card?.type ?? null };
    }
    return value;
  } catch (err) {
    return modelResult({ error: (err as Error).message });
  }
}
