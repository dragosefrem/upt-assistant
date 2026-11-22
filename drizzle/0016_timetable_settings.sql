CREATE TABLE `user_extra_courses` (
	`user_id` text NOT NULL,
	`course_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `course_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `share_private_details` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `timetable_confirmed_at` text;