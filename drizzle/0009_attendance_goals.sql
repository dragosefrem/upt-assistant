CREATE TABLE `attendance_goals` (
	`user_id` text NOT NULL,
	`semester_id` integer NOT NULL,
	`course_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`minimum` integer NOT NULL,
	PRIMARY KEY(`user_id`, `semester_id`, `course_key`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`semester_id`) REFERENCES `semesters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attendance_goal_positive_integer" CHECK(typeof("attendance_goals"."minimum") = 'integer' and "attendance_goals"."minimum" > 0)
);
