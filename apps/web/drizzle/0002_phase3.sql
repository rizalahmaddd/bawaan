CREATE TABLE `abuse_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`reason` text NOT NULL,
	`contact` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `abuse_open` ON `abuse_reports` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `gateway_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text,
	`amount_idr` integer NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `charges_invoice` ON `gateway_charges` (`invoice_id`,`status`);--> statement-breakpoint
CREATE TABLE `platform_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`months` integer NOT NULL,
	`amount_idr` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`proof_key` text,
	`gateway_url` text,
	`gateway_ref` text,
	`created_by` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `platform_invoices_tenant` ON `platform_invoices` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `platform_invoices_status` ON `platform_invoices` (`status`);--> statement-breakpoint
CREATE TABLE `waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`notified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_product_phone` ON `waitlist` (`product_id`,`phone`);--> statement-breakpoint
CREATE INDEX `waitlist_tenant` ON `waitlist` (`tenant_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `payments` ADD `gateway_ref` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_gateway_ref_unique` ON `payments` (`gateway_ref`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `plan_until` integer;--> statement-breakpoint
ALTER TABLE `tenants` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `tenants` ADD `custom_domain` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `custom_domain_id` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `custom_domain_status` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `integrations_sealed` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_custom_domain_unique` ON `tenants` (`custom_domain`);--> statement-breakpoint
ALTER TABLE `trips` ADD `kind` text DEFAULT 'po' NOT NULL;