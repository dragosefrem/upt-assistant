import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { occurrenceOverrides, userCourses, userOverrides, users } from "@/db/schema";
import { LOCALE_NAMES, isLocale } from "@/i18n/config";
import { and, asc } from "drizzle-orm";
import { sources } from "@/db/schema";
import { studentBuildings } from "../campus-buildings";
import { planCampusRoute } from "../campuspath/assistant";
import { publicBaseUrl } from "../export-email";
import { matchGroups } from "../saved-contacts";
import { courseChoices, currentSemester, describeGroup, eventsBetween } from "../schedule";
import { DAY_NAMES, addDays, nowLocal } from "../time";
import { addLink, brief, fold, num, parseClock, span, str, type AssistantTool } from "./toolkit";

/** Tools for the things the Settings page does: profile, course choices, language, plus opening a page. */

/** In-app pages the assistant may open for the student. */
export const PAGES: Record<string, string> = {
  calendar: "/",
  exams: "/exams",
  attendance: "/attendance",
  contacts: "/contacts",
  plan_group_event: "/contacts/plan",
  campus: "/campus",
  guide: "/guide",
  settings: "/settings",
  course_choices: "/settings#courses",
  calendar_export: "/settings#export",
};

export const APP_TOOLS: AssistantTool[] = [
  {
    name: "get_profile",
    description: "Who the student is in the app: faculty, programme, year, group, interface language and where their calendar e-mails go. Use it when they ask what group or year the app has for them.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user, locale }) {
      const group = describeGroup(user.groupId);
      return {
        faculty: group ? (group.faculty.shortName ?? group.faculty.name) : null,
        programme: group?.spec.name ?? null,
        year: user.year,
        group: group?.label ?? null,
        language: LOCALE_NAMES[user.locale ?? locale ?? "ro"],
        calendar_email: user.exportEmail ?? user.email,
        note: group ? undefined : "No group chosen yet: the timetable is empty until they pick one (set_group, or Settings).",
      };
    },
  },
  {
    name: "set_group",
    description:
      "Changes the group (and with it year and programme) the student's timetable is built from, for example after moving to another semigroup. This replaces their whole timetable and clears their course choices and class changes, so call it without `confirmed` first, read back the group it found, and only pass confirmed: true after the student said yes.",
    input_schema: {
      type: "object",
      properties: {
        group: { type: "string", description: "The group as the student says it, e.g. \"CTI anul 1 2.1\" or \"TI 3.2\"." },
        confirmed: { type: "boolean" },
      },
      required: ["group"],
    },
    run(input, ctx) {
      const query = str(input.group);
      if (!query) return { error: "Say which group." };
      const matches = matchGroups(query, ctx.user.facultyId, ctx.user.year);
      if (!matches.length) return { error: `No group matches "${query}".`, hint: "Ask for the programme, year and group as written in the timetable; Settings has the full list." };
      if (matches.length > 1) return { error: "Several groups match; ask which one.", candidates: matches.map((m) => `${m.group} (${m.code ?? ""} ${m.faculty})`.replace("( ", "(")) };
      const [match] = matches;
      const info = describeGroup(match.groupId)!;
      if (info.group.id === ctx.user.groupId) return { error: "That is already the student's group." };
      if (input.confirmed !== true) {
        return {
          needs_confirmation: `Switch the timetable to ${match.group} (${match.faculty})?`,
          note: "This replaces the whole timetable and clears course choices and class changes. Ask the student; if yes, call again with confirmed: true.",
        };
      }
      const db = getDb();
      // Course picks and personal changes refer to the old group's timetable.
      db.delete(userCourses).where(eq(userCourses.userId, ctx.user.id)).run();
      db.delete(userOverrides).where(eq(userOverrides.userId, ctx.user.id)).run();
      db.delete(occurrenceOverrides).where(eq(occurrenceOverrides.userId, ctx.user.id)).run();
      db.update(users)
        .set({ facultyId: info.faculty.id, specializationId: info.spec.id, year: info.group.year, groupId: info.group.id })
        .where(eq(users.id, ctx.user.id))
        .run();
      ctx.changed = true;
      return { group_is_now: match.group, faculty: match.faculty, note: "If this group has optional courses or labs in several slots, the student should check them (list_course_choices)." };
    },
  },
  {
    name: "list_course_choices",
    description:
      "The choices the student has in their timetable: optional courses they may follow or drop, and courses whose lab runs in several slots of which they attend one. Shows what is chosen now. Use it before set_course_choice, and when a lab is missing from their calendar.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      const semester = currentSemester();
      if (!semester) return { error: "No semester configured." };
      const choices = courseChoices(user, semester).filter((c) => c.selectable || c.slots.length > 0);
      return {
        courses: choices.map((c) => ({
          course: c.name,
          acronym: c.abbr,
          optional: c.isOptional,
          can_be_dropped: c.selectable,
          following: c.enrolled,
          lab_slots: c.slots.length
            ? c.slots.map((s, i) => ({ slot: i + 1, kind: s.kind, when: `${DAY_NAMES[s.day]} ${span(s.startMin, s.endMin)}`, room: s.room, chosen: s.entryId === c.chosenSlotId }))
            : undefined,
          needs_a_slot: c.enrolled && c.slots.length > 0 && !c.chosenSlotId ? true : undefined,
        })),
        note: choices.length ? undefined : "This student's timetable has no optional courses and no labs with several slots.",
      };
    },
  },
  {
    name: "set_course_choice",
    description:
      "Follow or drop an optional course, or choose which lab slot the student attends for a course whose lab runs in several slots. Only affects this student's timetable. See list_course_choices for the courses and slot numbers.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or acronym." },
        following: { type: "boolean", description: "true to follow the course, false to drop it (only for courses that can be dropped)." },
        slot: { type: "number", description: "Slot number from list_course_choices." },
        slot_weekday: { type: "number", description: "Alternatively the slot's weekday, 1 = Monday … 7 = Sunday." },
        slot_start: { type: "string", description: "…and its start time, HH:MM." },
      },
      required: ["course"],
    },
    run(input, ctx) {
      const semester = currentSemester();
      if (!semester) return { error: "No semester configured." };
      const q = fold(str(input.course) ?? "");
      if (!q) return { error: "Say which course." };
      const hits = courseChoices(ctx.user, semester).filter(
        (c) => (c.selectable || c.slots.length > 0) && [fold(c.name), fold(c.abbr ?? "")].some((n) => n && (n === q || n.includes(q) || (q.length > 3 && q.includes(n) && n.length > 2))),
      );
      if (!hits.length) return { error: "No course with a choice matches; see list_course_choices." };
      if (hits.length > 1) return { error: "Several courses match; ask which one.", candidates: hits.map((c) => c.name) };
      const [c] = hits;
      let enrolled = c.enrolled;
      if (typeof input.following === "boolean") {
        if (!c.selectable && !input.following) return { error: `${c.name} is a required course and cannot be dropped.` };
        enrolled = input.following;
      }
      let slotEntryId = c.chosenSlotId;
      const slotNumber = num(input.slot);
      const day = num(input.slot_weekday);
      const start = parseClock(input.slot_start);
      if (slotNumber !== undefined || day !== undefined || start !== undefined) {
        const wanted = slotNumber !== undefined ? [c.slots[slotNumber - 1]].filter(Boolean) : c.slots.filter((s) => (day === undefined || s.day === day) && (start === undefined || s.startMin === start));
        if (wanted.length !== 1) {
          return {
            error: c.slots.length ? "That does not pick out one slot; ask which." : `${c.name} has no alternative slots.`,
            slots: c.slots.map((s, i) => `${i + 1}: ${DAY_NAMES[s.day]} ${span(s.startMin, s.endMin)}${s.room ? `, ${s.room}` : ""}`),
          };
        }
        slotEntryId = wanted[0].entryId;
        enrolled = true;
      }
      if (!enrolled) slotEntryId = null;
      if (enrolled === c.enrolled && slotEntryId === c.chosenSlotId) return { error: "That is already the student's choice." };
      getDb()
        .insert(userCourses)
        .values({ userId: ctx.user.id, courseId: c.courseId, enrolled, slotEntryId })
        .onConflictDoUpdate({ target: [userCourses.userId, userCourses.courseId], set: { enrolled, slotEntryId } })
        .run();
      ctx.changed = true;
      const slot = c.slots.find((s) => s.entryId === slotEntryId);
      return {
        course: c.name,
        following: enrolled,
        lab_slot: slot ? `${DAY_NAMES[slot.day]} ${span(slot.startMin, slot.endMin)}${slot.room ? `, ${slot.room}` : ""}` : undefined,
        still_needs_a_slot: enrolled && c.slots.length > 0 && !slotEntryId ? true : undefined,
      };
    },
  },
  {
    name: "set_language",
    description: "Switches the app's interface language to Romanian (\"ro\") or English (\"en\") when the student asks for it. Reply in the new language.",
    input_schema: { type: "object", properties: { language: { type: "string", enum: ["ro", "en"] } }, required: ["language"] },
    run(input, ctx) {
      if (!isLocale(input.language)) return { error: "language must be \"ro\" or \"en\"." };
      getDb().update(users).set({ locale: input.language }).where(eq(users.id, ctx.user.id)).run();
      ctx.setLocale = input.language;
      ctx.locale = input.language;
      return { interface_language: LOCALE_NAMES[input.language], note: "The page switches as soon as your reply is shown." };
    },
  },
  {
    name: "open_page",
    description:
      "Opens a page of the app for the student when they ask to go somewhere (\"open my attendance\", \"take me to settings\"): calendar, exams, attendance, contacts, plan_group_event (find a common free time and book it), campus (walkthroughs to rooms), guide (first-week guide and glossary), settings, course_choices, calendar_export.",
    input_schema: { type: "object", properties: { page: { type: "string", enum: Object.keys(PAGES) } }, required: ["page"] },
    run(input, ctx) {
      const href = typeof input.page === "string" ? PAGES[input.page] : undefined;
      if (!href) return { error: `Unknown page. Choose one of: ${Object.keys(PAGES).join(", ")}.` };
      ctx.open = href;
      return { opening: input.page, note: "The page opens once your short reply is shown." };
    },
  },
  {
    name: "campus_route",
    description:
      "The way to a room, lab, amphitheatre or building on campus (\"B419\", \"A315\", \"D1\", \"the library\"), through the university's 360° tour. Without `from` it starts at the best building entrance for that room, chosen automatically, and the button it puts under your reply opens the whole journey: a Google map to that entrance, then the walkthrough video with turn-by-turn directions. `to` may be \"next\" for the student's next class. Pass `from` only when the student says where inside the campus they are starting. If it answers with a question (a room code that exists in two buildings), ask the student. Use get_directions instead for travel times across the city from the student's GPS position.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Room code or place name, an option value from an earlier question, or \"next\" for the next class." },
        from: { type: "string", description: "Where the student starts: a place name such as \"AC entrance\", a room, or an option value from an earlier question." },
      },
      required: ["to"],
    },
    async run(input, ctx) {
      let to = str(input.to);
      let building: string | undefined;
      let event: ReturnType<typeof brief> | undefined;
      if (!to || /^(next|urm[aă]tor)/i.test(to)) {
        const now = nowLocal();
        const next = eventsBetween(ctx.user, now.date, addDays(now.date, 14)).find((e) =>
          (e.type === "class" || e.type === "exam") && (e.date > now.date || e.startMin >= now.minutes));
        if (!next) return { error: "No upcoming class or exam in the next two weeks." };
        if (!next.room) return { error: "The room has not been published for the next class or exam.", for_class: brief(next) };
        to = next.room;
        building = next.place?.name;
        event = brief(next);
      }
      const answer = await planCampusRoute({ to, from: str(input.from), locale: ctx.locale ?? ctx.user.locale ?? "ro", building });
      if (answer.kind === "unavailable") return { error: answer.message, hint: "Walkthroughs are unavailable right now; offer get_directions to the building instead." };
      if (answer.kind === "question") {
        return {
          question_for_student: answer.message,
          about: answer.field === "start" ? "where they are starting from" : "which place they mean",
          options: answer.options.slice(0, 8),
          hint: `Ask the student${answer.options.length ? " (you may offer the options with show_choices)" : ""}, then call campus_route again with ${answer.field === "start" ? "`from`" : "`to`"} set to their answer or to the option's value.`,
          for_class: event,
        };
      }
      addLink(ctx, answer.title, answer.link);
      return {
        route: answer.title,
        for_class: event,
        starts_at: str(input.from) ? answer.start.name : `${answer.start.name} (chosen automatically: the entrance with the shortest walk to the room)`,
        video_reaches: answer.reach,
        notice: answer.notice ?? undefined,
        directions: answer.steps.map((s) => s.instruction).filter(Boolean).slice(0, 16),
        checkpoints: answer.steps.length,
        video_seconds: answer.durationSeconds,
        note: "A button under your reply opens the journey: a map from where the student is to that entrance, then the walkthrough video with every step. Say which entrance to go to, give the first two or three directions in your own words and mention the button; if video_reaches is not \"room\", say where the video ends.",
      };
    },
  },
  {
    name: "my_buildings",
    description:
      "The buildings where this student actually has classes this semester, most used first, with the address, the rooms they use there and the courses held in them. Use it for \"where are my classes?\", \"which buildings do I need to know?\"; for the way to one room use campus_route.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      const list = studentBuildings(user);
      return {
        buildings: list.map((b) => ({ name: b.name, address: b.address, position_is_approximate: b.approximate, rooms: b.rooms, courses: b.courses, timetable_entries: b.count })),
        note: list.length ? "Counts are activities in the semester timetable. Their weeks can vary. The Guide and Campus pages have a map and room walkthroughs." : "No timetable yet: the student has to choose a group first.",
      };
    },
  },
  {
    name: "timetable_documents",
    description:
      "The official documents this student's timetable and exams were read from (the faculty's published timetable and exam files), with their links and when they were last imported. Use it when the student wants the original timetable or doubts what the app shows.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      if (!user.facultyId) return { error: "The student has not chosen a faculty yet." };
      const rows = getDb()
        .select({ label: sources.label, url: sources.url, kind: sources.kind, status: sources.status, lastFetchedAt: sources.lastFetchedAt })
        .from(sources)
        .where(and(eq(sources.facultyId, user.facultyId)))
        .orderBy(asc(sources.kind), asc(sources.label))
        .all()
        .filter((d) => d.kind !== "other" && (d.status === "imported" || d.status === "partial"));
      return {
        documents: rows.slice(0, 25).map((d) => ({ title: d.label, kind: d.kind, link: d.url, last_imported: d.lastFetchedAt?.slice(0, 10) ?? null, partly_imported: d.status === "partial" || undefined })),
        note: rows.length ? "The same list is under Settings." : "No document has been imported for this faculty yet.",
      };
    },
  },
  {
    name: "get_calendar_link",
    description:
      "The student's private calendar subscription link (.ics) for Google Calendar, Apple Calendar or Outlook, which stays in sync with their timetable. Anyone with the link can see the timetable, so remind them to keep it private. To send the calendar by e-mail instead, use email_calendar.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      const base = publicBaseUrl();
      const path = `/api/ics/${user.feedToken}`;
      return base
        ? { subscription_link: `${base}${path}`, how: "Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription. Outlook: Add calendar → Subscribe from web." }
        : { note: "This server has no public address, so a subscription link would not work from outside. The student can download the file or copy the link under Settings → Export your calendar.", page: "calendar_export" };
    },
  },
];
