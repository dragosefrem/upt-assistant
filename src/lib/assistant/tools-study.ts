import "server-only";
import { guide } from "@/i18n/messages/guide";
import { isLocale } from "@/i18n/config";
import { attendanceRecords, markAttendance, summarizeAttendance } from "../attendance";
import { searchGlossary } from "../glossary";
import { makeupSessions, practicalsInWeek } from "../labs";
import { currentSemester, eventsBetween } from "../schedule";
import { semesterOverview } from "../semester-overview";
import { clearStudyPlan, proposeStudyPlan, saveStudyPlan, studyBlocks } from "../study-plan";
import { DAY_NAMES, addDays, describeWeeks, formatMinutes, nowLocal, weekday } from "../time";
import { brief, dated, fold, isDate, num, parseClock, span, str, type AssistantTool } from "./toolkit";

/** Tools about studying: which labs run this week, making up a missed lab, the exam study plan, attendance. */

const KINDS = ["course", "seminar", "lab", "project", "other"] as const;
type Kind = (typeof KINDS)[number];
const kindOf = (v: unknown): Kind | undefined => (KINDS as readonly string[]).includes(v as string) ? (v as Kind) : undefined;

export const STUDY_TOOLS: AssistantTool[] = [
  {
    name: "labs_this_week",
    description:
      "Which of the student's labs, seminars and projects take place in a given week, and which do NOT (labs often run only in odd or even weeks, or only in the first or second half of the semester). Also says the teaching-week number, whether it is odd or even, and whether it is a holiday or exam-session week. Use it for \"do I have lab this week?\", \"is this an odd or even week?\", \"do I have the physics lab next week?\". Never work parity out yourself.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", format: "date", description: "Any day of the week in question, YYYY-MM-DD. Default today; add 7 days for \"next week\"." },
        course: { type: "string", description: "Only this course (name or acronym)." },
        kinds: { type: "array", items: { type: "string", enum: ["lab", "seminar", "project"] }, description: "Which activity types. Default all three; pass [\"lab\"] when asked about labs only." },
        language: { type: "string", enum: ["ro", "en"], description: "Language of the student's question, for holiday names." },
      },
    },
    run(input, { user, locale }) {
      const date = isDate(input.date) ? input.date : nowLocal().date;
      const kinds = Array.isArray(input.kinds) ? input.kinds.flatMap((k) => (k === "lab" || k === "seminar" || k === "project" ? [k as Kind] : [])) : [];
      const week = practicalsInWeek(user, date, kinds.length ? kinds : undefined, isLocale(input.language) ? input.language : locale);
      const course = str(input.course);
      const wanted = (title: string, abbr: string | null) => !course || [fold(title), fold(abbr ?? "")].some((n) => n && (n.includes(fold(course)) || fold(course).includes(n)));
      const running = week.running.filter((e) => wanted(e.title, e.abbr));
      const skipped = week.skipped.filter((e) => wanted(e.title, e.abbr));
      return {
        week: `${week.monday} to ${week.sunday}`,
        teaching_week: week.week,
        parity: week.parity,
        holidays: week.holidays,
        no_teaching: week.pause ? { reason: week.pause, teaching_resumes: week.resumes } : undefined,
        takes_place: running.map(brief),
        not_this_week: skipped.map((e) => ({
          course: e.title,
          kind: e.kind,
          usually: `${DAY_NAMES[e.day]} ${span(e.startMin, e.endMin)}`,
          runs: describeWeeks(e.weeks) ?? "every week",
          next_on: e.next ? dated(e.next) : "finished for this semester",
        })),
        lab_slot_not_chosen: week.unchosen.length ? week.unchosen.map((c) => c.name) : undefined,
        note: !user.groupId
          ? "The student has not chosen a group yet."
          : week.unchosen.length
            ? "For the courses under lab_slot_not_chosen the student has not picked which lab slot they attend, so those labs are missing; they can pick in Settings or ask you (set_course_choice)."
            : undefined,
      };
    },
  },
  {
    name: "find_makeup_lab",
    description:
      "Find upcoming make-up sessions of the same lab, seminar or project. If the student names the missed day, pass missed_on (including relative weekdays like last Tuesday) to check whether their own activity was scheduled. If it was not, report its previous and next dates. Otherwise offer sessions that fit and advise asking the teacher first.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or acronym, e.g. \"PC\" or \"Fizică\"." },
        kind: { type: "string", enum: ["lab", "seminar", "project"], description: "Default: the course's lab." },
        missed_on: { type: "string", format: "date", description: "Date of the student's own missed activity, resolved from their message, YYYY-MM-DD. Independent of the range for replacements." },
        from: { type: "string", format: "date", description: "First day to look at, YYYY-MM-DD. Default today." },
        to: { type: "string", format: "date", description: "Last day, YYYY-MM-DD. Default: the end of next week. At most 28 days after `from`." },
      },
      required: ["course"],
    },
    run(input, { user }) {
      const course = str(input.course);
      if (!course) return { error: "Say which course." };
      const today = nowLocal().date;
      const from = isDate(input.from) && input.from > today ? input.from : today;
      // Through the Sunday of next week: "this week" for a lab every other week needs two.
      let to = isDate(input.to) && input.to >= from ? input.to : addDays(from, 14 - weekday(from));
      if (to > addDays(from, 28)) to = addDays(from, 28);
      const kind = kindOf(input.kind);
      const found = makeupSessions(user, { course, kind, from, to, missedOn: str(input.missed_on) });
      if (!found.ok) {
        if (found.reason === "not-scheduled") return {
          scheduled_on_missed_date: false, activity: found.course, kind: found.kind, missed_on: found.missedOn,
          previous_on: found.previous, next_on: found.next,
          note: "This activity was not on the student's calendar that day. Tell them they did not miss it and give the previous and next scheduled dates when available.",
        };
        if (found.reason === "ambiguous") return { error: "Several activities match; ask which one.", candidates: found.candidates.map((c) => `${c.title} (${c.kind})`) };
        if (found.reason === "not-found") return { error: `No ${kind ?? "lab, seminar or project"} matching "${course}" in the student's timetable. Use list_my_courses to see the names.` };
        return { error: found.reason === "no-group" ? "The student has not chosen a group yet." : "No semester configured." };
      }
      const { result } = found;
      return {
        activity: `${result.course} (${result.kind})`,
        ...(input.missed_on ? { scheduled_on_missed_date: true, missed_on: input.missed_on } : {}),
        searched: `${from} to ${to}`,
        own_sessions: result.own.map((o) => `${dated(o.date)} ${span(o.startMin, o.endMin)}${o.room ? `, ${o.room}` : ""}`),
        other_groups: result.sessions.map((s) => ({
          date: s.date,
          weekday: DAY_NAMES[weekday(s.date)],
          start: formatMinutes(s.startMin),
          end: formatMinutes(s.endMin),
          room: s.room,
          teacher: s.teacher,
          groups: s.groups,
          same_year_and_programme: s.sameYear,
          fits_timetable: s.clashes.length === 0,
          overlaps: s.clashes.length ? s.clashes.map((c) => `${c.title} (${c.kind}) ${span(c.startMin, c.endMin)}`) : undefined,
        })),
        note: result.sessions.length
          ? "Sessions that fit the student's timetable come first. Joining another group's session is up to the lab teacher (seats, attendance rules), so tell the student to ask them first."
          : "No other group has this activity in that period. It may be taught to this group only; suggest asking the teacher about a make-up.",
      };
    },
  },
  {
    name: "plan_exam_study",
    description:
      "Builds a study plan for the exam session, working backwards from each exam: study blocks in the student's free time on the days before it, never on an exam day, the last block being a final review. Each exam usually has two sittings; the plan prepares for the first and lists the later one. Without `confirmed` nothing is saved: describe the proposal briefly (per exam: how many blocks and on which days) and ask whether to add it to the calendar. With confirmed: true the blocks are saved as the student's own events, replacing any earlier study plan. If the faculty has not published exam dates yet, ask the student for the dates they know and pass them in `extra_exams`.",
    input_schema: {
      type: "object",
      properties: {
        hours_per_exam: { type: "number", description: "Study hours wanted per exam. Default 12." },
        block_minutes: { type: "number", description: "Length of one study block. Default 120." },
        blocks_per_day: { type: "number", description: "Most blocks on one day. Default 2." },
        earliest: { type: "string", description: "Earliest start of a block, HH:MM. Default 10:00." },
        latest: { type: "string", description: "Time by which blocks must end, HH:MM. Default 20:00." },
        keep_sunday_free: { type: "boolean", description: "Default true." },
        rest_weekdays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, description: "All weekdays to keep free, 1 Monday through 7 Sunday. Default [7]. For no Saturdays keep the usual Sunday rest too unless asked otherwise: [6,7]. Overrides keep_sunday_free." },
        start_from: { type: "string", format: "date", description: "Do not plan before this date, YYYY-MM-DD." },
        extra_exams: {
          type: "array",
          description: "Exams the student told you about that are not in find_exams yet.",
          items: {
            type: "object",
            properties: { course: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, start: { type: "string", description: "HH:MM, if known" } },
            required: ["course", "date"],
          },
        },
        confirmed: { type: "boolean", description: "Save the plan. Only after the student said yes to the proposal." },
      },
    },
    run(input, ctx) {
      const rest = input.rest_weekdays;
      if (rest !== undefined && (!Array.isArray(rest) || !rest.every((n) => Number.isInteger(n) && n >= 1 && n <= 7))) {
        return { error: "Rest weekdays must be numbers from 1 (Monday) to 7 (Sunday)." };
      }
      if (Array.isArray(input.extra_exams) && input.extra_exams.some((x) => !isDate(x?.date))) {
        return { error: "Each exam needs a real calendar date (YYYY-MM-DD). Ask the student to correct it." };
      }
      const extra = Array.isArray(input.extra_exams)
        ? input.extra_exams.flatMap((x) => {
            const r = (x ?? {}) as Record<string, unknown>;
            const course = str(r.course);
            return course && isDate(r.date) ? [{ course, date: r.date, startMin: parseClock(r.start) }] : [];
          })
        : [];
      const plan = proposeStudyPlan(ctx.user, {
        hoursPerExam: num(input.hours_per_exam),
        sessionMinutes: num(input.block_minutes),
        maxPerDay: num(input.blocks_per_day),
        dayStart: parseClock(input.earliest),
        dayEnd: parseClock(input.latest),
        restOnSunday: input.keep_sunday_free !== false,
        restWeekdays: rest,
        startFrom: isDate(input.start_from) ? input.start_from : undefined,
        extraExams: extra,
      });
      if (!plan.exams.length) {
        const semester = currentSemester();
        return {
          error: "No upcoming exam is known for this student.",
          exam_session: semester?.examStart && semester.examEnd ? `${semester.examStart} to ${semester.examEnd}` : undefined,
          hint: "The faculty publishes exam dates closer to the session. Ask the student which exams and dates they already know and call this again with extra_exams.",
        };
      }
      const perExam = plan.exams.map((x) => {
        const blocks = plan.sessions.filter((s) => s.examKey === x.key);
        return {
          course: x.course,
          exam: `${dated(x.date)} ${formatMinutes(x.startMin)}`,
          later_sitting: x.alsoOn?.length ? x.alsoOn.map(dated) : undefined,
          study_blocks: blocks.map((s) => `${dated(s.date)} ${span(s.startMin, s.endMin)}${s.review ? " (final review)" : ""}`),
          hours: (blocks.length * plan.sessionMinutes) / 60,
        };
      });
      const shortfall = plan.short.length
        ? plan.short.map((s) => `${s.course}: only ${s.planned} of ${s.wanted} blocks fit before it`)
        : undefined;
      if (input.confirmed !== true) {
        return {
          proposal: perExam,
          total_blocks: plan.sessions.length,
          could_not_fit: shortfall,
          currently_saved_blocks: studyBlocks(ctx.user.id).length,
          note: "Nothing is saved yet. Summarise this in a few short sentences (do not read out every block) and ask whether to add it to the calendar; offer the choice with show_choices, for example \"Add it to my calendar\", \"Fewer hours\", \"Start earlier\". To save, call this again with the same settings and confirmed: true.",
        };
      }
      const saved = saveStudyPlan(ctx.user.id, plan.sessions, ctx.locale ?? ctx.user.locale ?? "ro");
      ctx.changed = true;
      return { saved_blocks: saved, plan: perExam, could_not_fit: shortfall, note: "The blocks are in the student's calendar as their own events and can be moved or removed like any other; clear_study_plan removes them all." };
    },
  },
  {
    name: "clear_study_plan",
    description: "Removes every study block that plan_exam_study put in the student's calendar.",
    input_schema: { type: "object", properties: {} },
    run(_input, ctx) {
      const removed = clearStudyPlan(ctx.user.id);
      if (removed) ctx.changed = true;
      return { removed_blocks: removed };
    },
  },
  {
    name: "mark_attendance",
    description:
      "Records whether the student attended one class, exam or event that has already taken place (today or earlier): \"I was at today's PC lab\", \"mark Monday's lecture as missed\". Identify it by its date plus the course name (and kind or start time if several match). `status` \"clear\" removes the mark.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", format: "date", description: "The day it took place, YYYY-MM-DD." },
        course: { type: "string", description: "Course or event title, or its acronym." },
        kind: { type: "string", enum: ["course", "seminar", "lab", "project", "other", "exam", "personal"] },
        start: { type: "string", description: "Its start time HH:MM, to tell two apart." },
        status: { type: "string", enum: ["attended", "missed", "clear"] },
        all_that_day: { type: "boolean", description: "Mark every class of that day; only when the student said so (\"I was at everything today\")." },
      },
      required: ["date", "status"],
    },
    run(input, ctx) {
      if (!isDate(input.date)) return { error: "date must be YYYY-MM-DD." };
      const status = input.status === "attended" || input.status === "missed" ? input.status : input.status === "clear" ? null : undefined;
      if (status === undefined) return { error: "status must be attended, missed or clear." };
      const today = nowLocal().date;
      const q = fold(str(input.course) ?? "");
      const kind = str(input.kind);
      const start = parseClock(input.start);
      const day = eventsBetween(ctx.user, input.date, input.date);
      let hits = day.filter(
        (e) =>
          (!q || [fold(e.title), fold(e.abbr ?? "")].some((n) => n && (n === q || n.includes(q) || (q.length > 3 && q.includes(n) && n.length > 2)))) &&
          (!kind || e.kind === kind) &&
          (start === undefined || e.startMin === start),
      );
      if (input.all_that_day === true) hits = day.filter((e) => e.type === "class");
      else if (!q && !kind && start === undefined) return { error: "Say which class: its course name, kind or start time.", that_day: day.map(brief) };
      if (!hits.length) return { error: `Nothing matching in the student's calendar on ${dated(input.date)}.`, that_day: day.map(brief) };
      if (hits.length > 1 && input.all_that_day !== true) return { error: "Several events match; ask which one.", candidates: hits.map(brief) };
      const marked: string[] = [];
      for (const e of hits) {
        const result = markAttendance(ctx.user, { eventId: e.id, date: e.date, status }, today);
        if (!result.ok) return { error: result.error, marked: marked.length ? marked : undefined };
        marked.push(`${e.title} (${e.kind}) ${span(e.startMin, e.endMin)}`);
      }
      ctx.changed = true;
      return { date: dated(input.date), status: status ?? "mark removed", events: marked };
    },
  },
  {
    name: "get_attendance",
    description:
      "The student's attendance record: how many classes they marked as attended or missed, overall and per activity (course + lecture/lab/seminar), with the dates missed. Use it for \"how many labs have I missed?\" or \"what's my attendance at Physics?\". Only occurrences the student marked are counted.",
    input_schema: { type: "object", properties: { course: { type: "string", description: "Only activities of this course (name or acronym)." } } },
    run(input, { user }) {
      const q = fold(str(input.course) ?? "");
      const summary = summarizeAttendance(attendanceRecords(user.id).filter((r) => !q || [fold(r.title), fold(r.abbr ?? "")].some((n) => n && (n.includes(q) || q.includes(n)))));
      return {
        marked: summary.attended + summary.missed,
        attended: summary.attended,
        missed: summary.missed,
        attendance_rate_percent: summary.rate,
        by_activity: summary.series.map((s) => ({
          activity: `${s.title} (${s.kind})`,
          usually: `${DAY_NAMES[s.weekday]} ${span(s.startMin, s.endMin)}`,
          attended: s.attended,
          missed: s.missed,
          rate_percent: s.rate,
          missed_on: s.records.filter((r) => r.status === "missed").map((r) => r.date),
        })),
        note: summary.attended + summary.missed === 0 ? "Nothing is marked yet. The student marks attendance from a class in the calendar, or by telling you." : undefined,
      };
    },
  },
  {
    name: "explain_term",
    description:
      "Explains a word or abbreviation from university life or the timetable to a new student: serie, grupă, semigrupă, curs / seminar / laborator / proiect (C, S, L, P), odd and even weeks, sesiune, restanță, credits, fișa disciplinei, teaching titles (prof., conf., ș.l., as.), secretariat, Campus Virtual, room codes, ID / IFR. Use it for \"what does semigrupă mean?\" instead of answering from memory; explain in the student's language, in your own words.",
    input_schema: { type: "object", properties: { term: { type: "string", description: "The word or abbreviation as the student wrote it." } }, required: ["term"] },
    run(input, ctx) {
      const term = str(input.term);
      if (!term) return { error: "Say which word." };
      const locale = ctx.locale ?? ctx.user.locale ?? "ro";
      const found = searchGlossary(guide[locale].entries, term).slice(0, 3);
      if (!found.length) return { not_in_glossary: term, hint: "Say you are not sure what it means at UPT and suggest asking the year tutor or the faculty secretariat. The Guide page (open_page guide) has the full glossary." };
      return { entries: found.map((e) => ({ term: e.term, meaning: e.short, details: e.body })), more: "The Guide page has the full glossary (open_page guide)." };
    },
  },
  {
    name: "semester_calendar",
    description:
      "The structure of the current semester: when classes run, the holiday, the exam session, which teaching week it is now (odd or even) and how many are left. Use it for \"when does the session start?\", \"when is the winter holiday?\", \"how many weeks are left?\".",
    input_schema: { type: "object", properties: {} },
    run() {
      const semester = currentSemester();
      if (!semester) return { error: "No semester configured." };
      const o = semesterOverview(semester, nowLocal().date);
      return {
        semester: `${o.number} of ${o.academicYear}`,
        now: o.state === "teaching" ? `teaching week ${o.week} of ${o.totalWeeks} (${o.parity})` : o.state,
        classes_resume: o.state === "holiday" || o.state === "before" ? o.resumes : undefined,
        teaching_weeks_left_after_this_one: o.weeksLeft,
        classes: o.teaching.map((t) => `${t.from} to ${t.to} (${t.weeks} weeks)`),
        holidays: o.holidays.map((h) => `${h.from} to ${h.to}`),
        exam_session: o.session ? `${o.session.from} to ${o.session.to}` : "not set",
      };
    },
  },
  {
    name: "first_week_guide",
    description:
      "The checklist for a new student's first week (check the group, find the rooms, which labs run this week, pick lab slots, put the timetable on the phone, add colleagues, read each course's rules). Use it when a student says they are new, asks where to start, or what they should do first. Walk them through it conversationally, a few steps at a time, and offer to do the steps you can do yourself.",
    input_schema: { type: "object", properties: {} },
    run(_input, ctx) {
      const locale = ctx.locale ?? ctx.user.locale ?? "ro";
      return {
        steps: guide[locale].steps.map((s) => ({ step: s.title, why: s.body, page: s.href, question_poli_can_answer: s.ask })),
        note: "The same checklist, with a glossary and how to read the timetable, is on the Guide page (open_page guide).",
      };
    },
  },
];
