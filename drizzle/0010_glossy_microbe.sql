PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_code_model` (
	`id` text PRIMARY KEY NOT NULL,
	`agent` text DEFAULT 'claude' NOT NULL,
	`provider` text DEFAULT 'yunwu' NOT NULL,
	`model` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`input_token_cost_credits_per_1m` real DEFAULT 0 NOT NULL,
	`output_token_cost_credits_per_1m` real DEFAULT 0 NOT NULL,
	`cache_creation_input_token_cost_credits_per_1m` real DEFAULT 0 NOT NULL,
	`cached_input_token_cost_credits_per_1m` real DEFAULT 0 NOT NULL,
	`billing_multiplier` integer DEFAULT 200 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_code_model`("id", "agent", "provider", "model", "label", "base_url", "description", "input_token_cost_credits_per_1m", "output_token_cost_credits_per_1m", "cache_creation_input_token_cost_credits_per_1m", "cached_input_token_cost_credits_per_1m", "billing_multiplier", "enabled", "is_default", "sort", "created_at", "updated_at") SELECT "id", "agent", "provider", "model", "label", "base_url", "description", "input_token_cost_credits_per_1m", "output_token_cost_credits_per_1m", "cache_creation_input_token_cost_credits_per_1m", "cached_input_token_cost_credits_per_1m", "billing_multiplier", "enabled", "is_default", "sort", "created_at", "updated_at" FROM `code_model`;--> statement-breakpoint
DROP TABLE `code_model`;--> statement-breakpoint
ALTER TABLE `__new_code_model` RENAME TO `code_model`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_code_model_agent_enabled` ON `code_model` (`agent`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_code_model_agent_default` ON `code_model` (`agent`,`is_default`);--> statement-breakpoint
CREATE INDEX `idx_code_model_agent_sort` ON `code_model` (`agent`,`sort`);