CREATE TABLE `room_media_usage` (
	`room_id` text PRIMARY KEY NOT NULL,
	`upload_count` integer DEFAULT 0 NOT NULL,
	`byte_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
