CREATE TABLE `timetable_pdfs` (
	`source_id` integer PRIMARY KEY NOT NULL,
	`content` blob NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
