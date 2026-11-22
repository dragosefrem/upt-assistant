import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { assistant } from "@/i18n/messages/assistant";
import type { PublicHoliday } from "../holidays";
import { examAudience } from "../exam-audience";
import { kindLabel } from "../kinds";
import { practicalsToShow } from "../labs";
import { currentSemester, studentWeek } from "../schedule";
import { DAY_NAMES, addDays, dayName, formatDate, formatDateRange, mondayOf, nowLocal, weekday } from "../time";
import { runTool, type ToolContext } from "./tools";
import { isDate, parseClock } from "./toolkit";

/**
 * Built-in assistant used when no Claude credentials are configured. It recognises a
 * handful of common questions by keyword and answers from the same tools, so the chat
 * and voice features work out of the box — just far less flexibly than Claude.
 */

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const DAY_WORDS: Array<[RegExp, number]> = [
  [/\b(monday|luni)\b/, 1],
  [/\b(tuesday|marti)\b/, 2],
  [/\b(wednesday|miercuri)\b/, 3],
  [/\b(thursday|joi)\b/, 4],
  [/\b(friday|vineri)\b/, 5],
  [/\b(saturday|sambata)\b/, 6],
  [/\b(sunday|duminica)\b/, 7],
];

/** Short words of Romanian and English that are also course acronyms at UPT. */
const EVERYDAY_WORDS = new Set(["am", "an", "as", "at", "be", "ce", "de", "do", "et", "in", "is", "it", "la", "pe", "sa", "se", "si", "to", "or", "on", "ai", "ag", "me", "my"]);

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Month names and their short forms, Romanian and English, without diacritics. */
const MONTH = "ianuarie|january|ian|jan|februarie|february|feb|martie|march|mar|aprilie|april|apr|mai|may|iunie|june|iun|jun|iulie|july|iul|jul|august|aug|septembrie|september|sept|sep|octombrie|october|oct|noiembrie|november|noi|nov|decembrie|december|dec";
const MONTH_NUMBER: Array<[RegExp, number]> = [[/^(ian|jan)/, 1], [/^feb/, 2], [/^mar/, 3], [/^apr/, 4], [/^ma[iy]/, 5], [/^(iun|jun)/, 6],
  [/^(iul|jul)/, 7], [/^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^no[iv]/, 11], [/^dec/, 12]];

/** "30 noiembrie", "1 dec", "November 30", "30.11": that day, this year or the next if it has passed by more than a month. */
function calendarDate(text: string, today: string): string | undefined {
  const named = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\b`).exec(text) ?? undefined;
  const english = named ? undefined : new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(text) ?? undefined;
  const numeric = named || english ? undefined : /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/.exec(text) ?? undefined;
  const day = Number(named?.[1] ?? english?.[2] ?? numeric?.[1]);
  const month = numeric ? Number(numeric[2]) : MONTH_NUMBER.find(([re]) => re.test(named?.[2] ?? english?.[1] ?? ""))?.[1];
  if (!day || !month) return undefined;
  const at = (year: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (numeric?.[3]) return at(Number(numeric[3]));
  const year = Number(today.slice(0, 4));
  // A date named in January about "22 decembrie" is last month's; "12 ianuarie" asked in November is next year's.
  return at(year) < addDays(today, -31) ? at(year + 1) : at(year);
}

function looksEnglish(text: string): boolean {
  return /\b(what|when|where|which|how|who|do i|am i|is it|my|the|tomorrow|today|week|exam|free|please|write|tell me|show me)\b/.test(fold(text));
}

function isRomanian(text: string): boolean {
  // Only words that cannot be English ("am" and "sala" would misfire on "When am I…").
  return /[ăâîșşțţ]/i.test(text) || /\b(ce|unde|cand|azi|astazi|maine|examen|examenul|orar|orarul|liber|libera|grupa|cum|ajung|urmator|urmeaza|saptamana|luni|marti|miercuri|joi|vineri|ascunde|restaureaza|muta|mut|reprogrameaza)\b/.test(fold(text));
}

function mentionedDate(text: string, today: string) {
  const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
  if (iso) return iso;
  // "luni 30 noiembrie" is the 30th, not the next Monday.
  const dated = calendarDate(text, today);
  if (dated) return dated;
  if (/\b(tomorrow|maine)\b/.test(text)) return addDays(today, 1);
  if (/\b(today|azi|astazi)\b/.test(text)) return today;
  const named = DAY_WORDS.find(([re]) => re.test(text));
  return named && addDays(today, (named[1] - weekday(today) + 7) % 7);
}

function movePicker(text: string, ctx: ToolContext, locale: Locale) {
  const t = assistant[locale];
  const today = nowLocal().date;
  const [source, destination = ""] = text.replace(/\bde pe\b/g, "de").split(/\s+(?:to|pe|pentru|la)\s+(.+)/);
  const from = mentionedDate(source, today);
  const target = mentionedDate(destination, today);
  if ((from && !isDate(from)) || (target && !isDate(target))) return t.basic.invalidDate;
  if (/\b(?:exam|exams|examenul|examen)\b/.test(source)) return t.basic.fixedExam;
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(destination.replace(/\d{4}-\d{2}-\d{2}/g, ""));
  let newStart: string | undefined;
  if (time && (time[2] || time[3] || Number(time[1]) >= 8)) {
    const hour = time[3] ? Number(time[1]) % 12 + (time[3] === "pm" ? 12 : 0) : Number(time[1]);
    const clock = `${hour}:${time[2] ?? "00"}`;
    if (hour < 24 && parseClock(clock) !== undefined) newStart = clock;
  }
  const kind = /\b(?:labs?|laborator\w*)\b/.test(source) ? "lab" : /\bseminar\w*\b/.test(source) ? "seminar"
    : /\b(class|classes)\b/.test(source) ? "class" : /\bpersonal\b/.test(source) ? "personal" : undefined;
  const title = source.replace(/^.*?\b(?:reschedule|move|muta|mut|reprogrameaza|reprogramez)\b/, "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/g, "")
    .replace(/\b(?:my|an?|the|on|from|for|please|today|tomorrow|next|something|one|of|events?|classes|class|lab|seminar|un|o|eveniment\w*|personal|meu|mea|de|din|ora|laborator\w*|seminarul|maine|azi|astazi)\b/g, " ")
    .replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]/g, " ");
  const query = DAY_WORDS.reduce((rest, [pattern]) => rest.replace(pattern, ""), title).replace(/\s+/g, " ").trim();
  const result = runTool("choose_event_to_move", { from, title: query || undefined, kind, new_date: target, new_start: newStart }, ctx) as Any;
  if (!result.events?.length) return t.basic.noMove;
  const [only] = result.events;
  if (result.events.length === 1 && only.type === "personal" && (target || newStart) && (!time || newStart)) {
    const proposed = runTool("move_personal_event", { id: only.personal_event_id, new_date: target, new_start: newStart }, ctx) as Any;
    if (ctx.preview) {
      const p = ctx.preview;
      const day = formatDate(p.date, p.weekly ? { weekday: "long" } : undefined, locale);
      const reply = t.preview.review(p.title, t.preview.when(day, p.start, p.end, p.weekly));
      const clashes = (proposed.overlaps ?? []).map((e: Any) => `${e.title} (${e.start}–${e.end})`);
      return clashes.length ? `${reply} ${t.preview.overlaps(clashes.join(", "))}.` : reply;
    }
    // The slot might already be the current one. Keep its editor available.
    runTool("choose_event_to_move", { from, title: query || undefined, kind, new_date: target, new_start: newStart }, ctx);
  }
  return t.basic.pickEvent + " " + result.events.slice(0, 3).map((e: Any) => `${e.title}, ${formatDate(e.date, { weekday: "short", day: "numeric", month: "short" }, locale)}, ${e.start}`).join(". ") + ".";
}

function line(e: Any, locale: Locale): string {
  const where = [e.room, e.building].filter(Boolean).join(", ");
  return `${e.end ? `${e.start}–${e.end}` : e.start} ${e.title}${e.kind && e.kind !== "exam" && e.kind !== "personal" ? ` (${kindLabel(e.kind, locale)})` : ""}${where ? ` — ${where}` : ""}`;
}

export function askLocal(message: string, ctx: ToolContext): string {
  const q = fold(message);
  // A question with no telling word ("scrie-mi o poezie") is answered in the interface language.
  const ro = isRomanian(message) || ((ctx.locale ?? ctx.user.locale) === "ro" && !looksEnglish(message));
  const locale = ro ? "ro" : "en";
  const basic = assistant[locale].basic;
  const holidayLine = (h: PublicHoliday) => basic.holiday(formatDate(h.date, { day: "numeric", month: "long" }, locale), h.name);
  const t = (en: string, roText: string) => (ro ? roText : en);
  const now = nowLocal();

  // Which day is the question about?
  if (/\b(move|reschedule|muta|mut|reprogrameaza|reprogramez)\b/.test(q)) return movePicker(q, ctx, locale);
  const mentioned = mentionedDate(q, now.date);
  if (mentioned && !isDate(mentioned)) return basic.invalidDate;
  const date = mentioned ?? now.date;
  const dayNamed = !!mentioned;

  // A course mentioned by name or acronym, taken from the student's own timetable.
  const semester = currentSemester();
  const week = semester ? studentWeek(ctx.user, semester) : [];
  const words = new Set(q.split(/[^a-z0-9]+/));
  // An acronym that is also an everyday word ("AM" is "I have" in Romanian) only counts when typed in capitals.
  const capitals = new Set(message.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 2 && w === w.toUpperCase()));
  const named = (abbr: string) => words.has(fold(abbr)) && (!EVERYDAY_WORDS.has(fold(abbr)) || capitals.has(abbr.toUpperCase()));
  const course = week.find((e) => (e.abbr && named(e.abbr)) || (fold(e.title).length > 4 && q.includes(fold(e.title))));

  const weekRequest = !dayNamed && /\b(this week|next week|saptamana (?:asta|aceasta|viitoare))\b/.test(q);
  const weekStart = mondayOf(/\b(next week|saptamana viitoare)\b/.test(q) ? addDays(now.date, 7) : now.date);

  if (/\b(contacts?|contactele|colegi[il]?|friends?)\b/.test(q) && /\b(free|available|liber[aei]?|disponibil[ei]?)\b/.test(q)) {
    return t("In Contacts, choose “Plan a group event” and select the classmates whose calendars you want to compare.",
      "În Contacte, alege „Plănuiește o întâlnire” și selectează colegii ale căror orare vrei să le compari.");
  }
  if (/\b(missed|make.?up|lipsit|recuper[a-z]*)\b/.test(q) && /\b(labs?|laborator[a-z]*|seminar[a-z]*)\b/.test(q)) {
    return t("Open the missed lab or seminar in your timetable and choose “Find a make-up session” to see alternatives.",
      "Deschide în orar laboratorul sau seminarul la care ai lipsit și alege opțiunea de recuperare.");
  }
  if (/\b(study plan|plan (?:de |pentru )?(?:invatat|studiu|invatare))\b/.test(q)) {
    return t("Open Exams and choose the study planner to fit preparation around your classes.",
      "În Examene, deschide planul de învățare ca să găsești timp de pregătire între cursuri.");
  }

  // "What does semigrupă mean?" — answered from the glossary.
  const term = /\b(?:what does|what is an?|what is|ce inseamna|ce este|ce e)\s+(?:the\s+|un\s+|o\s+)?["„“”']?([a-z0-9 ./-]{1,30}?)["„“”']?(?:\s+mean)?\s*\??$/.exec(q)?.[1]?.trim();
  if (term) {
    // The word asked about is Romanian either way; the question's own wording decides the language.
    const inEnglish = /\b(what does|what is)\b/.test(q);
    const r = runTool("explain_term", { term }, { ...ctx, locale: inEnglish ? "en" : ro ? "ro" : "en" }) as Any;
    if (r.entries?.length) return `${r.entries[0].term}: ${r.entries[0].meaning} ${r.entries[0].details}`;
  }

  // "Do I have lab this week?" and "is it an odd week?" — the classic first-year questions.
  if (/\b(lab|labs|laborator|laboratoare|laboratorul|seminar|seminare|odd|even|para|impara|paritate|what week|week is it|ce saptamana|a cata saptamana)\b/.test(q) && !/\b(exam|examen|examene)\b/.test(q)) {
    const nextWeek = /\b(next week|saptamana viitoare)\b/.test(q);
    const labsOnly = /\b(lab|labs|laborator|laboratoare|laboratorul)\b/.test(q);
    // At the weekend, once this week's sessions are over, "do I have lab?" is about the week ahead,
    // as on the home page's card.
    const ahead = !nextWeek && !dayNamed && practicalsToShow(ctx.user, now, locale).upcoming;
    const r = runTool("labs_this_week", { date: nextWeek || ahead ? addDays(mondayOf(now.date), 7) : date, course: course?.title, kinds: labsOnly ? ["lab"] : undefined }, { ...ctx, locale }) as Any;
    if (!r.error) {
      const when = (e: Any) => `${formatDate(e.date, { weekday: "long", day: "numeric", month: "long" }, ro ? "ro" : "en")} ${e.start}–${e.end}${e.room ? `, ${e.room}` : ""}`;
      const head = r.teaching_week
        ? t(`Teaching week ${r.teaching_week}, an ${r.parity} week.`, `Săptămâna ${r.teaching_week}, ${r.parity === "odd" ? "impară" : "pară"}.`)
        : t("There are no classes that week.", "În săptămâna aceea nu sunt ore.");
      const running = (r.takes_place as Any[]).map((e) => `• ${e.title} (${e.kind}) — ${when(e)}`);
      const skipped = (r.not_this_week as Any[]).map((e) => `• ${e.course} (${e.kind}) — ${t(`not this week; ${e.runs}; next on ${e.next_on}`, `nu săptămâna aceasta; următorul: ${e.next_on.replace(/^\w+ /, "")}`)}`);
      return [
        ...(ahead ? [t("This week's classes are over. Next week:", "Orele din săptămâna aceasta s-au terminat. Săptămâna viitoare:")] : []),
        head,
        ...(r.holidays as PublicHoliday[]).map(holidayLine),
        running.length ? t("Taking place:", "Se țin:") : t("Nothing takes place.", "Nu se ține nimic."),
        ...running,
        ...(skipped.length ? [t("Not this week:", "Nu se țin săptămâna aceasta:"), ...skipped] : []),
      ].join("\n");
    }
  }

  if (/\b(exam|exams|examen|examene|examenul|sesiune|sesiunea|colocviu)\b/.test(q)) {
    const acronym = /\b(?:exam(?:en(?:ul)?)?|la|for|at|de)\s+(?:(?:for|la|de)\s+)?([a-z][a-z0-9]{1,7})\b/.exec(q)?.[1];
    const courseHint = acronym && !DAY_WORDS.some(([re]) => re.test(acronym))
      && !/^(exam|examen|the|my|meu|mele|held|tinut|on|at|in|pe|is|next|tomorrow|today|maine|azi)$/.test(acronym) ? acronym : undefined;
    const r = runTool("find_exams", {
      course: course?.title ?? courseHint,
      from: weekRequest ? weekStart : dayNamed ? date : undefined,
      to: weekRequest ? addDays(weekStart, 6) : dayNamed ? date : undefined,
      next_only: !weekRequest && /\b(next|urmatorul|urmator)\b/.test(q),
    }, ctx) as Any;
    // The session's own dates are in the academic calendar, whether or not exams are published yet.
    const long = (d: string) => formatDate(d, { day: "numeric", month: "long", year: "numeric" }, locale);
    const session = semester?.examStart && semester.examEnd && /\b(sesiune|sesiunea|session)\b/.test(q)
      ? t(`The exam session runs from ${long(semester.examStart)} to ${long(semester.examEnd)}. `, `Sesiunea de examene ține din ${long(semester.examStart)} până în ${long(semester.examEnd)}. `) : "";
    if (!r.count) {
      return session + t(
        "I couldn't find a scheduled exam for that yet. Faculties publish the session calendar closer to the exam period, so check again later.",
        "Nu am găsit încă un examen programat. Facultățile publică programarea mai aproape de sesiune, așa că merită să verifici din nou mai târziu.",
      );
    }
    const list = (r.exams as Any[]).slice(0, 6).map((x) => `${x.course}${examAudience(x.for, locale) ? ` (${examAudience(x.for, locale)})` : ""}: ${formatDate(x.date, undefined, locale)} ${x.end ? `${x.start}–${x.end}` : x.start}, ${[x.room, x.building].filter(Boolean).join(", ") || t("room not set", "sala nestabilită")}`);
    return `${session}${t(`I found ${r.count} exam(s):`, `Am găsit ${r.count} examen(e):`)}\n${list.join("\n")}`;
  }

  if (/\b(how do i get|how to get|directions|route|cum ajung|drumul|where is|unde e|unde este|unde se afla)\b/.test(q)) {
    const room = /\b(?:sala|room|to|la|spre)\s+([a-z]{0,5}\s?\d{1,4}[a-z]{0,2})\b/i.exec(message)?.[1];
    const r = runTool("get_directions", { destination: room ?? "next" }, ctx) as Any;
    if (r.error) return t("I don't know where that is. Try a room code such as A204, or a faculty name.", "Nu știu unde este. Încearcă un cod de sală, de exemplu A204, sau numele unei facultăți.");
    const head = r.event ? `${r.event.title}, ${r.event.start} — ` : "";
    if (!r.location_shared) {
      return `${head}${r.destination}${r.address ? `, ${r.address}` : ""}. ${t("Tap the location button and ask again for travel time.", "Apasă butonul de locație și întreabă din nou pentru durata drumului.")}`;
    }
    const opts = (r.options as Any[]).map((o) => `${o.how} ~${o.minutes} min`).join("; ");
    return `${head}${r.summary} ${opts}.${r.leave_by ? ` ${t("Leave by", "Pleacă până la")} ${r.leave_by}.` : ""}`;
  }

  if (/\b(free|gap|gaps|liber|libera|libere|fereastra|ferestre)\b/.test(q)) {
    const group = /\b(?:group|grupa|grupei)\s+([a-z0-9. ]{1,30})/i.exec(message)?.[1]?.trim();
    const from = weekRequest && weekStart > now.date ? weekStart : date;
    const to = weekRequest ? addDays(weekStart, 6) : dayNamed ? date : addDays(now.date, 4);
    const r = runTool("find_free_slots", { from, to, group }, ctx) as Any;
    if (r.error) return r.error;
    const slots = (r.free as Any[]).slice(0, 8).map((s) => `${formatDate(s.date, undefined, locale)}: ${s.start}–${s.end}`);
    if (!slots.length) return t("No free slot of an hour or more in that period.", "Nu există nicio fereastră de cel puțin o oră în perioada aceea.");
    return `${t(`Free time for ${r.for}:`, `Timp liber pentru ${r.for === "you" ? "tine" : r.for}:`)}\n${slots.join("\n")}`;
  }

  if (/\b(hide|remove|drop|ascunde|scoate|sterge|elimina)\b/.test(q) && course) {
    const r = runTool("hide_class", { course: course.title }, ctx) as Any;
    return r.error ?? t(`Hidden from your timetable: ${r.hidden.join("; ")}. Say "restore ${course.abbr ?? course.title}" to undo.`, `Am ascuns din orarul tău: ${r.hidden.join("; ")}. Spune „restaurează ${course.abbr ?? course.title}" pentru a reveni.`);
  }
  if (/^(yes|da|no|nu)[.!\s]*$/.test(q.trim())) {
    const previous = getDb().select({ content: chatMessages.content }).from(chatMessages)
      .where(and(eq(chatMessages.userId, ctx.user.id), eq(chatMessages.role, "assistant"))).orderBy(desc(chatMessages.id)).limit(1).get();
    if (previous?.content === assistant.en.basic.restoreAll || previous?.content === assistant.ro.basic.restoreAll) {
      if (/^(no|nu)/.test(q.trim())) return assistant[q.trim().startsWith("nu") ? "ro" : "en"].basic.kept;
      const r = runTool("restore_class", { confirmed: true }, ctx) as Any;
      return assistant[q.trim().startsWith("da") ? "ro" : "en"].basic.restored(r.restored);
    }
  }
  const restore = /\b(?:restore|undo|reset|restaureaza|reseteaza|anuleaza)\b(.*)/.exec(q);
  if (restore) {
    const which = restore[1].trim();
    const all = /^(?:all\b|everything\b|tot\b|toate\b)/.test(which);
    const r = runTool("restore_class", { course: all ? undefined : course?.title ?? which }, ctx) as Any;
    if (r.needs_confirmation) ctx.choices = [
      { label: basic.restore, reply: t("Yes", "Da") }, { label: basic.keep, reply: t("No", "Nu") },
    ];
    return r.needs_confirmation ? basic.restoreAll : basic.restored(r.restored);
  }

  if (/\b(next|now|urmator|urmatoarea|urmeaza|acum)\b/.test(q) && !dayNamed && !weekRequest) {
    const r = runTool("get_next_event", {}, ctx) as Any;
    const parts: string[] = [];
    if (r.current) parts.push(`${t("Now:", "Acum:")} ${line(r.current, locale)}`);
    if (r.next) parts.push(`${t("Next:", "Urmează:")} ${r.next.date === now.date ? "" : `${dayName(weekday(r.next.date), locale)} `}${line(r.next, locale)}`);
    return parts.join("\n") || t("Nothing coming up in the next two weeks.", "Nu ai nimic programat în următoarele două săptămâni.");
  }

  if (dayNamed || weekRequest || /\b(schedule|timetable|classes|orar|orarul|cursuri|ore)\b/.test(q)) {
    const from = weekRequest ? weekStart : date;
    const to = weekRequest ? addDays(from, 6) : date;
    const r = runTool("get_schedule", { from, to, language: locale }, ctx) as Any;
    const label = weekRequest ? formatDateRange(from, to, locale) : formatDate(date, undefined, locale);
    const lines = (r.events as Any[]).map((e) => weekRequest ? `${dayName(weekday(e.date), locale)} ${line(e, locale)}` : line(e, locale));
    if (r.holidays.length) return [...(r.holidays as PublicHoliday[]).map(holidayLine), ...lines].join("\n");
    if (!r.events.length) return t(`Nothing scheduled on ${label}.`, `Nu ai nimic programat ${label}.`);
    return `${label}:\n${lines.join("\n")}`;
  }

  return t(
    `I can answer: "What do I have tomorrow?", "What's next?", "Do I have lab this week?", "Where is my exam?", "When am I free on ${DAY_NAMES[weekday(addDays(now.date, 1))]}?", "When is group TI 3.2 free?", "How do I get to room A204?", "What does semigrupă mean?", "Move an event" and "Hide <course>". For other free-form questions and planning, an administrator can add a Gemini or Claude API key.`,
    `Pot răspunde la: „Ce am mâine?”, „Ce urmează?”, „Am laborator săptămâna aceasta?”, „Unde am examenul?”, „Când sunt liber?”, „Când e liberă grupa TI 3.2?”, „Cum ajung la sala A204?”, „Ce înseamnă semigrupă?”, „Mută un eveniment” și „Ascunde <materia>”. Pentru alte întrebări libere și planificare, un administrator poate adăuga o cheie API Gemini sau Claude.`,
  );
}
