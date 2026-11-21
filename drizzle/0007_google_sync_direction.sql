ALTER TABLE `google_event_links` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `google_sync_state` ADD `mode` text DEFAULT 'one_way' NOT NULL;
--> statement-breakpoint
-- Only the previously released two-way worker created rows in google_sync_state.
UPDATE google_sync_state SET mode = 'two_way', cursor = NULL;
