import { sql } from "drizzle-orm";
import {
  index,
  blob,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`);

export type Role = "student" | "admin";
export type Degree = "bachelor" | "master";
export type EntryKind = "course" | "seminar" | "lab" | "project" | "other";
export type SourceKind = "timetable" | "exams" | "other";
export type SourceFormat = "xlsx" | "gsheet" | "pdf" | "html" | "link";

/* ───────────────────────────── University structure ───────────────────────────── */

export const faculties = sqliteTable("faculties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  website: text("website"),
  scheduleUrl: text("schedule_url"),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
});

/** A selectable "speciality": a bachelor specialization or a master's programme. */
export const specializations = sqliteTable(
  "specializations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    facultyId: integer("faculty_id")
      .notNull()
      .references(() => faculties.id, { onDelete: "cascade" }),
    degree: text("degree").$type<Degree>().notNull(),
    name: text("name").notNull(),
    /** Normalised name, used to match catalog entries against timetable headers. */
    slug: text("slug").notNull(),
    /** Short code used in timetables and exam lists (C, TI, AIA, ML, …). */
    code: text("code"),
    /** Bachelor domain this specialization belongs to (as listed on upt.ro). */
    domain: text("domain"),
    language: text("language"),
    durationYears: integer("duration_years"),
    url: text("url"),
    source: text("source").$type<"catalog" | "schedule" | "manual">().notNull().default("catalog"),
  },
  (t) => [uniqueIndex("spec_unique").on(t.facultyId, t.degree, t.slug)],
);

/** The smallest unit a student belongs to (a subgroup such as "1.2"). */
export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    specializationId: integer("specialization_id")
      .notNull()
      .references(() => specializations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    /** Optional series inside a year ("Seria 1 (C)"). Empty string when unused. */
    series: text("series").notNull().default(""),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("group_unique").on(t.specializationId, t.year, t.series, t.name)],
);

export const buildings = sqliteTable("buildings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  /** Regex source (case-insensitive) matched against room labels. */
  roomPattern: text("room_pattern"),
  /** Comma-separated faculty acronyms the pattern applies to; empty = every faculty. */
  scope: text("scope").notNull().default(""),
  /** Lower number wins when several patterns match. */
  priority: integer("priority").notNull().default(100),
  notes: text("notes"),
});

/* ───────────────────────────── Calendar data ───────────────────────────── */

export const semesters = sqliteTable(
  "semesters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    academicYear: text("academic_year").notNull(),
    number: integer("number").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    /** JSON array of ISO dates: the Monday of every teaching week, in order. */
    teachingWeeks: text("teaching_weeks").notNull(),
    examStart: text("exam_start"),
    examEnd: text("exam_end"),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("semester_unique").on(t.academicYear, t.number)],
);

export const courses = sqliteTable(
  "courses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    semesterId: integer("semester_id")
      .notNull()
      .references(() => semesters.id, { onDelete: "cascade" }),
    facultyId: integer("faculty_id")
      .notNull()
      .references(() => faculties.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    abbreviation: text("abbreviation"),
    year: integer("year"),
    isOptional: integer("is_optional", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("course_semester").on(t.semesterId, t.facultyId)],
);

export const entries = sqliteTable(
  "entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable identity across re-scrapes so student overrides survive updates. */
    key: text("key").notNull().unique(),
    semesterId: integer("semester_id")
      .notNull()
      .references(() => semesters.id, { onDelete: "cascade" }),
    sourceId: integer("source_id").references(() => sources.id, { onDelete: "set null" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    kind: text("kind").$type<EntryKind>().notNull(),
    /** 1 = Monday … 7 = Sunday */
    day: integer("day").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    /** "all", parity, a teaching-week range, or their intersection (e.g. "odd&1-7"). */
    weeks: text("weeks").notNull().default("all"),
    room: text("room"),
    teacher: text("teacher"),
    rawText: text("raw_text").notNull(),
    /**
     * True when this is one of several alternative slots (typically optional-course
     * labs) of which a student attends exactly one.
     */
    isSlotOption: integer("is_slot_option", { mode: "boolean" }).notNull().default(false),
    publishedOptional: integer("published_optional", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("entry_course").on(t.courseId), index("entry_semester").on(t.semesterId)],
);

export const entryGroups = sqliteTable(
  "entry_groups",
  {
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.groupId] }), index("entry_groups_group").on(t.groupId)],
);

export const exams = sqliteTable(
  "exams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    facultyId: integer("faculty_id")
      .notNull()
      .references(() => faculties.id, { onDelete: "cascade" }),
    sourceId: integer("source_id").references(() => sources.id, { onDelete: "set null" }),
    session: text("session"),
    courseName: text("course_name").notNull(),
    courseAbbr: text("course_abbr"),
    date: text("date").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    room: text("room"),
    teacher: text("teacher"),
    /** Who sits the exam, as written in the source ("C-ro+TI 3"). */
    audience: text("audience"),
    year: integer("year"),
    rawText: text("raw_text").notNull(),
  },
  (t) => [index("exam_date").on(t.date), index("exam_faculty").on(t.facultyId)],
);

export const examSpecializations = sqliteTable(
  "exam_specializations",
  {
    examId: integer("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    specializationId: integer("specialization_id")
      .notNull()
      .references(() => specializations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.examId, t.specializationId] })],
);

/* ───────────────────────────── Scraping ───────────────────────────── */

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    facultyId: integer("faculty_id")
      .notNull()
      .references(() => faculties.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    label: text("label").notNull(),
    /** Section heading the link appeared under on the faculty page. */
    context: text("context"),
    kind: text("kind").$type<SourceKind>().notNull(),
    format: text("format").$type<SourceFormat>().notNull(),
    academicYear: text("academic_year"),
    semester: integer("semester"),
    /** discovered | imported | partial | unsupported | failed */
    status: text("status").notNull().default("discovered"),
    message: text("message"),
    itemCount: integer("item_count").notNull().default(0),
    contentHash: text("content_hash"),
    lastFetchedAt: text("last_fetched_at"),
    discoveredAt: createdAt(),
  },
  (t) => [uniqueIndex("source_unique").on(t.facultyId, t.url)],
);

export const scrapeRuns = sqliteTable("scrape_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  /** running | success | partial | failed */
  status: text("status").notNull().default("running"),
  scope: text("scope").notNull(),
  dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
  triggeredBy: text("triggered_by"),
  stats: text("stats"),
  log: text("log").notNull().default(""),
});

/** The complete printed timetable, including legends and pages with conflicting dates. */
export const timetablePdfs = sqliteTable("timetable_pdfs", {
  sourceId: integer("source_id").primaryKey().references(() => sources.id, { onDelete: "cascade" }),
  content: blob("content", { mode: "buffer" }).notNull(),
});

/* ───────────────────────────── Accounts ───────────────────────────── */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull().default("student"),
  facultyId: integer("faculty_id").references(() => faculties.id, { onDelete: "set null" }),
  specializationId: integer("specialization_id").references(() => specializations.id, {
    onDelete: "set null",
  }),
  year: integer("year"),
  groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
  onboardedAt: text("onboarded_at"),
  googleRefreshToken: text("google_refresh_token"),
  googleCalendarId: text("google_calendar_id"),
  googleSyncedAt: text("google_synced_at"),
  /** Secret token that authorises the read-only .ics subscription feed. */
  feedToken: text("feed_token").notNull(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the raw token never touches the database. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("session_user").on(t.userId)],
);

/** Which optional courses a student follows, and which alternative slot they picked. */
export const userCourses = sqliteTable(
  "user_courses",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    enrolled: integer("enrolled", { mode: "boolean" }).notNull().default(true),
    slotEntryId: integer("slot_entry_id").references(() => entries.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId] })],
);

/** A student's personal change to one timetable entry (hide it or move it). */
export const userOverrides = sqliteTable(
  "user_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    day: integer("day"),
    startMin: integer("start_min"),
    endMin: integer("end_min"),
    room: text("room"),
    note: text("note"),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex("override_unique").on(t.userId, t.entryId)],
);

export const personalEvents = sqliteTable(
  "personal_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** One-off events carry a date; weekly ones carry a weekday instead. */
    date: text("date"),
    day: integer("day"),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    location: text("location"),
    createdAt: createdAt(),
  },
  (t) => [index("personal_user").on(t.userId)],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_user").on(t.userId, t.id)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
