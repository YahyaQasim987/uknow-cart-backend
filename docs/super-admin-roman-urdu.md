# U-Know Multi-Mart — Super Admin Documentation (Roman Urdu)

**Document ka maqsad:** Is document mein current website aur admin panel ki functionality ko dekh kar bataya gaya hai ke `Super Admin` kaisa hona chahiye, us ke paas kaun se controls hon, aur normal admin se us ka farq kya ho.

**Audit ka scope:** Angular storefront, admin panel, Express API aur MySQL schema.

> Yeh implementation code nahi, balkay implementation-ready product aur technical blueprint hai. Is ka maqsad ye hai ke har current feature ka owner aur har sensitive action ka safe rule pehle se clear ho.

## 1. Seedhi baat: Super Admin kya hoga?

Super Admin system ka **owner-level operator** hoga. Us ka kaam rozana har order edit karna nahi; us ka kaam system, team access, paisay wali settings, security aur approvals ko control karna hoga.

Normal Admin ko apne assigned kaam tak access milni chahiye. Super Admin hi ye decide kare ke kaunsa admin kya dekh ya change kar sakta hai.

Is project mein abhi sirf do roles hain: `admin` aur `customer`. Is liye har admin ko aam tor par aik jaisi wide access milti hai. Super Admin banane ka asal faida ye hoga ke access **role aur permission** ke hisaab se chale, sirf `admin` naam ke role se nahi.

## 2. Current system ki important surat-e-haal

| Cheez | Current halat | Super Admin ke liye kya badalna chahiye |
| --- | --- | --- |
| User roles | Sirf `admin` aur `customer` supported hain. | `super_admin` add karein, phir granular permissions introduce karein. |
| Admin access | Admin route aur backend `requireAdmin` har admin ko same broad access dete hain. | Har screen/API ko permission check ke saath chalaya jaye. |
| Admin banana | Existing admin-provision API ko admin access milti hai. | Naya admin ya Super Admin sirf `staff.manage` wali Super Admin permission se ban sake. |
| Audit | Order status history hai, lekin har store-level change ka central immutable audit log nahi. | Har sensitive action ko `audit_logs` mein save karein. |
| Frontend guard | Guard sirf `role === 'admin'` check karta hai. | `super_admin` ko allow aur menu/action level permissions enforce karein. |
| Realtime rooms | Admin Socket.IO room sirf `admin` role ko maanta hai. | Super Admin ko relevant room access aur permission-aware events milen. |

Is liye sirf database mein `super_admin` value add kar dena kaafi nahi hoga. Backend middleware, JWT payload, frontend guard, sidebar aur har sensitive controller ko ek saath update karna hoga.

## 3. Website ki har important cheez aur Super Admin control

| Website feature | Current business use | Super Admin ki zimmedari |
| --- | --- | --- |
| Home page, hero carousel, promo cards, trust blocks | Brand presentation aur campaign landing | Publish/unpublish authority, emergency rollback, scheduled campaign approval. |
| Categories, sub-categories aur brands | Customer catalog navigation | Category hierarchy aur brand ownership ka final control; accidental delete ki bajaye archive. |
| Product catalog, landing pages, media aur variants | Product discover karna aur detail dekhna | Price change threshold, product publish approval, media-policy aur cross-admin ownership override. |
| Search, voice search aur product comparison | Customer discovery aur comparison | Search quality metrics, provider override ki approval aur bad comparison data ki correction. |
| Ads aur in-feed placements | Monetization/promotion | Ad placement, budget, start/end schedule aur moderation ka final approval. |
| Reviews, including verified-purchase media reviews | Social proof aur customer trust | Abuse/moderation policy, final appeal decision aur takedown audit. |
| Sign-up, sign-in aur social login | Customer account access | Customer suspension policy, privacy-data access approval aur auth/security settings. |
| Cart aur wishlist | Purchase intent | Isay aam tor par view-only analytics tak rakhein; customer ka personal data bina business reason edit na ho. |
| Checkout, coupon, discount aur tax | Order total aur payable amount | High-value discount, coupon abuse, FBR tax slab aur delivery/fee settings ka approval. |
| Order history, cancellation, courier aur refund | Fulfilment aur after-sales support | Refund threshold, forced cancellation, manual payment/refund aur courier exception ka final approval. |
| Notifications, live presence aur broadcast | Customer communication | Audience policy, emergency broadcast, template approval aur send history ka oversight. |
| SEO, redirects, robots aur keywords | Organic traffic | `robots`, site-wide redirect aur critical SEO change ka approval; rollback aur audit. |

## 4. Existing admin panel ko Super Admin ke liye kaise organise karna chahiye

Current panel mein Dashboard, Products, Categories & Brands, Variants, Inventory, Orders, Reviews, Ads, Banners & Promos, Discounts, SEO, Customers & VIPs, Sales, Tax, Fraud Radar, Analytics, Push Broadcaster aur Store Settings already nazar aate hain. Super Admin sidebar ko is structure mein rakhna behtar hoga:

```text
Dashboard
├─ Operations
│  ├─ Orders, refunds aur courier
│  ├─ Products, variants, categories aur inventory
│  ├─ Customers, VIPs aur reviews
│  └─ Fraud Radar
├─ Marketing
│  ├─ Banners, promos aur ads
│  ├─ Discounts aur coupons
│  ├─ Broadcasts
│  └─ SEO Control Center
├─ Finance
│  ├─ Sales aur analytics
│  ├─ Tax/FBR settings
│  └─ Refund approvals aur exports
├─ Team & Access  [NAYA]
│  ├─ Staff users
│  ├─ Roles aur permissions
│  ├─ Active sessions aur MFA
│  └─ Audit log
└─ System  [NAYA]
   ├─ Store settings aur integrations
   ├─ Approval queue
   ├─ Data export / backup status
   └─ Security alerts
```

`Team & Access`, `Approval queue`, `Audit log`, active sessions aur security alerts abhi separate Super Admin modules ke taur par maujood nahi hain. In ko naya banana zaroori hai; yehi Super Admin ko normal Admin se waqai alag banayenge.

## 5. Kaun sa role kya karega?

Ek hi "all-powerful admin" rakhne ke bajaye niche wale roles use karein. Aik staff member ko ek se zyada permission set bhi mil sakta hai, lekin default role minimum access wala hona chahiye.

| Role | Kya kar sakta hai | Kya nahi kar sakta |
| --- | --- | --- |
| **Super Admin** | Staff/roles, all settings, approvals, high-value refunds, tax, security, audit, integrations, emergency rollback. | Apna aakhri Super Admin account delete/suspend nahi kar sakta; secret values plain text mein nahi dekh sakta. |
| **Operations Admin** | Orders, shipment, inventory adjustment, standard refund workflow, customers. | Staff roles, tax, global settings, SEO robots, audit erase nahi kar sakta. |
| **Catalog Manager** | Products, variants, media, categories, brands, normal price/content changes. | High price/discount threshold se upar publish, tax, refunds aur users manage nahi kar sakta. |
| **Marketing Manager** | Banners, promos, ads, coupons, SEO content, broadcasts ka draft. | Site-wide robots/redirect, live high-budget ad aur broad broadcast bina approval publish nahi kar sakta. |
| **Customer Support** | Customer profile view, orders view, review moderation queue, customer communication. | Payment, discount, delivery fee, staff access aur permanent destructive changes nahi kar sakta. |
| **Finance Analyst** | Sales, tax report aur refund reporting dekh/export kar sakta hai. | Refund approve, tax slab edit, orders/status edit ya users manage nahi kar sakta. |
| **Analyst (read-only)** | Dashboard, analytics aur allowed reports. | Koi mutation ya personal-data export nahi kar sakta. |

### Permission identifiers ka suggested set

Backend mein role names par scattered checks ke bajaye permissions rakhein:

```text
staff.view                 staff.manage              roles.manage
catalog.view               catalog.create            catalog.edit
catalog.publish            catalog.delete            inventory.adjust
orders.view                orders.update             orders.cancel
refunds.view               refunds.request           refunds.approve
customers.view             customers.suspend         reviews.moderate
marketing.edit             marketing.publish         ads.approve
discounts.manage           tax.manage                seo.manage
seo.critical_manage        broadcasts.send           analytics.export
fraud.manage               settings.manage           integrations.manage
audit.view                 sessions.revoke           security.manage
```

`delete` permission ko bohat kam logon tak limited rakhein. Product, banner, ad, customer aur category ke liye pehle **archive/soft delete** use karein; permanent delete sirf Super Admin + reason + audit ke saath ho.

## 6. Super Admin dashboard par kya hona chahiye?

Dashboard sirf sales cards ka page na ho. Upar ke hisson mein aik nazar mein action-required cheezen dikhni chahiye:

1. Aaj ke orders, revenue, pending shipment aur low-stock count.
2. Pending refunds, failed payment/refund aur high-risk fraud orders.
3. Expiring/active ads, promos aur coupons.
4. Unpublished product/price/SEO changes jo approval mang rahe hon.
5. New staff invite, suspended account, failed login aur active privileged sessions.
6. Tax/FBR, courier, payment provider aur backup/integration health alerts.
7. Recent sensitive actions: kis ne kya change kiya, kab aur pehle kya value thi.

Har card par "View details" aur permission-aware action hona chahiye. Misal: Finance Analyst refund count dekh sakta hai, lekin "Approve refund" button us ko nazar nahi aana chahiye.

## 7. High-risk actions ke liye approval rules

Har cheez ko approval mein daalna workflow ko slow karega. Sirf high-risk changes par approval lagayen:

| Action | Kaun request kare | Kaun approve kare | Zaroori record |
| --- | --- | --- | --- |
| Product price ko configured threshold se zyada badalna | Catalog/Operations | Super Admin | Old/new price, reason, product ID |
| Discount/coupon ko configured limit se zyada rakhna | Marketing | Super Admin | Audience, budget/limit, expiry |
| Refund ko configured limit se zyada approve karna | Operations/Support | Super Admin | Order, amount, destination hint, reason |
| Tax, delivery fee, payment/courier config change | Finance/Operations | Super Admin | Old/new config, effective date |
| Site-wide `robots` ya bulk redirect change | Marketing | Super Admin | Diff, impact note, rollback point |
| Admin/role creation ya permission change | Super Admin only | Optional second Super Admin for owner-level role | Target user, old/new role, reason |
| Customer-wide push broadcast | Marketing draft | Super Admin | Recipient count, content, schedule |
| Permanent delete / data export | Relevant manager | Super Admin | Scope, legal/business reason, export log |

Approval mein requester aur approver same user nahi hona chahiye. Emergency change ka option ho sakta hai, lekin us mein reason mandatory aur post-action review required ho.

## 8. Staff aur access management screen

Naya **Team & Access** area Super Admin ke liye sab se zaroori page hoga.

### Staff list mein fields

- Naam, email, role(s), account status aur last login.
- MFA enabled/disabled aur active session count.
- Assigned store/domain scope agar future mein multi-store support aaye.
- Recent sensitive action ka short summary.
- Invite pending hai ya accept ho chuka hai.

### Available actions

- Staff invite bhejna; public sign-up se admin kabhi na bane.
- Role/permission grant aur revoke karna.
- Account suspend/restore karna.
- Ek device ya tamam active sessions revoke karna.
- Password reset link bhejna; password khud dekhna ya manually display karna nahi.
- High-risk action ke liye temporary, expiry-based access dena.

### Guard rails

- System mein kam az kam aik active Super Admin lazmi ho.
- Aakhri active Super Admin ko suspend, delete ya demote na kiya ja sake.
- `super_admin` create/transfer par MFA aur current password/re-authentication lazmi ho.
- Role change ke baad JWT/session revoke ho, taake purani permission turant khatam ho.
- Staff ko apni permission khud upgrade karne ka raasta na mile.

## 9. Audit log kaisa hona chahiye?

Har sensitive action ke liye immutable log banayen. Sirf order history ka audit kafi nahi, kyun ke tax, ads, roles, settings aur discounts bhi financial/security impact rakhte hain.

Suggested `audit_logs` fields:

```text
id, actor_user_id, actor_role_snapshot, action, resource_type, resource_id,
old_value_json, new_value_json, reason, approval_id, ip_address,
user_agent, request_id, created_at
```

Audit log mein kam az kam ye events aane chahiye:

- Login success/failure, MFA change, session revoke aur account suspension.
- Staff invite, role/permission change aur Super Admin transfer.
- Product price, inventory, category, variant aur publish state change.
- Coupon/discount, ad budget/schedule aur banner/SEO publish action.
- Tax, delivery fee, store setting, payment/courier integration change.
- Order status, cancellation, refund create/approve/complete aur fraud blacklist action.
- Customer data export, archive ya permanent deletion request.

Audit log ko normal Admin edit ya delete nahi kar sakta. Super Admin ko bhi audit record alter nahi karna chahiye; retention policy alag se documented ho.

## 10. Security standard

1. **No public Super Admin registration:** Initial owner account CLI/environment se provision ho; baqi staff invite se aaye.
2. **MFA mandatory:** Super Admin ke liye authenticator-app based MFA mandatory rakhein. Email OTP sirf recovery fallback ho.
3. **Short privileged session:** Sensitive action se pehle re-authenticate karein; long inactive session automatically expire ho.
4. **Session control:** Device, IP, last activity aur revoke-all option dikhayen.
5. **Least privilege:** Sidebar hide karna sirf UX hai; asli permission backend API middleware mein enforce ho.
6. **Secrets safe:** Payment, courier aur social credentials encrypted/config secret store mein hon. UI kabhi full secret dobara show na kare.
7. **Rate limits aur alerts:** Repeated login failure, privilege escalation attempt aur unusual export par alert aaye.
8. **Privacy:** Customer phone, address aur payment destination sirf zarurat wali roles ko dikhayen; exports ko audit karein.

## 11. Technical design aur current code mein zaroori tabdeeliyan

### Phase 1 — Super Admin ko safe tareeqe se introduce karna

1. `users.role` ko `super_admin`, `admin`, `customer` support dene ke liye migrate karein.
2. JWT mein role ke saath permission/version ya token invalidation strategy rakhein.
3. Existing `requireRole` ko sirf fixed `admin/customer` list tak limited na rakhein.
4. `requireAdmin` ko business action ke hisaab se `requirePermission(...)` mein convert karein. Jahan normal Admin allowed ho, Super Admin inherited allow ho.
5. Frontend ke `User` type, login state, `adminGuard`, role labels aur sidebar ko update karein.
6. Socket.IO admin room aur order access mein Super Admin compatibility add karein.
7. Existing admin-provision endpoint ko Super Admin-only banayen.

### Phase 2 — Proper RBAC data model

Role ko sirf enum mein barhane ke bajaye ye tables rakhein:

```text
roles                 (id, code, name, is_system, description)
permissions           (id, code, module, description)
role_permissions      (role_id, permission_id)
user_roles            (user_id, role_id, assigned_by, assigned_at, expires_at)
audit_logs            (sensitive action trail)
approval_requests     (action payload, requester, approver, status, expiry)
admin_sessions        (device/session revocation and security visibility)
```

`users.role` transition ke dauran backward compatibility ke liye reh sakta hai, lekin final authorization ka source `user_roles + role_permissions` hona chahiye. Is se future mein roles add karne ke liye baar baar schema enum aur hard-coded checks change nahi karne padenge.

### Phase 3 — API aur UI

Suggested Super Admin APIs:

```text
GET    /api/v1/super-admin/staff
POST   /api/v1/super-admin/staff/invites
PATCH  /api/v1/super-admin/staff/:id/roles
PATCH  /api/v1/super-admin/staff/:id/status
POST   /api/v1/super-admin/staff/:id/sessions/revoke
GET    /api/v1/super-admin/roles
PUT    /api/v1/super-admin/roles/:id/permissions
GET    /api/v1/super-admin/audit-logs
GET    /api/v1/super-admin/approvals
POST   /api/v1/super-admin/approvals/:id/approve
POST   /api/v1/super-admin/approvals/:id/reject
GET    /api/v1/super-admin/security/overview
```

Response se extra personal data ya secret fields na bhejein. List APIs mein pagination, filters aur date range zaroor dein.

## 12. Suggested implementation order

1. **Foundation:** Migration, Super Admin bootstrap account, permission middleware aur automated tests.
2. **Safety:** Session invalidation, MFA, audit log aur Super Admin-only staff provisioning.
3. **UI:** Team & Access, role editor, audit viewer aur permission-based sidebar/actions.
4. **Business controls:** Approval queue for refund, price, discounts, tax, SEO-critical aur broadcast actions.
5. **Operations hardening:** Export controls, alerts, emergency rollback aur integration health view.

Is order ka faida ye hai ke pehle backend security aa jati hai; sirf frontend mein button hide karke false security nahi banti.

## 13. Launch se pehle checklist

- [ ] Public registration kabhi `admin` ya `super_admin` role assign nahi karti.
- [ ] At least aik active Super Admin hamesha bachta hai.
- [ ] Super Admin MFA ke baghair login/action complete nahi kar sakta.
- [ ] Permission har protected API par backend se verify hoti hai.
- [ ] Frontend route, sidebar aur buttons permissions ke mutabiq visible hain.
- [ ] Role change, suspend aur session revoke turant effective hote hain.
- [ ] Har sensitive change audit log mein old/new value aur actor ke saath save hota hai.
- [ ] High-risk refunds, discount, tax, SEO critical aur broad broadcast approval workflow se guzarte hain.
- [ ] Secrets logs, API response aur UI mein mask/encrypted rehte hain.
- [ ] Super Admin, normal Admin aur Customer ke negative-access automated tests maujood hain.
- [ ] Backup/restore aur emergency rollback ka tested process documented hai.

## 14. Code references (current basis)

- Frontend routes aur protected admin shell: [`app.routes.ts`](../../u-know-multi-mart/src/app/app.routes.ts)
- Current admin navigation/modules: [`admin-sidebar.component.ts`](../../u-know-multi-mart/src/app/components/admin/admin-sidebar/admin-sidebar.component.ts)
- Current frontend admin route guard: [`admin.guard.ts`](../../u-know-multi-mart/src/app/guards/admin.guard.ts)
- Current role type/login handling: [`store.service.ts`](../../u-know-multi-mart/src/app/services/store.service.ts)
- Current roles schema: [`schema.sql`](../sql/schema.sql)
- Current authentication and role middleware: [`auth.middleware.js`](../src/middlewares/auth.middleware.js)
- Current admin provisioning route: [`auth.routes.js`](../src/routes/auth.routes.js)
- Current feature coverage inventory: [`feature-coverage.md`](./feature-coverage.md)

## Final recommendation

Is project ke liye best Super Admin woh hoga jo **har cheez khud karne wala admin** nahi, balkay **team access, approvals, finance/security settings aur audit ka accountable owner** ho. Current admin panel ki existing business modules ko retain rakhein, un ko role-based banayen, aur Super Admin ke liye `Team & Access`, `Audit Log`, `Approval Queue` aur `Security/System` modules add karein. Is se system scalable, safe aur future staff hiring ke liye ready ho jayega.
