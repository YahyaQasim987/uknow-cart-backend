# U-Know Multi-Mart — Business Rules & Authoritative Logic

**Document Version:** 2.0.0  
**Enforcement:** Server-Side Authoritative Architecture  

---

## 1. Authoritative Pricing & Delivery Fee Rules

1. **Client Price Stripping**:
   - Client-submitted prices (`item.price`) are strictly discarded on checkout.
   - The server exclusively retrieves active unit prices from `products` or `product_variants` tables.
   - Any order item referencing an invalid, disabled, or non-existent product is rejected immediately.

2. **Standard & Free Shipping Threshold**:
   - Orders with a verified subtotal **below Rs. 3,500 PKR** incur a standard delivery fee of **Rs. 250 PKR**.
   - Orders with a verified subtotal **equal to or exceeding Rs. 3,500 PKR** qualify for **Free Standard Shipping** (`shippingFee = 0`).

3. **Urgent Delivery Surcharge**:
   - When the customer selects `deliverySpeed: 'urgent'`, an additional **Rs. 500 PKR** express handling fee is added, irrespective of free shipping eligibility.

4. **Cash on Delivery Only**:
   - New orders must use the `cod` payment method; the backend rejects other methods.
   - The complete order total is due at delivery. Product advance-payment fields and legacy gateway configuration are ignored.

5. **Integer Cent/Paisa Precision**:
   - To eliminate IEEE-754 floating-point rounding inaccuracies in multi-item orders, all subtotals, discounts, delivery fees, and taxes are calculated internally in integer cents/paisas (`Math.round(val * 100)`) and converted back to two decimal places upon final response serialization.

6. **Promotional Coupon Validation**:
   - Coupon codes are looked up against the `coupons` table with active status checks (`is_active = TRUE`) and non-expired dates (`expires_at IS NULL OR expires_at >= NOW()`).
   - Coupons enforce `min_order_amount` thresholds and `max_discount` caps.

---

## 2. Order Lifecycle, State Transitions & Cancellation Lock

1. **State Machine Flow**:
   ```
   [ placed ] 
       │
       ▼
   [ confirmed ] 
       │
       ▼
   [ courier_assigned ] ── (PERMANENT CANCELLATION LOCK APPLIED)
       │
       ▼
   [ shipped ] ── (INVENTORY COMMITTED TO PHYSICAL DEDUCTION)
       │
       ▼
   [ delivered ]
   ```

2. **Permanent Cancellation Lock**:
   - While an order is in `placed` or `confirmed` status, it may be cancelled by the owning customer or store admin.
   - The exact moment an administrator assigns a courier partner and tracking code (`PATCH /orders/:id/courier`), the order transitions to `courier_assigned`.
   - **Strict Rule:** From this state onward (`courier_assigned`, `shipped`, `delivered`), customer cancellations are **strictly rejected with HTTP 400/409**:
     `"Cancellation rejected. Order has already been assigned to courier or dispatched."`

3. **Customer Ownership & Guest Order Security**:
   - Customer identity is derived strictly from verified authentication context (`req.user.id`), never from an unverified request body `userId` or customer name alone.
   - One customer cannot view, confirm, modify, or cancel another customer's order (HTTP 403 Forbidden).
   - Unauthenticated requests without valid credentials or guest tokens cannot confirm or cancel customer orders (HTTP 401 Unauthorized).
   - Orders placed by unauthenticated guests generate a high-entropy 24-byte cryptographic token (`guestAccessToken`).
   - Guest tokens can only access genuine guest orders where `customer_id` is NULL; guest tokens cannot bypass ownership of authenticated customer orders.

---

## 3. Atomic Inventory & Double-Decrement Prevention

1. **Reservation on Order Placement**:
   - On order submission (`POST /orders`), a database transaction locks the product row with `FOR UPDATE`.
   - Stock is verified: `available = physical_stock - reserved_stock`.
   - If `available >= requested_qty`, `reserved_stock` is atomically incremented by `requested_qty` and an `active` reservation record is stored.
   - Physical stock is NOT decremented yet.

2. **Commitment on Shipment**:
   - When the order status moves to `shipped` (`PATCH /orders/:id/shipped`), the reservation is committed:
     `UPDATE products SET stock = stock - qty, reserved_stock = reserved_stock - qty WHERE id = ?`.
   - Reservation status updates to `committed`.
   - Idempotency check prevents duplicate shipment commits.

3. **Release on Cancellation**:
   - If an order is cancelled prior to courier assignment, active reservations are restored:
     `UPDATE products SET reserved_stock = GREATEST(0, reserved_stock - qty) WHERE id = ?`.
   - Reservation status updates to `released`.

---

## 4. Video-Only Unboxing Reviews & Moderation

1. **Mandatory Video Rule**:
   - Written-only reviews are strictly prohibited. Every customer review must include a multipart `video` file.
   - MP4, WebM, and MOV are accepted up to 50 MB. The backend checks the media signature; the client duration is limited to 30.5 seconds.
   - Requests without a video file are rejected with HTTP 400.

2. **Accepted Video Duration Constraint (30.5s)**:
   - The unboxing video duration (`videoDuration`) cannot exceed **30.5 seconds** (`duration <= 30.5`), which is preserved and accepted.
   - Videos exceeding 30.5 seconds are rejected with HTTP 400.

3. **Verified Delivered Purchase Verification**:
   - The submitting user ID is derived strictly from verified authentication context and must correspond to a completed order for that specific product in `delivered` status (`orders.order_status = 'delivered'`).

4. **Curator Moderation Workflow**:
   - Newly submitted reviews enter `pending` status.
   - Reviews are only visible on public storefront endpoints once approved by a store administrator (`PATCH /reviews/:id/moderate` with `status: 'approved'`). The admin Client Reviews page provides this moderation queue.

---

## 5. Ad Anti-Inflation & Budget Auto-Pause

1. **Click & Impression Deduplication**:
   - In-memory rate limiting and sliding IP caches deduplicate repeat hits for the same advertisement within a 30-second window.
   - Bot clicks and rapid page refreshes from the same client IP do not inflate CPM/CPC spending metrics or impression counters.

2. **Budget Auto-Pause**:
   - When an ad campaign's cumulative `spending` reaches or exceeds its configured `budget`, the ad status automatically updates from `active` to `completed`, removing it from public storefront placement endpoints.

---

## 6. Multi-Admin Product Ownership & Authorization (Strict Two-Role Model)

1. **Strict Two-Role Architecture**:
   - The system exclusively supports two roles: `'admin'` and `'customer'`.
   - Legacy roles (`super_admin`, `manager`, `vendor`, `passenger`) are completely removed and safely migrated.
   - Public registrations strictly force the `'customer'` role; self-promotion to `'admin'` is impossible.
   - Admin accounts are provisioned via protected administrative endpoints (`POST /api/v1/auth/admin/provision`).

2. **Product Authorship & Admin Separation**:
   - Products record `admin_id` (foreign key to `users.id`, role `'admin'`) and `owner_id`.
   - `admin_id` is set strictly on the server from `req.user.id`; client-submitted `admin_id` or `owner_id` is ignored.
   - Every Admin creates and manages their own products.
   - Cross-Admin isolation: An Admin cannot edit or delete another Admin's product (HTTP 403 Forbidden).
