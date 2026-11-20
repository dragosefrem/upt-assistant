import type { Degree, EntryKind, SourceFormat, SourceKind } from "@/db/schema";
import type { Grid } from "./grid";
import type { ParsedTimetable } from "./timetable";

/** A document found on a faculty page that may hold a timetable or exam schedule. */
export interface DiscoveredSource {
  url: string;
  label: string;
  context: string;
  kind: SourceKind;
  format: SourceFormat;
  academicYear: string | null;
  semester: number | null;
}

/** How a timetable or exam list refers to a specialization before it has a database id. */
export interface SpecRef {
  name: string;
  code?: string | null;
  degree: Degree;
  language?: string | null;
}

export interface NormalizedGroup {
  spec: SpecRef;
  year: number;
  series: string;
  name: string;
}

export interface NormalizedEntry {
  sheet: string;
  day: number;
  startMin: number;
  endMin: number;
  kind: EntryKind;
  courseName: string;
  courseAbbr: string | null;
  room: string | null;
  teacher: string | null;
  weeks: string;
  rawText: string;
  isSlotOption: boolean;
  /** Indexes into the owning `NormalizedTimetable.groups`. */
  groups: number[];
}

export interface NormalizedTimetable {
  groups: NormalizedGroup[];
  entries: NormalizedEntry[];
  warnings: string[];
}

export interface NormalizedExam {
  date: string;
  startMin: number;
  endMin: number;
  room: string | null;
  courseName: string;
  courseAbbr: string | null;
  teacher: string | null;
  audience: string;
  year: number | null;
  specs: SpecRef[];
  rawText: string;
}

export interface SemesterRef {
  academicYear: string;
  number: number;
}

export interface PageLink {
  url: string;
  label: string;
  context: string;
}

/**
 * Faculty-specific knowledge the generic engine cannot infer: where the documents
 * live and how sheet headings map onto specializations, series and groups.
 */
export interface FacultyAdapter {
  /** Matches `faculties.slug`. */
  slug: string;
  /** Pages to scan for timetable links (defaults to the faculty's schedule URL). */
  timetablePages?(semester: SemesterRef, scheduleUrl: string | null): string[];
  /** Pages to scan for exam schedule links. */
  examPages?(semester: SemesterRef): string[];
  /** Overrides or vetoes the generic classification of one link. */
  classify?(link: PageLink, guess: DiscoveredSource, semester: SemesterRef, page: "timetable" | "exams"): DiscoveredSource | null;
  /** Maps one parsed sheet onto specializations/groups. Return null to skip the sheet. */
  normalize?(parsed: ParsedTimetable, source: DiscoveredSource): NormalizedTimetable | null;
  parseExams?(grids: Grid[], source: DiscoveredSource): NormalizedExam[];
}
