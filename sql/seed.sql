-- =============================================================================
-- SEED DATA: U-KNOW CART LUXURY E-COMMERCE
-- RDBMS: MySQL 8.0+
-- Matches exact 22 catalog products, 5 categories, brands, & full SEO suite in store.service.ts
-- =============================================================================

USE `uknow_store`;

-- Every catalog item must belong to the store administrator. Without an owner,
-- admin order queries (which are scoped by product ownership) cannot see orders.
UPDATE `products` SET `admin_id` = 'usr-admin-1' WHERE `admin_id` IS NULL;

-- 1. SEED DEFAULT ADMIN USER
INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `role`, `avatar`, `phone`, `city`, `address`) VALUES
('usr-admin-1', 'U-Know Store Administrator', 'admin@uknow.com', '$2b$10$YourHashedPasswordHereOrBcryptToken', 'admin', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', '+92 300 1234567', 'Karachi', 'DHA Phase 6, Karachi, Pakistan')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- 2. SEED CATEGORIES
INSERT INTO `categories` (`id`, `name`, `icon`, `image_url`, `description`, `display_order`) VALUES
('watches', 'Luxury Watches', '⌚', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'Mastercrafted automatic chronographs and bespoke complications.', 1),
('fragrances', 'Niche Fragrances', '✨', 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=800&q=80', 'Rare extrait de parfum and artisan attar extracts.', 2),
('jewelry', 'Fine Jewelry', '💍', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=800&q=80', 'Ethically sourced diamonds and handcrafted solid gold heirloom pieces.', 3),
('apparel', 'Haute Couture', '👔', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80', 'Bespoke tailoring, pure mulberry silk, and Italian cashmere.', 4),
('electronics', 'High-End Audio & Tech', '🎧', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80', 'Audiophile precision drivers and titanium desktop accessories.', 5)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `image_url`=VALUES(`image_url`);

-- 3. SEED SUB-CATEGORIES
INSERT INTO `sub_categories` (`category_id`, `name`, `image_url`, `description`, `display_order`) VALUES
('watches', 'Chronographs', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'Precision timing complications', 1),
('watches', 'Tourbillon', 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=800&q=80', 'Gravitational balance wheel complications', 2),
('watches', 'GMT', 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=800&q=80', 'Dual-time zone travel instruments', 3),
('watches', 'Diver', 'https://images.unsplash.com/photo-1508057198894-247b23fe5ade?auto=format&fit=crop&w=800&q=80', '300M water-resistant professional dive watches', 4),
('watches', 'Accessories', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'Saffiano leather vaults and watch rolls', 5),
('fragrances', 'Extrait de Parfum', 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=800&q=80', 'Maximum concentration natural oils', 1),
('fragrances', 'Pure Dehn Al Oud', 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?auto=format&fit=crop&w=800&q=80', 'Aged Cambodian and Assamese agarwood', 2),
('fragrances', 'Attar & Oil', 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=800&q=80', 'Pure distilled floral and musky oils', 3),
('fragrances', 'Elixir', 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?auto=format&fit=crop&w=800&q=80', 'Warm resins and spiced vanilla concentrates', 4),
('jewelry', 'Bracelets', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=800&q=80', '18K solid gold bangles and cuffs', 1),
('jewelry', 'Necklaces', 'https://images.unsplash.com/photo-1611591475815-560411d33190?auto=format&fit=crop&w=800&q=80', 'Emerald and diamond chokers', 2),
('jewelry', 'Rings', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=800&q=80', 'Pavé diamond eternity bands', 3),
('jewelry', 'Earrings', 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=800&q=80', 'Ceylon sapphire drops and chandelier earrings', 4),
('apparel', 'Outerwear', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=800&q=80', 'Double-faced virgin wool trench coats', 1),
('apparel', 'Loungewear', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80', 'Mulberry silk kimonos and robes', 2),
('apparel', 'Overcoats', 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80', 'Mongolian cloud cashmere overcoats', 3),
('apparel', 'Blazers', 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80', 'Unconstructed Irish linen blazers', 4),
('electronics', 'Audiophile', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80', 'Beryllium driver active noise cancellation', 1),
('electronics', 'Audio Systems', 'https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=800&q=80', 'Walnut vinyl turntables', 2),
('electronics', 'Speakers', 'https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=800&q=80', 'Studio reference mastering monitors', 3),
('electronics', 'Peripherals', 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=800&q=80', 'Planar magnetic wireless gaming rigs', 4)
ON DUPLICATE KEY UPDATE `image_url`=VALUES(`image_url`);

-- 4. SEED BRANDS
INSERT INTO `brands` (`name`, `image_url`, `description`, `is_featured`) VALUES
('Maison Noir', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'Atelier of timeless mechanical horology & niche extraits', 1),
('Horology Studio', 'https://images.unsplash.com/photo-1508057198894-247b23fe5ade?auto=format&fit=crop&w=800&q=80', 'Avant-garde titanium watchmaking and GMT complications', 1),
('Atelier Aurelia', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=800&q=80', 'Handcrafted 18K solid gold and certified gemstone joaillerie', 1),
('Sartorial Craft', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80', 'Bespoke tailoring, virgin wool, and pure Mongolian cashmere', 1),
('Vanguard Audio', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80', 'Lossless Hi-Res beryllium acoustics and precision audio decks', 1),
('Geneva Atelier', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'Grand complication skeleton tourbillons', 1)
ON DUPLICATE KEY UPDATE `image_url`=VALUES(`image_url`);

-- 5. SEED ALL 22 PRODUCTS
INSERT INTO `products` (
  `id`, `name`, `subtitle`, `category_id`, `sub_category`, `brand`, `luxury_tier`,
  `price`, `cost_price`, `original_price`, `discount_type`, `discount_value`,
  `rating`, `reviews_count`, `description`, `stock`, `sku`, `tags`, `badge`,
  `featured`, `show_on_home`, `is_new`, `delivery_days`, `payment_policy`,
  `advance_payment_required`, `advance_payment_type`, `advance_payment_amount`, `advance_payment_percent`,
  `city_restriction_mode`, `variants_mode`
) VALUES
('prod-1', 'Aura Noir Extreme Extrait', 'Smoked Leather, Cardamom & Dark Amber Extrait', 'fragrances', 'Extrait de Parfum', 'Maison Noir', 'Ultra Luxury', 3800.00, 2200.00, 4800.00, 'fixed', 1000.00, 4.90, 142, 'A masterwork of midnight sophistication. Pure oil formulation offering 18-hour continuous sillage.', 24, 'FRG-AURA-01', '["Luxury", "Extrait", "Bestseller"]', 'Bestseller', TRUE, TRUE, TRUE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'short'),
('prod-2', 'Titan Chrono Heritage 42mm', 'Forged Titanium, Obsidian Dial & Automatic Movement', 'watches', 'Chronographs', 'Horology Studio', 'Bespoke Heritage', 18500.00, 11000.00, 22000.00, 'percentage', 16.00, 4.80, 88, 'Engineered from aerospace-grade grade-5 titanium with dual-sapphire crystal domes.', 7, 'WTC-TITAN-02', '["Titanium", "Automatic", "Limited"]', 'Limited Edition', TRUE, TRUE, FALSE, 3, 'advance_deposit', TRUE, 'fixed', 2000.00, 0, 'all', 'short'),
('prod-3', 'Soleil 18K Radiant Bangle', 'Hand-chiseled 18k Solid Gold with Solitary Baguette', 'jewelry', 'Bracelets', 'Atelier Aurelia', 'Ultra Luxury', 14200.00, 9000.00, 16500.00, 'percentage', 14.00, 5.00, 64, 'Sculptural elegance sculpted from solid recycled 18-karat gold with brushed interior finish.', 4, 'JWL-SOLEIL-03', '["18K Gold", "Handcrafted"]', '18K Solid', TRUE, TRUE, FALSE, 2, 'advance_deposit', TRUE, 'percentage', NULL, 20, 'all', 'short'),
('prod-4', 'Atelier Midnight Wool Trench', 'Double-faced Melton Virgin Wool & Italian Horn Buttons', 'apparel', 'Outerwear', 'Sartorial Craft', 'Bespoke Heritage', 8900.00, 5200.00, 11000.00, 'percentage', 19.00, 4.70, 52, 'Impeccable bespoke architecture tailored from heavyweight Melton virgin wool.', 12, 'APP-TRENCH-04', '["Virgin Wool", "Winter 2026"]', NULL, TRUE, TRUE, FALSE, 4, 'cod', FALSE, 'fixed', 0, 0, 'all', 'short'),
('prod-5', 'Spatial Studio Wireless ANC', 'Lossless Hi-Res Beryllium Drivers & Brushed Aluminum', 'electronics', 'Audiophile', 'Vanguard Audio', 'Premium Selection', 9200.00, 5500.00, 11500.00, 'fixed', 2300.00, 4.90, 176, 'Acoustic perfection featuring precision 40mm custom beryllium diaphragms and hybrid active noise cancellation.', 19, 'AUD-SPATIAL-05', '["Audiophile", "Lossless", "Wireless"]', NULL, TRUE, FALSE, FALSE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'short'),
('prod-6', 'Oud Royal Imperial Dehn', 'Aged 18-Year Wild Cambodian Oud & Damask Rose', 'fragrances', 'Pure Dehn Al Oud', 'Maison Noir', 'Ultra Luxury', 6400.00, 3800.00, 7800.00, 'percentage', 18.00, 5.00, 93, 'Rare wild Cambodian agarwood naturally distilled and aged in French oak casks.', 9, 'FRG-OUD-06', '["Aged Oud", "Extrait"]', 'Artisanal', FALSE, FALSE, FALSE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-7', 'Monaco Vintage Tourbillon', 'Skeletonized Calibre with Rose Gold PVD Bezel', 'watches', 'Tourbillon', 'Geneva Atelier', 'Ultra Luxury', 24500.00, 15000.00, 28000.00, 'percentage', 12.00, 4.90, 37, 'Exquisite open-worked mechanical movement showcasing intricate hand-beveled bridges and 72-hour power reserve.', 3, 'WTC-MONACO-07', '["Tourbillon", "Skeleton"]', 'Grand Complication', TRUE, FALSE, FALSE, 3, 'advance_deposit', TRUE, 'fixed', 3000.00, 0, 'all', 'none'),
('prod-8', 'Emerald Tear Diamond Choker', 'Columbian Emerald Pear-Cut with Platinum Pavé', 'jewelry', 'Necklaces', 'Atelier Aurelia', 'Ultra Luxury', 32000.00, 20000.00, 38000.00, 'percentage', 15.00, 5.00, 19, 'A striking certified Zambian emerald surrounded by brilliant-cut VVS diamonds set in fine platinum.', 2, 'JWL-EMERALD-08', '["Emerald", "Platinum", "Exclusive"]', 'Museum Piece', FALSE, FALSE, FALSE, 2, 'advance_deposit', TRUE, 'percentage', NULL, 25, 'restricted', 'none'),
('prod-9', 'Santal Blanc Silk Kimono', 'Pure Mulberry Silk Charmeuse with Hand Embroidery', 'apparel', 'Loungewear', 'Sartorial Craft', 'Luxury', 7600.00, 4200.00, 9500.00, 'percentage', 20.00, 4.80, 41, 'Heavyweight 22-momme grade 6A mulberry silk draped effortlessly with French seams and delicate motif.', 15, 'APP-SILK-09', '["Mulberry Silk", "Handmade"]', NULL, FALSE, FALSE, FALSE, 3, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-10', 'Nordic Walnut Lossless Turntable', 'Direct-Drive Audiophile Vinyl System with Carbon Arm', 'electronics', 'Audio Systems', 'Vanguard Audio', 'Bespoke Heritage', 16800.00, 10500.00, 19500.00, 'fixed', 2700.00, 4.90, 54, 'Solid European walnut plinth with decoupled motor suspension and precision Ortofon magnetic cartridge.', 6, 'ELC-VINYL-10', '["Audiophile", "Vinyl"]', 'Analog Heritage', FALSE, FALSE, FALSE, 4, 'advance_deposit', TRUE, 'fixed', 2000.00, 0, 'all', 'none'),
('prod-11', 'Velvet Amber 100ml Elixir', 'Madagascan Vanilla, Tonka Bean & Spiced Tobacco', 'fragrances', 'Elixir', 'Maison Noir', 'Luxury', 4500.00, 2600.00, 5600.00, 'percentage', 19.00, 4.80, 112, 'Warm, magnetic embrace of dark resins, bourbon vanilla extract, and smoked cedarwood.', 20, 'FRG-VELVET-11', '["Amber", "Warm", "Unisex"]', NULL, FALSE, FALSE, FALSE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-12', 'Geneva Executive Dual Time', 'Dual Time Zone GMT Automatic with Ceramic Bezel', 'watches', 'GMT', 'Horology Studio', 'Bespoke Heritage', 15400.00, 9500.00, 18000.00, 'percentage', 14.00, 4.70, 65, 'Swiss-calibre inspired GMT with bidirectional scratch-proof ceramic ring and jubilee steel bracelet.', 8, 'WTC-GMT-12', '["GMT", "Ceramic"]', NULL, FALSE, FALSE, FALSE, 3, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-13', 'Pavé Diamond Eternity Ring', 'Continuous Band of Brilliant Round VVS Diamonds', 'jewelry', 'Rings', 'Atelier Aurelia', 'Ultra Luxury', 19800.00, 12500.00, 23500.00, 'fixed', 3700.00, 5.00, 49, 'Precision microscopic pavé setting providing an uninterrupted sparkle in 18K white gold.', 5, 'JWL-RING-13', '["Diamonds", "18K Gold"]', 'Forever Collection', FALSE, FALSE, FALSE, 2, 'advance_deposit', TRUE, 'percentage', NULL, 15, 'all', 'none'),
('prod-14', 'Sartorial Cashmere Overcoat', '100% Loro Piana Mongolian Grade-A Cashmere', 'apparel', 'Overcoats', 'Sartorial Craft', 'Ultra Luxury', 12800.00, 7800.00, 15500.00, 'percentage', 17.00, 4.90, 31, 'Unstructured master tailoring crafted from pure unblended Mongolian cloud cashmere.', 7, 'APP-CASHMERE-14', '["Cashmere", "Winter"]', NULL, FALSE, FALSE, FALSE, 3, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-15', 'Acoustic Soundstage Reference Monitor', 'Dual Electrostatic Ribbon Tweeters with Kevlar Cones', 'electronics', 'Speakers', 'Vanguard Audio', 'Ultra Luxury', 21500.00, 13000.00, 25000.00, 'percentage', 14.00, 4.90, 28, 'Studio mastering-grade acoustics in piano-lacquer black enclosure with bi-wiring gold terminals.', 4, 'ELC-SPK-15', '["Soundstage", "HiFi"]', NULL, FALSE, FALSE, FALSE, 4, 'advance_deposit', TRUE, 'fixed', 2500.00, 0, 'all', 'none'),
('prod-16', 'Taif Rose & Musk Sublime', 'Morning Harvest Taif Rose Petals & White Amber Musk', 'fragrances', 'Attar & Oil', 'Maison Noir', 'Bespoke Heritage', 5200.00, 3000.00, 6500.00, 'percentage', 20.00, 4.90, 84, 'Distilled using antique copper alembics from Taif high-altitude organic rose gardens.', 16, 'FRG-TAIF-16', '["Taif Rose", "Musk"]', 'Rare Essence', FALSE, FALSE, FALSE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-17', 'Nautilus Oceanic Diver 300M', 'Deep Sea Helium Valve & Super-LumiNova Indices', 'watches', 'Diver', 'Horology Studio', 'Luxury', 13900.00, 8500.00, 16800.00, 'fixed', 2900.00, 4.80, 72, 'Professional dive instrument tested to 30 atmospheres with unidirectional rotating dive bezel.', 11, 'WTC-DIVE-17', '["300M", "Automatic"]', NULL, FALSE, FALSE, FALSE, 3, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-18', 'Sapphire Drop Chandelier Earrings', 'Royal Blue Ceylon Sapphires in 18K White Gold', 'jewelry', 'Earrings', 'Atelier Aurelia', 'Ultra Luxury', 22400.00, 14000.00, 26000.00, 'percentage', 14.00, 5.00, 23, 'Unheated natural Ceylon royal blue sapphires articulating with brilliant diamonds.', 3, 'JWL-SAPPHIRE-18', '["Sapphire", "Ceylon"]', 'Royal Heirloom', FALSE, FALSE, FALSE, 2, 'advance_deposit', TRUE, 'percentage', NULL, 20, 'all', 'none'),
('prod-19', 'Milanese Linen Savile Blazer', 'Unconstructed Irish Linen with Hand-Sewn Lapels', 'apparel', 'Blazers', 'Sartorial Craft', 'Premium Selection', 6900.00, 4000.00, 8500.00, 'percentage', 18.00, 4.70, 39, 'Breezy yet impeccably structured summer blazer with natural horn buttons and patch pockets.', 14, 'APP-BLAZER-19', '["Linen", "Summer"]', NULL, FALSE, FALSE, FALSE, 3, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-20', 'Precision Wireless Gaming Rig ANC', 'Ultra-Low Latency Lossless with Magnetic Planar Drivers', 'electronics', 'Peripherals', 'Vanguard Audio', 'Premium Selection', 7800.00, 4800.00, 9500.00, 'fixed', 1700.00, 4.80, 88, 'Custom tuned planar magnetic diaphragms with sub-15ms lossless 2.4GHz wireless transmission.', 19, 'ELC-RIG-20', '["Planar", "Wireless"]', NULL, FALSE, FALSE, FALSE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-21', 'Leatherette Travel Watch Vault', 'Triple-Cushion Handcrafted Saffiano Leather Case', 'watches', 'Accessories', 'Horology Studio', 'Signature Standard', 3400.00, 1900.00, 4200.00, 'percentage', 19.00, 4.90, 104, 'Saffiano scratch-proof exterior with ultra-soft microsuede cushions and snap closures.', 25, 'WTC-CASE-21', '["Travel", "Leather"]', NULL, FALSE, FALSE, FALSE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none'),
('prod-22', 'Golden Mirage Saffron Extrait', 'Persian Saffron, Bulgarian Rose & Oud Wood Infusion', 'fragrances', 'Extrait de Parfum', 'Maison Noir', 'Ultra Luxury', 5800.00, 3400.00, 7000.00, 'percentage', 17.00, 5.00, 67, 'Gold-grade Persian red saffron threads cold-extracted into pure golden amber oil.', 10, 'FRG-SAFFRON-22', '["Saffron", "Luxury Extrait"]', 'Limited Harvest', FALSE, FALSE, FALSE, 2, 'cod', FALSE, 'fixed', 0, 0, 'all', 'none')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `price`=VALUES(`price`);

-- 6. SEED SEO ENTITIES (FULL CATALOG COVERAGE)
INSERT INTO `seo_entities` (
  `id`, `entity_type`, `entity_id`, `name`, `seo_title`, `meta_description`,
  `preferred_slug`, `canonical_url`, `h1_heading`, `main_page_description`,
  `target_keyword`, `related_keywords`, `search_intent`, `og_title`, `og_description`,
  `og_image`, `twitter_card`, `robots_index`, `robots_follow`, `is_published`, `seo_score`
) VALUES
-- STATIC PAGES
('seo-page-home', 'page', 'home', 'Storefront Homepage', 'U-KNOW CART — Multi-Vendor Online Marketplace in Pakistan', 'Shop products from trusted sellers across every category — electronics, fashion, watches, jewellery, beauty, home and more, with secure checkout and nationwide delivery across Pakistan.', '/', 'https://uknowcart.com.pk/', 'Shop Every Category from Trusted Sellers', 'Discover products from multiple verified vendors across every category, with secure checkout and nationwide delivery.', 'online marketplace pakistan', '["multi vendor marketplace pakistan", "online shopping pakistan", "electronics fashion jewellery"]', 'commercial', 'U-KNOW CART — Multi-Vendor Online Marketplace', 'Shop every category from trusted sellers with secure checkout and nationwide delivery across Pakistan.', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1200&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 98),
('seo-page-shop', 'page', 'shop', 'All Collections Catalog', 'Shop All Products from Trusted Sellers | U-KNOW CART', 'Browse products from multiple verified vendors across electronics, fashion, watches, jewellery, beauty, home and more.', '/shop', 'https://uknowcart.com.pk/shop', 'Browse Every Category & Trusted Seller', 'Full catalog of products from trusted vendors across every category.', 'online shopping pakistan', '["multi vendor marketplace pakistan", "buy electronics online pakistan", "fashion jewellery store"]', 'transactional', 'All Products | U-KNOW CART', 'Browse every category from trusted sellers.', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1200&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 95),
('seo-page-checkout', 'page', 'checkout', 'Secure Checkout & Payment', 'Insured Checkout & Bank Wire Verification | U-KNOW CART', 'Finalize your acquisition with end-to-end 256-bit SSL encryption, FBR registered tax invoice, and insured nationwide delivery.', '/checkout', 'https://uknowcart.com.pk/checkout', 'Secure Order Checkout & Insured Transit Verification', 'Finalize transaction securely.', 'luxury checkout pakistan', NULL, 'transactional', 'Secure Checkout | U-KNOW CART', 'Encrypted checkout process.', NULL, 'summary', FALSE, FALSE, TRUE, 92),
('seo-page-cart', 'page', 'cart', 'Shopping Bag', 'Your Curated Acquisition Bag | U-KNOW CART', 'Review selected haute horology timepieces, solid gold bangles, and bespoke extrait flacons before insured dispatch.', '/cart', 'https://uknowcart.com.pk/cart', 'Your Selected Acquisitions', 'Review your shopping bag.', 'shopping cart', NULL, 'navigational', 'Shopping Bag | U-KNOW CART', 'Review acquisitions.', NULL, 'summary', FALSE, FALSE, TRUE, 90),
('seo-page-account', 'page', 'account', 'Client Account & Rewards', 'Client Concierge & VIP Profile | U-KNOW CART', 'Manage personal acquisitions, concierge delivery preferences, registered warranties, and Atelier loyalty rewards.', '/account', 'https://uknowcart.com.pk/account', 'Client Concierge & Profile Management', 'VIP account area.', 'client account', NULL, 'navigational', 'Client Concierge | U-KNOW CART', 'Manage VIP profile.', NULL, 'summary', FALSE, FALSE, TRUE, 91),
('seo-page-wishlist', 'page', 'wishlist', 'Curated Wishlist', 'Your Saved Masterpieces & Private Wishlist | U-KNOW CART', 'Bookmark exclusive chronographs, diamond rings, and rare oud extraits for upcoming seasonal purchases.', '/wishlist', 'https://uknowcart.com.pk/wishlist', 'Your Private Curated Wishlist', 'Saved items list.', 'saved wishlist', NULL, 'navigational', 'Private Wishlist | U-KNOW CART', 'Saved pieces.', NULL, 'summary', FALSE, FALSE, TRUE, 90),
('seo-page-orders', 'page', 'orders', 'Order History & Tracking', 'Track Live Vault Shipments & Past Orders | U-KNOW CART', 'Real-time courier GPS tracking via TCS, Leopards, and Trax with automated SMS dispatch confirmations.', '/orders', 'https://uknowcart.com.pk/orders', 'Order History & Transit Tracking', 'Track active shipments.', 'track order pakistan', NULL, 'navigational', 'Track Shipments | U-KNOW CART', 'Shipment tracking.', NULL, 'summary', FALSE, FALSE, TRUE, 92),

-- CATEGORIES
('seo-cat-watches', 'category', 'watches', 'Luxury Watches Department', 'Swiss Luxury Watches & Chronographs in Pakistan | U-KNOW CART', 'Discover certified automatic chronographs, sapphire crystal titanium timepieces, and tourbillon masterworks with nationwide insured delivery.', '/category/watches', 'https://uknowcart.com.pk/category/watches', 'Haute Horology & Swiss Automatic Timepieces', 'Automatic chronographs, tourbillons, and GMT complications.', 'luxury watches pakistan', '["swiss automatic watches", "titanium chronograph", "rolex audemars alternatives"]', 'transactional', 'Haute Horology | U-KNOW CART', 'Automatic chronographs and luxury timepieces.', 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 96),
('seo-cat-fragrances', 'category', 'fragrances', 'Niche Fragrances & Oud', 'Niche Fragrances & Royal Cambodian Oud in Pakistan | U-KNOW CART', 'Immense Cambodian royal agarwood, Persian saffron extracts, and Bulgarian rose attars handcrafted into long-lasting extrait de parfum.', '/category/fragrances', 'https://uknowcart.com.pk/category/fragrances', 'Artisanal Extrait de Parfum & Rare Agarwood Blends', 'Artisanal extrait de parfum and rare aged Cambodian oud.', 'best oud perfume pakistan', '["extrait de parfum", "niche fragrances karachi", "cambodian agarwood"]', 'commercial', 'Niche Fragrances | U-KNOW CART', 'Artisanal extraits and royal oud oils.', 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 94),
('seo-cat-jewelry', 'category', 'jewelry', 'Fine Jewelry & Diamonds', 'Fine Joaillerie & 18K Solid Gold Jewelry in Pakistan | U-KNOW CART', 'Bespoke 18K solid gold bangles, VS-clarity diamond eternity rings, and artisanal gemstone treasures with certified hallmarking.', '/category/jewelry', 'https://uknowcart.com.pk/category/jewelry', 'Handcrafted 18K Solid Gold & Certified Diamond Joaillerie', 'Handcrafted solid gold and certified gemstone creations.', '18k gold jewelry pakistan', '["diamond eternity ring", "solitaire diamond ring karachi", "hallmarked gold"]', 'transactional', 'Fine Joaillerie | U-KNOW CART', 'Certified diamond rings and solid gold bangles.', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 92),
('seo-cat-apparel', 'category', 'apparel', 'Haute Couture & Apparel', 'Sartorial Couture & Mongolian Cashmere in Pakistan | U-KNOW CART', 'Hand-tailored virgin wool trench coats, unconstructed linen blazers, and 100% Grade-A Mongolian cashmere with bespoke sizing.', '/category/apparel', 'https://uknowcart.com.pk/category/apparel', 'Bespoke Sartorial Couture & Fine Natural Fibers', 'Virgin wool coats and mulberry silk loungewear.', 'bespoke clothing pakistan', '["cashmere overcoat lahore", "linen blazer karachi", "luxury fashion brand"]', 'commercial', 'Haute Couture | U-KNOW CART', 'Cashmere overcoats and silk kimonos.', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 95),
('seo-cat-electronics', 'category', 'electronics', 'High-End Audio & Tech', 'Audiophile Sound Systems & Beryllium Drivers | U-KNOW CART', 'Precision soundstage monitors, planar magnetic headphones, and direct-drive walnut vinyl turntables for discerning music lovers.', '/category/electronics', 'https://uknowcart.com.pk/category/electronics', 'Audiophile Acoustic Systems & Lossless Audio', 'Hi-Res monitors and vinyl turntables.', 'audiophile headphones pakistan', '["beryllium driver monitors", "walnut turntable", "lossless audio gear"]', 'commercial', 'Audiophile Tech | U-KNOW CART', 'Lossless audio systems and planar headphones.', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 93),

-- ALL 22 PRODUCTS
('seo-prod-1', 'product', 'prod-1', 'Aura Noir Extreme Extrait', 'Aura Noir Extreme Extrait 100ml by Maison Noir | U-KNOW CART', 'Handcrafted extrait de parfum featuring 25-year aged Assamese agarwood, cardamom, and ambergris. Insured delivery across Pakistan.', '/products/aura-noir-extreme-extrait-i1-s17091.html', 'https://uknowcart.com.pk/products/aura-noir-extreme-extrait-i1-s17091.html', 'Aura Noir Extreme Extrait de Parfum', 'Pure oil formulation with 18-hour continuous projection.', 'aura noir perfume', '["maison noir extrait", "assamese oud perfume", "long lasting perfume pakistan"]', 'transactional', 'Aura Noir Extreme Extrait | U-KNOW CART', 'Rare Assamese oud extract.', 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 97),
('seo-prod-2', 'product', 'prod-2', 'Titan Chrono Heritage 42mm', 'Titan Chrono Heritage 42mm Automatic Watch | U-KNOW CART', 'Forged Grade 5 titanium case with double anti-reflective sapphire crystal, 72-hour power reserve, and ceramic bezel. Insured delivery across Pakistan.', '/products/titan-chrono-heritage-42mm-i2-s17092.html', 'https://uknowcart.com.pk/products/titan-chrono-heritage-42mm-i2-s17092.html', 'Titan Chrono Heritage 42mm Automatic Titanium Watch', 'Aerospace grade titanium case with sapphire dome.', 'titanium chronograph watch', '["automatic watch pakistan", "grade 5 titanium watch", "swiss automatic chronograph"]', 'transactional', 'Titan Chrono Heritage 42mm | U-KNOW CART', 'Titanium automatic chronograph.', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 99),
('seo-prod-3', 'product', 'prod-3', 'Soleil 18K Radiant Bangle', 'Soleil 18K Radiant Bangle Solid Gold | U-KNOW CART', 'Hand-chiseled 18k solid gold bangle with solitary baguette diamond and brushed interior finish. Certified hallmarking included.', '/products/soleil-18k-radiant-bangle-i3-s17093.html', 'https://uknowcart.com.pk/products/soleil-18k-radiant-bangle-i3-s17093.html', 'Soleil 18K Radiant Solid Gold Bangle', 'Solid recycled 18-karat gold with brushed finish.', '18k gold bangle', NULL, 'transactional', 'Soleil 18K Radiant Bangle | U-KNOW CART', 'Solid gold bangle with baguette diamond.', 'https://images.unsplash.com/photo-1611591475815-560411d33190?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 95),
('seo-prod-4', 'product', 'prod-4', 'Atelier Midnight Wool Trench', 'Atelier Midnight Virgin Wool Trench Coat | U-KNOW CART', 'Double-faced Melton virgin wool trench with Italian horn buttons, structured shoulders, and windproof thermal drape.', '/products/atelier-midnight-wool-trench-i4-s17094.html', 'https://uknowcart.com.pk/products/atelier-midnight-wool-trench-i4-s17094.html', 'Atelier Midnight Heavyweight Wool Trench Coat', 'Heavyweight Melton virgin wool tailored trench.', 'wool trench coat men', NULL, 'transactional', 'Atelier Midnight Wool Trench | U-KNOW CART', 'Virgin wool winter trench coat.', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 96),
('seo-prod-5', 'product', 'prod-5', 'Spatial Studio Wireless ANC', 'Spatial Studio Wireless ANC Headset Beryllium | U-KNOW CART', 'Lossless Hi-Res audio with custom 40mm beryllium drivers, active noise cancellation, and brushed aircraft aluminum chassis.', '/products/spatial-studio-wireless-anc-i5-s17095.html', 'https://uknowcart.com.pk/products/spatial-studio-wireless-anc-i5-s17095.html', 'Spatial Studio Wireless Hi-Res Headphones', '40mm custom beryllium diaphragms with hybrid ANC.', 'wireless anc headphones', NULL, 'transactional', 'Spatial Studio Wireless ANC | U-KNOW CART', 'Beryllium driver headphones.', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 94),
('seo-prod-6', 'product', 'prod-6', 'Oud Royal Imperial Dehn', 'Oud Royal Imperial Aged 18-Year Dehn Al Oud | U-KNOW CART', 'Rare wild Cambodian agarwood naturally distilled and aged in oak casks with Damask rose accents. 100% pure perfume oil.', '/products/oud-royal-imperial-dehn-i6-s17096.html', 'https://uknowcart.com.pk/products/oud-royal-imperial-dehn-i6-s17096.html', 'Oud Royal Imperial Aged Dehn Al Oud', '18-year aged Cambodian agarwood distilled essence.', 'dehn al oud cambodi', NULL, 'transactional', 'Oud Royal Imperial Dehn | U-KNOW CART', 'Pure Cambodian oud oil.', 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 97),
('seo-prod-7', 'product', 'prod-7', 'Monaco Vintage Tourbillon', 'Monaco Vintage Skeleton Tourbillon Watch | U-KNOW CART', 'Open-worked mechanical tourbillon movement showcasing intricate hand-beveled bridges, rose gold bezel, and 72-hour reserve.', '/products/monaco-vintage-tourbillon-i7-s17097.html', 'https://uknowcart.com.pk/products/monaco-vintage-tourbillon-i7-s17097.html', 'Monaco Vintage Skeleton Mechanical Tourbillon', 'Open-worked mechanical movement with tourbillon.', 'tourbillon watch pakistan', NULL, 'transactional', 'Monaco Vintage Tourbillon | U-KNOW CART', 'Hand-beveled skeleton tourbillon.', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 98),
('seo-prod-8', 'product', 'prod-8', 'Emerald Tear Diamond Choker', 'Emerald Tear Diamond Choker Platinum | U-KNOW CART', 'Certified pear-cut Zambian emerald surrounded by brilliant-cut VVS diamonds set in pure hallmarked platinum.', '/products/emerald-tear-diamond-choker-i8-s17098.html', 'https://uknowcart.com.pk/products/emerald-tear-diamond-choker-i8-s17098.html', 'Certified Zambian Emerald & Diamond Choker', 'Pear-cut Zambian emerald with VVS diamonds in platinum.', 'emerald diamond choker', NULL, 'transactional', 'Emerald Tear Diamond Choker | U-KNOW CART', 'Platinum emerald choker.', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 96),
('seo-prod-9', 'product', 'prod-9', 'Santal Blanc Silk Kimono', 'Santal Blanc Pure Mulberry Silk Kimono Robe | U-KNOW CART', 'Heavyweight 22-momme Grade-6A organic mulberry silk draped effortlessly with French seams and delicate artisanal embroidery.', '/products/santal-blanc-silk-kimono-i9-s17099.html', 'https://uknowcart.com.pk/products/santal-blanc-silk-kimono-i9-s17099.html', 'Santal Blanc 22-Momme Mulberry Silk Robe', 'Pure mulberry silk charmeuse with French seams.', 'pure silk kimono robe', NULL, 'transactional', 'Santal Blanc Silk Kimono | U-KNOW CART', 'Mulberry silk kimono.', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 93),
('seo-prod-10', 'product', 'prod-10', 'Nordic Walnut Lossless Turntable', 'Nordic Walnut Direct-Drive Vinyl Turntable | U-KNOW CART', 'Solid European walnut plinth with decoupled motor suspension, precision carbon-fiber tonearm, and Ortofon magnetic cartridge.', '/products/nordic-walnut-lossless-turntable-i10-s17100.html', 'https://uknowcart.com.pk/products/nordic-walnut-lossless-turntable-i10-s17100.html', 'Nordic Walnut Direct-Drive Audiophile Turntable', 'Solid walnut plinth with Ortofon cartridge.', 'audiophile vinyl turntable', NULL, 'transactional', 'Nordic Walnut Turntable | U-KNOW CART', 'Direct-drive vinyl deck.', 'https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 95),
('seo-prod-11', 'product', 'prod-11', 'Velvet Amber 100ml Elixir', 'Velvet Amber Elixir 100ml Spiced Vanilla | U-KNOW CART', 'Bourbon vanilla extract, toasted tonka bean, dark amber resins, and smoked cedarwood formulated into an intimate warm elixir.', '/products/velvet-amber-100ml-elixir-i11-s17101.html', 'https://uknowcart.com.pk/products/velvet-amber-100ml-elixir-i11-s17101.html', 'Velvet Amber Spiced Vanilla & Dark Resin Elixir', 'Bourbon vanilla, tonka bean, and amber resins.', 'amber vanilla perfume', NULL, 'transactional', 'Velvet Amber Elixir | U-KNOW CART', 'Warm amber elixir.', 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 94),
('seo-prod-12', 'product', 'prod-12', 'Geneva Executive Dual Time', 'Geneva Executive Dual Time GMT Watch | U-KNOW CART', 'Dual time zone automatic GMT movement with scratch-proof bidirectional ceramic 24h bezel and five-link jubilee steel bracelet.', '/products/geneva-executive-dual-time-i12-s17102.html', 'https://uknowcart.com.pk/products/geneva-executive-dual-time-i12-s17102.html', 'Geneva Executive Automatic GMT Dual-Time Watch', 'Bidirectional ceramic ring with dual-time GMT calibre.', 'gmt automatic watch', NULL, 'transactional', 'Geneva Executive Dual Time | U-KNOW CART', 'Dual time zone GMT watch.', 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 96),
('seo-prod-13', 'product', 'prod-13', 'Pavé Diamond Eternity Ring', 'Pavé Diamond Eternity Ring 18K White Gold | U-KNOW CART', 'Continuous band of brilliant round VVS clarity diamonds set in an uninterrupted microscopic pavé channel of 18K solid white gold.', '/products/pave-diamond-eternity-ring-i13-s17103.html', 'https://uknowcart.com.pk/products/pave-diamond-eternity-ring-i13-s17103.html', '18K White Gold Microscopic Pavé Diamond Eternity Ring', 'Continuous band of brilliant VVS diamonds.', 'diamond eternity ring pakistan', NULL, 'transactional', 'Pavé Diamond Eternity Ring | U-KNOW CART', '18K white gold diamond ring.', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 97),
('seo-prod-14', 'product', 'prod-14', 'Sartorial Cashmere Overcoat', 'Sartorial 100% Mongolian Cloud Cashmere Overcoat | U-KNOW CART', 'Unstructured master tailoring crafted from pure unblended Mongolian Grade-A cashmere with genuine buffalo horn closures.', '/products/sartorial-cashmere-overcoat-i14-s17104.html', 'https://uknowcart.com.pk/products/sartorial-cashmere-overcoat-i14-s17104.html', 'Pure Mongolian Cloud Cashmere Overcoat', 'Pure unblended Grade-A Mongolian cashmere.', 'mens cashmere overcoat', NULL, 'transactional', 'Sartorial Cashmere Overcoat | U-KNOW CART', 'Mongolian cashmere overcoat.', 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 96),
('seo-prod-15', 'product', 'prod-15', 'Acoustic Soundstage Reference Monitor', 'Acoustic Soundstage Reference Monitor Studio Pair | U-KNOW CART', 'Studio mastering-grade acoustics with dual electrostatic ribbon tweeters, Kevlar woven cones, and piano-lacquer black enclosure.', '/products/acoustic-soundstage-reference-monitor-i15-s17105.html', 'https://uknowcart.com.pk/products/acoustic-soundstage-reference-monitor-i15-s17105.html', 'Acoustic Soundstage Studio Reference Mastering Monitors', 'Electrostatic ribbon tweeters with Kevlar cones.', 'studio reference monitors', NULL, 'transactional', 'Acoustic Soundstage Monitors | U-KNOW CART', 'Mastering studio reference speakers.', 'https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 94),
('seo-prod-16', 'product', 'prod-16', 'Taif Rose & Musk Sublime', 'Taif Rose & Musk Sublime Organic Attar Oil | U-KNOW CART', 'Distilled using antique copper alembics from high-altitude organic Taif rose gardens with cold-cured crystalline white musk.', '/products/taif-rose-musk-sublime-i16-s17106.html', 'https://uknowcart.com.pk/products/taif-rose-musk-sublime-i16-s17106.html', 'Pure Taif Rose & White Amber Musk Attar Oil', 'Organic Taif rose petals distilled in copper alembics.', 'taif rose attar oil', NULL, 'transactional', 'Taif Rose & Musk Sublime | U-KNOW CART', 'Organic Taif rose essence oil.', 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 95),
('seo-prod-17', 'product', 'prod-17', 'Nautilus Oceanic Diver 300M', 'Nautilus Oceanic Diver 300M Automatic Tool Watch | U-KNOW CART', 'Professional 30-atmosphere deep diving instrument with automatic helium escape valve and vivid Super-LumiNova indices.', '/products/nautilus-oceanic-diver-300m-i17-s17107.html', 'https://uknowcart.com.pk/products/nautilus-oceanic-diver-300m-i17-s17107.html', 'Nautilus Oceanic 300M Automatic Deep Diving Watch', '300M water-resistant tool watch with helium valve.', 'automatic diver watch 300m', NULL, 'transactional', 'Nautilus Oceanic Diver 300M | U-KNOW CART', '300M automatic diving instrument.', 'https://images.unsplash.com/photo-1508057198894-247b23fe5ade?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 96),
('seo-prod-18', 'product', 'prod-18', 'Sapphire Drop Chandelier Earrings', 'Ceylon Sapphire Drop Chandelier Earrings 18K | U-KNOW CART', 'Unheated natural Ceylon royal blue sapphires articulating gracefully with brilliant diamonds in 18K solid white gold.', '/products/sapphire-drop-chandelier-earrings-i18-s17108.html', 'https://uknowcart.com.pk/products/sapphire-drop-chandelier-earrings-i18-s17108.html', 'Unheated Ceylon Royal Blue Sapphire Chandelier Earrings', 'Natural Ceylon blue sapphires with brilliant diamonds.', 'sapphire diamond earrings', NULL, 'transactional', 'Sapphire Drop Chandelier Earrings | U-KNOW CART', '18K white gold sapphire earrings.', 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 97),
('seo-prod-19', 'product', 'prod-19', 'Milanese Linen Savile Blazer', 'Milanese Unconstructed Irish Linen Blazer | U-KNOW CART', 'Breathable lightweight unconstructed summer blazer tailored from pure Irish flax linen with hand-sewn pick stitching.', '/products/milanese-linen-savile-blazer-i19-s17109.html', 'https://uknowcart.com.pk/products/milanese-linen-savile-blazer-i19-s17109.html', 'Milanese Hand-Sewn Irish Flax Linen Blazer', 'Pure Irish flax linen with unconstructed shoulders.', 'irish linen blazer', NULL, 'transactional', 'Milanese Linen Savile Blazer | U-KNOW CART', 'Hand-sewn summer linen blazer.', 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 94),
('seo-prod-20', 'product', 'prod-20', 'Precision Wireless Gaming Rig ANC', 'Precision Planar Wireless Gaming Headset ANC | U-KNOW CART', 'Planar magnetic audiophile diaphragms with sub-15ms lossless 2.4GHz transmission and broadcast-grade detachable mic.', '/products/precision-wireless-gaming-rig-anc-i20-s17110.html', 'https://uknowcart.com.pk/products/precision-wireless-gaming-rig-anc-i20-s17110.html', 'Precision Planar Magnetic Wireless Gaming Rig', 'Planar magnetic diaphragms with low latency wireless.', 'planar magnetic gaming headset', NULL, 'transactional', 'Precision Wireless Gaming Rig | U-KNOW CART', 'Lossless wireless planar headset.', 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 93),
('seo-prod-21', 'product', 'prod-21', 'Leatherette Travel Watch Vault', 'Saffiano Leather Triple Watch Travel Roll Vault | U-KNOW CART', 'Handcrafted scratch-proof Saffiano leather watch roll with ultra-soft plush microsuede cushions and solid brass snaps.', '/products/leatherette-travel-watch-vault-i21-s17111.html', 'https://uknowcart.com.pk/products/leatherette-travel-watch-vault-i21-s17111.html', 'Saffiano Handcrafted Triple Watch Travel Case', 'Scratch-proof Saffiano leather with microsuede cushions.', 'leather watch travel case', NULL, 'transactional', 'Leatherette Travel Watch Vault | U-KNOW CART', 'Triple watch leather travel roll.', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 95),
('seo-prod-22', 'product', 'prod-22', 'Golden Mirage Saffron Extrait', 'Golden Mirage Red Saffron & Rose Extrait | U-KNOW CART', 'Cold-extracted Gold-Grade Persian red saffron threads blended with Bulgarian rose and aged oud wood for unmatched warmth.', '/products/golden-mirage-saffron-extrait-i22-s17112.html', 'https://uknowcart.com.pk/products/golden-mirage-saffron-extrait-i22-s17112.html', 'Golden Mirage Persian Red Saffron Extrait Flacon', 'Gold-grade Persian red saffron threads in pure amber oil.', 'persian saffron perfume', NULL, 'transactional', 'Golden Mirage Saffron Extrait | U-KNOW CART', 'Red saffron and rose extrait.', 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=800&q=80', 'summary_large_image', TRUE, TRUE, TRUE, 98)
ON DUPLICATE KEY UPDATE `seo_title`=VALUES(`seo_title`);

-- 7. SEED SEO IMAGE ALTS
INSERT INTO `seo_image_alts` (
  `id`, `entity_type`, `entity_id`, `entity_name`, `image_url`, `alt_text`, `image_title`, `file_name`, `dimensions`, `is_decorative`
) VALUES
('img-seo-1', 'product', 'prod-1', 'Aura Noir Extreme Extrait', 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=800&q=80', 'Aura Noir Extreme Extrait de Parfum crystal flacon with gold foil crest and magnetic cap', 'Aura Noir Extreme Luxury Flacon', 'aura-noir-extreme-extrait-flacon.webp', '800x800', FALSE),
('img-seo-2', 'product', 'prod-2', 'Titan Chrono Heritage 42mm', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80', 'Titan Chrono Heritage 42mm automatic watch dial showing chronograph sub-dials and ceramic tachymeter bezel', 'Titan Chrono Heritage 42mm Titanium Dial View', 'titan-chrono-heritage-42mm-dial.webp', '800x800', FALSE),
('img-seo-3', 'product', 'prod-3', 'Soleil 18K Radiant Bangle', 'https://images.unsplash.com/photo-1611591475815-560411d33190?auto=format&fit=crop&w=800&q=80', 'Soleil 18K solid yellow gold bangle with solitary baguette diamond and satin polish', 'Soleil 18K Solid Gold Bangle', 'soleil-18k-gold-bangle.webp', '800x800', FALSE),
('img-seo-4', 'product', 'prod-4', 'Atelier Midnight Wool Trench', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=800&q=80', 'Atelier Midnight double-faced virgin wool trench coat with dark horn buttons on male model', 'Atelier Midnight Virgin Wool Trench', 'atelier-midnight-wool-trench.webp', '800x800', FALSE),
('img-seo-5', 'product', 'prod-5', 'Spatial Studio Wireless ANC', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80', 'Spatial Studio wireless ANC headphones with brushed aluminum cups and memory foam ear pads', 'Spatial Studio Wireless ANC Headphones', 'spatial-studio-wireless-anc.webp', '800x800', FALSE),
('img-seo-6', 'category', 'watches', 'Luxury Watches Department', 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80', 'Luxury automatic watches collection showcase with open exhibition caseback on velvet display', 'Haute Horology Collection Department', 'luxury-watches-department-showcase.webp', '600x600', FALSE),
('img-seo-7', 'category', 'fragrances', 'Niche Fragrances Department', 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=600&q=80', 'Niche extrait de parfum decanters in amber and clear crystal with solid gold sprayers', 'Niche Fragrance Boutique Collection', 'niche-fragrances-boutique-collection.webp', '600x600', FALSE),
('img-seo-8', 'category', 'jewelry', 'Fine Jewelry Department', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80', '18K solid yellow gold bangles with brilliant pavé cut diamonds', 'Fine Joaillerie Solid Gold Bangles', 'fine-jewelry-18k-gold-bangles.webp', '600x600', FALSE)
ON DUPLICATE KEY UPDATE `alt_text`=VALUES(`alt_text`);

-- 8. SEED SEO REDIRECTS
INSERT INTO `seo_redirects` (`id`, `source_url`, `destination_url`, `status_code`, `reason`, `is_active`, `hits_count`) VALUES
('redir-1', '/luxury-watches', '/category/watches', 301, 'Legacy department URL consolidated to canonical category route', TRUE, 184),
('redir-2', '/old-fragrances-sale', '/category/fragrances', 301, 'Promotional campaign expired, redirected to main perfumery', TRUE, 92),
('redir-3', '/products/swiss-automatic-42mm', '/products/titan-chrono-heritage-42mm-i2-s17092.html', 301, 'Old SKU URL mapped to new Daraz-style canonical format', TRUE, 310)
ON DUPLICATE KEY UPDATE `destination_url`=VALUES(`destination_url`);

-- 9. SEED SEO ROBOTS CONFIG
INSERT INTO `seo_robots_config` (`id`, `content`, `sitemap_url`, `disallowed_paths`, `allowed_paths`) VALUES
(
  1,
  'User-agent: *\nAllow: /\nAllow: /shop\nAllow: /category/\nAllow: /brand/\nAllow: /products/\nDisallow: /admin\nDisallow: /checkout\nDisallow: /cart\nDisallow: /account\nDisallow: /api/\n\nSitemap: https://uknowcart.com.pk/sitemap.xml',
  'https://uknowcart.com.pk/sitemap.xml',
  '["/admin", "/checkout", "/cart", "/account", "/api/"]',
  '["/", "/shop", "/category/", "/brand/", "/products/"]'
)
ON DUPLICATE KEY UPDATE `content`=VALUES(`content`);

-- 10. SEED SEO AUDIT ISSUES
INSERT INTO `seo_audit_issues` (`id`, `severity`, `category`, `page_url`, `title`, `description`, `recommendation`, `auto_fixable`, `is_resolved`, `dismissed`) VALUES
('aud-1', 'critical', 'meta', 'https://uknowcart.com.pk/checkout', 'Missing Meta Description on Checkout Page', 'The secure checkout route has no tailored meta description.', 'Add a concise 130-150 character description highlighting SSL encryption and insured transit.', TRUE, FALSE, FALSE),
('aud-2', 'high', 'images', 'https://uknowcart.com.pk/products/aura-noir-extreme-extrait-i1-s17091.html', 'Product Secondary Gallery Image Missing Alt Text', 'The second gallery view has an empty alt attribute.', 'Assign descriptive alt text detailing the faceted crystal base.', TRUE, FALSE, FALSE),
('aud-3', 'medium', 'meta', 'https://uknowcart.com.pk/category/apparel', 'Category Title Below Recommended 30 Characters', 'Title is currently only 24 characters, missing opportunity to include location and luxury intent keywords.', 'Expand to "Sartorial Couture & Cashmere in Pakistan | U-KNOW CART" (58 characters).', TRUE, FALSE, FALSE),
('aud-4', 'low', 'headings', 'https://uknowcart.com.pk/shop', 'Multiple Secondary H2 Headings Without Unique IDs', 'Filter drawer and sorting sections share generic section tags without anchor IDs.', 'Add semantic id attributes to filter groups for deep-linking access.', FALSE, FALSE, FALSE)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 11. SEED SEO KEYWORDS
INSERT INTO `seo_keywords` (`id`, `keyword`, `search_intent`, `target_page_url`, `target_entity_type`, `target_entity_id`, `notes`, `status`) VALUES
('kw-1', 'luxury watches in pakistan', 'commercial', '/category/watches', 'category', 'watches', 'Primary revenue driver query with strong buyer intent in Karachi, Lahore, and Islamabad.', 'ranking'),
('kw-2', 'best royal oud perfume price in pakistan', 'transactional', '/category/fragrances', 'category', 'fragrances', 'Targets high-net-worth niche fragrance enthusiasts.', 'in_progress'),
('kw-3', '18k solid gold diamond ring online karachi', 'transactional', '/category/jewelry', 'category', 'jewelry', 'High value jewelry transaction intent in Sindh region.', 'ranking'),
('kw-4', 'swiss automatic chronograph watches', 'commercial', '/category/watches', 'category', 'watches', 'High search frequency for automatic chronos.', 'ranking'),
('kw-5', 'bespoke cashmere overcoat lahore', 'commercial', '/category/apparel', 'category', 'apparel', 'Winter peak luxury buyer query in Punjab.', 'planned')
ON DUPLICATE KEY UPDATE `notes`=VALUES(`notes`);

-- 12. SEED STORE ADS & ADVERTISER CAMPAIGNS
INSERT INTO `store_ads` (
  `id`, `name`, `advertiser_name`, `campaign_name`, `ad_type`, `headline`, `title`, `description`,
  `business_logo`, `cta_text`, `image_url`, `destination_url`, `badge`, `status`, `priority`,
  `pricing_model`, `budget`, `daily_budget`, `cpm_rate`, `cpc_rate`, `max_impressions`, `max_clicks`,
  `impressions`, `clicks`, `spending`, `revenue`, `payment_status`, `start_date`, `end_date`, `start_time`,
  `end_time`, `timezone`, `target_type`, `target_category`, `device_target`, `city_targets`, `placements`
) VALUES
(
  'ad-rolex-spotlight',
  'Rolex Certified Chrono Spotlight',
  'Atelier Luxury Partners',
  'Spring Haute Horology 2026',
  'banner',
  'Official Atelier Certified',
  'Rolex Submariner Date 41mm Oystersteel & Cerachrom',
  'Directly authenticated by Swiss-trained horologists. Insured overnight armored dispatch across Pakistan.',
  'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=200&auto=format&fit=crop',
  'Explore Watch',
  'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=1200&auto=format&fit=crop',
  '/category/watches',
  'Rare Availability',
  'active',
  95,
  'cpc',
  50000.00,
  2500.00,
  150.00,
  35.00,
  100000,
  2000,
  14200,
  490,
  17150.00,
  34300.00,
  'paid',
  '2026-03-01 00:00:00',
  '2026-06-30 23:59:59',
  '00:00',
  '23:59',
  'Asia/Karachi',
  'category',
  'watches',
  'all',
  '["all"]',
  '["home_below_hero", "shop_top", "in_feed_card", "product_landing_top"]'
),
(
  'ad-oud-royale',
  'Royal Taif Rose & Ambergris Decanter',
  'Maison Noir Parfums',
  'Summer Niche Extrait Campaign',
  'banner',
  'Artisanal Distillation',
  'Taif Rose & Musk Sublime Extrait de Parfum',
  'Hand-harvested Taif petals aged with golden ambergris. Extraordinary continuous 24-hour projection.',
  'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?q=80&w=200&auto=format&fit=crop',
  'Discover Fragrance',
  'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?q=80&w=1200&auto=format&fit=crop',
  '/category/fragrances',
  'Limited Harvest',
  'active',
  85,
  'cpm',
  30000.00,
  1500.00,
  120.00,
  25.00,
  80000,
  1500,
  9800,
  310,
  1176.00,
  2352.00,
  'paid',
  '2026-02-15 00:00:00',
  '2026-05-31 23:59:59',
  '00:00',
  '23:59',
  'Asia/Karachi',
  'category',
  'fragrances',
  'all',
  '["Karachi", "Lahore", "Islamabad"]',
  '["shop_grid_row_2", "product_landing_middle", "in_feed_card"]'
),
(
  'ad-kundan-bridal',
  'Imperial 22K Kundan Choker Suite',
  'Darbar Jewellers Lahore',
  'Wedding Season Royale',
  'banner',
  'Heritage Masterpiece',
  'Imperial 22K Solid Gold Polki Kundan Necklace',
  'Heirloom gemstone settings with natural emerald drops and certified hallmarked purity.',
  'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=200&auto=format&fit=crop',
  'Book Private Viewing',
  'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=1200&auto=format&fit=crop',
  '/category/jewelry',
  'Bridal Heirloom',
  'active',
  90,
  'cpc',
  75000.00,
  3500.00,
  180.00,
  45.00,
  120000,
  2500,
  18500,
  620,
  27900.00,
  55800.00,
  'paid',
  '2026-01-01 00:00:00',
  '2026-12-31 23:59:59',
  '00:00',
  '23:59',
  'Asia/Karachi',
  'category',
  'jewelry',
  'all',
  '["all"]',
  '["home_promo_section", "shop_grid_row_4", "cart_page", "in_feed_card"]'
)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- 13. SEED HERO BANNERS (Top Carousel with Responsive Images)
INSERT INTO `hero_banners` (
  `id`, `internal_name`, `theme`, `eyebrow`, `category_label`, `title`, `subtitle`,
  `image`, `desktop_image`, `tablet_image`, `mobile_image`, `overlay_opacity`, `button_text`, `badge`, `link_type`, `target_category`,
  `custom_url`, `display_order`, `active`
) VALUES (
  'slide-eternal',
  'Hero Slide 1 - Eternal Beauty & Elegance',
  'dark',
  'ETERNAL',
  'Haute Joaillerie',
  'Beauty & Elegance',
  'Creating magical and eternal bonds of mesmerizing beauty and breathtaking elegance.',
  'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1600&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1920&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1600&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1080&auto=format&fit=crop&q=85',
  45,
  'View Jewellery Collection',
  'Haute Joaillerie',
  'category',
  'jewelry',
  '/category/jewelry',
  1,
  TRUE
),
(
  'slide-traditional',
  'Hero Slide 2 - Traditional Heritage 22K Gold',
  'dark-gold',
  'TRADITIONAL YET',
  'Artisanal Gold',
  'Modernistic',
  'The fine blend of traditional elegance and modernistic designs that make you go awestruck.',
  'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1600&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1920&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1600&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1080&auto=format&fit=crop&q=85',
  50,
  'Explore Heritage Suite',
  'Artisanal Gold',
  'category',
  'jewelry',
  '/category/jewelry',
  2,
  TRUE
),
(
  'slide-lodge',
  'Hero Slide 3 - Lodge & White Linen Resort Edition',
  'light-minimal',
  'NEW COLLECTION — ATELIER',
  'Modern Atelier',
  'LODGE & White Linen',
  'Contemporary minimalist aesthetics, pavé solitaire rings, and pure organic flax linen tailored for understated luxury.',
  'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1600&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1920&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1600&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1080&auto=format&fit=crop&q=85',
  35,
  'Shop New Arrivals',
  'Modern Atelier',
  'category',
  'apparel',
  '/category/apparel',
  3,
  TRUE
)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 14. SEED PROMO CARDS (Cards Beneath Hero)
INSERT INTO `promo_cards` (
  `id`, `internal_name`, `tag`, `title`, `description`, `image`, `overlay_opacity`,
  `action_text`, `badge`, `link_type`, `target_category`, `custom_url`, `display_order`, `active`
) VALUES (
  'promo-eternal-bands',
  'Homepage Promo 1 - Eternal Kundan & Diamond Bands',
  'Haute Joaillerie',
  'Eternal Bands & Royal Kundan',
  'Marquise pavé diamonds, 18K rose gold, and 22K certified heritage craftsmanship.',
  'https://images.unsplash.com/photo-1603561591411-07134e71a2a9?w=800&auto=format&fit=crop&q=80',
  35,
  'Explore Jewellery Suite',
  'Diamond & Kundan',
  'category',
  'jewelry',
  '/category/jewelry',
  1,
  TRUE
),
(
  'promo-white-linen',
  'Homepage Promo 2 - White Linen Resort Edition',
  'Haute Living & Couture',
  'The New White Linen Edition',
  'Pure Normandy flax linen ensembles, minimalist resort tailoring, and organic textures.',
  'https://images.unsplash.com/photo-1584273143981-41c073dfe8f8?w=800&auto=format&fit=crop&q=80',
  30,
  'Discover Linen Collection',
  'Pure Normandy Flax',
  'category',
  'apparel',
  '/category/apparel',
  2,
  TRUE
)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 15. SEED TRUST INDICATORS
INSERT INTO `trust_indicators` (`id`, `icon`, `title`, `subtitle`, `display_order`, `active`) VALUES
('trust-1', 'shield', '100% Certified Authenticity', 'Every piece is verified and hallmarked with master certification.', 1, TRUE),
('trust-2', 'clock', '3-Day Fast Courier Delivery', 'Nationwide expedited transit with full insurance guarantee.', 2, TRUE),
('trust-3', 'gem', 'Conflict-Free Gemstones', 'Ethically sourced diamonds and certified 22K pure heritage gold.', 3, TRUE),
('trust-4', 'headset', '24/7 Boutique Concierge', 'Direct styling support and doorstep assistance across Pakistan.', 4, TRUE)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 16. SEED CAROUSEL SETTINGS
INSERT INTO `carousel_settings` (`id`, `auto_play`, `slide_duration`, `show_arrows`, `show_indicators`) VALUES
(1, TRUE, 6500, TRUE, TRUE)
ON DUPLICATE KEY UPDATE `slide_duration`=VALUES(`slide_duration`);

-- 17. SEED STORE SETTINGS
INSERT INTO `store_settings` (
  `id`, `store_name`, `store_tagline`, `legal_business_name`, `tax_registration_number`,
  `brand_accent_color`, `store_logo_url`, `support_email`, `support_phone`, `whatsapp_number`, `alternate_phone`,
  `complaints_email`, `urgent_contact_person`, `store_address`, `warehouse_address`, `warehouse_city`,
  `standard_shipping_fee`, `free_shipping_threshold`, `enable_free_shipping`, `urgent_shipping_fee`,
  `enable_urgent_shipping`, `primary_courier`, `enable_cod`, `cod_max_limit`,
  `require_advance_for_high_value`, `advance_payment_threshold`, `advance_payment_percent`,
  `low_stock_threshold`, `min_order_amount`, `customer_cancellation_hours`,
  `maintenance_mode`, `announcement_bar_active`, `announcement_text`, `announcement_theme`, `announcement_link`
) VALUES (
  1,
  'U-KNOW CART',
  "Pakistan's Multi-Vendor Marketplace — Every Category, Trusted Sellers, Nationwide Delivery",
  'U-KNOW CART Pvt. Ltd.',
  'STRN-7492841-9 / NTN: 948201-1',
  '#d97706',
  NULL,
  'qaseeem08@gmail.com',
  '+92 300 2232038',
  '+92 300 2232038',
  '03340255740',
  'qasimabha@bul.com.pk',
  'Muhammad Qasim (Director & Concierge)',
  '11-F New Karachi Sindh Karachi Pakistan',
  '11-F New Karachi Sindh Karachi Pakistan',
  'Karachi',
  350.00,
  999999999.00,
  FALSE,
  600.00,
  TRUE,
  'tcs',
  TRUE,
  100000.00,
  TRUE,
  25000.00,
  20,
  5,
  500.00,
  36,
  FALSE,
  TRUE,
  'Standard Delivery Rs. 350 Nationwide across Pakistan. Direct WhatsApp VIP Concierge Active 24/7.',
  'amber',
  '/shop'
)
ON DUPLICATE KEY UPDATE `store_address`=VALUES(`store_address`), `warehouse_city`=VALUES(`warehouse_city`), `standard_shipping_fee`=VALUES(`standard_shipping_fee`), `urgent_shipping_fee`=VALUES(`urgent_shipping_fee`), `enable_free_shipping`=VALUES(`enable_free_shipping`);

