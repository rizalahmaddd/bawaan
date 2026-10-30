CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`permissions_json` text,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_tenant` ON `invites` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `parcels` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`shipment_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`weight_g` integer NOT NULL,
	`length_cm` integer,
	`width_cm` integer,
	`height_cm` integer,
	`invoice_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parcels_shipment_customer` ON `parcels` (`shipment_id`,`customer_id`);--> statement-breakpoint
ALTER TABLE `auth_handoffs` ADD `target` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `merged_into` text;--> statement-breakpoint
CREATE INDEX `customers_user` ON `customers` (`user_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `shipment_id` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `combined_into` text;--> statement-breakpoint
CREATE INDEX `invoices_combined` ON `invoices` (`combined_into`);--> statement-breakpoint
CREATE INDEX `invoices_shipment` ON `invoices` (`shipment_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `permissions_json` text;--> statement-breakpoint
ALTER TABLE `oauth_states` ADD `target` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `decided_by` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `hold_for_combine` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shipments` ADD `cost_idr` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shipments` ADD `duty_idr` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shipments` ADD `duty_mode` text DEFAULT 'pass' NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `cargo_rate_idr_per_kg` integer;--> statement-breakpoint
ALTER TABLE `trips` ADD `cargo_round_g` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `cargo_min_idr` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `actual_kurs_micro` integer;
--> statement-breakpoint
UPDATE app_meta SET value = 'phase-2', updated_at = unixepoch() WHERE key = 'schema';
