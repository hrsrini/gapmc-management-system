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
| **Admin screens** | Users (assign role + locations), Roles, Permission matrix (module × role → checkboxes), Locations (yards), Config, Audit log (list + filters), SLA config. |

**Status in current app:** Login, ProtectedRoute, AdminRoute, can(), RequirePermission, sidebar filtering, list/detail permission checks exist. Optional: “Pending my action” filter for DV/DA.

### 0.4 One DO→DV→DA flow (validation)

Implement or confirm one full workflow (e.g. **Payment Voucher** or **Leave Request**): Draft → DV verify → DA approve; only DO creates draft; only DV can verify; only DA can approve. Use same status + approved_by/approved_at pattern for other modules later.

**Exit criteria Phase 0:**  
- User can log in; roles and permissions drive visibility and actions.  
- Location scope restricts data to user’s yards.  
- Every relevant mutation is audited.  
- At least one entity has full DO→DV→DA and is permission-gated.

---

## Phase 1 — Receipt engine (M-05) & Trader/Asset (M-02)

### 1.1 M-05 Receipts Online

| Layer | Deliverable |
|-------|-------------|
| **DB** | Receipts table: receipt_no (GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]), location_id, financial_year, revenue_head, amount, payer, payment_mode, gateway_ref, source_module, source_id; receipt_sequence (per location, head, FY); payment_gateway_log. |
| **API** | Create receipt (internal/counter); list/filter (location, head, date); reconciliation (gateway vs receipts); public GET /verify/:receiptNo. |
| **Logic** | Sequential receipt_no; revenue heads: Rent, GSTInvoice, MarketFee, LicenceFee, SecurityDeposit, Miscellaneous. |
| **UI** | Receipt list (filters); receipt detail (QR download); reconciliation screen; public verify page. |

**Gaps to implement (if any):** Online gateway (SBI ePay/NSDL/RazorpayGov) + callback; PDF with QR; ensure numbering and heads match SRS.

### 1.2 M-02 Trader & Asset

| Layer | Deliverable |
|-------|-------------|
| **DB** | locations (yards + check posts); assets (yard_id, asset_code, type, plinth_area, etc.); trader_licences (licence_no, valid_from, valid_to, status, do/dv/da); asset_allotments; trader_blocking_log; msp_settings. |
| **API** | Locations CRUD; Assets CRUD; Trader licences CRUD + lifecycle; Allotments CRUD; Block/unblock + log; MSP CRUD; reports (licence holder, etc.). |
| **Logic** | Licence lifecycle: apply → DV → DA → issue; allotment linked to asset + licence; blocking log on block/unblock. |
| **UI** | Yard/check post master; trader licence list/detail + application/renewal; asset register; allotment screen (with vacancy); blocking log; MSP settings. |

**Gaps to implement (if any):** Licence application form + document upload + eKYC step; auto-block cron on licence expiry; locations type (Yard/CheckPost/HO).

---

## Phase 2 — Rent (M-03) & Market (M-04)

### 2.1 M-03 Rent / GST

| Layer | Deliverable |
|-------|-------------|
| **DB** | rent_invoices (status, approved_by, approved_at, allotment_id); rent_deposit_ledger; credit_notes (invoice_id, amount, reason, status). |
| **API** | Invoice list (status/yard/period filter); create/update; batch verify/approve (DV/DA); ledger by entity/asset; credit note CRUD + approve; GSTR-1 export (JSON). |
| **Logic** | Cron 1st of month: create Draft invoice per active allotment (idempotent); Govt/Track B → Pre-Receipt (no GST); credit note only for approved invoices, restrict if paid. |
| **UI** | Invoice register (search, filter); Verify/Approve actions; ledger view; credit note form; GSTR-1 export button. |

**Gaps to implement:** Auto-invoice cron; Govt Track B / Pre-Receipt; GSTR-1 export; enforce credit note rules.

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

**Gaps to implement:** Monthly statement report (auto or on-demand, PDF/Excel).

### 3.2 M-07 Fleet

| Layer | Deliverable |
|-------|-------------|
| **DB** | vehicles; vehicle_trip_log; fuel_issuance; vehicle_maintenance (voucher_id link to M-06). |
| **API** | Vehicle CRUD; trip log CRUD; fuel register; maintenance CRUD. |
| **Logic** | Location scope; alerts for insurance/fitness expiry (cron or scheduled query). |
| **UI** | Vehicle master; trip entry; fuel register; maintenance + link to voucher; dashboard alerts (insurance/fitness). |

**Gaps to implement:** Insurance/fitness renewal alerts (e.g. 60/30 days).

### 3.3 M-08 Construction & Maintenance

| Layer | Deliverable |
|-------|-------------|
| **DB** | works; work_bills (work_id, voucher_id); amc_contracts; land_register (append-only / no delete); fixed_assets (disposal_date, link to M-06). |
| **API** | Works CRUD + bills; AMC CRUD; land read-only or append-only; fixed assets CRUD + disposal (DA only). |
| **Logic** | AMC renewal alert (cron 60/30 days before contract_end). |
| **UI** | Works register; work detail + bills; AMC list + renewal alerts; land register; fixed asset register + disposal approval. |

**Gaps to implement:** AMC renewal cron/alert; land immutability (DB constraint); disposal workflow.

### 3.4 M-09 Correspondence (Dak)

| Layer | Deliverable |
|-------|-------------|
| **DB** | inward_dak; outward_dak; dak_actions; subject_files (optional). |
| **API** | Inward/outward CRUD; assign/reassign; status update; list by officer/date/subject; SLA breach report. |
| **Logic** | SLA = deadline − received_date; cron: deadline &lt; today and status ≠ Closed → create escalation + notify. |
| **UI** | Inward register (assign, deadline); outward register; “My pending dak”; action tracking; subject file view; SLA breach report. |

**Gaps to implement:** SLA cron + escalation (create record, notify); SLA breach report; subject file grouping.

---

## Phase 4 — HRMS (M-01)

| Layer | Deliverable |
|-------|-------------|
| **DB** | employees (link to users); employment_contracts; attendance_events; timesheets; service_book_entries; leave_requests; leave_allocations; lta_ltc; cgegis_records; ta_da_claims; recruitment (job, application, interview_stages). |
| **API** | CRUD per entity; attendance check-in/out; timesheet validation; leave request workflow (DO→DV→DA); service book append (immutable after DA); LTC/TA-DA claims. |
| **Logic** | EMP-ID on DA approval; service book immutable after DA; retirement alerts (cron 180/90/60/30 days); on Retired/Resigned, disable linked user. |
| **UI** | Employee master (3-tab: Public / Personal / HR Settings); contracts; attendance; timesheet validation; leave requests/approvals; service book view; LTC/TA-DA; retirement alerts widget. |

**Gaps to implement:** Aadhaar eKYC flow (or simulated); 3-tab employee form; retirement cron + user disable; CGEGIS if required.

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
