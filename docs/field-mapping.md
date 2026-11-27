# U-Know Multi-Mart — Data Model & Field Mapping Specification

**Document Version:** 2.0.0  
**Scope:** Bi-directional mapping between Angular frontend TypeScript models and MySQL database schema tables.  

---

## 1. Product & Catalog Models

### Frontend Interface: `Product` (`src/app/models/product.model.ts`)
| Frontend Property | MySQL Table & Column | Data Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `products.id` | `VARCHAR(64)` | Unique product primary key (e.g. `p-1`) |
| `name` | `products.name` | `VARCHAR(255)` | Product name |
| `title` | `products.name` | `VARCHAR(255)` | Alias for name |
| `description` | `products.description` | `TEXT` | Detailed product narrative |
| `price` | `products.price` | `DECIMAL(10,2)` | Regular retail price in PKR |
| `originalPrice` | `products.original_price` | `DECIMAL(10,2)` | Strikethrough/comparison price |
| `stock` | `products.stock` | `INT` | Physical inventory count |
| `reservedStock` | `products.reserved_stock` | `INT` | Reserved in open orders |
| `category` | `products.category_id` | `VARCHAR(64)` | Foreign key to `categories.id` |
| `categoryName` | `categories.name` | `VARCHAR(128)` | Resolved category display label |
| `brand` | `products.brand` | `VARCHAR(128)` | Brand name |
| `sku` | `products.sku` | `VARCHAR(64)` | Stock keeping unit |
| `gtin` | `products.gtin` | `VARCHAR(64)` | Global Trade Item Number (UPC/EAN) |
| `mpn` | `products.mpn` | `VARCHAR(64)` | Manufacturer Part Number |
| `modelNumber` | `products.model_number` | `VARCHAR(64)` | Product model code |
| `warranty` | `products.warranty` | `VARCHAR(128)` | Warranty terms (e.g. "2 Years Official") |
| `adminId` | `products.admin_id` | `VARCHAR(64)` | Authoritative Admin owner FK to `users.id` (`role = 'admin'`) |
| `ownerId` | `products.owner_id` | `VARCHAR(64)` | Backward-compatible alias for `admin_id` |
| `ownerName` | `products.owner_name` | `VARCHAR(128)` | Admin creator name |
| `ownerPhone` | `products.owner_phone` | `VARCHAR(32)` | Admin direct contact |
| `ownerWhatsapp` | `products.owner_whatsapp` | `VARCHAR(32)` | WhatsApp direct ordering |
| `seoTitle` | `products.seo_title` | `VARCHAR(255)` | Custom page `<title>` tag |
| `metaDescription` | `products.meta_description`| `TEXT` | Custom `<meta name="description">` |
| `urlSlug` | `products.url_slug` | `VARCHAR(255)` | Canonical SEO URL slug |
| `imageAltText` | `products.image_alt_text` | `VARCHAR(255)` | Accessibility alt tag for hero media |
| `images` | `products.images` | `JSON` | Array of image URLs `["https://..."]` |
| `imageUrl` | Derived from `images[0]` | `VARCHAR(512)` | Primary display image |
| Legacy advance-payment fields | `products.advance_payment_*` | Existing columns | Retained for compatibility; ignored by COD-only checkout |
| `variants` | Joined from `product_variants` | `Array<Variant>` | Active size/color variations |

---

## 2. Order & Customer Models

### Frontend Interface: `Order` (`src/app/models/order.model.ts`)
| Frontend Property | MySQL Table & Column | Data Type | Description |
| :--- | :--- | :--- | :--- |
| `id` / `orderId` | `orders.id` | `VARCHAR(64)` | Order identifier (e.g. `AUK-123456-789`) |
| `userId` / `user_id`| `orders.user_id` | `VARCHAR(64)` | Foreign key to `users.id` (nullable for guest) |
| `customerId` / `customer_id` | `orders.customer_id` | `VARCHAR(64)` | Authoritative customer foreign key to `users.id` |
| `guestAccessToken` | `orders.guest_access_token`| `VARCHAR(64)` | Cryptographic token for guest order tracking |
| `customerName` | `orders.customer_name` | `VARCHAR(128)` | Customer full name |
| `customerPhone` | `orders.customer_phone` | `VARCHAR(32)` | Customer primary contact phone |
| `customerEmail` | `orders.customer_email` | `VARCHAR(128)` | Customer contact email |
| `customerCity` | `orders.customer_city` | `VARCHAR(64)` | Delivery destination city |
| `customerAddress` | `orders.customer_address` | `TEXT` | Physical delivery address |
| `paymentMethod` | `orders.payment_method` | `VARCHAR(32)` | `cod`, `advance_cod`, `bank_transfer` |
| `orderStatus` | `orders.order_status` | `VARCHAR(32)` | `placed`, `confirmed`, `courier_assigned`, `shipped`, `delivered`, `cancelled` |
| `subtotal` | `orders.subtotal` | `DECIMAL(10,2)` | Total product catalog price sum |
| `discountAmount` | `orders.discount_amount` | `DECIMAL(10,2)` | Coupon or promo discount deducted |
| `shipping` | `orders.shipping` | `DECIMAL(10,2)` | Shipping cost (0 if >= free threshold) |
| `total` | `orders.total` | `DECIMAL(10,2)` | Net final order payable amount |
| Legacy advance-payment amounts | `orders.advance_payment_due`, `orders.cod_remaining_due` | Existing columns | Retained for historical order compatibility; new COD orders charge the full total on delivery |
| `deliverySpeed` | `orders.delivery_speed` | `VARCHAR(24)` | `standard` or `urgent` (adds Rs. 500) |
| `courierPartner` | `orders.courier_partner` | `VARCHAR(64)` | TCS, Leopard, Call Courier, etc. |
| `trackingNumber` | `orders.tracking_number` | `VARCHAR(64)` | Consignment tracking barcode number |
| `courierStatusNote`| `orders.courier_status_note`| `VARCHAR(255)`| Dispatch notes from logistics partner |
| `cancellationReason`| `orders.cancellation_reason`| `VARCHAR(255)`| Audit log note for cancelled orders |
| `items` | Joined from `order_items` | `Array<OrderItem>` | Snapshot of ordered products, `admin_id`, and prices |
| `history` | Joined from `order_status_history` | `Array<StatusHistory>`| Audit trail of all state transitions |

### Order Item Model (`order_items`)
| Property | Column | Data Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `order_items.id` | `INT AUTO_INCREMENT` | Item record identifier |
| `orderId` | `order_items.order_id` | `VARCHAR(64)` | Foreign key to `orders.id` |
| `productId` | `order_items.product_id` | `VARCHAR(64)` | Foreign key to `products.id` |
| `adminId` | `order_items.admin_id` | `VARCHAR(64)` | Product merchant Admin at purchase time |
| `productName` | `order_items.product_name` | `VARCHAR(255)` | Historical product name snapshot |
| `variantId` | `order_items.variant_id` | `VARCHAR(64)` | Selected variation ID |
| `price` | `order_items.price` | `DECIMAL(10,2)` | Authoritative unit price snapshot |
| `quantity` | `order_items.quantity` | `INT` | Purchased quantity |

---

## 3. Cart & Wishlist Models

### Frontend Interface: `CartItem` & `WishlistItem`
| Frontend Property | MySQL Table & Column | Data Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `cart_items.id` / `wishlist_items.id` | `INT AUTO_INCREMENT` | Item record identifier |
| `cartId` / `userId` | `carts.user_id` / `wishlists.user_id` | `VARCHAR(64)` | User owner ID |
| `productId` | `cart_items.product_id` | `VARCHAR(64)` | Product identifier |
| `variantId` | `cart_items.variant_id` | `VARCHAR(64)` | Selected variation (nullable) |
| `quantity` | `cart_items.quantity` | `INT` | Item count in bag (strictly > 0) |
| `createdAt` | `cart_items.created_at` | `TIMESTAMP` | Time item was added |

---

## 4. Single Common User Account Table (`users`)

The backend maintains **one unified `users` table** for both Admins and Customers. The only supported roles are `'admin'` and `'customer'`.

### Common Account Fields
| Field | Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `users.id` | `VARCHAR(50)` | No (PK) | Unique user identifier (`usr-...`) |
| `fullName` / `name` | `users.full_name`, `users.name` | `VARCHAR(150)` | `name` is required | Customer or Admin display name |
| `email` | `users.email` | `VARCHAR(150)` | No (Unique) | Unique login email; public signup restricts supported provider domains |
| `passwordHash` | `users.password_hash` | `VARCHAR(255)` | Yes | bcrypt hash; NULL for provider-only accounts |
| `emailVerified` | `users.email_verified` | `BOOLEAN` | No | False for password signups until verification; true for OAuth and legacy accounts |
| `role` | `users.role` | `ENUM('admin', 'customer')` | No | Only `'admin'` or `'customer'` |
| `status` | `users.status` | `ENUM('active', 'suspended')` | No | Account status (suspended users blocked) |
| `lastLoginAt` | `users.last_login_at` | `TIMESTAMP` | Yes | Recorded on login |
| `createdAt` | `users.created_at` | `TIMESTAMP` | No | Account registration timestamp |
| `updatedAt` | `users.updated_at` | `TIMESTAMP` | No | Last update timestamp |

### Admin-Specific Profile Fields (In Same Table, Nullable for Customers)
| Field | Column | Type | Access Level | Description |
| :--- | :--- | :--- | :--- | :--- |
| `recoveryEmail` | `users.recovery_email`, `users.secondary_email` | `VARCHAR(150)` | Admin-Only | Secondary account recovery email |
| `primaryPhone` | `users.primary_phone`, `users.phone` | `VARCHAR(50)` | Admin / Customer | Main contact number |
| `secondaryPhone` | `users.secondary_phone` | `VARCHAR(50)` | Admin-Only | Secondary admin telephone |
| `whatsappNumber` | `users.whatsapp_number`, `users.whatsapp_phone` | `VARCHAR(50)` | Admin-Only | Admin WhatsApp merchant number |
| `profileImage` | `users.profile_image`, `users.avatar` | `VARCHAR(500)` | Admin / Customer | Profile avatar URL |
| `bio` | `users.bio` | `TEXT` | Admin-Only | Merchant bio / credentials |

**Privacy Rule:** Customer serialization (`serializeUser`) never exposes Admin-specific fields (`recoveryEmail`, `secondaryPhone`, `whatsappNumber`, `bio`) or password hashes.

---

## 5. Review Model (Strict Video-Only)

### Frontend Interface: `Review` (`src/app/models/review.model.ts`)
| Frontend Property | MySQL Table & Column | Data Type | Constraints / Description |
| :--- | :--- | :--- | :--- |
| `id` | `reviews.id` | `VARCHAR(64)` | Review primary key |
| `productId` | `reviews.product_id` | `VARCHAR(64)` | Foreign key to `products.id` |
| `userId` | `reviews.user_id` | `VARCHAR(64)` | Author user ID (Derived strictly from verified JWT) |
| `userName` | `reviews.user_name` | `VARCHAR(128)` | Display author name |
| `userCity` | `reviews.user_city` | `VARCHAR(64)` | Reviewer city |
| `rating` | `reviews.rating` | `INT` | Rating 1 to 5 stars |
| `comment` | `reviews.comment` | `TEXT` | Written impressions |
| `videoUrl` | `reviews.video_url` | `VARCHAR(512)` | Public URL generated for the uploaded review video |
| `videoDuration` | `reviews.video_duration` | `INT` | Video length (strictly <= 30.5 seconds accepted) |
| `videoThumbnail` | `reviews.video_thumbnail` | `VARCHAR(512)` | Video preview cover thumbnail |
| `verifiedPurchase` | `reviews.verified_purchase` | `BOOLEAN` | Must match a `delivered` order |
| `status` | `reviews.status` | `VARCHAR(24)` | `pending`, `approved`, `rejected` |
