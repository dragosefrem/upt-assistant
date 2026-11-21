CREATE TABLE `attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`series_key` text NOT NULL,
	`course_key` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`abbr` text,
	`kind` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`room` text,
	`teacher` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_unique` ON `attendance` (`user_id`,`series_key`,`date`);--> statement-breakpoint
CREATE INDEX `attendance_user_date` ON `attendance` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`first_id` text NOT NULL,
	`second_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`accepted` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`first_id`, `second_id`),
	FOREIGN KEY (`first_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`second_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_pair" CHECK("contacts"."first_id" < "contacts"."second_id" and "contacts"."requested_by" in ("contacts"."first_id", "contacts"."second_id"))
);
--> statement-breakpoint
CREATE INDEX `contact_second` ON `contacts` (`second_id`);--> statement-breakpoint
CREATE TABLE `event_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text,
	`guest_name` text,
	`guest_key_hash` text,
	`invited` integer DEFAULT false NOT NULL,
	`response` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `group_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "participant_identity" CHECK(("event_participants"."user_id" is not null and "event_participants"."guest_key_hash" is null and "event_participants"."guest_name" is null)
    or ("event_participants"."user_id" is null and "event_participants"."guest_key_hash" is not null and "event_participants"."guest_name" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_user` ON `event_participants` (`user_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participant_guest` ON `event_participants` (`guest_key_hash`,`event_id`);--> statement-breakpoint
CREATE INDEX `participant_event` ON `event_participants` (`event_id`,`response`);--> statement-breakpoint
CREATE TABLE `group_events` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`date` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`deadline` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`share_token` text,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_events_share_token_unique` ON `group_events` (`share_token`);--> statement-breakpoint
CREATE TABLE `occurrence_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entry_id` integer NOT NULL,
	`date` text NOT NULL,
	`new_date` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`room` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_unique` ON `occurrence_overrides` (`user_id`,`entry_id`,`date`);--> statement-breakpoint
CREATE TABLE `saved_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`group_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_contact_unique` ON `saved_contacts` (`user_id`,`name_key`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `choices` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `preview` text;--> statement-breakpoint
ALTER TABLE `users` ADD `export_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `calendar_emailed_at` text;