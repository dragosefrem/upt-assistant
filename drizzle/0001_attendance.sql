CREATE TABLE `attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`series_key` text NOT NULL,
	`course_key` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_unique` ON `attendance` (`user_id`,`series_key`,`date`);--> statement-breakpoint
CREATE INDEX `attendance_user_date` ON `attendance` (`user_id`,`date`);