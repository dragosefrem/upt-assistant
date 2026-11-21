import type { CalendarFields, CalendarTiming, GoogleEvent, GoogleSyncMode } from "../lib/calendar-types";
import { sql } from "drizzle-orm";
import {
  check,
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
  /** Where "Email my calendar" sends the calendar file; the sign-in address when empty. */
  exportEmail: text("export_email"),
  /** When the calendar was last e-mailed, to limit how often it can be sent. */
  calendarEmailedAt: text("calendar_emailed_at"),
  /** Secret token that authorises the read-only .ics subscription feed. */
  feedToken: text("feed_token").notNull(),
  /** Interface language the student chose ("ro" | "en"); also used for e-mails. Null until chosen. */
  locale: text("locale").$type<"ro" | "en">(),
  /** When the student finished (or skipped) the welcome tour shown after onboarding. */
  welcomeSeenAt: text("welcome_seen_at"),
  createdAt: createdAt(),
});

/** One-time links e-mailed by "Forgot password?". Only the hash of the token is stored. */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    /** SHA-256 of the token in the link. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("password_reset_user").on(t.userId)],
);

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

/**
 * A student's change to a single occurrence of a class ("only next Wednesday's lab,
 * on Friday instead"). Every other week keeps the weekly time.
 */
export const occurrenceOverrides = sqliteTable(
  "occurrence_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    /** The date the class would normally take place on. */
    date: text("date").notNull(),
    newDate: text("new_date").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    room: text("room"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("occurrence_unique").on(t.userId, t.entryId, t.date)],
);

export const googleSyncState = sqliteTable("google_sync_state", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  mode: text("mode").$type<GoogleSyncMode>().notNull().default("one_way"),
  cursor: text("cursor"),
  lease: text("lease"),
  leaseUntil: integer("lease_until").notNull().default(0),
  nextAttempt: integer("next_attempt").notNull().default(0),
  failures: integer("failures").notNull().default(0),
});

export const googleEventLinks = sqliteTable("google_event_links", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  uid: text("uid").notNull(),
  googleId: text("google_id").notNull(),
  origin: text("origin").$type<"poli" | "google">(),
  base: text("base", { mode: "json" }).$type<CalendarFields>().notNull(),
  remote: text("remote", { mode: "json" }).$type<GoogleEvent>(),
  pending: text("pending", { mode: "json" }).$type<Partial<CalendarFields>>(),
  overrides: text("overrides", { mode: "json" }).$type<Partial<CalendarFields>>(),
}, (t) => [primaryKey({ columns: [t.userId, t.uid] }), uniqueIndex("google_link_resource").on(t.userId, t.googleId)]);

export const googleExceptions = sqliteTable("google_exceptions", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleId: text("google_id").notNull(),
  parentId: text("parent_id").notNull(),
  event: text("event", { mode: "json" }).$type<GoogleEvent>().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.googleId] }), index("google_exception_parent").on(t.userId, t.parentId)]);

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
    /**
     * Set on events a planner generated, so they can be listed and replaced as a set:
     * "study:<exams.key>" for an exam study plan. Null for events the student added.
     */
    plan: text("plan"),
    description: text("description"),
    calendarTiming: text("calendar_timing", { mode: "json" }).$type<CalendarTiming>(),
    createdAt: createdAt(),
  },
  (t) => [index("personal_user").on(t.userId)],
);

export type AttendanceStatus = "attended" | "missed";

/**
 * Whether a student attended one dated occurrence of a calendar event. No row means
 * "not marked yet".
 *
 * Timetable events are expanded on the fly, so rows are keyed by series + date rather
 * than referencing an event row. The series key is built from stable keys
 * (`entries.key`, `exams.key`) so marks survive re-scrapes, and title/kind/time are
 * snapshotted so history stays readable after a class or personal event disappears.
 */
export const attendance = sqliteTable(
  "attendance",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "e:<entries.key>" | "x:<exams.key>" | "p:<personal_events.id>" */
    seriesKey: text("series_key").notNull(),
    /** Groups a course's lecture, lab, … together: "c:<courses.key>", else the series key. */
    courseKey: text("course_key").notNull(),
    date: text("date").notNull(),
    status: text("status").$type<AttendanceStatus>().notNull(),
    title: text("title").notNull(),
    abbr: text("abbr"),
    kind: text("kind").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    room: text("room"),
    teacher: text("teacher"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("attendance_unique").on(t.userId, t.seriesKey, t.date), index("attendance_user_date").on(t.userId, t.date)],
);

/** A single invitation or accepted contact per unordered pair of accounts. */
export const contacts = sqliteTable("contacts", {
  firstId: text("first_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  secondId: text("second_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestedBy: text("requested_by").notNull(),
  accepted: integer("accepted", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.firstId, t.secondId] }),
  index("contact_second").on(t.secondId),
  check("contact_pair", sql`${t.firstId} < ${t.secondId} and ${t.requestedBy} in (${t.firstId}, ${t.secondId})`),
]);

export type EventStatus = "pending" | "confirmed" | "expired";
/** A participant's answer to a group event invitation. */
export type Rsvp = "pending" | "accepted" | "declined";

export const groupEvents = sqliteTable("group_events", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  location: text("location"),
  date: text("date").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  /** UTC epoch milliseconds, selected in the timetable's time zone. */
  deadline: integer("deadline").notNull(),
  status: text("status").$type<EventStatus>().notNull().default("pending"),
  shareToken: text("share_token").unique(),
});

export const eventParticipants = sqliteTable("event_participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().references(() => groupEvents.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  guestName: text("guest_name"),
  guestKeyHash: text("guest_key_hash"),
  /** Unanimity applies to the original invitees, including the creator. */
  invited: integer("invited", { mode: "boolean" }).notNull().default(false),
  response: text("response").$type<Rsvp>().notNull().default("pending"),
}, (t) => [
  uniqueIndex("participant_user").on(t.userId, t.eventId),
  uniqueIndex("participant_guest").on(t.guestKeyHash, t.eventId),
  index("participant_event").on(t.eventId, t.response),
  check("participant_identity", sql`(${t.userId} is not null and ${t.guestKeyHash} is null and ${t.guestName} is null)
    or (${t.userId} is null and ${t.guestKeyHash} is not null and ${t.guestName} is not null)`),
]);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    /** JSON list of the tappable choices the assistant offered with this reply. */
    choices: text("choices"),
    /** JSON preview of a proposed calendar change that the student can accept. */
    preview: text("preview"),
    /** JSON list of buttons that open a page of the app (a walkthrough, a group event). */
    links: text("links"),
    createdAt: createdAt(),
  },
  (t) => [index("chat_user").on(t.userId, t.id)],
);

/**
 * People a student plans to meet who are not linked accounts, as the student described
 * them ("Mindy is in TI 3.2"). Only the name and group are stored, so meeting times are
 * worked out from that group's published timetable. Accepted account contacts live in
 * `contacts` and share their real calendar as busy time.
 */
export const savedContacts = sqliteTable(
  "saved_contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Lower-cased, accent-free name used for matching. */
    nameKey: text("name_key").notNull(),
    groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("saved_contact_unique").on(t.userId, t.nameKey)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
