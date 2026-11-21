import "server-only";
import { currentSemester, studentWeek } from "../schedule";
import { DAY_NAMES, addDays, formatDate, nowLocal, weekday } from "../time";
import { runTool, type ToolContext } from "./tools";

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

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function isRomanian(text: string): boolean {
  // Only words that cannot be English ("am" and "sala" would misfire on "When am I…").
  return /[ăâîșşțţ]/i.test(text) || /\b(unde|cand|azi|astazi|maine|examen|examenul|orar|orarul|liber|libera|grupa|cum|ajung|urmator|urmeaza|saptamana|luni|marti|miercuri|joi|vineri|ascunde|restaureaza)\b/.test(fold(text));
}

function line(e: Any): string {
  const where = [e.room, e.building].filter(Boolean).join(", ");
  return `${e.start}–${e.end} ${e.title}${e.kind && e.kind !== "exam" && e.kind !== "personal" ? ` (${e.kind})` : ""}${where ? ` — ${where}` : ""}`;
}

export function askLocal(message: string, ctx: ToolContext): string {
  const q = fold(message);
  const ro = isRomanian(message);
  const t = (en: string, roText: string) => (ro ? roText : en);
  const now = nowLocal();

  // Which day is the question about?
  let date = now.date;
  let dayNamed = false;
  if (/\b(tomorrow|maine)\b/.test(q)) {
    date = addDays(now.date, 1);
    dayNamed = true;
  } else if (/\b(today|azi|astazi)\b/.test(q)) dayNamed = true;
  else {
    for (const [re, day] of DAY_WORDS) {
      if (re.test(q)) {
        const ahead = (day - weekday(now.date) + 7) % 7;
        date = addDays(now.date, ahead);
        dayNamed = true;
      }
    }
  }

  // A course mentioned by name or acronym, taken from the student's own timetable.
  const semester = currentSemester();
  const week = semester ? studentWeek(ctx.user, semester) : [];
  const words = new Set(q.split(/[^a-z0-9]+/));
  const course = week.find((e) => (e.abbr && words.has(fold(e.abbr))) || (fold(e.title).length > 4 && q.includes(fold(e.title))));

  if (/\b(exam|exams|examen|examene|examenul|sesiune|sesiunea|colocviu)\b/.test(q)) {
    const acronym = /\b(?:exam(?:en(?:ul)?)?|la|for|at|de)\s+([a-z0-9]{2,8})\b/.exec(q)?.[1];
    const r = runTool("find_exams", { course: course?.title ?? (acronym && !/^(exam|examen|the|my|meu|mele|held|tinut)$/.test(acronym) ? acronym : undefined) }, ctx) as Any;
    if (!r.count) {
      return t(
        "I couldn't find a scheduled exam for that yet. Faculties publish the session calendar closer to the exam period, so check again later.",
        "Nu am găsit încă un examen programat. Facultățile publică programarea mai aproape de sesiune, așa că merită să verifici din nou mai târziu.",
      );
    }
    const list = (r.exams as Any[]).slice(0, 6).map((x) => `${x.course}: ${formatDate(x.date)} ${x.start}–${x.end}, ${[x.room, x.building].filter(Boolean).join(", ") || t("room not set", "sala nestabilită")}`);
    return `${t(`I found ${r.count} exam(s):`, `Am găsit ${r.count} examen(e):`)}\n${list.join("\n")}`;
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
    const to = dayNamed ? date : addDays(now.date, 4);
    const r = runTool("find_free_slots", { from: dayNamed ? date : now.date, to, group }, ctx) as Any;
    if (r.error) return r.error;
    const slots = (r.free as Any[]).slice(0, 8).map((s) => `${s.weekday} ${s.date.slice(5)}: ${s.start}–${s.end}`);
    if (!slots.length) return t("No free slot of an hour or more in that period.", "Nu există nicio fereastră de cel puțin o oră în perioada aceea.");
    return `${t(`Free time for ${r.for}:`, `Timp liber pentru ${r.for === "you" ? "tine" : r.for}:`)}\n${slots.join("\n")}`;
  }

  if (/\b(hide|remove|drop|ascunde|scoate|sterge|elimina)\b/.test(q) && course) {
    const r = runTool("hide_class", { course: course.title }, ctx) as Any;
    return r.error ?? t(`Hidden from your timetable: ${r.hidden.join("; ")}. Say "restore ${course.abbr ?? course.title}" to undo.`, `Am ascuns din orarul tău: ${r.hidden.join("; ")}. Spune „restaurează ${course.abbr ?? course.title}" pentru a reveni.`);
  }
  if (/\b(restore|undo|reset|restaureaza|reseteaza|anuleaza)\b/.test(q)) {
    const r = runTool("restore_class", {}, ctx) as Any;
    return t(`Restored ${r.restored} change(s) to your timetable.`, `Am anulat ${r.restored} modificare/modificări din orar.`);
  }

  if (/\b(next|now|urmator|urmatoarea|urmeaza|acum)\b/.test(q) && !dayNamed) {
    const r = runTool("get_next_event", {}, ctx) as Any;
    const parts: string[] = [];
    if (r.current) parts.push(`${t("Now:", "Acum:")} ${line(r.current)}`);
    if (r.next) parts.push(`${t("Next:", "Urmează:")} ${r.next.date === now.date ? "" : `${r.next.weekday} `}${line(r.next)}`);
    return parts.join("\n") || t("Nothing coming up in the next two weeks.", "Nu ai nimic programat în următoarele două săptămâni.");
  }

  if (dayNamed || /\b(schedule|timetable|classes|orar|orarul|cursuri|ore)\b/.test(q)) {
    const r = runTool("get_schedule", { from: date }, ctx) as Any;
    const label = formatDate(date, undefined, ro ? "ro-RO" : "en-GB");
    if (!r.events.length) return t(`Nothing scheduled on ${label}.`, `Nu ai nimic programat ${label}.`);
    return `${label}:\n${(r.events as Any[]).map(line).join("\n")}`;
  }

  return t(
    `I can answer: "What do I have tomorrow?", "What's next?", "Where is my exam?", "When am I free on ${DAY_NAMES[weekday(addDays(now.date, 1))]}?", "When is group TI 3.2 free?", "How do I get to room A204?" and "Hide <course>". For free-form questions, planning and schedule changes, an administrator can add a Gemini or Claude API key.`,
    `Pot răspunde la: „Ce am mâine?", „Ce urmează?", „Unde am examenul?", „Când sunt liber?", „Când e liberă grupa TI 3.2?", „Cum ajung la sala A204?" și „Ascunde <materia>". Pentru întrebări libere, planificare și modificări ale orarului, un administrator poate adăuga o cheie API Gemini sau Claude.`,
  );
}
