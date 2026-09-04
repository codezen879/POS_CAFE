# POS Cafe — QA Test Case Suite

Comprehensive functional, UI, UX, and security test cases for the POS Cafe webapp.

- App: Next.js 15 + Prisma/MySQL, NextAuth v5
- Env: Dev server `http://localhost:3000`, prod build on Vercel
- Test accounts (dev seed):
  - `admin@poscafe.example / admin123` — PIN `1234` — SUPER_ADMIN
  - `cashier@poscafe.example / staff123` — PIN `5678` — CASHIER
  - `kitchen@poscafe.example / staff123` — PIN `1111` — KITCHEN

**Roles matrix** (walkman): Admin = SUPER_ADMIN/ADMIN, Mgr = MANAGER, Cash = CASHIER, Kit = KITCHEN, Pub = public/unauthenticated.

---

## TL;DR — Priority Checklist

| Area | Priority items |
|------|----------------|
| Auth | Login PIN & password, invalid creds, disabled user, session persistence, logout, route guards |
| Roles | 403 on manager APIs for cashier/kitchen, hidden nav & buttons |
| POS loop | Open → order → KDS → bill → pay → close → loyalty → review |
| Billing | Tax split (CGST/SGST), discounts, service charge, split payment, rounding |
| Inventory | Stock IN/OUT, low-stock alerts, decrement on order |
| Tables/Floors | CRUD, delete guards, duplicate names, seats sync |
| Menu | CRUD categories/products, add-ons, veg/non-veg, slugs |
| Reports | 30-day revenue, GST summary, top items, charts |
| Public `/m` | No-auth menu, QR |
| Security | Access control, input validation, no data leak |

---

# SECTION 1 — AUTHENTICATION & SESSION

### AUTH-001 Login — PIN (valid)
**Priority:** High
**Steps:** Load `/login` → enter `admin@poscafe.example` + PIN `1234` → submit.
**Expected:** Redirect to `/`; success toast "Welcome back!"; sidebar shows admin name/role SUPER_ADMIN.
**Pass/Fail/Notes:**

### AUTH-002 Login — Password (valid)
**Steps:** Toggle to Password mode → `admin@poscafe.example` + `admin123`.
**Expected:** Successful login to dashboard.

### AUTH-003 Login — wrong PIN / wrong password
**Steps:** Submit invalid PIN or wrong password (hash-scenario).
**Expected:** No login, stays on page, error toast "Invalid credentials". No detail leak (no "user not found").

### AUTH-004 Login — inactive (disabled) user
**Steps:** Deactivate a staff user (staff page) → attempt login with that user.
**Expected:** Login rejected ("Invalid credentials"); cannot reach app.

### AUTH-005 Login — empty fields / whitespace
**Steps:** Leave both fields blank and submit (form `required`), then only-whitespace values.
**Expected:** Native validation blocks submit; whitespace-only not accepted.

### AUTH-006 Session persistence
**Steps:** Login → reload page → navigate across routes.
**Expected:** Session retained (JWT cookie); no bounce to login on refresh.
**Notes:** Negative control: clear cookies → redirected to `/login`.

### AUTH-007 Logout
**Steps:** Click sign out in sidebar.
**Expected:** Redirect to `/login`; back button does not restore app; `/` now redirects to login.

### AUTH-008 Already-logged-in visits /login
**Steps:** With active session, visit `/login`.
**Expected:** Redirected to `/` (auth layout guard).

### AUTH-009 Unauthenticated hits protected route
**Steps:** No session → open `/tables`, `/menu`, `/settings`, `/kitchen`.
**Expected:** All redirect to `/login`.

---

# SECTION 2 — ROLES, PERMISSIONS & ACCESS CONTROL

### SEC-001 Nav visibility by role
**Steps:** Log in as Admin / Cashier / Kitchen and inspect sidebar.
**Expected:**
- Admin: sees Menu, Inventory, Staff, Reports, Settings (manager items).
- Cashier: does NOT see Menu, Inventory, Staff, Reports, Settings.
- Kitchen: does NOT see manager items (Menus/Inventory/Staff/Reports/Settings).
**Pass/Fail/Notes:**

### SEC-002 Manager page direct-URL access by non-manager
**Steps:** As Cashier, type `/menu`, `/inventory`, `/staff`, `/settings`, `/reports` directly.
**Expected:** Page renders "You don't have permission"/"Only managers can edit settings" or hides functionality; manager role APIs return 403. No data mutation possible.

### SEC-003 Manager API 403 for non-manager
**Steps:** As Cashier (and Kitchen), call:
`POST /api/products`, `POST /api/tables`, `POST /api/floors`, `POST /api/staff`, `PATCH /api/settings`, `POST /api/stock`.
**Expected:** `403` with error JSON; no record created.

### SEC-004 "Manage" buttons hidden for non-manager
**Steps:** As Cashier open `/tables` and `/inventory`.
**Expected:** No "Manage" (tables) button, no "Adjust" (inventory) button.

### SEC-005 Role required for Settings (admin-only)
**Steps:** Login as MANAGER → try `/settings`; login as CASHIER → try `/settings`.
**Expected:** MANAGER blocked from editing settings (API 403); CASHIER blocked. Only SUPER_ADMIN/ADMIN can save settings.

### SEC-006 Unprotected endpoints — data exposure review
**Steps:** Without login fetch `GET /api/menu/categories`, `GET /api/pos/kitchen/orders`, `GET /api/pos/sessions/{id}/bill-detailed`.
**Expected:** menu categories is intended-public; kitchen orders & bill-detailed currently unprotected — **flag**: confirm acceptable or add guards. Note in bug list.

---

# SECTION 3 — TABLE & FLOOR MANAGEMENT

### TBL-001 Open table
**Steps:** Tables page → click an AVAILABLE table → select guest count → Open.
**Expected:** Session created (`TAB-xxxx`), toast "Table opened", table tile becomes OCCUPIED.

### TBL-002 Open table — walk-in (no customer)
**Steps:** Choose "Walk-in", open table.
**Expected:** Session links to no customer; bill/loyalty handled gracefully (no loyalty for null customer).

### TBL-003 Open table — existing customer
**Steps:** Choose "Existing", pick a customer, open.
**Expected:** Session linked to that customer; loyalty eligible.

### TBL-004 Open table — new customer
**Steps:** Choose "New", enter name + phone → open. Then same phone again.
**Expected:** 1st opens (customer created); 2nd reuses existing customer. Phone-required validation fires if missing (toast).

### TBL-005 Invalid guest count
**Steps:** Attempt guestCount 0 / negative / non-numeric.
**Expected:** Rejected (min bound); not 0 seats.

### TBL-006 Add table (manager)
**Steps:** Manage → Add table → name `T5`, floor, seats 4 → Save.
**Expected:** Appears in grid; `seatCount=4`; seat rows created (4). Toast "Table added".

### TBL-007 Add table — duplicate name
**Steps:** Add a table with a name that already exists (e.g. create `T5` twice).
**Expected:** `409` "already exists"; no duplicate; friendlier UI toast if surfaced.

### TBL-008 Add table — empty name
**Steps:** Click Save with blank name.
**Expected:** Toast "Table name required"; nothing created.

### TBL-009 Edit table
**Steps:** Manage → ✏️ on a table → rename + change seats up/down → Save.
**Expected:** Name updates; seats sync (upsert rows); occupied table shrink-guard tested below.

### TBL-010 Shrink seats while occupied
**Steps:** Table with an OPEN session → edit seats down.
**Expected:** Cannot drop below seats used (guard) OR seats retained but label updated — verify no orphan/overlap seat numbers and no data corruption.

### TBL-011 Delete table (empty)
**Steps:** Delete a table with no open session.
**Expected:** Confirm dialog; on confirm removed; toast "Table deleted".

### TBL-012 Delete occupied table
**Steps:** Delete a table with an OPEN session.
**Expected:** Refused with error ("Cannot delete an occupied table. Close its session first."); table remains.

### TBL-013 Add floor
**Steps:** Manage → add floor name → Add.
**Expected:** Floor appears in list; assignable to a table.

### TBL-014 Rename floor
**Steps:** ✏️ on a floor → new name → Rename.
**Expected:** Name updates app-wide (tables assigned to it show new name).

### TBL-015 Delete empty floor
**Steps:** Delete a floor with no tables.
**Expected:** Removed.

### TBL-016 Delete floor with tables
**Steps:** Delete a floor that has tables assigned.
**Expected:** Refused ("N table(s) are assigned… move them first."); floor persists.

### TBL-017 Duplicate floor name
**Steps:** Create two floors with the same name.
**Expected:** Decision: allowed or rejected — confirm no confusing duplicates.

### TBL-018 Dynamic floors
**Steps:** Create multiple floors; assign tables to each; verify number of floors is fully user-controlled (no hardcoded cap).
**Expected:** Unlimited floors via CRUD; all appear.

---

# SECTION 4 — ORDER PLACEMENT & TERMINAL

### ORD-001 Browse menu & add item
**Steps:** Open OCCUPIED table → terminal → click a product (no add-ons).
**Expected:** Item appears in cart with qty 1; subtotal updates.

### ORD-002 Add-on picker
**Steps:** Click a product WITH add-ons.
**Expected:** Add-on overlay appears; add-ons with +/- qty; adds to cart correctly with add-on totals.

### ORD-003 Cart operations
**Steps:** Add items → change quantity (+/-) → remove item (`trash`).
**Expected:** Subtotal recalculates; removed item leaves cart.

### ORD-004 Cart dedup
**Steps:** Add same product with same note twice.
**Expected:** Quantity merges to one line (not two identical lines). Different notes → separate lines.

### ORD-005 Send to kitchen — empty cart
**Steps:** Click "Send to kitchen" with empty cart.
**Expected:** Button disabled (no action).

### ORD-006 Send to kitchen — non-empty
**Steps:** Add items → "Send to kitchen".
**Expected:** `POST /api/pos/sessions/[id]/order`; order status `SENT_TO_KITCHEN`; toast "Order sent to kitchen"; cart clears; session shows order.

### ORD-007 Multiple orders per session
**Steps:** Send order #1, then add more items → send order #2.
**Expected:** Two separate orders under same session; order history count increments.

### ORD-008 Order numbers sequential
**Steps:** Create two orders.
**Expected:** Unique sequential `orderNumber` values; no duplication/collision.

---

# SECTION 5 — KITCHEN DISPLAY (KDS)

### KDS-001 KDS board loads orders
**Steps:** Kitchen page with active orders.
**Expected:** Columns New/Preparing/Ready/Serving; cards show order#, table, items, qty, add-ons, notes (red italic).

### KDS-002 Auto-refresh
**Steps:** Open kitchen board; place an order from another tab.
**Expected:** New order appears within ~8s without manual refresh.

### KDS-003 Advance status — start / ready / served
**Steps:** Kitchen clicks Start prepping → Mark ready → Mark served.
**Expected:** Order moves columns; timestamps `prepStartedAt`, `readyAt`, `servedAt` set (verify in DB if possible).

### KDS-004 Order serving / split serving
**Steps:** Advance a large order to PARTIALLY_SERVED.
**Expected:** Moves to Serving column; final "Mark served" after all served.

### KDS-005 Kitchen advance beyond valid status
**Steps:** Attempt invalid transitions (e.g. SERVED→READY, compensate, cancel twice) via API.
**Expected:** Rejected/guarded; no impossible state.

---

# SECTION 6 — BILLING, TAX & PAYMENT

### BIL-001 Generate bill
**Steps:** With items sent → Bill tab → "Generate bill".
**Expected:** Bill issued; shows subtotal, tax breakdown (CGST+SGST), service charge, total; toast "Bill generated".

### BIL-002 Tax split (CGST/SGST)
**Steps:** Order items taxed at a rate (e.g. 18%).
**Expected:** Ex tax item contributes CGST 9% + SGST 9% (half each); per-tax-rate lines correct. Validate math (e.g. ₹100 → CGST ₹9 + SGST ₹9).

### BIL-003 Multiple tax rates on one bill
**Steps:** Order one 18% and one 5% item.
**Expected:** Two separate tax breakdown groups sum correctly; total = items + all GST − discount + service charge.

### BIL-004 Flat (FIXED) discount
**Steps:** Discount type Flat, value ₹10.
**Expected:** Subtotal minus discount on taxable base; discount recorded; tax computed on discounted base (verify).

### BIL-005 Percentage discount
**Steps:** Discount type Percentage, e.g. 10%.
**Expected:** Discount = 10% of base; correct rounding; tax on discounted base.

### BIL-006 Discount greater than subtotal
**Steps:** Flat discount > subtotal.
**Expected:** Discount capped (never negative total / negative tax base); client & server handle gracefully.

### BIL-007 Zero-cents / currency rounding
**Steps:** Items with decimals → totals.
**Expected:** Consistent 2-decimal rounding on subtotal, tax, service charge, total across UI and stored bill (no 0.999999).

### BIL-008 Service charge applied
**Steps:** Set `service_charge_percent` > 0 (settings) → regenerate bill.
**Expected:** Service charge computed on pre-discount subtotal and added to total.

### BIL-009 Regenerate bill
**Steps:** Generate bill, add an item, generate again.
**Expected:** Old ISSUED bill replaced/updated (upsert) — no orphan duplicate bills; totals reflect new items.

### BIL-010 Pay full — Cash
**Steps:** Select method Cash, amount = due → Receive.
**Expected:** Payment COMPLETED; bill PAID; session CLOSED; table AVAILABLE; toast "Payment complete".

### BIL-011 Pay — UPI / Card
**Steps:** Repeat #BIL-010 for UPI and Card methods (and any split).
**Expected:** Each recorded with correct method + optional transaction id (if supported).

### BIL-012 Split payment
**Steps:** Pay part of bill (Cash), then remainder (UPI).
**Expected:** Msg "Payment received" (partial); due updates; after remainder settled → bill PAID, session closed, table freed. Payments total = bill total.

### BIL-013 Overpay / amount > due
**Steps:** Enter amount > due.
**Expected:** Blocked (button disabled / validation); no negative due.

### BIL-014 Payment amount zero / negative
**Steps:** Enter 0 or negative.
**Expected:** Rejected; no zero-amount completed payment.

### BIL-015 Loyalty points earned on settle
**Steps:** Pay a bill for a linked customer for e.g. ₹826.
**Expected:** `EARN` LoyaltyTransaction for `Math.floor(total)` (826) pts; balance updated; shown in customer loyalty history.

### BIL-016 No loyalty for walk-in
**Steps:** Full-pay a session with no customer.
**Expected:** No loyalty txn; no crash (null-customer guard).

### BIL-017 Redeem loyalty points
**Steps:** RedeemDialog → phone lookup → redeem e.g. 300 pts.
**Expected:** Flat discount ₹3 applied; `REDEEM` txn; balance reduced by 300. Validate 100 pts = ₹1 exactly.

### BIL-018 Redeem more points than balance
**Steps:** Enter points > available balance.
**Expected:** Blocked server-side; friendly error; no negative balance.

### BIL-019 Bill with nothing to charge (empty/cancelled items)
**Steps:** Open session with only cancelled/draft orders → generate bill.
**Expected:** Bill reflects zero/valid subtotal; no crash; shows clean empty state.

---

# SECTION 7 — RECEIPT & REVIEW

### RCT-001 Receipt contents
**Steps:** After settle → Receipt.
**Expected:** Shows store header (name, address, GSTIN, phone), bill/session/table/customer, itemized lines with add-ons, financial summary, thank-you message.

### RCT-002 Print receipt
**Steps:** Click "Print receipt" (window.print).
**Expected:** Print dialog opens; `@media print` shows only `#receipt-print` at 80mm width; no app chrome printed.

### RCT-003 Review dialog
**Steps:** After settle → "This table left a review?" → select stars + comment → submit.
**Expected:** `POST /api/reviews` returns 201; toast "Thanks for the review!".

### RCT-004 Review — no rating
**Steps:** Submit review without selecting stars.
**Expected:** Toast "Pick a rating"; not saved.

### RCT-005 Review — rating range
**Steps:** Submit star value outside 1–5 (via API).
**Expected:** Rejected (server validates 1–5).

---

# SECTION 8 — DASHBOARD

### DSH-001 Dashboard loads key widgets
**Steps:** Log in → `/`.
**Expected:** Today's revenue, bills count, open sessions, active kitchen orders, table overview, low-stock alerts, recent orders visible.

### DSH-002 Revenue matches bills
**Steps:** Compare dashboard "today's revenue" with a just-settled bill total.
**Expected:** Matches (within same day); totals are consistent not cached-stale.

### DSH-003 Weekly revenue chart
**Steps:** View the weekly chart.
**Expected:** Renders without error; axes/labels readable; reflects settled amounts.

### DSH-004 Low-stock alert aligns with inventory
**Steps:** Set an ingredient below its threshold → check dashboard.
**Expected:** Low-stock alert appears for that ingredient.

### DSH-005 Empty state
**Steps:** Fresh DB with no transactions.
**Expected:** Dashboard shows zeros/empty states cleanly, no errors.

---

# SECTION 9 — MENU MANAGEMENT

### MEN-001 Create category
**Steps:** Menu → Add category → name + emoji icon.
**Expected:** Category appears; auto slug generated (URL-safe, unique). Toast "Category added".

### MEN-002 Create product
**Steps:** Add product: name, category, base price, tax rate, veg/non-veg, prep time, bestseller toggle.
**Expected:** Product appears in terminal + public menu; toast "Product created".

### MEN-003 Product — missing required fields
**Steps:** Save without name/category/price.
**Expected:** Toast "Name, category and price required"; not created.

### MEN-004 Add-ons on product
**Steps:** Configure add-ons (e.g. "Extra cheese") on a product.
**Expected:** Add-on appears in terminal picker; price added to line when selected.

### MEN-005 Edit product
**Steps:** Edit name/price/category.
**Expected:** Updates everywhere (terminal, public menu, existing cart unaffected/bill computed correctly).

### MEN-006 Delete product
**Steps:** Delete a product.
**Expected:** Confirm; removed from menu; products with active inventory/billing handled without FK error.

### MEN-007 Price rules
**Steps:** Set price 0 or negative.
**Expected:** Validated (no negative/free-by-accident pricing).

### MEN-008 Veg / non-veg indicator
**Steps:** Toggle isVeg on a product.
**Expected:** Green (veg) dot / red (non-veg) dot shown consistently in terminal & public menu & receipts.

---

# SECTION 10 — INVENTORY

### INV-001 Adjust stock IN
**Steps:** Inventory → Adjust → type IN → quantity → note.
**Expected:** StockMovement PURCHASE/IN recorded; ingredient stock increases; toast "Stock updated".

### INV-002 Adjust stock OUT
**Steps:** Adjust → OUT → quantity.
**Expected:** Consumption/adjustment recorded; stock decreases; cannot go below 0 (guard).

### INV-003 Out-of-stock / below-zero
**Steps:** Attempt OUT beyond current stock.
**Expected:** Rejected or clamped to 0; no negative stock.

### INV-004 Quantity validation
**Steps:** Enter non-numeric / 0.
**Expected:** Toast "Enter a quantity"; no movement.

### INV-005 Stock decrement on order (if auto-deduct enabled)
**Steps:** Place an order for an item linked to inventory.
**Expected:** Ingredient stock decremented by recipe/consumption (or documented as manual-only). Verify documented behavior.

### INV-006 Zero-qty order handling
**Steps:** Order item whose ingredient has 0 stock.
**Expected:** Defined behavior (block vs allow); consistent message.

### INV-007 Supplier list
**Steps:** Inventory → view suppliers.
**Expected:** Suppliers listed/readable; manage if supported.

---

# SECTION 11 — STAFF

### STF-001 Add staff
**Steps:** Staff → Add staff → name, email, password, role.
**Expected:** User created; auto 4-digit PIN generated and shown in CreatedPinDialog. Toast "Staff added".

### STF-002 Add staff — missing fields
**Steps:** Save without name/email/password.
**Expected:** Toast "Name, email and password required"; not created.

### STF-003 Duplicate email
**Steps:** Add staff with an existing email.
**Expected:** Rejected (unique) with clear message.

### STF-004 Deactivate staff
**Steps:** Toggle isActive off for a user.
**Expected:** Toggle reflects; that user cannot log in (AUTH-004); their existing session invalidated on next check.

### STF-005 Reactivate staff
**Steps:** Toggle back on.
**Expected:** Can log in again.

### STF-006 PIN generation uniqueness/length
**Steps:** Create several staff.
**Expected:** Each PIN 4-digit; PIN requirement (login) works (SEC-007 / AUTH-001).

### STF-007 Role update
**Steps:** Change a user's role (e.g. CASHIER → MANAGER).
**Expected:** Permissions update accordingly (nav + API guards) after reload.

---

# SECTION 12 — REPORTS

### REP-001 30-day revenue chart
**Steps:** Reports page.
**Expected:** Revenue line over last 30 days renders; matches settled bills.

### REP-002 GST summary
**Steps:** View GST summary.
**Expected:** CGST + SGST totals per rate, consistent with bills.

### REP-003 Top selling items
**Steps:** View top items.
**Expected:** Ranked by qty/sales; correct ordering.

### REP-004 Category breakdown
**Steps:** View category breakdown.
**Expected:** Sales by category totals correct (sums to revenue).

### REP-005 Loyalty earned in reports
**Steps:** View loyalty metric.
**Expected:** Reflects EARN (net of REDEEM or gross as designed) totals.

### REP-006 Date/range correctness
**Steps:** Review boundaries (today vs yesterday).
**Expected:** Data bucketed to correct day; no off-by-one.

---

# SECTION 13 — SETTINGS

### SET-001 Store details
**Steps:** Settings → edit store name/address/GSTIN/phone → save.
**Expected:** Persisted; appears on receipt header. Toast "Store updated".

### SET-002 Tax rates
**Steps:** Add/edit a tax rate (code, name, rate).
**Expected:** New rate usable in product tax selection; appears on bills.

### SET-003 Service charge %
**Steps:** Set service_charge_percent.
**Expected:** Applied to new bills (BIL-008).

### SET-004 Loyalty points per rupee
**Steps:** Set loyalty_points_per_rupee.
**Expected:** Changes EARN calculation accordingly (verify math).

### SET-005 Settings — non-manager
**Steps:** Login as CASHIER/MANAGER → settings.
**Expected:** CASHIER can't edit (guard). MANAGER can view but not save (API 403); only Admin saves.

### SET-006 Validation of numeric settings
**Steps:** Enter negative / non-numeric service charge or loyalty rate.
**Expected:** Rejected or sanitized; no NaN persisted.

---

# SECTION 14 — ORDERS & BILLING LISTS

### LST-001 Orders filter tabs
**Steps:** Orders page → each status tab (ALL, DRAFT, SENT_TO_KITCHEN, PREPARING, READY, PARTIALLY_SERVED, SERVED, CANCELLED).
**Expected:** List filters to correct status; URL `?status=` reflects selection.

### LST-002 Billing history
**Steps:** Billing page.
**Expected:** Shows recent bills, statuses (ISSUED/PAID), and collected amounts consistent with payments.

### LST-003 Empty states
**Steps:** No orders/bills.
**Expected:** Clean empty message, no errors.

---

# SECTION 15 — CUSTOMERS & LOYALTY

### CUS-001 Customer list
**Steps:** Customers page.
**Expected:** Cards with tier badges, phone, loyalty points.

### CUS-002 Find/create by phone
**Steps:** Lookup a phone → nonexistent.
**Expected:** Graceful "not found" with create option; create dedupes (no duplicate same phone).

### CUS-003 Create via POS new-customer
**Steps:** Open-table "New" path.
**Expected:** Customer created with valid phone; appears in Customers list.

### CUS-004 Loyalty transaction history
**Steps:** Open a customer → history.
**Expected:** EARN on orders, REDEEM on redemptions shown with correct deltas.

### CUS-005 Reviews listing
**Steps:** Customer detail → reviews.
**Expected:** Submitted reviews appear with rating/comment.

### CUS-006 Customer with no orders
**Steps:** Customer created but never ordered.
**Expected:** Renders with 0 points; no crash.

---

# SECTION 16 — PUBLIC DIGITAL MENU (`/m`) & QR

### PUB-001 Public menu no auth
**Steps:** Open `/m` logged-out (incognito).
**Expected:** Loads; shows categories + products; no login forced.

### PUB-002 QR code
**Steps:** Tables → Menu QR dialog.
**Expected:** QRCodSVG renders the `/m` URL; scanning opens public menu on phone.

### PUB-003 Mobile responsive
**Steps:** Open `/m` at 375px width.
**Expected:** No horizontal scroll; legible; tap targets usable.

### PUB-004 Add-ons on public menu
**Steps:** Inspect a product with add-ons.
**Expected:** Add-ons shown with prices (read-only display).

---

# SECTION 17 — UI CONSISTENCY & RESPONSIVENESS

### UI-001 Layout no overflow
**Steps:** Resize from 360px → 1920px across key pages (login, tables, terminal, dashboard, reports).
**Expected:** No horizontal scrollbar; content reflows; dialogs fit viewport.

### UI-002 Touch friendliness
**Steps:** Mobile widths; tap all primary buttons.
**Expected:** Targets ≥ 40px; no accidental misclick.

### UI-003 Dialog mobile fit
**Steps:** Open each dialog at 375px (TableTerminal, Manage, Menu, Staff, Redeem, Review, Receipt).
**Expected:** Content scrolls within dialog; buttons reachable (max-h + overflow applied).

### UI-004 Dark mode
**Steps:** Toggle theme (next-themes) → revisit all pages.
**Expected:** No unreadable contrast; toast/dialog readable in dark & light.

### UI-005 Input/dropdown solid fill
**Steps:** View any form input and select dropdown (e.g. table edit).
**Expected:** Fields have a solid, visible background (not transparent/blending into dialog). **Regression link: recent fix.**

### UI-006 Status color coding
**Steps:** Check table tiles and badges for AVAILABLE/OCCUPIED/RESERVED/CLEANING/CLOSED, and order statuses.
**Expected:** Distinct, consistent colors; occupied count header accurate.

### UI-007 Loading & disabled states
**Steps:** Trigger async actions (open, send, pay, save).
**Expected:** Button becomes loading/disabled; no duplicate submissions on double-click.

### UI-008 Toasts visible & non-blocking
**Steps:** Trigger a success and an error toast.
**Expected:** Shown top-center, clear message, auto-dismiss (~3s), dismissible.

### UI-009 Empty / no-data states
**Steps:** Visit pages with no data (fresh DB).
**Expected:** Graceful empty messages; no blank screens or errors.

---

# SECTION 18 — UX & EDGE CASES

### UX-001 Keyboard navigation
**Steps:** Login then tab through the POS terminal.
**Expected:** Focusable controls reachable; Enter submits login; numeric inputs react.

### UX-002 Confirm prompts before destructive actions
**Steps:** Delete table / floor / product.
**Expected:** Confirmation dialog always precedes destruction (no accidental deletes).

### UX-003 Feedback on long actions
**Steps:** Trigger slow network request (throttle devtools) on order/pay.
**Expected:** Spinner/disabled; no dead-feeling UI.

### UX-004 Recovery after API error
**Steps:** Force an API failure (e.g. DB down / seeded 500) during open-order.
**Expected:** Error toast; app remains usable; no stuck modal.

### UX-005 Double-click open table
**Steps:** Rapidly double-click an AVAILABLE table.
**Expected:** Only one session created (no duplicates).

### UX-006 Concurrent role session race
**Steps:** Same user logged in admin + cashier flows simultaneously.
**Expected:** No shared-state corruption; per-request auth consistent.

### UX-007 Special characters in names/notes/comment
**Steps:** Enter name with `<script>`, quotes, emoji, long text.
**Expected:** Rendered as text (no XSS); stored safely; no layout break / overflow.

### UX-008 Very long item notes
**Steps:** Add a long special note to an order.
**Expected:** Truncates/wraps in KDS; no layout explosion.

### UX-009 Currency display format
**Steps:** Check totals, bills, receipts, reports.
**Expected:** Consistent ₹ / 2-decimal formatting throughout.

### UX-010 Browser back/forward
**Steps:** Navigate tables→terminal→kitchen then use back.
**Expected:** Correct page state; no stale cart in a different table.

---

# SECTION 19 — DATA INTEGRITY, PERFORMANCE & SECURITY

### SEC-007 Stored password hashing
**Steps:** Inspect DB user rows.
**Expected:** `passwordHash` and `pin` are bcrypt hashes (not plaintext) — never returned in API responses.

### SEC-008 PIN length/strength
**Steps:** Attempt login with a PIN not matching regex (e.g. <4 digits, >6).
**Expected:** Rejected cleanly; no crash.

### SEC-009 SQL injection attempt
**Steps:** Enter `' OR '1'='1` in email/phone/login fields.
**Expected:** Treated as literal; no bypass; Prisma parameterized.

### SEC-010 API payload validation
**Steps:** Send malformed JSON / oversized payloads to POST endpoints.
**Expected:** Graceful 4xx error / no crash; no partial writes.

### SEC-011 Rate limiting / brute force (recommend)
**Steps:** Attempt many failed logins rapidly.
**Expected:** (If implemented) throttling or lockout; otherwise documented risk in bug list.

### PRF-001 First-load bundle
**Steps:** Measure dashboard `First Load JS` dev/prod.
**Expected:** Reasonable; no giant blocking bundle; pages lazy-loaded (Next dynamic routes).

### PRF-002 Kithen poll
**Steps:** Observe KDS 8s polling.
**Expected:** Lightweight; no throttling errors; no memory leak across long sessions.

### PRF-003 Reports on large data
**Steps:** Reports page with many bills/orders.
**Expected:** Reasonable render time; aggregates computed server-side without heavy client work.

---

# SECTION 20 — DEPLOYMENT (Vercel + MySQL)

### DEP-001 Production build
**Steps:** `npm run build`.
**Expected:** Compiles with 0 TypeScript errors; all routes present (incl. `/api/tables`, `/api/floors`, `/m`).

### DEP-002 Managed MySQL connectivity
**Steps:** Point `DATABASE_URL` to managed MySQL → `prisma migrate deploy` + `prisma db seed`.
**Expected:** Schema applied; seed data present; app connects.

### DEP-003 Env vars
**Steps:** Verify `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL` set in Vercel.
**Expected:** Auth works in prod (stable AUTH_SECRET so sessions survive redeploy).

### DEP-004 Public `/m` on prod
**Steps:** Deploy → open `/m`.
**Expected:** Serves without auth; QR points to prod URL.

### DEP-005 Persisted data across redeploys
**Steps:** Make an order, redeploy, reload.
**Expected:** Data persists (external DB), not wiped.

---

# Bug / Risk Log (filled during execution)

## Defects fixed in this QA pass

| ID | Severity | Area | Title | Fix |
|----|----------|------|-------|-----|
| BUG-001 | Med | Security | `GET /api/pos/kitchen/orders`, `GET /api/pos/sessions/[id]/bill-detailed` have **no auth guard** | **OPEN/RISK** — confirm intended (KDS needs per-request auth). `menu/categories` is intentionally public (`/m`). |
| BUG-002 | High | Settings | `PATCH /api/settings` accepted & stored `-5`, `abc`, `150` for `service_charge_percent` → would corrupt billing (`NaN` total on `abc`) | **FIXED** in `api/settings/route.ts`: rejects negative/non-numeric and clamps >100 (and loyalty rate ≤1000). Plus defensive guard in `bill/route.ts` (invalid stored value → 0). |
| BUG-003 | Med | Floors | Duplicate floor names allowed (no uniqueness) → confusing floor list | **FIXED** in `api/floors/route.ts` & `[id]/route.ts`: create/rename to an existing name → `409`. |
| BUG-004 | High | Ordering/Security | `POST /api/pos/sessions/[id]/order` trusted client-supplied `name`/`unitPrice` → price tampering possible | **FIXED** in `order/route.ts`: hydrates `name`/`unitPrice` from the product record server-side; rejects unknown product. |

## Execution result

- **55/55 functional assertions PASS** (0 failures) on the live dev server covering: AUTH, SEC role matrix (7 manager endpoints × cashier+kitchen → 403), TABLES/FLOORS CRUD + guards, DATA CRUD (categories/products/staff/loyalty), and full POS loop (open → order → KDS advance → bill CGST/SGST → discount → split pay → session close → loyalty 837 pts → overpay blocked).
- Verified after-fix: negative/`abc`/`>100` service charge → 400; duplicate floor create/rename → 409; tampered order price → real product price stored.
- `npm run build` clean; all `/api` and page routes return 200; solid `bg-slate-100` input fill present in compiled CSS (UI-005).

## Remaining risks

| Risk | Notes |
|------|-------|
| BUG-001 (unguarded read endpoints) | Confirm intended or add guards (ESPECIALLY bill-detailed — exposes a session's bill without auth). |
| Rate limiting / brute force on login | No throttling/lockout observed. Add in production hardening. |
| Manual/UI-only cases | Listed below not covered by the API sweep — run in a browser. |

## Manual/UI-only cases in this suite (not auto-verified)

UI-001..009, UX-001..010 (responsive, dark mode, keyboard nav, toasts, loading states), RCT-002 (print), KDS-002 (8s auto-refresh), PUB-002/003 (QR scan, mobile). These require manual browser confirmation.

---

# Suggested Automation Goals

If later converted to automated e2e (Playwright), prioritize:

1. AUTH-001/003, SEC-001/003 (auth + role guards)
2. TBL-006/009/011/012/014/016, ORD-005/006, KDS-003
3. BIL-002/004/010/012/015/017 (billing math + pay + loyalty)
4. RCT-001/003, PUB-001 (receipt, review, public menu)
5. UI-005 regression (solid input fill)

---

*Document ends. Test case priority: High = must pass to ship; Med = important; Low = polish/edge.*