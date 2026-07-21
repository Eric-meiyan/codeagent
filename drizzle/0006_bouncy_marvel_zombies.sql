ALTER TABLE `code_billing_event` ADD `collectible` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `settlement_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `last_settlement_at` integer;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `settled_at` integer;--> statement-breakpoint
ALTER TABLE `code_billing_event` ADD `settlement_error` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_code_billing_event_collectible_status` ON `code_billing_event` (`collectible`,`status`,`created_at`);
