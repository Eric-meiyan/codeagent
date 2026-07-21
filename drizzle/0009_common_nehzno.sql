ALTER TABLE `user` ADD `code_billing_lock_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `code_billing_lock_expires_at` integer;