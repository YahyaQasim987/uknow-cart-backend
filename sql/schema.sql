-- =============================================================================
-- DATABASE SCHEMA: U-KNOW CART LUXURY E-COMMERCE (CONSOLIDATED MASTER SCHEMA)
-- RDBMS: MySQL 8.0.16+  (Strict CHECK constraints & STORED generated keys enforced)
-- Character Set: utf8mb4 / Collation: utf8mb4_unicode_ci
--
-- Single, consolidated, latest production database schema file.
-- All columns, modern constraints, and responsive assets unified in one place.
-- =============================================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `uknow_store`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `uknow_store`;

-- -----------------------------------------------------------------------------
-- 1. USERS & CREDENTIALS (roles strictly: admin, customer)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `full_name` VARCHAR(150) NULL,
  `email` VARCHAR(150) NOT NULL,
  `secondary_email` VARCHAR(150) NULL,
  `recovery_email` VARCHAR(150) NULL,
  `password_hash` VARCHAR(255) NULL,
  `email_verified` BOOLEAN NOT NULL DEFAULT TRUE,
  `signup_method` ENUM('website', 'google', 'facebook', 'unknown') NOT NULL DEFAULT 'unknown',
  `role` ENUM('admin', 'customer') NOT NULL DEFAULT 'customer',
  `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  `last_login_at` TIMESTAMP NULL,
  `avatar` VARCHAR(500) NULL,
  `profile_image` VARCHAR(500) NULL,
  `phone` VARCHAR(50) NULL,
  `primary_phone` VARCHAR(50) NULL,
  `secondary_phone` VARCHAR(50) NULL,
  `whatsapp_phone` VARCHAR(50) NULL,
  `whatsapp_number` VARCHAR(50) NULL,
  `city` VARCHAR(100) NULL,
  `address` TEXT NULL,
  `bio` TEXT NULL,
  `bank_name` VARCHAR(100) NULL,
  `bank_account_title` VARCHAR(150) NULL,
  `bank_account_number` VARCHAR(100) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_email` (`email`),
  INDEX `idx_users_role` (`role`),
  INDEX `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. CATEGORIES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `categories` (
  `id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `icon` VARCHAR(50) NULL DEFAULT '💎',
  `image_url` VARCHAR(500) NULL,
  `description` TEXT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. SUB-CATEGORIES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sub_categories` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `category_id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `image_url` VARCHAR(500) NULL,
  `description` TEXT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cat_subcat` (`category_id`, `name`),
  CONSTRAINT `fk_subcat_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. BRANDS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `brands` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `image_url` VARCHAR(500) NULL,
  `description` TEXT NULL,
  `is_featured` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_brands_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. PRODUCTS (catalog, payment policies, stock, delivery charges & responsive banners)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `products` (
  `id` VARCHAR(50) NOT NULL,
  `admin_id` VARCHAR(50) NULL,
  `owner_id` VARCHAR(50) NULL,
  `owner_name` VARCHAR(150) NULL,
  `owner_phone` VARCHAR(50) NULL,
  `owner_whatsapp` VARCHAR(50) NULL,
  `name` VARCHAR(200) NOT NULL,
  `subtitle` VARCHAR(255) NULL,
  `category_id` VARCHAR(50) NOT NULL,
  `sub_category` VARCHAR(100) NULL,
  `brand` VARCHAR(100) NULL,
  `luxury_tier` VARCHAR(50) NULL DEFAULT 'Luxury',
  `price` DECIMAL(12, 2) NOT NULL,
  `cost_price` DECIMAL(12, 2) NULL,
  `original_price` DECIMAL(12, 2) NULL,
  `discount_type` ENUM('percentage', 'fixed') NULL DEFAULT 'percentage',
  `discount_value` DECIMAL(12, 2) NULL DEFAULT 0.00,
  `rating` DECIMAL(3, 2) NOT NULL DEFAULT 5.00,
  `reviews_count` INT NOT NULL DEFAULT 0,
  `description` TEXT NOT NULL,
  `stock` INT NOT NULL DEFAULT 0,
  `reserved_stock` INT NOT NULL DEFAULT 0,
  `sku` VARCHAR(100) NOT NULL,
  `gtin` VARCHAR(32) NULL,
  `mpn` VARCHAR(100) NULL,
  `model_number` VARCHAR(100) NULL,
  `warranty` VARCHAR(255) NULL,
  `tags` JSON NULL,
  `badge` VARCHAR(50) NULL,
  `featured` BOOLEAN NOT NULL DEFAULT FALSE,
  `show_on_home` BOOLEAN NOT NULL DEFAULT TRUE,
  `is_new` BOOLEAN NOT NULL DEFAULT FALSE,
  `video_url` VARCHAR(500) NULL,
  `hover_video_url` VARCHAR(500) NULL,
  `hover_image` VARCHAR(500) NULL,
  `delivery_days` INT NOT NULL DEFAULT 3,
  `delivery_timeline_note` VARCHAR(255) NULL,
  `delivery_charges` DECIMAL(10, 2) NULL DEFAULT NULL,
  `show_in_carousel` BOOLEAN NOT NULL DEFAULT FALSE,
  `delivery_advance_required` BOOLEAN NOT NULL DEFAULT FALSE,
  `delivery_advance_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `delivery_advance_value` DECIMAL(12, 2) NULL,
  `urgent_delivery_advance_required` BOOLEAN NOT NULL DEFAULT FALSE,
  `urgent_delivery_advance_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `urgent_delivery_advance_value` DECIMAL(12, 2) NULL,
  `payment_policy` ENUM('cod', 'advance_deposit', 'full_prepay') NOT NULL DEFAULT 'cod',
  `advance_payment_required` BOOLEAN NOT NULL DEFAULT FALSE,
  `advance_payment_type` ENUM('percentage', 'fixed') NULL DEFAULT 'percentage',
  `advance_payment_amount` DECIMAL(12, 2) NULL,
  `advance_payment_percent` INT NULL DEFAULT 20,
  `advance_payment_value` DECIMAL(12, 2) NULL,
  `city_restriction_mode` ENUM('all', 'restricted') NOT NULL DEFAULT 'all',
  `expires_at` DATETIME NULL,
  `archived_at` DATETIME NULL,
  `archived_by` VARCHAR(50) NULL,
  `archive_reason` VARCHAR(255) NULL,
  `show_on_banner` BOOLEAN NOT NULL DEFAULT FALSE,
  `banner_image` VARCHAR(500) NULL,
  `banner_desktop_image` VARCHAR(500) NULL,
  `banner_tablet_image` VARCHAR(500) NULL,
  `banner_mobile_image` VARCHAR(500) NULL,
  `banner_title` VARCHAR(200) NULL,
  `banner_subtitle` VARCHAR(255) NULL,
  `banner_eyebrow` VARCHAR(150) NULL,
  `banner_badge` VARCHAR(100) NULL,
  `category_description` TEXT NULL,
  `sub_category_description` TEXT NULL,
  `seo_title` VARCHAR(255) NULL,
  `meta_description` TEXT NULL,
  `url_slug` VARCHAR(255) NULL,
  `image_alt_text` VARCHAR(255) NULL,
  `variants_mode` ENUM('none', 'short', 'full') NOT NULL DEFAULT 'none',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prod_sku` (`sku`),
  INDEX `idx_prod_category` (`category_id`),
  INDEX `idx_prod_brand` (`brand`),
  INDEX `idx_prod_price` (`price`),
  INDEX `idx_prod_featured` (`featured`),
  INDEX `idx_prod_show_home` (`show_on_home`),
  INDEX `idx_prod_carousel` (`show_in_carousel`),
  INDEX `idx_prod_admin` (`admin_id`),
  INDEX `idx_prod_archived` (`archived_at`),
  CONSTRAINT `fk_prod_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_prod_admin` FOREIGN KEY (`admin_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_prod_price` CHECK (`price` >= 0),
  CONSTRAINT `chk_prod_stock` CHECK (`stock` >= 0),
  CONSTRAINT `chk_prod_reserved` CHECK (`reserved_stock` >= 0),
  CONSTRAINT `chk_prod_rating` CHECK (`rating` >= 0 AND `rating` <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. PRODUCT IMAGES (multi-angle gallery)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `product_images` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `image_url` VARCHAR(500) NOT NULL,
  `image_checksum` CHAR(64) NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_prod_img_fk` (`product_id`),
  UNIQUE INDEX `uq_prod_img_checksum` (`product_id`, `image_checksum`),
  CONSTRAINT `fk_prod_img_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. PRODUCT VARIANTS (short options & full editions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `product_variants` (
  `id` VARCHAR(50) NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `barcode` VARCHAR(100) NULL,
  `variant_type` VARCHAR(50) NULL DEFAULT 'Option',
  `variant_code` VARCHAR(50) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `is_full_variant` BOOLEAN NOT NULL DEFAULT FALSE,
  `price` DECIMAL(12, 2) NOT NULL,
  `cost_price` DECIMAL(12, 2) NULL,
  `original_price` DECIMAL(12, 2) NULL,
  `discount_type` ENUM('percentage', 'fixed') NULL DEFAULT 'percentage',
  `discount_value` DECIMAL(12, 2) NULL DEFAULT 0.00,
  `stock` INT NOT NULL DEFAULT 0,
  `reserved_stock` INT NOT NULL DEFAULT 0,
  `color` VARCHAR(50) NULL,
  `size` VARCHAR(50) NULL,
  `image_url` VARCHAR(500) NULL,
  `video_url` VARCHAR(500) NULL,
  `subtitle` VARCHAR(255) NULL,
  `description` TEXT NULL,
  `images` JSON NULL,
  `brand` VARCHAR(100) NULL,
  `sub_category` VARCHAR(100) NULL,
  `luxury_tier` VARCHAR(50) NULL,
  `delivery_days` INT NULL,
  `delivery_timeline_note` VARCHAR(255) NULL,
  `delivery_charges` DECIMAL(10, 2) NULL DEFAULT NULL,
  `advance_payment_required` BOOLEAN NULL,
  `advance_payment_type` ENUM('percentage', 'fixed') NULL DEFAULT 'percentage',
  `advance_payment_amount` DECIMAL(12, 2) NULL,
  `advance_payment_percent` INT NULL,
  `advance_payment_value` DECIMAL(12, 2) NULL,
  `city_restriction_mode` ENUM('all', 'restricted') NULL DEFAULT 'all',
  `allowed_cities` JSON NULL,
  `standalone_in_catalog` BOOLEAN NOT NULL DEFAULT TRUE,
  `badge` VARCHAR(50) NULL,
  `expires_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_variant_sku` (`sku`),
  INDEX `idx_variant_prod` (`product_id`),
  CONSTRAINT `fk_variant_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_variant_price` CHECK (`price` >= 0),
  CONSTRAINT `chk_variant_stock` CHECK (`stock` >= 0),
  CONSTRAINT `chk_variant_reserved` CHECK (`reserved_stock` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7b. GLOBAL SKU INFRASTRUCTURE (products + variants share one namespace)
-- -----------------------------------------------------------------------------
-- One row per generated sequence scope, e.g. product:PERF:202611.
CREATE TABLE IF NOT EXISTS `sku_sequences` (
  `scope_key` VARCHAR(120) NOT NULL,
  `last_value` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`scope_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The single global uniqueness guard: a SKU can belong to only one product OR variant.
CREATE TABLE IF NOT EXISTS `sku_registry` (
  `sku` VARCHAR(64) NOT NULL,
  `entity_type` ENUM('product', 'variant') NOT NULL,
  `entity_id` VARCHAR(50) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sku`),
  INDEX `idx_sku_registry_entity` (`entity_type`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. PRODUCT ALLOWED CITIES (fraud prevention & delivery geofencing)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `product_allowed_cities` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `city_name` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prod_city` (`product_id`, `city_name`),
  CONSTRAINT `fk_allowed_city_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8b. ADVANCE PAYMENT POLICIES (global and city scoped per vendor/admin)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_payment_policies` (
  `admin_id` VARCHAR(50) NOT NULL,
  `product_advance_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `product_advance_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `product_advance_value` DECIMAL(12, 2) NULL,
  `delivery_advance_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `delivery_advance_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `delivery_advance_value` DECIMAL(12, 2) NULL,
  `apply_delivery_advance_to_urgent` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_payment_policies` (
  `id` VARCHAR(60) NOT NULL,
  `admin_id` VARCHAR(50) NOT NULL,
  `city_name` VARCHAR(100) NOT NULL,
  `product_advance_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `product_advance_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `product_advance_value` DECIMAL(12, 2) NULL,
  `delivery_advance_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `delivery_advance_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `delivery_advance_value` DECIMAL(12, 2) NULL,
  `apply_delivery_advance_to_urgent` BOOLEAN NOT NULL DEFAULT TRUE,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_city_policy_admin_city` (`admin_id`, `city_name`),
  INDEX `idx_city_policy_city` (`city_name`),
  INDEX `idx_city_policy_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. ORDERS & CHECKOUT FINANCIALS (authoritative pricing, courier locks & guest tokens)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
  `id` VARCHAR(50) NOT NULL,
  `user_id` VARCHAR(50) NULL,
  `customer_id` VARCHAR(50) NULL,
  `guest_access_token` VARCHAR(100) NULL,
  `checkout_key` VARCHAR(100) NULL,
  `checkout_request_hash` CHAR(64) NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `customer_phone` VARCHAR(50) NOT NULL,
  `customer_email` VARCHAR(150) NOT NULL,
  `customer_city` VARCHAR(100) NOT NULL,
  `customer_address` TEXT NOT NULL,
  `customer_postal_code` VARCHAR(20) NULL,
  `payment_method` ENUM('cod', 'card', 'bank_transfer', 'easypaisa', 'jazzcash', 'payfast') NOT NULL,
  `payment_status` ENUM('pending', 'partially_paid', 'paid', 'failed', 'refunded', 'reversed', 'disputed', 'awaiting_proof', 'proof_submitted', 'verification_pending', 'rejected', 'verified', 'expired') NOT NULL DEFAULT 'pending',
  `order_status` ENUM('placed', 'confirmed', 'processing', 'courier_assigned', 'shipped', 'delivered', 'cancelled', 'returned', 'expired') NOT NULL DEFAULT 'placed',
  `payment_review` BOOLEAN NOT NULL DEFAULT FALSE,
  `payment_review_from_status` VARCHAR(30) NULL,
  `expires_at` DATETIME NULL,
  `customer_hidden_at` DATETIME NULL,
  `coupon_code` VARCHAR(50) NULL,
  `subtotal` DECIMAL(12, 2) NOT NULL,
  `discount_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `tax_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `shipping` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `total` DECIMAL(12, 2) NOT NULL,
  `advance_payment_due` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `cod_remaining_due` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `transaction_reference` VARCHAR(150) NULL,
  `account_holder_name` VARCHAR(150) NULL,
  `payment_platform` VARCHAR(100) NULL,
  `max_delivery_days` INT NOT NULL DEFAULT 3,
  `delivery_speed` ENUM('standard', 'urgent') NOT NULL DEFAULT 'standard',
  `urgent_delivery_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `tracking_number` VARCHAR(100) NULL,
  `courier_partner` VARCHAR(100) NULL,
  `courier_status_note` VARCHAR(255) NULL,
  `delivered_at` TIMESTAMP NULL,
  `cancellation_reason` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_order_user` (`user_id`),
  INDEX `idx_order_customer` (`customer_id`),
  INDEX `idx_order_guest_token` (`guest_access_token`),
  UNIQUE INDEX `uk_order_checkout_key` (`checkout_key`),
  INDEX `idx_order_status` (`order_status`),
  INDEX `idx_order_payment_status` (`payment_status`),
  INDEX `idx_order_payment_review` (`payment_review`),
  INDEX `idx_order_payment_expiry` (`payment_status`, `expires_at`),
  INDEX `idx_order_customer_visibility` (`customer_id`, `customer_hidden_at`, `order_status`),
  INDEX `idx_order_created` (`created_at`),
  INDEX `idx_order_tracking` (`tracking_number`),
  CONSTRAINT `fk_order_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_order_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_order_subtotal` CHECK (`subtotal` >= 0),
  CONSTRAINT `chk_order_total` CHECK (`total` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9A. MANUAL ADVANCE PAYMENT PROOFS & AUDIT HISTORY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_payment_proofs` (
  `id` VARCHAR(50) NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `admin_id` VARCHAR(50) NULL,
  `amount_due` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `image_storage_path` VARCHAR(500) NULL,
  `account_holder_name` VARCHAR(150) NULL,
  `payment_platform` VARCHAR(100) NULL,
  `transaction_reference` VARCHAR(150) NULL,
  `amount` DECIMAL(12, 2) NULL,
  `status` ENUM('awaiting_proof', 'verification_pending', 'verified', 'rejected', 'expired') NOT NULL DEFAULT 'awaiting_proof',
  `submitted_at` TIMESTAMP NULL DEFAULT NULL,
  `verified_by` VARCHAR(50) NULL,
  `verified_at` DATETIME NULL,
  `rejection_reason` VARCHAR(1000) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payment_proof_order_admin` (`order_id`, `admin_id`),
  INDEX `idx_payment_proof_order` (`order_id`, `created_at`),
  INDEX `idx_payment_proof_admin` (`admin_id`),
  INDEX `idx_payment_proof_verifier` (`verified_by`),
  INDEX `idx_payment_proof_platform_ref` (`payment_platform`, `transaction_reference`),
  CONSTRAINT `fk_payment_proof_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_proof_admin` FOREIGN KEY (`admin_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payment_proof_verifier` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_payment_proof_due` CHECK (`amount_due` >= 0),
  CONSTRAINT `chk_payment_proof_amount` CHECK (`amount` IS NULL OR `amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_payment_proof_history` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `payment_proof_id` VARCHAR(50) NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `previous_status` VARCHAR(30) NULL,
  `new_status` VARCHAR(30) NOT NULL,
  `actor_id` VARCHAR(50) NULL,
  `actor_role` VARCHAR(30) NOT NULL,
  `reason` VARCHAR(1000) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_payment_proof_history_order` (`order_id`, `created_at`),
  CONSTRAINT `fk_payment_proof_history_proof` FOREIGN KEY (`payment_proof_id`) REFERENCES `order_payment_proofs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_proof_history_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_proof_history_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_payment_status_history` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `previous_status` VARCHAR(30) NULL,
  `new_status` VARCHAR(30) NOT NULL,
  `actor_id` VARCHAR(50) NULL,
  `actor_role` VARCHAR(30) NOT NULL,
  `reason` VARCHAR(1000) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_order_payment_status_history` (`order_id`, `created_at`),
  CONSTRAINT `fk_order_payment_status_history_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_order_payment_status_history_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. ORDER ITEMS (historical price snapshots & admin attribution)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(200) NOT NULL,
  `variant_id` VARCHAR(50) NULL,
  `admin_id` VARCHAR(50) NULL,
  `variant_name` VARCHAR(150) NULL,
  `price` DECIMAL(12, 2) NOT NULL,
  `cost_price` DECIMAL(12, 2) NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `image_url` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_order_items_fk` (`order_id`),
  INDEX `idx_order_items_product` (`product_id`),
  INDEX `idx_order_items_admin` (`admin_id`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_order_items_admin` FOREIGN KEY (`admin_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_order_items_price` CHECK (`price` >= 0),
  CONSTRAINT `chk_order_items_qty` CHECK (`quantity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. INVENTORY RESERVATIONS (concurrency & safe stock locking)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `inventory_reservations` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `variant_id` VARCHAR(50) NULL,
  `quantity` INT NOT NULL,
  `status` ENUM('active', 'released', 'committed') NOT NULL DEFAULT 'active',
  `expires_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_res_order` (`order_id`),
  INDEX `idx_res_prod` (`product_id`),
  INDEX `idx_res_variant` (`variant_id`),
  INDEX `idx_res_status` (`status`),
  CONSTRAINT `fk_res_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_res_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_res_variant` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_res_qty` CHECK (`quantity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_adjustments` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `variant_id` VARCHAR(50) NULL,
  `admin_id` VARCHAR(50) NULL,
  `previous_stock` INT NOT NULL,
  `new_stock` INT NOT NULL,
  `adjustment` INT NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_inventory_adjustments_product` (`product_id`),
  INDEX `idx_inventory_adjustments_variant` (`variant_id`),
  INDEX `idx_inventory_adjustments_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. ORDER STATUS HISTORY (durable audit trail)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_status_history` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `previous_status` VARCHAR(50) NULL,
  `new_status` VARCHAR(50) NOT NULL,
  `actor` VARCHAR(150) NOT NULL,
  `actor_role` VARCHAR(50) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_hist_order` (`order_id`),
  CONSTRAINT `fk_hist_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. VERIFIED REVIEWS & 30-SEC UNBOXING VIDEOS (default status: pending)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` VARCHAR(50) NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(200) NULL,
  `user_id` VARCHAR(50) NULL,
  `user_name` VARCHAR(150) NOT NULL,
  `user_city` VARCHAR(100) NULL,
  `rating` INT NOT NULL DEFAULT 5,
  `comment` TEXT NOT NULL,
  `verified_purchase` BOOLEAN NOT NULL DEFAULT FALSE,
  `video_url` VARCHAR(500) NULL,
  `video_thumbnail` VARCHAR(500) NULL,
  `video_duration` INT NULL DEFAULT 24,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_review_prod` (`product_id`),
  INDEX `idx_review_user` (`user_id`),
  INDEX `idx_review_status` (`status`),
  CONSTRAINT `fk_review_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_review_rating` CHECK (`rating` BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 14. STORE SETTINGS & LOGISTICS CONFIGURATION (single row: id = 1)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `store_settings` (
  `id` INT NOT NULL DEFAULT 1,
  `store_name` VARCHAR(150) NOT NULL,
  `store_tagline` VARCHAR(255) NOT NULL,
  `legal_business_name` VARCHAR(150) NULL,
  `tax_registration_number` VARCHAR(100) NULL,
  `brand_accent_color` VARCHAR(50) NULL DEFAULT '#d97706',
  `store_logo_url` VARCHAR(500) NULL DEFAULT NULL,
  `support_email` VARCHAR(150) NOT NULL,
  `support_phone` VARCHAR(50) NOT NULL,
  `whatsapp_number` VARCHAR(50) NOT NULL,
  `alternate_phone` VARCHAR(50) NULL,
  `complaints_email` VARCHAR(150) NULL,
  `urgent_contact_person` VARCHAR(150) NULL,
  `store_address` TEXT NOT NULL,
  `warehouse_address` TEXT NULL,
  `warehouse_city` VARCHAR(100) NULL DEFAULT 'Lahore',
  `standard_shipping_fee` DECIMAL(10, 2) NOT NULL DEFAULT 350.00,
  `free_shipping_threshold` DECIMAL(12, 2) NOT NULL DEFAULT 999999999.00,
  `enable_free_shipping` BOOLEAN NOT NULL DEFAULT FALSE,
  `urgent_shipping_fee` DECIMAL(10, 2) NOT NULL DEFAULT 600.00,
  `enable_urgent_shipping` BOOLEAN NOT NULL DEFAULT TRUE,
  `primary_courier` VARCHAR(50) NOT NULL DEFAULT 'tcs',
  `enable_cod` BOOLEAN NOT NULL DEFAULT TRUE,
  `cod_max_limit` DECIMAL(12, 2) NOT NULL DEFAULT 100000.00,
  `require_advance_for_high_value` BOOLEAN NOT NULL DEFAULT TRUE,
  `advance_payment_threshold` DECIMAL(12, 2) NOT NULL DEFAULT 25000.00,
  `advance_payment_percent` INT NOT NULL DEFAULT 20,
  `enable_easypaisa` BOOLEAN NOT NULL DEFAULT FALSE,
  `easypaisa_account_number` VARCHAR(50) NULL,
  `easypaisa_account_title` VARCHAR(150) NULL,
  `enable_jazzcash` BOOLEAN NOT NULL DEFAULT FALSE,
  `jazzcash_account_number` VARCHAR(50) NULL,
  `jazzcash_account_title` VARCHAR(150) NULL,
  `enable_bank_transfer` BOOLEAN NOT NULL DEFAULT FALSE,
  `bank_name` VARCHAR(100) NULL,
  `bank_account_title` VARCHAR(150) NULL,
  `bank_iban` VARCHAR(50) NULL,
  `bank_branch_code` VARCHAR(50) NULL,
  `enable_card_payments` BOOLEAN NOT NULL DEFAULT TRUE,
  `low_stock_threshold` INT NOT NULL DEFAULT 5,
  `min_order_amount` DECIMAL(10, 2) NOT NULL DEFAULT 500.00,
  `customer_cancellation_hours` INT NOT NULL DEFAULT 36,
  `maintenance_mode` BOOLEAN NOT NULL DEFAULT FALSE,
  `announcement_bar_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `announcement_text` TEXT NULL,
  `announcement_theme` VARCHAR(50) NOT NULL DEFAULT 'amber',
  `announcement_link` VARCHAR(255) NOT NULL DEFAULT '/shop',
  `extra_data` JSON NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_store_settings_single_row` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 15. PROMOTIONAL COUPONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `coupons` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `discount_percent` INT NOT NULL,
  `min_order_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `max_discount` DECIMAL(12, 2) NULL,
  `expires_at` DATETIME NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_coupon_code` (`code`),
  CONSTRAINT `chk_coupon_percent` CHECK (`discount_percent` BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 16. SEO ENTITIES (on-page metadata, slugs, canonical URLs, social cards)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `seo_entities` (
  `id` VARCHAR(100) NOT NULL,
  `entity_type` ENUM('page', 'product', 'category', 'sub_category', 'brand') NOT NULL,
  `entity_id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `seo_title` VARCHAR(255) NOT NULL,
  `meta_description` TEXT NOT NULL,
  `preferred_slug` VARCHAR(255) NOT NULL,
  `canonical_url` VARCHAR(500) NOT NULL,
  `h1_heading` VARCHAR(255) NULL,
  `main_page_description` TEXT NULL,
  `target_keyword` VARCHAR(150) NULL,
  `related_keywords` JSON NULL,
  `search_intent` ENUM('transactional', 'commercial', 'informational', 'navigational') NOT NULL DEFAULT 'transactional',
  `og_title` VARCHAR(255) NULL,
  `og_description` TEXT NULL,
  `og_image` VARCHAR(500) NULL,
  `twitter_card` ENUM('summary_large_image', 'summary') NOT NULL DEFAULT 'summary_large_image',
  `robots_index` BOOLEAN NOT NULL DEFAULT TRUE,
  `robots_follow` BOOLEAN NOT NULL DEFAULT TRUE,
  `is_published` BOOLEAN NOT NULL DEFAULT TRUE,
  `seo_notes` TEXT NULL,
  `seo_score` INT NOT NULL DEFAULT 0,
  `last_modified` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_seo_entity` (`entity_type`, `entity_id`),
  INDEX `idx_seo_slug` (`preferred_slug`),
  CONSTRAINT `chk_seo_score` CHECK (`seo_score` BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 17. SEO 301/302 REDIRECTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `seo_redirects` (
  `id` VARCHAR(100) NOT NULL,
  `source_url` VARCHAR(500) NOT NULL,
  `destination_url` VARCHAR(500) NOT NULL,
  `status_code` INT NOT NULL DEFAULT 301,
  `reason` VARCHAR(255) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `hits_count` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_redirect_source` (`source_url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seo_image_alts` (
  `id` VARCHAR(100) NOT NULL,
  `entity_type` ENUM('product', 'category', 'sub_category', 'brand', 'page', 'banner') NOT NULL,
  `entity_id` VARCHAR(50) NOT NULL,
  `entity_name` VARCHAR(200) NOT NULL,
  `image_url` VARCHAR(500) NOT NULL,
  `alt_text` TEXT NOT NULL,
  `image_title` VARCHAR(255) NULL,
  `file_name` VARCHAR(255) NULL,
  `dimensions` VARCHAR(50) NULL,
  `is_decorative` BOOLEAN NOT NULL DEFAULT FALSE,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seo_robots_config` (
  `id` INT NOT NULL DEFAULT 1,
  `content` TEXT NOT NULL,
  `sitemap_url` VARCHAR(500) NULL,
  `disallowed_paths` JSON NULL,
  `allowed_paths` JSON NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seo_audit_issues` (
  `id` VARCHAR(100) NOT NULL,
  `severity` ENUM('critical', 'high', 'medium', 'low') NOT NULL DEFAULT 'medium',
  `category` VARCHAR(50) NOT NULL,
  `page_url` VARCHAR(500) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `recommendation` TEXT NOT NULL,
  `auto_fixable` BOOLEAN NOT NULL DEFAULT FALSE,
  `is_resolved` BOOLEAN NOT NULL DEFAULT FALSE,
  `dismissed` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seo_keywords` (
  `id` VARCHAR(100) NOT NULL,
  `keyword` VARCHAR(200) NOT NULL,
  `search_intent` ENUM('transactional', 'commercial', 'informational', 'navigational') NOT NULL DEFAULT 'commercial',
  `target_page_url` VARCHAR(500) NOT NULL,
  `target_entity_type` VARCHAR(50) NULL,
  `target_entity_id` VARCHAR(50) NULL,
  `notes` TEXT NULL,
  `status` ENUM('ranking', 'in_progress', 'planned') NOT NULL DEFAULT 'in_progress',
  `added_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 18. STORE ADS & SPONSORED CAMPAIGNS (default: draft / payment pending)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `store_ads` (
  `id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `advertiser_name` VARCHAR(150) NOT NULL DEFAULT 'Atelier Luxury Partners',
  `advertiser_id` VARCHAR(50) NULL,
  `campaign_name` VARCHAR(150) NOT NULL,
  `ad_type` ENUM('banner', 'text', 'video') NOT NULL DEFAULT 'banner',
  `headline` VARCHAR(150) NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NOT NULL,
  `business_logo` VARCHAR(500) NULL,
  `cta_text` VARCHAR(50) NOT NULL DEFAULT 'Explore Now',
  `image_url` VARCHAR(500) NOT NULL,
  `mobile_image_url` VARCHAR(500) NULL,
  `video_url` VARCHAR(500) NULL,
  `destination_url` VARCHAR(500) NOT NULL,
  `badge` VARCHAR(50) NULL,
  `status` ENUM('draft', 'pending_review', 'approved', 'rejected', 'active', 'paused', 'completed', 'archived') NOT NULL DEFAULT 'draft',
  `rejection_reason` TEXT NULL,
  `priority` INT NOT NULL DEFAULT 80,
  `pricing_model` ENUM('fixed', 'cpm', 'cpc') NOT NULL DEFAULT 'cpc',
  `budget` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `daily_budget` DECIMAL(12, 2) NULL,
  `cpm_rate` DECIMAL(10, 2) NULL DEFAULT 120.00,
  `cpc_rate` DECIMAL(10, 2) NULL DEFAULT 25.00,
  `max_impressions` INT NULL DEFAULT 50000,
  `max_clicks` INT NULL DEFAULT 2000,
  `impressions` INT NOT NULL DEFAULT 0,
  `clicks` INT NOT NULL DEFAULT 0,
  `spending` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `revenue` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `payment_status` ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
  `start_date` DATETIME NOT NULL,
  `end_date` DATETIME NULL,
  `start_time` VARCHAR(10) NULL DEFAULT '00:00',
  `end_time` VARCHAR(10) NULL DEFAULT '23:59',
  `timezone` VARCHAR(50) NULL DEFAULT 'Asia/Karachi',
  `target_type` VARCHAR(50) NULL DEFAULT 'category',
  `target_product_id` VARCHAR(50) NULL,
  `target_category` VARCHAR(100) NULL,
  `target_brand` VARCHAR(100) NULL,
  `target_sub_category` VARCHAR(100) NULL,
  `custom_url` VARCHAR(500) NULL,
  `city_targets` JSON NULL,
  `device_target` ENUM('all', 'desktop', 'mobile') NOT NULL DEFAULT 'all',
  `placements` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ad_status` (`status`),
  CONSTRAINT `chk_ad_budget` CHECK (`budget` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 19. NOTIFICATIONS & STORE AUDIT LOGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(50) NOT NULL,
  `recipient_id` VARCHAR(50) NULL,
  `audience` ENUM('all', 'admin', 'customer') NOT NULL DEFAULT 'all',
  `type` VARCHAR(50) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `message` TEXT NOT NULL,
  `order_id` VARCHAR(50) NULL,
  `link_url` VARCHAR(500) NULL,
  `is_read` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_notif_recipient` (`recipient_id`),
  INDEX `idx_notif_audience` (`audience`),
  INDEX `idx_notif_read` (`is_read`),
  INDEX `idx_notif_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 20. PAYMENT TRANSACTIONS (provider-neutral deferred stubs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_transactions` (
  `id` VARCHAR(50) NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `transaction_ref` VARCHAR(150) NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'PKR',
  `status` ENUM('pending', 'completed', 'failed', 'refunded', 'reversed', 'disputed') NOT NULL DEFAULT 'pending',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pay_order` (`order_id`),
  INDEX `idx_pay_ref` (`transaction_ref`),
  CONSTRAINT `fk_pay_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_status_history` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `payment_transaction_id` VARCHAR(50) NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `previous_status` VARCHAR(30) NULL,
  `new_status` VARCHAR(30) NOT NULL,
  `source` VARCHAR(50) NOT NULL,
  `details` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_payment_history_order` (`order_id`),
  INDEX `idx_payment_history_transaction` (`payment_transaction_id`),
  CONSTRAINT `fk_payment_history_transaction` FOREIGN KEY (`payment_transaction_id`) REFERENCES `payment_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_history_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_webhook_events` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `provider_event_id` VARCHAR(150) NOT NULL,
  `transaction_ref` VARCHAR(150) NOT NULL,
  `event_type` VARCHAR(50) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `received_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payment_webhook_event` (`provider`, `provider_event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `refund_requests` (
  `id` VARCHAR(50) NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `requested_by` VARCHAR(50) NOT NULL,
  `payment_transaction_id` VARCHAR(50) NULL,
  `provider` ENUM('bank_transfer', 'easypaisa', 'jazzcash', 'payfast', 'other') NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `reason` TEXT NULL,
  `destination_hint` VARCHAR(80) NULL,
  `status` ENUM('requested', 'under_review', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled', 'manually_refunded', 'gateway_refunded') NOT NULL DEFAULT 'requested',
  `provider_reference` VARCHAR(150) NULL,
  `notes` TEXT NULL,
  `refund_method` VARCHAR(100) NULL,
  `refund_date` DATETIME NULL,
  `admin_notes` TEXT NULL,
  `proof_url` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_refund_order` (`order_id`),
  INDEX `idx_refund_transaction` (`payment_transaction_id`),
  INDEX `idx_refund_status` (`status`),
  INDEX `idx_refund_created` (`created_at`),
  CONSTRAINT `chk_refund_amount` CHECK (`amount` > 0),
  CONSTRAINT `fk_refund_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_refund_payment` FOREIGN KEY (`payment_transaction_id`) REFERENCES `payment_transactions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `refund_status_history` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `refund_request_id` VARCHAR(50) NOT NULL,
  `previous_status` VARCHAR(30) NULL,
  `new_status` VARCHAR(30) NOT NULL,
  `actor_id` VARCHAR(50) NULL,
  `details` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_refund_history_request` (`refund_request_id`),
  CONSTRAINT `fk_refund_history_request` FOREIGN KEY (`refund_request_id`) REFERENCES `refund_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 21. HERO BANNERS (carousel slides & responsive images)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hero_banners` (
  `id` VARCHAR(100) NOT NULL,
  `internal_name` VARCHAR(255) NULL,
  `theme` VARCHAR(50) DEFAULT 'dark',
  `eyebrow` VARCHAR(255) NULL,
  `category_label` VARCHAR(255) NULL,
  `title` VARCHAR(255) NOT NULL,
  `subtitle` TEXT NULL,
  `image` TEXT NULL,
  `desktop_image` TEXT NULL,
  `tablet_image` TEXT NULL,
  `mobile_image` TEXT NULL,
  `mobile_image_url` TEXT NULL,
  `overlay_opacity` INT DEFAULT 45,
  `button_text` VARCHAR(100) DEFAULT 'Explore Collection',
  `badge` VARCHAR(100) NULL,
  `link_type` VARCHAR(50) DEFAULT 'category',
  `target_product_id` VARCHAR(100) NULL,
  `target_category` VARCHAR(100) NULL,
  `target_sub_category` VARCHAR(100) NULL,
  `custom_url` TEXT NULL,
  `price` DECIMAL(12, 2) NULL,
  `original_price` DECIMAL(12, 2) NULL,
  `accent_label` VARCHAR(255) NULL,
  `display_order` INT DEFAULT 1,
  `active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_hero_banners_active` (`active`),
  INDEX `idx_hero_banners_order` (`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 22. PROMO CARDS (cards under hero)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `promo_cards` (
  `id` VARCHAR(100) NOT NULL,
  `internal_name` VARCHAR(255) NULL,
  `tag` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `image` TEXT NULL,
  `mobile_image_url` TEXT NULL,
  `overlay_opacity` INT DEFAULT 35,
  `link_type` VARCHAR(50) DEFAULT 'category',
  `target_product_id` VARCHAR(100) NULL,
  `target_category` VARCHAR(100) NULL,
  `target_sub_category` VARCHAR(100) NULL,
  `custom_url` TEXT NULL,
  `action_text` VARCHAR(100) DEFAULT 'Explore Collection',
  `badge` VARCHAR(100) NULL,
  `display_order` INT DEFAULT 1,
  `active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_promo_cards_active` (`active`),
  INDEX `idx_promo_cards_order` (`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 23. TRUST INDICATORS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `trust_indicators` (
  `id` VARCHAR(100) NOT NULL,
  `icon` VARCHAR(100) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `subtitle` TEXT NULL,
  `display_order` INT DEFAULT 1,
  `active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_trust_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 24. CAROUSEL SETTINGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `carousel_settings` (
  `id` VARCHAR(50) NOT NULL DEFAULT 'default',
  `auto_play` BOOLEAN DEFAULT TRUE,
  `slide_duration` INT DEFAULT 6500,
  `show_arrows` BOOLEAN DEFAULT TRUE,
  `show_indicators` BOOLEAN DEFAULT TRUE,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 25. FBR TAX SLABS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tax_slabs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `slab_label` VARCHAR(255) NOT NULL,
  `min_pkr` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  `max_pkr` DECIMAL(15, 2) NULL,
  `rate_percentage` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  `fixed_base_tax_pkr` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  `description` TEXT NULL,
  `is_exempt` BOOLEAN DEFAULT FALSE,
  `display_order` INT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_tax_slabs_order` (`display_order`),
  CONSTRAINT `chk_tax_slab_range` CHECK (`max_pkr` IS NULL OR `max_pkr` >= `min_pkr`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 26. EXTERNAL COMPARISON PROVIDERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `comparison_providers` (
  `id` VARCHAR(100) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `domain` VARCHAR(255) NOT NULL,
  `enabled` BOOLEAN DEFAULT TRUE,
  `is_demo` BOOLEAN DEFAULT TRUE,
  `reliability_score` INT DEFAULT 90,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 27. COMPARISON MANUAL OVERRIDES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `comparison_overrides` (
  `id` VARCHAR(100) NOT NULL,
  `product_id` VARCHAR(100) NOT NULL,
  `merchant_name` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `url` TEXT NOT NULL,
  `image_url` TEXT NULL,
  `price` DECIMAL(15, 2) NOT NULL,
  `currency` VARCHAR(10) DEFAULT 'PKR',
  `availability` VARCHAR(50) DEFAULT 'IN_STOCK',
  `seller` VARCHAR(255) NULL,
  `shipping` VARCHAR(255) NULL,
  `warranty` VARCHAR(255) NULL,
  `return_policy` VARCHAR(255) NULL,
  `match_type` VARCHAR(50) DEFAULT 'EXACT_MATCH',
  `verified_by_admin` BOOLEAN DEFAULT TRUE,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_comp_prod_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 28. FRAUD RISK & BLACKLISTED CITIES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fraud_blacklist` (
  `id` VARCHAR(100) NOT NULL,
  `city` VARCHAR(255) NOT NULL,
  `reason` TEXT NULL,
  `fraud_count` INT DEFAULT 1,
  `total_orders` INT DEFAULT 1,
  `is_high_risk` BOOLEAN DEFAULT TRUE,
  `added_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fraud_city` (`city`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 29. PUSH BROADCAST ANNOUNCEMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `broadcast_messages` (
  `id` VARCHAR(100) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `audience` VARCHAR(100) DEFAULT 'all',
  `audience_label` VARCHAR(255) DEFAULT 'All Registered VIPs',
  `priority` VARCHAR(50) DEFAULT 'normal',
  `image_url` TEXT NULL,
  `action_text` VARCHAR(100) NULL,
  `action_url` TEXT NULL,
  `recipients_count` INT DEFAULT 0,
  `clicks_count` INT DEFAULT 0,
  `click_through_rate` VARCHAR(50) DEFAULT '0%',
  `sent_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_broadcast_sent` (`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 30. PASSWORD RESETS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `user_id` VARCHAR(50) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pwd_reset_token` (`token_hash`),
  INDEX `idx_pwd_reset_user` (`user_id`),
  CONSTRAINT `fk_pwd_reset_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 31. EMAIL VERIFICATION TOKENS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `email_verifications` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `user_id` VARCHAR(50) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email_verification_token` (`token_hash`),
  INDEX `idx_email_verification_user` (`user_id`),
  CONSTRAINT `fk_email_verification_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 32. CARTS & CART ITEMS
--     variant_key: NULL variant ko '' bana kar unique key sahi kaam karwata hai
--     (MySQL me NULL values unique key me duplicate allowed hoti hain).
--     INSERT me variant_key kabhi na likhein, ye khud calculate hota hai.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `carts` (
  `id` VARCHAR(50) NOT NULL,
  `user_id` VARCHAR(50) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cart_user` (`user_id`),
  CONSTRAINT `fk_cart_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cart_items` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `cart_id` VARCHAR(50) NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `variant_id` VARCHAR(50) NULL,
  `variant_key` VARCHAR(50) GENERATED ALWAYS AS (IFNULL(`variant_id`, '')) STORED,
  `quantity` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cart_prod_var` (`cart_id`, `product_id`, `variant_key`),
  INDEX `idx_cart_item_product` (`product_id`),
  CONSTRAINT `fk_cart_item_cart` FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cart_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_cart_item_qty` CHECK (`quantity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 32. WISHLISTS & WISHLIST ITEMS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wishlists` (
  `id` VARCHAR(50) NOT NULL,
  `user_id` VARCHAR(50) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wishlist_user` (`user_id`),
  CONSTRAINT `fk_wishlist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wishlist_items` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `wishlist_id` VARCHAR(50) NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wishlist_prod` (`wishlist_id`, `product_id`),
  INDEX `idx_wishlist_item_product` (`product_id`),
  CONSTRAINT `fk_wishlist_item_wishlist` FOREIGN KEY (`wishlist_id`) REFERENCES `wishlists` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wishlist_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 33. EXPENSE & INCOME TRANSACTIONS (Expense Calculator & Financial Ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expense_transactions` (
  `id` VARCHAR(50) NOT NULL,
  `type` ENUM('expense', 'income') NOT NULL,
  `category` VARCHAR(100) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `description` TEXT NOT NULL,
  `order_id` VARCHAR(50) NULL,
  `transaction_date` DATE NOT NULL,
  `receipt_image_path` VARCHAR(500) NULL,
  `created_by` VARCHAR(50) NULL,
  `updated_by` VARCHAR(50) NULL,
  `deleted_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_exp_type` (`type`),
  INDEX `idx_exp_category` (`category`),
  INDEX `idx_exp_date` (`transaction_date`),
  INDEX `idx_exp_order` (`order_id`),
  INDEX `idx_exp_deleted` (`deleted_at`),
  INDEX `idx_exp_created_by` (`created_by`),
  CONSTRAINT `fk_exp_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_exp_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_exp_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_exp_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 34. COURIER INTEGRATIONS (Trax + any additional courier via config)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `courier_providers` (
  `id` VARCHAR(50) NOT NULL,
  `provider_key` VARCHAR(50) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `is_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `is_default` BOOLEAN NOT NULL DEFAULT FALSE,
  `api_base_url` VARCHAR(255) NULL,
  `api_key` VARCHAR(500) NULL,
  `auth_header` VARCHAR(80) NOT NULL DEFAULT 'Authorization',
  `auth_scheme` VARCHAR(40) NOT NULL DEFAULT 'Bearer',
  `book_method` VARCHAR(10) NOT NULL DEFAULT 'POST',
  `book_path` VARCHAR(255) NOT NULL,
  `track_method` VARCHAR(10) NOT NULL DEFAULT 'GET',
  `track_path` VARCHAR(255) NOT NULL,
  `cancel_method` VARCHAR(10) NOT NULL DEFAULT 'POST',
  `cancel_path` VARCHAR(255) NULL,
  `label_path` VARCHAR(255) NULL,
  `pickup_address_id` VARCHAR(120) NULL,
  `service_code` VARCHAR(80) NULL,
  `default_weight_kg` DECIMAL(6, 2) NOT NULL DEFAULT 0.50,
  `tracking_field` VARCHAR(120) NULL,
  `status_field` VARCHAR(120) NULL,
  `events_field` VARCHAR(120) NULL,
  `label_field` VARCHAR(120) NULL,
  `extra_headers` TEXT NULL,
  `payload_template` TEXT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_courier_provider_key` (`provider_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_shipments` (
  `id` VARCHAR(50) NOT NULL,
  `order_id` VARCHAR(50) NOT NULL,
  `provider_key` VARCHAR(50) NOT NULL,
  `provider_name` VARCHAR(120) NOT NULL,
  `tracking_number` VARCHAR(100) NULL,
  `shipment_status` VARCHAR(60) NOT NULL DEFAULT 'booked',
  `raw_status` VARCHAR(120) NULL,
  `label_url` VARCHAR(1000) NULL,
  `request_payload` LONGTEXT NULL,
  `last_response` LONGTEXT NULL,
  `events` LONGTEXT NULL,
  `booked_by` VARCHAR(80) NULL,
  `booked_at` TIMESTAMP NULL,
  `last_synced_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_shipment_order` (`order_id`),
  INDEX `idx_shipment_tracking` (`tracking_number`),
  INDEX `idx_shipment_provider` (`provider_key`),
  CONSTRAINT `fk_shipment_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- END OF SCHEMA (34 sections, 39 tables)
-- =============================================================================
