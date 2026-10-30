CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`recipient` text NOT NULL,
	`phone` text NOT NULL,
	`line` text NOT NULL,
	`city` text NOT NULL,
	`province` text,
	`postal_code` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `addresses_customer` ON `addresses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`data_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_tenant` ON `audit_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_handoffs` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`return_to` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`bank` text NOT NULL,
	`number` text NOT NULL,
	`holder` text NOT NULL,
	`qris_key` text,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_tenant` ON `bank_accounts` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `counters` (
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tenant_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`phone_e164` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`notes` text,
	`tags` text,
	`balance_idr` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_tenant_phone` ON `customers` (`tenant_id`,`phone_e164`);--> statement-breakpoint
CREATE INDEX `customers_tenant_name` ON `customers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`address_snapshot` text,
	`courier` text,
	`resi` text,
	`cost_idr` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'packed' NOT NULL,
	`shipped_at` integer,
	`delivered_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deliveries_customer` ON `deliveries` (`customer_id`);--> statement-breakpoint
CREATE TABLE `idempotency` (
	`key` text PRIMARY KEY NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`order_id` text,
	`type` text NOT NULL,
	`amount_idr` integer NOT NULL,
	`unique_code` integer DEFAULT 0 NOT NULL,
	`paid_idr` integer DEFAULT 0 NOT NULL,
	`due_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`lines_json` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_tenant_number` ON `invoices` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoices_tenant_status` ON `invoices` (`tenant_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `invoices_order` ON `invoices` (`order_id`);--> statement-breakpoint
CREATE INDEX `invoices_customer` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`delta_idr` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_customer` ON `ledger_entries` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_user` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`audience` text NOT NULL,
	`target_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`seen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_target` ON `notifications` (`audience`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`return_to` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`title` text NOT NULL,
	`variant` text,
	`link` text,
	`note` text,
	`qty` integer NOT NULL,
	`qty_obtained` integer,
	`price_minor` integer,
	`currency` text NOT NULL,
	`kurs_micro` integer,
	`fee_idr` integer DEFAULT 0 NOT NULL,
	`unit_price_idr` integer,
	`actual_price_minor` integer,
	`max_price_minor` integer,
	`on_unavailable` text DEFAULT 'refund' NOT NULL,
	`approval_note` text,
	`approval_deadline` integer,
	`status` text DEFAULT 'requested' NOT NULL,
	`photo_key` text,
	`receipt_key` text,
	`shipment_id` text,
	`delivery_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_tenant_status` ON `order_items` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `order_items_shipment` ON `order_items` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`trip_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`address_id` text,
	`notes` text,
	`token_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`confirmed_at` integer,
	`closed_at` integer,
	`close_reason` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_code_unique` ON `orders` (`code`);--> statement-breakpoint
CREATE INDEX `orders_tenant_status` ON `orders` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_customer` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_idr` integer NOT NULL,
	PRIMARY KEY(`payment_id`, `invoice_id`)
);
--> statement-breakpoint
CREATE INDEX `allocations_invoice` ON `payment_allocations` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`invoice_id` text,
	`amount_idr` integer NOT NULL,
	`method` text NOT NULL,
	`proof_key` text,
	`proof_hash` text,
	`bank_account_id` text,
	`paid_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`reject_reason` text,
	`verified_by` text,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_tenant_status` ON `payments` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_customer` ON `payments` (`customer_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`price_minor` integer NOT NULL,
	`fee_idr` integer DEFAULT 0 NOT NULL,
	`est_weight_g` integer,
	`quota` integer,
	`reserved` integer DEFAULT 0 NOT NULL,
	`photo_key` text,
	`variants_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `products_trip` ON `products` (`trip_id`,`sort`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`audience` text NOT NULL,
	`target_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_target` ON `push_subscriptions` (`audience`,`target_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`forwarder` text,
	`awb` text,
	`status` text DEFAULT 'preparing' NOT NULL,
	`eta_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shipments_tenant` ON `shipments` (`tenant_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `slug_history` (
	`slug` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`released_at` integer NOT NULL,
	`redirect_until` integer NOT NULL,
	`quarantine_until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`photo_key` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`actor_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_entity` ON `status_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tint_color` text,
	`logo_key` text,
	`wa_number` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`policy_json` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`slug_changed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`country` text NOT NULL,
	`currency` text NOT NULL,
	`kurs_micro` integer NOT NULL,
	`kurs_lock` text DEFAULT 'confirm' NOT NULL,
	`rounding` integer DEFAULT 1000 NOT NULL,
	`default_fee_idr` integer DEFAULT 0 NOT NULL,
	`dp_percent` integer NOT NULL,
	`opens_at` integer,
	`closes_at` integer NOT NULL,
	`eta_at` integer,
	`mode` text DEFAULT 'cargo' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trips_tenant_status` ON `trips` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);