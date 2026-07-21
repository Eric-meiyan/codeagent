CREATE TABLE `code_session_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`runtime_user_id` text DEFAULT '' NOT NULL,
	`agent` text DEFAULT 'claude' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`source` text DEFAULT 'app' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_code_session_event_user_created` ON `code_session_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_code_session_event_session_created` ON `code_session_event` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_code_session_event_type` ON `code_session_event` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_code_session_event_severity_created` ON `code_session_event` (`severity`,`created_at`);
