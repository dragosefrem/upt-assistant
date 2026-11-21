CREATE TABLE `google_event_links` (
	`user_id` text NOT NULL,
	`uid` text NOT NULL,
	`google_id` text NOT NULL,
	`base` text NOT NULL,
	`remote` text,
	`pending` text,
	`overrides` text,
	PRIMARY KEY(`user_id`, `uid`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_link_resource` ON `google_event_links` (`user_id`,`google_id`);--> statement-breakpoint
CREATE TABLE `google_exceptions` (
	`user_id` text NOT NULL,
	`google_id` text NOT NULL,
	`parent_id` text NOT NULL,
	`event` text NOT NULL,
	PRIMARY KEY(`user_id`, `google_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `google_exception_parent` ON `google_exceptions` (`user_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `google_sync_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `personal_events` ADD `description` text;--> statement-breakpoint
ALTER TABLE `personal_events` ADD `calendar_timing` text;