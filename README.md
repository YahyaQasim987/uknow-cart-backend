# ATELIER U-KNOW — Backend (Express.js + MySQL + Socket.IO)

Modern, high-performance, modular backend built with pure **Node.js (ES Modules)**, **Express.js**, **MySQL 8.0+**, and **Socket.IO** for the ATELIER U-KNOW luxury multi-mart platform.

---

## 🚀 Quick Start

### 1. Environment Configuration
Copy `.env.example` to `.env` and configure your credentials:
```bash
cd backend
cp .env.example .env
```

Key environment settings:
- `BACKEND_PORT=4000`
- `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=...`, `DB_NAME=uknow_store`
- `JWT_SECRET=super_secret_jwt_key_at_least_32_characters_long`
- `CLIENT_ORIGIN=http://localhost:3000`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM` for password-account verification emails
- `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID`, and `FACEBOOK_APP_SECRET` for verified social sign-in

Website registrations accept Gmail, Outlook, Yahoo, and iCloud addresses only. New password accounts remain inactive until the one-time email link is used. Google and Facebook credentials are validated by the backend; the frontend must also be configured with the provider's public client/app ID in `u-know-multi-mart/src/app/services/social-auth.service.ts`.

Signup source is recorded in `users.signup_method` (`website`, `google`, or `facebook`) and returned as `signupMethod` on authenticated user data. Website registration sends `method: "website"`; social registration must send a real provider credential with `method: "google"` or `method: "facebook"`. Existing users created before this field was added return `unknown` rather than an inferred source.

In development only, if SMTP is not configured, signup returns a verification link in the API response so the account flow can be tested locally. Configure SMTP to send real email. Backend logs default to warnings and errors; set `LOG_LEVEL=info` to enable startup and informational logs. Run the backend and frontend in separate terminals: `npm run dev` in `backend`, then `npm run dev` in `u-know-multi-mart`.

Admin image uploads use `POST /api/v1/uploads/:entity/:id/:variant` with multipart field `image` and a bearer token. Supported destinations are `products/:id/image`, `categories/:id/image`, `subcategories/:id/image`, and `banners/:id/{image|desktop|tablet|mobile}`. Files are stored under `uploads/` and their public URL is written to the corresponding MySQL image field/table.

### 2. Initialize Database Schema
Runs the consolidated master schema in `backend/sql/schema.sql`:
```bash
npm run migrate
```

### 3. Provision Admin Account
Create or seed the initial administrator with salted bcrypt hashing:
```bash
npm run provision:admin
```

### 4. Start the Server
```bash
npm start
# or during development:
npm run dev
```

### 5. Run Automated Tests
Executes the native Node.js test suite across pricing, security audit, inventory, order workflows, and real-time presence:
```bash
npm test
```
The focused auth/upload tests run without modifying store records:
```bash
node --test tests/auth-registration.test.js
```
The complete suite contains database-backed write tests; run it only against an isolated test database, not the configured store.

---

## 📡 Real-Time Socket.IO Channels

Connect to `http://localhost:5000` with optional JWT token in auth handshake.

| Event | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `presence:join` | Client ➔ Server | `{ visitorId, tabId, isVisible }` | Registers open shopper tab |
| `presence:visibility` | Client ➔ Server | `{ visitorId, tabId, isVisible }` | Sends visibility state (tab active/hidden) |
| `presence:leave` | Client ➔ Server | `{ visitorId, tabId }` | Closes active tab |
| `presence:count` | Server ➔ Client | `{ activeShoppers, timestamp }` | Broadcasts active unique shopper count |
| `orders:new` | Server ➔ Admin | `{ orderId, customerName, total }` | Alerts admin of fresh order placement (`admin` room only) |
| `orders:status_changed`| Server ➔ Client | `{ orderId, newStatus }` | Broadcasts lifecycle status changes |
| `inventory:stock_changed` | Server ➔ Client | `{ productId, availableStock }` | Syncs available stock in real time |
| `ads:click_recorded` | Server ➔ Admin | `{ adId, timestamp }` | Live campaign interaction telemetry |

---

## 🛡️ Business & Security Invariants Enforced

1. **Authoritative Server Pricing (Defect A Resolved)**: Client-submitted prices (`item.price`), subtotals, or taxes are strictly discarded. The server exclusively verifies prices against active catalog records. Unverified products or prices immediately reject checkout with an error. Integer paisa arithmetic (`Math.round(val * 100)`) eliminates floating-point rounding discrepancies.
2. **Order Confirmation, Ownership & Courier Lock (Defect B Resolved)**:
   - `optionalAuth` is strictly removed from customer order operations; unauthenticated requests without tokens cannot view, confirm, or cancel orders (HTTP 401).
   - Customer identity is derived exclusively from verified JWT authentication context, never from client-submitted `userId`.
   - Ownership is verified: Customer A cannot view, confirm, modify, or cancel Customer B's order (HTTP 403).
   - Guest orders require a 24-byte cryptographic `guestAccessToken` (`X-Guest-Token`), which cannot access or manipulate authenticated customer orders.
   - Cancellation is permanently locked once an order transitions to `courier_assigned` or dispatched (`Cancellation rejected. Order has already been assigned to courier or dispatched.`).
   - Order state transitions strictly follow valid state machine paths (`placed` ➔ `confirmed` ➔ `courier_assigned` ➔ `shipped` ➔ `delivered`).
3. **Strict Two-Role Architecture & Single Common Users Table (Defect C & Section 4 Resolved)**:
   - The application strictly supports two roles: `'admin'` and `'customer'`. All legacy or unsupported roles (`super_admin`, `manager`, `vendor`, `passenger`) are purged and safely migrated.
   - A single unified `users` table holds both Admin and Customer accounts with common fields (`id`, `full_name`, `email`, `password_hash`, `role`, `status`, `last_login_at`, timestamps) and nullable Admin profile fields (`recovery_email`, `primary_phone`, `secondary_phone`, `whatsapp_number`, `profile_image`, `bio`).
   - Public registrations strictly force the `'customer'` role; self-assigning `'admin'` is impossible.
   - Admin accounts are provisioned exclusively via protected administrative APIs (`POST /api/v1/auth/admin/provision`).
   - Suspended accounts (`status: 'suspended'`) are blocked from login and API operations (HTTP 403).
   - Customer profile serialization strictly enforces DTO privacy: Admin-specific fields and password hashes are never leaked to customers.
4. **Product Ownership & Admin Separation (Section 5 Resolved)**:
   - Every product records `products.admin_id` referencing `users.id` with `role = 'admin'`.
   - `admin_id` is set strictly on the server from `req.user.id`; client-submitted `admin_id` or `owner_id` is ignored.
   - Cross-Admin isolation: An Admin cannot edit or delete another Admin's product (HTTP 403).
5. **Atomic Inventory Reservation**: Available stock formula is strictly `available = physical - reserved`. Orders hold reservations without prematurely reducing physical stock. When shipped, physical stock is decremented and reservations cleared atomically.
6. **Video-Only Unboxing Reviews**: Text-only reviews are strictly rejected. Submit a multipart `video` file (MP4, WebM, or MOV; up to 50 MB) with the review fields. Duration is limited to 30.5 seconds, and the authenticated user must have a verified `delivered` purchase. New reviews require admin approval before appearing on the product page.
7. **Active Shopper Deduplication**: Multi-tab browsing by the same visitor is deduplicated to 1 shopper. When minimized, a 15-minute grace period runs before cleaning up the session.
8. **SEO Suite & Ad Anti-Inflation**: Circular 301/302 redirect loops are rejected; Schema.org JSON-LD and XML sitemaps are generated on demand. Ad impressions and clicks feature 30-second IP deduplication.
