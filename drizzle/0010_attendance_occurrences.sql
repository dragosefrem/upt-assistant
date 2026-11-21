DROP INDEX `attendance_unique`;--> statement-breakpoint
ALTER TABLE `attendance` ADD `occurrence_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_unique` ON `attendance` (`user_id`,`series_key`,`date`,`occurrence_key`);