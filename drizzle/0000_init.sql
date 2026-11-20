CREATE TABLE `buildings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`room_pattern` text,
	`scope` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildings_code_unique` ON `buildings` (`code`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_user` ON `chat_messages` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`semester_id` integer NOT NULL,
	`faculty_id` integer NOT NULL,
	`name` text NOT NULL,
	`abbreviation` text,
	`year` integer,
	`is_optional` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semesters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_key_unique` ON `courses` (`key`);--> statement-breakpoint
CREATE INDEX `course_semester` ON `courses` (`semester_id`,`faculty_id`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`semester_id` integer NOT NULL,
	`source_id` integer,
	`course_id` integer NOT NULL,
	`kind` text NOT NULL,
	`day` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`weeks` text DEFAULT 'all' NOT NULL,
	`room` text,
	`teacher` text,
	`raw_text` text NOT NULL,
	`is_slot_option` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semesters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_key_unique` ON `entries` (`key`);--> statement-breakpoint
CREATE INDEX `entry_course` ON `entries` (`course_id`);--> statement-breakpoint
CREATE INDEX `entry_semester` ON `entries` (`semester_id`);--> statement-breakpoint
CREATE TABLE `entry_groups` (
	`entry_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `group_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_groups_group` ON `entry_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `exam_specializations` (
	`exam_id` integer NOT NULL,
	`specialization_id` integer NOT NULL,
	PRIMARY KEY(`exam_id`, `specialization_id`),
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`specialization_id`) REFERENCES `specializations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`faculty_id` integer NOT NULL,
	`source_id` integer,
	`session` text,
	`course_name` text NOT NULL,
	`course_abbr` text,
	`date` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`room` text,
	`teacher` text,
	`audience` text,
	`year` integer,
	`raw_text` text NOT NULL,
	FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exams_key_unique` ON `exams` (`key`);--> statement-breakpoint
CREATE INDEX `exam_date` ON `exams` (`date`);--> statement-breakpoint
CREATE INDEX `exam_faculty` ON `exams` (`faculty_id`);--> statement-breakpoint
CREATE TABLE `faculties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`website` text,
	`schedule_url` text,
	`address` text,
	`lat` real,
	`lng` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `faculties_slug_unique` ON `faculties` (`slug`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`specialization_id` integer NOT NULL,
	`year` integer NOT NULL,
	`series` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`specialization_id`) REFERENCES `specializations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_unique` ON `groups` (`specialization_id`,`year`,`series`,`name`);--> statement-breakpoint
CREATE TABLE `personal_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text,
	`day` integer,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`location` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `personal_user` ON `personal_events` (`user_id`);--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`scope` text NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`triggered_by` text,
	`stats` text,
	`log` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `semesters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`academic_year` text NOT NULL,
	`number` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`teaching_weeks` text NOT NULL,
	`exam_start` text,
	`exam_end` text,
	`is_current` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `semester_unique` ON `semesters` (`academic_year`,`number`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`faculty_id` integer NOT NULL,
	`url` text NOT NULL,
	`label` text NOT NULL,
	`context` text,
	`kind` text NOT NULL,
	`format` text NOT NULL,
	`academic_year` text,
	`semester` integer,
	`status` text DEFAULT 'discovered' NOT NULL,
	`message` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`content_hash` text,
	`last_fetched_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_unique` ON `sources` (`faculty_id`,`url`);--> statement-breakpoint
CREATE TABLE `specializations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`faculty_id` integer NOT NULL,
	`degree` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`code` text,
	`domain` text,
	`language` text,
	`duration_years` integer,
	`url` text,
	`source` text DEFAULT 'catalog' NOT NULL,
	FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_unique` ON `specializations` (`faculty_id`,`degree`,`slug`);--> statement-breakpoint
CREATE TABLE `user_courses` (
	`user_id` text NOT NULL,
	`course_id` integer NOT NULL,
	`enrolled` integer DEFAULT true NOT NULL,
	`slot_entry_id` integer,
	PRIMARY KEY(`user_id`, `course_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `user_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entry_id` integer NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`day` integer,
	`start_min` integer,
	`end_min` integer,
	`room` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `override_unique` ON `user_overrides` (`user_id`,`entry_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`faculty_id` integer,
	`specialization_id` integer,
	`year` integer,
	`group_id` integer,
	`onboarded_at` text,
	`google_refresh_token` text,
	`google_calendar_id` text,
	`google_synced_at` text,
	`feed_token` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`specialization_id`) REFERENCES `specializations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);