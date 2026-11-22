CREATE TABLE `sponsored_events` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text,
	`title` text NOT NULL,
	`sponsor` text NOT NULL,
	`location` text NOT NULL,
	`description` text NOT NULL,
	`date` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`faculty_ids` text NOT NULL,
	`years` text NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sponsored_date` ON `sponsored_events` (`date`,`start_min`);--> statement-breakpoint
CREATE TABLE `sponsored_responses` (
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`response` text NOT NULL,
	PRIMARY KEY(`user_id`, `event_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `sponsored_events`(`id`) ON UPDATE no action ON DELETE cascade
);
