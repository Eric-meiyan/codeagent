CREATE TABLE `code_model` (
	`id` text PRIMARY KEY NOT NULL,
	`agent` text DEFAULT 'claude' NOT NULL,
	`provider` text DEFAULT 'yunwu' NOT NULL,
	`model` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_code_model_agent_enabled` ON `code_model` (`agent`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_code_model_agent_default` ON `code_model` (`agent`,`is_default`);--> statement-breakpoint
CREATE INDEX `idx_code_model_agent_sort` ON `code_model` (`agent`,`sort`);--> statement-breakpoint
CREATE TABLE `code_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`runtime_user_id` text NOT NULL,
	`agent` text DEFAULT 'claude' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`archive_key` text,
	`archive_digest` text,
	`last_active_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_code_session_user_status` ON `code_session` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_code_session_user_last_active` ON `code_session` (`user_id`,`last_active_at`);
