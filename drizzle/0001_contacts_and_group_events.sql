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
CREATE UNIQUE INDEX `group_events_share_token_unique` ON `group_events` (`share_token`);