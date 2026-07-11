ALTER TABLE `code_billing_event` ADD `idempotency_key` text;
ALTER TABLE `code_billing_event` ADD `provider` text DEFAULT '' NOT NULL;
ALTER TABLE `code_billing_event` ADD `endpoint` text DEFAULT '' NOT NULL;
ALTER TABLE `code_billing_event` ADD `upstream_status` integer DEFAULT 0 NOT NULL;
ALTER TABLE `code_billing_event` ADD `request_id` text DEFAULT '' NOT NULL;
ALTER TABLE `code_billing_event` ADD `raw_usage` text DEFAULT '' NOT NULL;
CREATE UNIQUE INDEX `idx_code_billing_event_idempotency`
  ON `code_billing_event` (`idempotency_key`);
