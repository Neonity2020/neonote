CREATE TABLE `tombstone` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tombstone_user_deleted_idx` ON `tombstone` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `block_user_updated_idx` ON `block` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `page_user_updated_idx` ON `page` (`user_id`,`updated_at`);