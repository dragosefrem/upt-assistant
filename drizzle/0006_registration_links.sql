CREATE TABLE `registration_links` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`invite` text,
	`client_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `registration_email_time` ON `registration_links` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `registration_client_time` ON `registration_links` (`client_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `registration_time` ON `registration_links` (`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` text;