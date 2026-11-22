CREATE TABLE `calendar_feed_revisions` (
	`user_id` text NOT NULL,
	`uid` text NOT NULL,
	`fingerprint` text,
	`sequence` integer NOT NULL,
	`modified_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `uid`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
