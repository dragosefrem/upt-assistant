import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { specializations, userCourses, users } from "@/db/schema";
import { LOCALE_NAMES, isLocale } from "@/i18n/config";
import { facultyDocuments } from "../faculty-documents";
import { pickerData, facultyOf, studiesInHunedoara } from "../catalog";
import { programmeOptions } from "../profile-options";
import { applyStudyProfile, profileError, type StudyProfile } from "../study-profile";
import { studentBuildings } from "../campus-buildings";
import { planCampusRoute } from "../campuspath/assistant";
import { listClassrooms } from "../campuspath/client";
import { campus } from "@/i18n/messages/campus";
import { settings } from "@/i18n/messages/settings";
import { rotateCalendarFeed } from "../auth";
import { disconnectGoogle, googleConfigured, googleSyncMode, syncToGoogle } from "../google";
import { publicBaseUrl } from "../export-email";
import { matchGroups } from "../saved-contacts";
import { courseChoices, currentSemester, describeGroup, eventsBetween, hiddenClasses, unhideClass, needsSlot } from "../schedule";
import { DAY_NAMES, addDays, formatMinutes, nowLocal } from "../time";
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
      const faculty = group?.faculty ?? facultyOf(user.facultyId);
      const spec = group?.spec ?? (user.specializationId ? getDb().select().from(specializations).where(eq(specializations.id, user.specializationId)).get() : null);
      return {
        faculty: faculty?.shortName ?? faculty?.name ?? null,
        programme: spec?.name ?? null,
        year: user.year,
        group: group?.label ?? null,
        language: LOCALE_NAMES[user.locale ?? locale ?? "ro"],
        calendar_email: user.exportEmail ?? user.email,
        note: group ? undefined : "No group chosen yet: the timetable is empty until they pick one (set_group, or Settings).",
      };
    },
  },
  {
    name: "find_programmes",
    description: "Find profile options from the same catalogue as Settings. Filter by year, faculty name/code and programme name/code. For a selected programme_id, return its groups and series, or indicate it has no published groups.",
    input_schema: { type: "object", properties: {
      year: { type: "integer", minimum: 1, maximum: 6 }, faculty: { type: "string" }, programme: { type: "string" }, programme_id: { type: "integer" },
    }, required: ["year"] },
    run(input) {
      const year = num(input.year);
      if (!year || !Number.isInteger(year) || year < 1 || year > 6) return { error: "Choose a study year from 1 to 6." };
      const data = pickerData();
      const offered = programmeOptions(data.specializations, data.groups, year);
      const facultyQuery = fold(str(input.faculty) ?? "");
      const programmeQuery = fold(str(input.programme) ?? "");
      const faculties = data.faculties.filter(f => fold(`${f.shortName ?? ""} ${f.name}`).includes(facultyQuery));
      const matches = [...offered.scheduled, ...offered.other].filter(s =>
        faculties.some(f => f.id === s.facultyId) && fold(`${s.code ?? ""} ${s.name}`).includes(programmeQuery) &&
        (input.programme_id === undefined || s.id === input.programme_id));
      return { year, count: matches.length, programmes: matches.slice(0, 30).map(s => ({
        programme_id: s.id, name: s.name, faculty: faculties.find(f => f.id === s.facultyId)?.name, degree: s.degree, language: s.language,
        groups: matches.length === 1 ? data.groups.filter(g => g.specializationId === s.id && g.year === year).map(g => ({ group_id: g.id, group: g.name, series: g.series })) : undefined,
      })), note: matches.length > 30 ? "Narrow the faculty or programme search." : undefined };
    },
  },
  {
    name: "set_group",
    description: "Change the student's timetable profile. Supply a group name or a programme_id, year and group_id from find_programmes. Omit group_id for a programme without published groups. Confirm the exact selection with the student before replacing course choices and class changes.",
    input_schema: { type: "object", properties: {
      group: { type: "string" }, programme_id: { type: "integer" }, year: { type: "integer" }, group_id: { type: "integer" }, confirmed: { type: "boolean" },
    } },
    run(input, ctx) {
      const locale = ctx.locale ?? "en";
      let profile: StudyProfile;
      let label: string;
      if (input.programme_id !== undefined) {
        const spec = pickerData().specializations.find(s => s.id === input.programme_id);
        if (!spec) return { error: "Choose a programme from find_programmes." };
        profile = { facultyId: spec.facultyId, specializationId: spec.id, year: num(input.year) ?? 0, groupId: num(input.group_id) ?? null };
        const error = profileError(profile);
        if (error) return { error: `Invalid ${error}. Use find_programmes for this year.` };
        const info = describeGroup(profile.groupId, locale);
        label = [spec.name, `year ${profile.year}`, info?.label ?? "no published group"].join(", ");
      } else {
        const query = str(input.group);
        if (!query) return { error: "Say which group or programme." };
        const matches = matchGroups(query, ctx.user.facultyId, ctx.user.year, locale);
        const match = input.group_id === undefined ? (matches.length === 1 ? matches[0] : undefined) : matches.find(m => m.groupId === input.group_id);
        if (!match) return { error: matches.length ? "Several groups match; ask for a group_id." : "No group matches. Search find_programmes.", candidates: matches };
        const info = describeGroup(match.groupId)!;
        profile = { facultyId: info.faculty.id, specializationId: info.spec.id, year: info.group.year, groupId: info.group.id };
        if (profileError(profile)) return { error: "This group is no longer offered. Search find_programmes." };
        label = `${match.group} (${match.faculty})`;
      }
      if (ctx.user.specializationId === profile.specializationId && ctx.user.year === profile.year && ctx.user.groupId === profile.groupId) return { error: "That is already the student's profile." };
      if (input.confirmed !== true) return { needs_confirmation: `Switch the timetable to ${label}? Ask before replacing the existing timetable choices and class changes.` };
      applyStudyProfile(ctx.user, profile);
      Object.assign(ctx.user, profile);
      ctx.changed = true;
      return { group_is_now: label, note: "Use list_course_choices for optional courses and alternative lab slots." };
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
          needs_a_slot: needsSlot(c) ? true : undefined,
          // The class is already in the timetable at a fixed time; these slots are extra sessions.
          slots_are_supplementary: c.slotsAreExtra ? true : undefined,
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
        slot: { type: "integer", minimum: 0, description: "Slot number from list_course_choices, or 0 to clear the selected slot." },
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
      if (slotNumber === 0) {
        slotEntryId = null;
      } else if (slotNumber !== undefined || day !== undefined || start !== undefined) {
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
        still_needs_a_slot: enrolled && c.slots.length > 0 && !slotEntryId && !c.slotsAreExtra ? true : undefined,
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
    name: "browse_classrooms",
    description: "Search the Campus classroom directory by room or building, filter by tour coverage and page through results. Use a room's ID with campus_route.",
    input_schema: { type: "object", properties: {
      query: { type: "string" }, coverage: { type: "string", enum: ["exact", "checkpoint", "unmapped"] }, offset: { type: "integer", minimum: 0 },
    } },
    async run(input, ctx) {
      const coverage = input.coverage;
      if (coverage !== undefined && coverage !== "exact" && coverage !== "checkpoint" && coverage !== "unmapped") return { error: "Unknown coverage filter." };
      const lang = ctx.locale ?? ctx.user.locale ?? "en";
      const page = await listClassrooms({ q: str(input.query), coverage, lang, offset: Math.max(0, Math.floor(num(input.offset) ?? 0)), limit: 20 });
      return { total: page.total, next_offset: page.offset + page.items.length < page.total ? page.offset + page.items.length : null,
        rooms: page.items.map(r => ({ id: r.index, code: r.code, room: r.name, building: r.area, floor: r.level, video_reaches: r.reach, sources: r.sources })) };
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
        qr: { type: "boolean", description: "Add a QR image for this walk if the student asks to share it." },
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
      const answer = await planCampusRoute({ to, from: str(input.from), locale: ctx.locale ?? ctx.user.locale ?? "ro", building,
        home: studiesInHunedoara(ctx.user) ? "hunedoara" : undefined });
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
      if (input.qr === true && ctx.origin) {
        const qr = new URLSearchParams({ link: new URL(answer.link, ctx.origin).href, format: "png" });
        addLink(ctx, campus[ctx.locale ?? "en"].share.saveImage, `/api/campus/qr?${qr}`);
      }
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
      const semester = currentSemester();
      const rows = [...facultyDocuments(user.facultyId, "timetable", semester), ...facultyDocuments(user.facultyId, "exams")];
      return {
        documents: rows.map(d => ({ title: d.label, kind: d.kind, link: d.pdfId ? `/api/timetables/${d.pdfId}` : d.url,
          publication: d.url, status: d.status, import_details: d.message, last_imported: d.lastFetchedAt?.slice(0, 10) ?? null })),
        note: rows.length ? "Settings lists timetable publications. Exams lists the exam sources." : "No document is listed for this faculty yet.",
      };
    },
  },
  {
    name: "list_hidden_classes",
    description: "List individual hidden classes in Settings. Use the entry ID with show_hidden_class to restore visibility while keeping its time, room and one-off moves.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      return { classes: hiddenClasses(user.id, currentSemester()?.id).map(e => ({
        entry_id: e.id, course: e.name, kind: e.kind, weekday: e.movedDay ?? e.day, start: formatMinutes(e.movedTime ?? e.time),
      })) };
    },
  },
  {
    name: "show_hidden_class",
    description: "Make one hidden class visible again. Pass its entry ID from list_hidden_classes.",
    input_schema: { type: "object", properties: { entry_id: { type: "integer" } }, required: ["entry_id"] },
    run(input, ctx) {
      const id = num(input.entry_id);
      if (!id || !unhideClass(ctx.user.id, id)) return { error: "No hidden class with that ID for this student." };
      ctx.changed = true;
      return { shown: id };
    },
  },
  {
    name: "renew_calendar_link",
    description: "Replace the private calendar subscription link. Tell the student all old subscriptions stop updating and ask for a yes before passing confirmed: true.",
    input_schema: { type: "object", properties: { confirmed: { type: "boolean" } } },
    run(input, ctx) {
      if (input.confirmed !== true) return { needs_confirmation: "Replace the private feed address and invalidate the old subscriptions?" };
      rotateCalendarFeed(ctx.user.id);
      ctx.changed = true;
      addLink(ctx, settings[ctx.locale ?? "en"].export.file.title, "/settings#export");
      return { renewed: true, note: "The new link is ready in Settings." };
    },
  },
  {
    name: "google_calendar",
    description: "Check the Google Calendar connection, open the student's consent screen, sync their dedicated Poli calendar using the direction selected in Settings, or disconnect it. Ask before syncing or disconnecting.",
    input_schema: { type: "object", properties: {
      action: { type: "string", enum: ["status", "connect", "sync", "disconnect"] }, confirmed: { type: "boolean" },
    }, required: ["action"] },
    async run(input, ctx) {
      const user = getDb().select().from(users).where(eq(users.id, ctx.user.id)).get()!;
      const configured = googleConfigured();
      const connected = !!user.googleRefreshToken;
      const t = settings[ctx.locale ?? user.locale ?? "en"].export.google;
      if (input.action === "status") return { configured, connected, direction: googleSyncMode(user.id), last_sync: user.googleSyncedAt, settings: "/settings#export" };
      if (input.action === "connect" && configured) {
        addLink(ctx, t.connect, "/settings#export");
        return { note: "Choose one-way or two-way sync in Settings, then connect Google Calendar." };
      }
      if (!connected) return { error: configured ? t.notConnected : "Google Calendar is not configured." };
      if (input.action !== "disconnect" && input.action !== "sync") return { error: "Choose sync or disconnect for an existing connection." };
      if (input.confirmed !== true) return { needs_confirmation: input.action === "sync" ? (googleSyncMode(user.id) === "one_way" ? "Publish your Poli timetable to Google Calendar?" : "Sync changes between Poli and your Poli calendar in Google?") : "Disconnect Google Calendar? The existing Google calendar will remain in your account." };
      if (input.action === "disconnect") {
        disconnectGoogle(user.id);
        ctx.changed = true;
        return { disconnected: true };
      }
      const { events } = await syncToGoogle(user, ctx.locale ?? user.locale ?? "en");
      ctx.changed = true;
      return { synced: true, uploaded_events: events };
    },
  },
  {
    name: "get_calendar_link",
    description:
      "The student's private calendar subscription link (.ics) for Google Calendar, Apple Calendar or Outlook, which stays in sync with their timetable. Anyone with the link can see the timetable, so remind them to keep it private. To send the calendar by e-mail instead, use email_calendar.",
    input_schema: { type: "object", properties: {} },
    run(_input, ctx) {
      const { user } = ctx;
      const base = publicBaseUrl();
      const token = getDb().select({ value: users.feedToken }).from(users).where(eq(users.id, user.id)).get()!.value;
      const path = `/api/ics/${token}.ics`;
      const t = settings[ctx.locale ?? user.locale ?? "en"].export.file;
      addLink(ctx, t.download, `${path}?download`);
      return base
        ? { subscription_link: `${base}${path}`, how: "Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription. Outlook: Add calendar → Subscribe from web." }
        : { note: "This server has no public address, so a subscription link would not work from outside. The student can download the file or copy the link under Settings → Calendar sync and export.", page: "calendar_export" };
    },
  },
];
