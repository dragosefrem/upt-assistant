CREATE TABLE `upt_event_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`location` text,
	`access` text,
	`source_url` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upt_event_date` ON `upt_event_occurrences` (`date`,`start_min`);--> statement-breakpoint
CREATE TABLE `upt_event_subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
