ALTER TABLE `code_model` ADD COLUMN `input_token_cost_credits_per_1m` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_model` ADD COLUMN `output_token_cost_credits_per_1m` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_model` ADD COLUMN `cached_input_token_cost_credits_per_1m` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_model` ADD COLUMN `billing_multiplier` integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_session` ADD COLUMN `last_billed_at` integer;--> statement-breakpoint
ALTER TABLE `code_session` ADD COLUMN `billed_credits` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `code_billing_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`agent` text DEFAULT 'claude' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`event_type` text NOT NULL,
	`runtime_state` text DEFAULT '' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`raw_cost_credits` integer DEFAULT 0 NOT NULL,
	`charged_credits` integer DEFAULT 0 NOT NULL,
	`billing_multiplier` integer DEFAULT 200 NOT NULL,
	`credit_id` text,
	`status` text DEFAULT 'charged' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_code_billing_event_user_created` ON `code_billing_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_code_billing_event_session` ON `code_billing_event` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_code_billing_event_type` ON `code_billing_event` (`event_type`);
