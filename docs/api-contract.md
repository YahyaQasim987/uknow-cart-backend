# U-Know Multi-Mart — REST API & Socket.IO Contract

**API Base Path:** `/api/v1`  
**Authentication Scheme:** Bearer Token (JWT in `Authorization` header)  
**Real-Time Gateway:** Socket.IO v4+ on root HTTP server  

---

## 1. REST API Endpoints Matrix

### 1.1 Authentication & Security (`/api/v1/auth`)

| Method | Endpoint | Auth | Request Body | Response (200/201) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Public | `{ method: "website", name, fullName?, email, password, phone?, city?, address? }` | `{ success: true, method: "website", message }` | Public customer registration; allows Gmail, Outlook, Yahoo, and iCloud addresses only; records the signup source, creates an unverified customer, and sends a one-time email link |
| `POST` | `/api/v1/auth/login` | Public | `{ email, password }` | `{ success: true, token, user }` | Login & JWT issuance (Rejects suspended and unverified customer accounts; records `last_login_at`) |
| `GET` | `/api/v1/auth/verify-email?token=...` | Public | — | Redirects to the storefront after verification | Consumes a single-use, 30-minute verification link |
| `POST` | `/api/v1/auth/resend-verification` | Public | `{ email }` | `{ success: true, message }` | Sends a replacement verification link without disclosing whether an account exists |
| `POST` | `/api/v1/auth/oauth-login` | Public | `{ method: "google", idToken }` or `{ method: "facebook", accessToken }` | `{ success: true, method, token, user }` | Verifies provider credentials server-side; stores the original signup source; provider-verified users do not need a second email verification |
| `GET` | `/api/v1/auth/me` | Bearer | None | `{ success: true, user }` | Current session details (Strict DTO privacy: never leaks admin fields to customer) |
| `GET` | `/api/v1/auth/profile` | Bearer | None | `{ success: true, user }` | Complete user profile |
| `PUT` | `/api/v1/auth/profile` | Bearer | `{ name?, fullName?, phone?, primaryPhone?, city?, address?, avatar?, profileImage?, whatsappNumber?, secondaryPhone?, recoveryEmail?, bio? }` | `{ success: true, user }` | Update user profile (Role assignment strictly blocked) |
| `POST` | `/api/v1/auth/change-password` | Bearer | `{ currentPassword, newPassword }` | `{ success: true, message }` | Change user password |
| `POST` | `/api/v1/auth/forgot-password` | Public | `{ email }` | `{ success: true, message }` | Issue reset token (anti-enumeration) |
| `POST` | `/api/v1/auth/reset-password` | Public | `{ token, newPassword }` | `{ success: true, message }` | Apply reset password token |
| `POST` | `/api/v1/auth/admin/provision` | Admin | `{ fullName, email, password, primaryPhone?, secondaryPhone?, whatsappNumber?, recoveryEmail?, profileImage? }` | `{ success: true, admin }` | Secure admin account provisioning |

New users' original signup source is returned as `user.signupMethod` (`website`, `google`, or `facebook`) in login, OAuth login, and `/auth/me` responses. Existing users created before source tracking return `unknown` because their original provider cannot be inferred reliably.

Auth/API diagnostics: the backend logs each `/api/...` request with method, path, status, duration, and a generated request ID; auth responses include a safe summary, and unhandled errors include the server stack in the terminal. The request ID is returned in the `X-Request-Id` header. The browser console logs auth request/response status and safe response details; failures include status, server message, and request ID so they can be matched to the backend log. Passwords, OAuth tokens, JWTs, verification links, and request bodies are not logged.

### Image Uploads (`/api/v1/uploads`)

All routes require an admin bearer token and a multipart file field named `image`. JPEG, PNG, WebP, and GIF files are accepted up to 10 MB; detected file signatures are checked before the public URL is saved in MySQL.

| Method | Endpoint | Stored path | Database destination |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/uploads/products/:id/image` | `uploads/products/product-:id/` | Adds a row to `product_images` |
| `POST` | `/api/v1/uploads/products/:id/{desktop|tablet|mobile}` | `uploads/products/product-:id/` | Updates the product's responsive hero image URL |
| `POST` | `/api/v1/uploads/products/:productId/variants/:variantId/image` | `uploads/products/product-:productId/variant-:variantId/` | Appends to the variant's `images` JSON and sets `image_url` for its first image |
| `POST` | `/api/v1/uploads/banners/:id/{image|desktop|tablet|mobile}` | `uploads/banners/:id/` | Updates the corresponding `hero_banners` image column; a desktop upload also updates the legacy `image` column |
| `POST` | `/api/v1/uploads/promo-cards/:id/{image|mobile}` | `uploads/banners/promo-:id/` | Updates `promo_cards.image` or `promo_cards.mobile_image_url` |
| `POST` | `/api/v1/uploads/categories/:id/image` | `uploads/categories/category-:id/` | Updates `categories.image_url` |
| `POST` | `/api/v1/uploads/subcategories/:id/image` | `uploads/subcategories/subcategory-:id/` | Updates `sub_categories.image_url` |

Hero slides, promo cards, trust indicators, and carousel settings are stored in MySQL and managed through `/api/v1/banners/hero`, `/api/v1/banners/promo`, `/api/v1/banners/trust`, and `/api/v1/banners/carousel-settings`. Their list endpoints return persisted records; an empty table returns an empty list rather than demo content. All create/update/delete operations require an admin token. Uploaded banner/promo media must use the multipart endpoints above; `blob:` and `data:` preview URLs are rejected.

Uploaded files are served from `/uploads/...`; responses include the persisted URL.

### 1.2 Shopping Cart (`/api/v1/cart`)

| Method | Endpoint | Auth | Request Body | Response | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cart` | Bearer | None | `{ success: true, cart: { id, items: [...], totalItems } }` | Retrieve active shopping bag |
| `POST` | `/api/v1/cart/items` | Bearer | `{ productId, variantId?, quantity }` | `{ success: true, message }` | Add item or increment qty |
| `PUT` | `/api/v1/cart/items/:id` | Bearer | `{ quantity }` | `{ success: true, message }` | Update item quantity in cart |
| `DELETE`| `/api/v1/cart/items/:id` | Bearer | None | `{ success: true, message }` | Remove single item from cart |
| `DELETE`| `/api/v1/cart` | Bearer | None | `{ success: true, message }` | Clear all items from cart |

### 1.3 Wishlist (`/api/v1/wishlist`)

| Method | Endpoint | Auth | Request Body | Response | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/wishlist` | Bearer | None | `{ success: true, wishlist: { items: [...] } }` | Retrieve customer wishlist |
| `POST` | `/api/v1/wishlist/items` | Bearer | `{ productId }` | `{ success: true, message }` | Add product to wishlist |
| `DELETE`| `/api/v1/wishlist/items/:productId` | Bearer | None | `{ success: true, message }` | Remove product from wishlist |

### 1.4 Catalog & Products (`/api/v1/products`)

| Method | Endpoint | Auth | Query / Body | Response | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/products` | Public | `category`, `subCategory`, `brand`, `tier`, `search`, `minPrice`, `maxPrice`, `featured`, `showOnHome`, `ownerId`, `sortBy`, `page`, `limit` | `{ success: true, count, total, page, products: [...] }` | Filtered, paginated catalog with persisted media, inventory, and variants |
| `GET` | `/api/v1/products/:id` | Public | None | `{ success: true, product }` | Full details, variants, media, authorized owner |
| `POST` | `/api/v1/products` | Admin | Product model fields including category, SKU, price, images, shipping/payment, banner, tags, and SEO metadata | `{ success: true, product }` | Create catalog item and optional initial variants (`admin_id` strictly derived from `req.user.id`) |
| `PUT` | `/api/v1/products/:id` | Admin | Partial product fields; `images` and `allowedCities` replace their lists | `{ success: true, product }` | Update product fields and return the persisted product (strict cross-admin ownership check) |
| `DELETE`| `/api/v1/products/:id`| Admin | None | `{ success: true, message }` | Delete product (Strict cross-admin ownership check: Admin A cannot delete Admin B) |

Product variants support create, update, and delete operations at `POST /api/v1/products/:productId/variants`, `PUT /api/v1/products/variants/:id`, and `DELETE /api/v1/products/variants/:id`. Variant writes require an admin token and enforce ownership of the parent product. Variant images are uploaded separately through the multipart endpoint above; `blob:` and `data:` preview URLs are not accepted as persisted media.

### 1.5 Orders & Order Lifecycle (`/api/v1/orders`)

| Method | Endpoint | Auth | Headers / Body | Response | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/orders/pricing/calculate` | Public/Bearer | `{ items, couponCode?, deliverySpeed?, city? }` | `{ success: true, subtotal, total, ... }` | Authoritative server pricing engine |
| `POST` | `/api/v1/orders` | Public/Bearer | `{ items, customer, paymentMethod, deliverySpeed?, couponCode? }` | `{ success: true, orderId, orderStatus: 'placed', guestAccessToken? }` | Place order with atomic stock lock & price snapshot |
| `GET` | `/api/v1/orders/my-orders` | Customer | None | `{ success: true, orders: [...] }` | Authenticated customer orders; cancelled orders are omitted. The admin order list retains the cancellation history. |
| `GET` | `/api/v1/orders` | Admin | Filter by status, search | `{ success: true, orders: [...] }` | Admin list of all store orders |
| `GET` | `/api/v1/orders/:id` | Guarded | `Authorization` Bearer OR `X-Guest-Token` | `{ success: true, order }` | View order (Ownership strictly enforced; customer B cannot view customer A) |
| `POST` | `/api/v1/orders/:id/confirm` | Guarded | `Authorization` Bearer OR `X-Guest-Token` | `{ success: true, orderStatus: 'confirmed' }` | Explicit customer confirmation (from `placed` only) |
| `POST` | `/api/v1/orders/:id/cancel` | Guarded | `Authorization` Bearer OR `X-Guest-Token`, `{ reason }` | `{ success: true, orderStatus: 'cancelled' }` | Cancel order (Ownership enforced; permanently locked once courier assigned) |
| `PATCH`| `/api/v1/orders/:id/courier` | Admin | `{ courierPartner, trackingNumber, note? }` | `{ success: true, orderStatus: 'courier_assigned' }` | Assign courier & activate cancellation lock |
| `PATCH`| `/api/v1/orders/:id/shipped` | Admin | `{ note? }` | `{ success: true, orderStatus: 'shipped' }` | Commit inventory reservation |
| `PATCH`| `/api/v1/orders/:id/status` | Admin | `{ status, reason? }` | `{ success: true, newStatus }` | Transition order status strictly validating state machine paths |

### 1.6 Reviews (`/api/v1/reviews`)

| Method | Endpoint | Auth | Request Body | Response | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/reviews/product/:productId` | Public | None | `{ success: true, reviews: [...] }` | Approved reviews for product |
| `POST` | `/api/v1/reviews` | Customer | Multipart fields `productId`, `productName`, `rating`, `comment`, `userName`, `userCity`, `videoDuration`, optional `videoThumbnail`, and file field `video` | `{ success: true, review, message }` | Submit a verified delivered-purchase review. MP4/WebM/MOV video is limited to 50 MB and 30.5 seconds; new reviews are pending moderation. |
| `GET` | `/api/v1/reviews/admin/all` | Admin | `status?` (`pending`, `approved`, `rejected`) | `{ success: true, reviews: [...] }` | Admin moderation list |
| `PATCH` | `/api/v1/reviews/:id/moderate` | Admin | `{ status: 'pending' | 'approved' | 'rejected' }` | `{ success: true, message }` | Moderate customer review; approved videos appear on the matching product page |

### 1.7 SEO Suite (`/api/v1/seo`)

| Method | Endpoint | Auth | Parameters | Response | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/seo/jsonld/:productId` | Public | URL param | Schema.org Product JSON-LD | Product rich snippet structured data |
| `GET` | `/api/v1/seo/sitemap` | Public | None | XML Sitemap | Search engine XML crawl feed |
| `GET` | `/api/v1/seo/robots` | Public | None | Plaintext | Dynamic robots.txt |
| `GET` | `/api/v1/seo/redirects` | Admin | None | `{ success: true, redirects: [...] }` | List configured redirects |
| `POST` | `/api/v1/seo/redirects` | Admin | `{ sourceUrl, destinationUrl, statusCode }` | `{ success: true, redirect }` | Create redirect (loop protected) |

---

## 2. Socket.IO Real-Time Gateway Matrix

| Namespace / Room | Room Join Authorization | Events Emitted | Payload Structure |
| :--- | :--- | :--- | :--- |
| `/` (Public) | All connected visitors | `presence:update` | `{ activeShoppers: number }` |
| `/` (Public) | All connected visitors | `inventory:change` | `{ productId, availableStock }` |
| `/` (Public) | All connected visitors | `announcement:broadcast` | `{ message, level, timestamp }` |
| `admin` (Room) | Admin role verified via JWT | `order:new` | `{ orderId, customerName, total, paymentMethod }` |
| `order:<id>` (Room) | Order owner or valid `guestToken` | `order:status_changed` | `{ orderId, previousStatus, newStatus, timestamp }` |
