import type { Locale } from "@/i18n/config";
import { holidaysBetween } from "./holidays";
import type { Semester } from "./schedule";
import { addDays, mondayOf } from "./time";

/** The shape of a semester for the Guide page and the assistant: blocks of classes, holidays, the session. */
export interface SemesterOverview {
  number: number;
  academicYear: string;
  /** Unbroken runs of teaching weeks: Monday of the first week to Friday of the last. */
  teaching: Array<{ from: string; to: string; weeks: number }>;
  /** Breaks between two runs of teaching weeks. */
  holidays: Array<{ from: string; to: string }>;
  /** Public holidays on a weekday of a teaching week: no classes that day. */
  daysOff: Array<{ date: string; name: string }>;
  session: { from: string; to: string } | null;
  totalWeeks: number;
  /** 1-based teaching week of `today`, or null outside teaching. */
  week: number | null;
  parity: "odd" | "even" | null;
  weeksLeft: number;
  state: "before" | "teaching" | "holiday" | "session" | "over";
  /** When classes next start or resume, for the "before" and "holiday" states. */
  resumes: string | null;
}

export function semesterOverview(semester: Semester, today: string, locale: Locale = "en"): SemesterOverview {
  const weeks = semester.weeks;
  const teaching: SemesterOverview["teaching"] = [];
  const holidays: SemesterOverview["holidays"] = [];
  for (const [i, monday] of weeks.entries()) {
    const run = teaching.at(-1);
    if (run && addDays(weeks[i - 1], 7) === monday) {
      run.to = addDays(monday, 4);
      run.weeks++;
    } else {
      if (run) holidays.push({ from: addDays(weeks[i - 1], 7), to: addDays(monday, -1) });
      teaching.push({ from: monday, to: addDays(monday, 4), weeks: 1 });
    }
  }
  const thisMonday = mondayOf(today);
  const index = weeks.indexOf(thisMonday);
  const week = index === -1 ? null : index + 1;
  const resumes = weeks.find((w) => w > thisMonday) ?? null;
  const inSession = !!semester.examStart && !!semester.examEnd && today >= semester.examStart && today <= semester.examEnd;
  const state: SemesterOverview["state"] =
    week !== null ? "teaching" : weeks.length && thisMonday < weeks[0] ? "before" : resumes ? "holiday" : inSession || (semester.examEnd && today <= semester.examEnd) ? "session" : "over";
  return {
    number: semester.number,
    academicYear: semester.academicYear,
    teaching,
    holidays,
    daysOff: weeks.flatMap((monday) => holidaysBetween(monday, addDays(monday, 4), locale)),
    session: semester.examStart && semester.examEnd ? { from: semester.examStart, to: semester.examEnd } : null,
    totalWeeks: weeks.length,
    week,
    parity: week === null ? null : week % 2 === 1 ? "odd" : "even",
    weeksLeft: weeks.filter((w) => w > thisMonday).length,
    state,
    resumes,
  };
}
