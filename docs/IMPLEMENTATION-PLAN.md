# GAPMC IOMS — Implementation Plan

**Principle:** RBAC and cross-cutting foundation first; then all other modules in dependency order.  
**Stack:** Express + React/Vite + Drizzle + PostgreSQL (`gapmc` schema).  
**Reference:** Current app vs IOMS (quick map).md, GAPLMB IOMS Module-Wise Dev Prompts.

---

## Overview: Phase order

| Phase | Focus | Modules | Rationale |
|-------|--------|---------|-----------|
| **0** | RBAC & cross-cutting | M-10 + auth, locations, audit, workflow | Every module depends on user, role, location, permission, audit. |
| **1** | Receipt engine + Trader/Asset | M-05, M-02 | Receipts and trader/asset are used by Rent, Market, Voucher. |
| **2** | Rent & Market | M-03, M-04 | Depend on M-02 (allotments, licences) and M-05 (receipts). |
| **3** | Voucher, Fleet, Construction, Dak | M-06, M-07, M-08, M-09 | Depend on M-10; can run in parallel after Phase 1–2. |
| **4** | HRMS | M-01 | Employee–user link and advances tie to M-10 and M-06; complete after core ops. |

---

## Phase 0 — RBAC & cross-cutting (do first)

**Goal:** Users, roles, permissions, location scope, audit, and one DO→DV→DA workflow so every later module can plug in.

### 0.1 Database

| Table / concept | Purpose |
|-----------------|---------|
| `users` | id, email, name, password hash, is_active. |
| `roles` | id, name, tier (DO / DV / DA / READ_ONLY / ADMIN). |
| `user_roles` | user_id, role_id. |
| `permissions` | id, module (M-01 … M-10), action (Read / Create / Update / Delete). |
| `role_permissions` | role_id, permission_id. |
| `yards` or `locations` | id, code, name, type (Yard / CheckPost / HO), address. Master for 14 yards/check posts. |
| `user_yards` | user_id, yard_id. Which locations the user can see. |
| `audit_log` | table_name, record_id, action, user_id, old_value (jsonb), new_value (jsonb), ip, created_at. |
| `system_config` | key, value. e.g. financial_year, default_market_fee_pct. |
| `sla_config` | workflow, hours, alert_role. For M-09 and future SLA. |

**Status in current app:** Users, roles, user_roles, permissions, role_permissions, yards, user_yards, audit_log, system_config, sla_config exist. Ensure `locations`/yards are the single master (type = Yard/CheckPost/HO if needed).

### 0.2 Backend

| Deliverable | Description |
|-------------|-------------|
| **Auth middleware** | Resolve user from session; load roles + permissions; attach `req.user` and `req.scopedLocationIds` (from user_yards). |
| **Permission middleware** | For /api/admin: require M-10 permission by method (Read/Create/Update/Delete). For other /api: map path to module (M-01–M-09), method to action; require `hasPermission(user, module, action)`. ADMIN bypass. |
| **Audit** | On every create/update/delete of business data: `writeAuditLog(req, { module, action, recordId, beforeValue, afterValue })`. |
| **APIs** | User CRUD (assign roles + yards); Role CRUD; Permission matrix (GET list, POST/DELETE role_permissions); Locations (yards) CRUD; System config get/set; SLA config CRUD; Audit log list (filter by user, module, date). |

**Status in current app:** Auth, scopedLocationIds, requireModulePermissionByPath, requireAdminPermissionByMethod, writeAuditLog, admin routes exist. Confirm audit is called on all mutable operations.

### 0.3 Frontend

| Deliverable | Description |
|-------------|-------------|
| **Login** | Session-based; store user + roles + permissions (e.g. from /api/auth/me). |
| **Route guards** | Protected routes require auth; admin section requires ADMIN or M-10 permission. |
| **Permission-aware UI** | Helper `can(module, action)`. Hide/disable Create/Edit/Delete where user lacks permission; show “Access denied” on forbidden pages or 403. |
| **Admin screens** | Users (assign role + locations), Roles, Permission matrix (module × role → checkboxes), Locations (yards), Config, Audit log (list + filters: module, user id, limit), SLA config. |

**Status in current app:** Login, ProtectedRoute, AdminRoute, can(), RequirePermission, sidebar filtering, list/detail permission checks exist. **Pending my action:** payment vouchers and **leave requests** (`pendingMyAction=1`).

### 0.4 One DO→DV→DA flow (validation)

Implement or confirm one full workflow (e.g. **Payment Voucher** or **Leave Request**): Draft → DV verify → DA approve; only DO creates draft; only DV can verify; only DA can approve. Use same status + approved_by/approved_at pattern for other modules later.

**Exit criteria Phase 0:**  
- User can log in; roles and permissions drive visibility and actions.  
- Location scope restricts data to user’s yards.  
- Every relevant mutation is audited.  
- At least one entity has full DO→DV→DA and is permission-gated.

### Phase 0 — completion (this repo)

| Area | Done |
|------|------|
| **0.1 DB** | `yards.type` supports **Yard \| CheckPost \| HO** (comment in schema); locations remain single master. |
| **0.2 Audit** | M-10: yards, roles, users (no password in audit payload), role_permissions assign/remove, SLA config create/update; existing config + tally mapping unchanged. M-06: expenditure head create/update, advance create; vouchers create/update already audited. |
| **0.3 UI** | **Payment Vouchers** and **leave requests**: **“Pending my action”** → `GET /api/ioms/vouchers?pendingMyAction=1` and `GET /api/hr/leaves?pendingMyAction=1` (DV/DA queue + ADMIN where applicable). |
| **0.4 Reference workflow** | **Payment vouchers** (`server/workflow.ts` + `routes-vouchers.ts`): Draft/Submitted → Verified (DV) → Approved/Rejected/Paid (DA); DO create; segregation + permission checks. |

---

## Phase 1 — Receipt engine (M-05) & Trader/Asset (M-02)

### Phase 1 — progress (this repo)

| Item | Status |
|------|--------|
| **M-05 Public verify** | `GET /api/ioms/receipts/verify/:receiptNo` and `/verify/:receiptNo` work **without login** (`isPublicReceiptVerificationPath` in `server/auth.ts`). |
| **M-05 QR image** | `GET /api/ioms/receipts/public/qr?receiptNo=` returns PNG; new receipts store `qrCodeUrl` pointing at this endpoint; verify page shows QR. Optional `PUBLIC_APP_URL` for correct scan target in QR payload. |
| **M-02 Licence expiry cron** | `autoBlockExpiredTraderLicences()` in `server/cron-licence-expiry.ts`: Active + `validTo` &lt; today → `Expired`, blocked, `trader_blocking_log`, system audit. In-process schedule: `CRON_LICENCE_EXPIRY=true` (daily 01:05). HTTP: `POST /api/cron/licence-expiry-auto-block` with `x-cron-secret` when `CRON_SECRET` is set. |

### Phase 2 — progress (this repo)

| Item | Status |
|------|--------|
| **M-03 Auto-invoice cron** | `generateRentInvoicesForCurrentMonth()` (`server/cron-rent-invoices.ts`); in-process `CRON_RENT_INVOICE=true` (1st 00:01); HTTP `POST /api/cron/rent-invoice-generation` with `x-cron-secret` if `CRON_SECRET` set. |
| **M-03 Track B / Pre-Receipt** | Create/update Draft rent invoice: `tenantLicenceIsGstExempt` forces CGST/SGST 0, `isGovtEntity` true; manual **Govt entity** on form. GSTR-1 excludes `isGovtEntity`. |
| **M-03 GSTR-1** | `GET /api/ioms/rent/gstr1?fromMonth=&toMonth=`; UI on rent invoices register. Optional `GSTIN` in `.env`. |
| **M-03 Credit notes** | Create + update enforce **Approved** invoice, **not Paid**, yard scope on linked invoice. |

### Phase 3 — progress (this repo)

| Item | Status |
|------|--------|
| **M-06 Monthly statement** | `GET /api/ioms/vouchers/monthly-statement` (JSON/CSV/XLSX/PDF); UI `/vouchers/monthly-statement`. |
| **M-07 Fleet alerts** | `GET /api/ioms/fleet/renewal-alerts` + banner on vehicles list (`operational-alerts.ts`, 60/30/overdue). |
| **M-08 AMC alerts** | `GET /api/ioms/amc/renewal-alerts`; Construction AMC UI can consume same pattern. |
| **M-09 Dak SLA** | `GET /api/ioms/dak/inward/sla-overdue`; hourly `sla-reminder.ts` when `sla_config` rows match M-09/DAK; inward register banner. |
| **M-08 Land register** | Append-only at API: **no** PUT/DELETE for `land_records` (create + list only). Optional DB enforcement: **`npm run db:apply-land-immutable`** (then **`npm run db:verify-schema`**). |

### 1.1 M-05 Receipts Online

| Layer | Deliverable |
|-------|-------------|
| **DB** | Receipts table: receipt_no (GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]), location_id, financial_year, revenue_head, amount, payer, payment_mode, gateway_ref, source_module, source_id; receipt_sequence (per location, head, FY); payment_gateway_log. |
| **API** | Create receipt (internal/counter); list/filter (location, head, date); reconciliation (gateway vs receipts); public GET /verify/:receiptNo. |
| **Logic** | Sequential receipt_no; revenue heads: Rent, GSTInvoice, MarketFee, LicenceFee, SecurityDeposit, Miscellaneous. |
| **UI** | Receipt list (filters); receipt detail (QR download); reconciliation screen; public verify page. |

**Gaps to implement (if any):** Production payment gateway (SBI ePay/NSDL/RazorpayGov); ensure numbering and heads match SRS. **Public verify page:** browser **Print / save as PDF** (no server PDF; avoids open SRS layout questions).

### 1.2 M-02 Trader & Asset

| Layer | Deliverable |
|-------|-------------|
| **DB** | locations (yards + check posts); assets (yard_id, asset_code, type, plinth_area, etc.); trader_licences (licence_no, valid_from, valid_to, status, do/dv/da); asset_allotments; trader_blocking_log; msp_settings. |
| **API** | Locations CRUD; Assets CRUD; Trader licences CRUD + lifecycle; Allotments CRUD; Block/unblock + log; MSP CRUD; reports (licence holder, etc.). |
| **Logic** | Licence lifecycle: apply → DV → DA → issue; allotment linked to asset + licence; blocking log on block/unblock. |
| **UI** | Yard/check post master; trader licence list/detail + application/renewal; asset register; allotment screen (with vacancy); blocking log; MSP settings. |

**Gaps to implement (if any):** Licence application form + document upload + eKYC step. **Locations (M-10):** admin **create + edit** yards (code, name, type Yard/CheckPost/HO, contact, active). **Auto-block on licence expiry:** implemented (cron + HTTP trigger above).

---

## Phase 2 — Rent (M-03) & Market (M-04)

### 2.1 M-03 Rent / GST

| Layer | Deliverable |
|-------|-------------|
| **DB** | rent_invoices (status, approved_by, approved_at, allotment_id); rent_deposit_ledger; credit_notes (invoice_id, amount, reason, status). |
| **API** | Invoice list (status/yard/period filter); create/update; batch verify/approve (DV/DA); ledger by entity/asset; credit note CRUD + approve; GSTR-1 export (JSON). |
| **Logic** | Cron 1st of month: create Draft invoice per active allotment (idempotent); Govt/Track B → Pre-Receipt (no GST); credit note only for approved invoices, restrict if paid. |
| **UI** | Invoice register (search, filter); Verify/Approve actions; ledger view; credit note form; GSTR-1 export button. |

**Remaining gaps (optional / production):** Payment gateway live integration; server-side PDF; further SRS alignment on receipt numbering.

### 2.2 M-04 Market Fee & Commodities

| Layer | Deliverable |
|-------|-------------|
| **DB** | commodities; market_fee_rates; farmers/purchase_entities; yard_transactions/purchase; check_post_inward/outward; exit_permits; check_post_bank_deposits. |
| **API** | Commodity CRUD; fee rates CRUD; purchase entry (auto market fee); check post inward/outward; exit permit; bank deposits; registers (permit, stock, fee, inward/outward). |
| **Logic** | Location scope; DO/DV/DA where applicable; adjusted returns (original + credit note) if required. |
| **UI** | Commodity master; fee rate config; farmer/entity registry; purchase entry; check post inward/outward; exit permit; bank deposit + verification. |

**Gaps to implement:** Weighbridge integration (optional); full “adjusted returns” flow if not done.

---

## Phase 3 — Voucher (M-06), Fleet (M-07), Construction (M-08), Dak (M-09)

### 3.1 M-06 Payment Voucher

| Layer | Deliverable |
|-------|-------------|
| **DB** | expenditure_heads; payment_vouchers (type, payee, amount, head_id, location_id, status, work_id, vehicle_id, advance_employee_id, supporting_doc_refs, approved_by, approved_at). |
| **API** | Voucher CRUD; DO/DV/DA transitions; monthly statement (by head, location). |
| **UI** | Create voucher (type, payee, head, amount, links to work/vehicle/advance); list with “pending my action”; approve flow; monthly statement report (PDF/Excel). |

**Remaining gaps:** Optional scheduled email for statement; JSON/CSV/**XLSX/PDF** exports are implemented on the monthly statement API and UI.

### 3.2 M-07 Fleet

| Layer | Deliverable |
|-------|-------------|
| **DB** | vehicles; vehicle_trip_log; fuel_issuance; vehicle_maintenance (voucher_id link to M-06). |
| **API** | Vehicle CRUD; trip log CRUD; fuel register; maintenance CRUD. |
| **Logic** | Location scope; alerts for insurance/fitness expiry (cron or scheduled query). |
| **UI** | Vehicle master; trip entry; fuel register; maintenance + link to voucher; dashboard alerts (insurance/fitness). |

**Remaining gaps:** Optional scheduled email/push from renewal-alerts API (UI banner exists).

### 3.3 M-08 Construction & Maintenance

| Layer | Deliverable |
|-------|-------------|
| **DB** | works; work_bills (work_id, voucher_id); amc_contracts; land_register (append-only / no delete); fixed_assets (disposal_date, link to M-06). |
| **API** | Works CRUD + bills; AMC CRUD; land read-only or append-only; fixed assets CRUD + disposal (DA only). |
| **Logic** | AMC renewal alert (cron 60/30 days before contract_end). |
| **UI** | Works register; work detail + bills; AMC list + renewal alerts; land register; fixed asset register + disposal approval. |

**Remaining gaps:** In-process daily cron for AMC (optional; alerts API exists); full DA-only disposal workflow in UI if not complete. **Land:** DB-level append-only triggers via **`npm run db:apply-land-immutable`** (see `scripts/migrations/002-land-records-immutable.sql`).

### 3.4 M-09 Correspondence (Dak)

| Layer | Deliverable |
|-------|-------------|
| **DB** | inward_dak; outward_dak; dak_actions; subject_files (optional). |
| **API** | Inward/outward CRUD; assign/reassign; status update; list by officer/date/subject; SLA breach report. |
| **Logic** | SLA = deadline − received_date; cron: deadline &lt; today and status ≠ Closed → create escalation + notify. |
| **UI** | Inward register (assign, deadline); outward register; “My pending dak”; action tracking; subject file view; SLA breach report. |

**Remaining gaps:** Optional physical file-room barcode linkage (out of scope here). **Done:** `dak_escalations` persistence + SLA report page + inward **subject** filter + **URL `?subject=`** sync + **Inward by subject** index (`GET /api/ioms/dak/inward/subject-summary`, `/correspondence/inward/subjects`) + **My pending dak** / **Escalations** UI routes.

---

## Phase 4 — HRMS (M-01)

| Layer | Deliverable |
|-------|-------------|
| **DB** | employees (link to users); employment_contracts; attendance_events; timesheets; service_book_entries; leave_requests; leave_allocations; lta_ltc; cgegis_records; ta_da_claims; recruitment (job, application, interview_stages). |
| **API** | CRUD per entity; attendance check-in/out; timesheet validation; leave request workflow (DO→DV→DA); service book append (immutable after DA); LTC/TA-DA claims. |
| **Logic** | EMP-ID on DA approval; service book immutable after DA; retirement alerts (cron 180/90/60/30 days); on Retired/Resigned, disable linked user. |
| **UI** | Employee master (3-tab: Public / Personal / HR Settings); contracts; attendance; timesheet validation; leave requests/approvals; service book view; LTC/TA-DA; retirement alerts widget (dashboard summary + daily cron). |

**Gaps to implement:** Aadhaar eKYC flow (or simulated); CGEGIS if required. **3-tab employee form** and **dashboard retirement window** are in the repo (`HrEmployeeForm`, `GET /api/hr/retirement-upcoming`).

**Done in repo:** Retirement reminder cron; **user login disabled** when employee status is Inactive / Retired / Suspended / Resigned — on **PUT** `/api/hr/employees/:id` (by `employees.userId` and/or `users.employee_id`) and again **daily** inside `runHrRetirementReminders()` (`disableUsersForSeparatedEmployees`, system audit).

---

## Cron jobs (schedule after phases)

| Cron | Purpose |
|------|---------|
| **1st of month 00:01** | M-03: Create Draft rent invoice per active allotment (idempotent). |
| **Daily** | M-02: Auto-block licence when valid_to &lt; today; M-09: SLA escalation (deadline passed, status ≠ Closed). |
| **Daily / weekly** | M-01: Retirement alerts (180/90/60/30 days); disable user on Retired/Resigned. |
| **Daily / weekly** | M-07: Insurance/fitness alerts (60/30 days); M-08: AMC renewal alerts (60/30 days). |

Use node-cron or a small scheduler process; document in .env.example.

---

## Docs and config

- **gapmc_db_structure.md:** Keep updated with every new table and which module it serves.
- **.env.example:** Document SESSION_SECRET, DB URL, payment gateway keys, SMS/email for notifications, cron on/off.
- **SRS / Module spec:** Use as source of truth for validations, receipt number format, report layouts.

---

## Summary: RBAC first, then modules

1. **Phase 0 (RBAC first):** Users, roles, permissions, role_permissions, locations (yards), user_yards, audit_log, system_config, SLA config. Middleware: auth, scopedLocationIds, permission by path/method. UI: login, guards, can(), admin screens (users, roles, permission matrix, locations, config, audit, SLA). One full DO→DV→DA flow.
2. **Phase 1:** M-05 (receipt engine), M-02 (trader, asset, licence, allotment, blocking, MSP).
3. **Phase 2:** M-03 (rent, ledger, credit note, GSTR-1, auto-invoice), M-04 (commodities, fee, check post, exit permit, bank deposits).
4. **Phase 3:** M-06 (voucher + statement), M-07 (fleet + alerts), M-08 (works, AMC, land, fixed assets + alerts), M-09 (dak + SLA cron + escalation).
5. **Phase 4:** M-01 (HRMS: employee, attendance, leave, service book, LTC/TA-DA, recruitment, retirement alerts).
6. **Cron and docs:** All scheduled jobs above; keep DB and .env docs updated.

This order keeps RBAC and cross-cutting concerns first, then builds modules that depend on receipts and trader/asset, then the rest, with HRMS last.

---

## Repo completion note (2026-04)

After pulling these changes, run **`npm run db:push`** so new columns exist: `leave_requests` (`do_user`, `dv_user`, `workflow_revision_count`, `dv_return_remarks`), `purchase_transactions` (`parent_transaction_id`, `entry_kind`). Optional: **`npm run db:apply-land-immutable`** for `land_records` triggers; **`npm run db:verify-schema`** to confirm columns and triggers (read-only).

| Area | Delivered in code |
|------|-------------------|
| **M-01 Leave** | Full **Pending → Verified (DV) → Approved/Rejected (DA)**; DV return to Pending with remarks; **pending my action** filter; sample seed uses do/dv users. |
| **M-01 Retirement** | Daily cron + HTTP cron; **user disable** on terminal HR status (PUT + cron); notifications via `notify` (webhook/SMTP optional). |
| **M-04 Adjusted returns** | **Adjustment** purchase rows linked to **Approved** parent; negative `marketFeeAmount`; same DO→DV→DA workflow as originals. |
| **M-08 Land** | Append-only API; optional DB triggers via **`npm run db:apply-land-immutable`** + **`npm run db:verify-schema`**. |
| **M-08 Disposal** | **PUT `/api/ioms/fixed-assets/:id`** — disposal fields **DA/Admin only**; UI **Dispose** on fixed assets. |
| **M-09 Dak** | Hourly SLA tick **inserts `dak_escalations`** (one per inward per UTC day); **SLA breach report** page; inward list **`?subject=`** filter (case-insensitive contains). |
| **M-07/M-08 digest** | Daily cron + HTTP; fleet + AMC alert counts + audit stub. |
| **Service book** | **PUT** allowed until entry is immutable / Approved. |

**Still external / optional:** live payment gateway (adapter `PAYMENT_GATEWAY_MODE`), Aadhaar eKYC, CGEGIS, weighbridge. **Land DB triggers** are optional but scripted: **`npm run db:apply-land-immutable`** (API remains append-only without them).

**Also delivered:** notify channels (webhook/SMTP), voucher monthly **PDF/XLSX**, Dak **my-pending** / **escalations** / **subject index** + **query-string subject filter**, admin **location create + edit** (yard type HO/CheckPost/Yard), **HR user disable** on separation (PUT + daily cron), **dashboard retirement-upcoming** card (`GET /api/hr/retirement-upcoming?days=90`), **public receipt print/PDF** from browser, **audit log** module list aligned with IOMS writers + **user id** filter.
