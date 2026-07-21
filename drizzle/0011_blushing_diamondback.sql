ALTER TABLE `code_billing_event` ADD `cost_source` text DEFAULT 'token_rates' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `provider_request_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `provider_quota` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `provider_quota_per_cny` integer DEFAULT 1000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `provider_group` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `provider_group_ratio` real DEFAULT 0 NOT NULL;