# GAPLMB IOMS — Execution Plan

**Source:** GAPLMB IOMS Module-Wise Dev Prompts (10 modules, Next.js 14 + Supabase).  
**Adapted for:** Current GAPMC stack — **Express (server) + React/Vite (client) + Drizzle ORM + PostgreSQL (`gapmc` schema)**.  
**Purpose:** Ordered, dependency-aware build plan with deliverables and open questions.

---

## 1. Stack mapping

| Doc assumes           | Current GAPMC stack                    |
|-----------------------|----------------------------------------|
| Next.js 14 App Router | Express API + React (Vite, Wouter)     |
| Supabase (PostgreSQL) | PostgreSQL + Drizzle (`gapmc` schema) |
| Supabase RLS          | Server middleware + location/role checks |
| Server Actions        | REST API routes + React Query         |
| shadcn/ui             | Already in use (Radix + Tailwind)     |

All schema and workflow logic from the doc applies; only the runtime (Next.js vs Express, Supabase client vs Drizzle) is different.

---

## 2. Recommended build order (phases)

| Phase | Module | Name | Dependency | Priority |
|-------|--------|------|------------|----------|
| **1** | **M-10** | RBAC & System Administration | None — build first | Critical |
| **2** | **M-05** | Receipts Online | After M-10 | Critical |
| **3a** | M-01 | HRMS & Service Record Management | After M-10 | High |
| **3b** | M-02 | Trader & Asset ID Management | After M-10 | High |
| **4a** | M-03 | Rent / GST Tax Invoice | After M-02 | High |
| **4b** | M-04 | Market Fee & Commodities | After M-02 + M-05 | High |
| **5a** | M-06 | Payment Voucher Management | After M-05 | Medium |
| **5b** | M-07 | Vehicle Fleet Management | After M-06 | Medium |
| **5c** | M-08 | Construction & Maintenance | After M-06 | Medium |
| **5d** | M-09 | Correspondence Management | After M-10 | Medium |

**Critical path:** M-10 → M-05 → M-02 → M-03 and M-04.

---

## 3. Common rules (all modules)

- **Workflow:** Every create/edit follows **DO (Data Originator) → DV (Data Verifier) → DA (Data Approver)**. Records stay draft until DA approval.
- **Visibility:** Draft records are not visible outside the creator’s yard scope.
- **Audit:** Every mutation is written to **audit_log** (M-10).
- **Location scoping:** Enforced in server middleware (user’s yard_ids); no RLS — use API filters and checks.

---

## 4. Phase-wise execution plan

### Phase 1 — M-10: RBAC & System Administration (foundation)

**Goal:** Users, roles (DO/DV/DA/Admin/Read-only), location scoping, permissions, audit log, system config. All other modules depend on this.

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `users`, `roles`, `user_roles`, `permissions`, `role_permissions`, `yards` (locations), `user_yards`, `system_config`, `sla_config`, `audit_log` |
| **API** | **App login:** `POST|PUT /api/hr/employees/:id/login` (not admin user CRUD). Role/permission matrix, location CRUD, config get/set, audit log query (filter by user/module/date) |
| **Client routes** | **User provisioning:** `/hr/employees/:id` (Login & roles) — not `/admin/users`. **Admin:** `/admin/roles`, `/admin/locations`, `/admin/config`, `/admin/audit`, `/admin/permissions`, `/admin/sla-config`, `/admin/finance-mappings` |
| **Middleware** | Resolve user from session; attach `user` and `scopedYardIds` to request; enforce role + yard on protected routes |
| **Seed** | 14 locations (Canacona, Curchorem, Dhargal, GSAMB, Keri, Mapusa, Mapusa Sub Yard, Margao, Mollem, Pernem, Pollem, Ponda, Sanquelim, Valpoi); default config (Market Fee % = 1, MSP Rate = 10, Admin Charges = 0, Licence Fee = 300) |

**Open questions (resolve before build):**

1. Can one user hold both DV and DA, or must they be different?
2. Can location-scoped users see HO-raised records (read-only) or no access?
3. Is SSO (government portal) required in Phase 1 or later?
4. Which `system_config` keys need DA approval vs admin-only immediate update?

---

### Phase 2 — M-05: Receipts Online (central receipt engine)

**Goal:** Single receipt engine for the system. Receipt numbers `GAPLMB/[LOC]/[FY]/[HEAD-CODE]/[NNN]`. Other modules call M-05 to generate receipts; no direct user creation of receipts from UI.

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `receipts` (receipt_no, yard_id, revenue_head, payer_*, amount, payment_mode, gateway_ref, source_module, source_record_id, status); `receipt_sequence` (yard_id, revenue_head, financial_year, last_seq); `payment_gateway_log` |
| **API** | Internal “create receipt” (called by M-02/M-03/M-04/M-06/M-08); list/filter receipts; reconciliation (gateway vs receipts); public verify by receipt_no (optional) |
| **Client routes** | `/receipts` (list), `/receipts/:id` (detail + QR download), `/receipts/reconciliation`, `/receipts/reports`; optional public `/verify/:receiptNo` |
| **Logic** | Sequential receipt_no via lock on `receipt_sequence`; revenue heads: Rent, GSTInvoice, MarketFee, LicenceFee, SecurityDeposit, Miscellaneous; QR PDF on Paid |

**Open questions:**

26. Which gateway is confirmed — SBI ePay, NSDL, or RazorpayGov?
27. Short codes for receipt numbering (RENT, MFEE, LCFEE, etc.)?
28. Public QR verification: separate unauthenticated route?
29. Legacy 54 receipt types → mapping to 6 revenue heads before go-live?
30. Cheque/DD dishonour: how is receipt reversed?

---

### Phase 3a — M-01: HRMS & Service Record Management

**Goal:** Employee lifecycle — onboarding, contracts, attendance, leave, service book, LTC, CGEGIS, TA/DA, pre-retirement alerts. Employee linked to user in M-10.

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `employees`, `employee_contracts`, `recruitment`, `attendances`, `timesheets`, `service_book_entries`, `leave_requests`, `ltc_claims`, `ta_da_claims` |
| **API** | CRUD per entity; attendance check-in/out; timesheet validation; leave request workflow; service book append (immutable after DA) |
| **Client routes** | `/hr/employees`, `/hr/employees/:id`, `/hr/recruitment`, `/hr/attendance`, `/hr/timesheets`, `/hr/leaves`, `/hr/claims` |
| **Logic** | EMP-ID = `EMP-[LOC]-[YEAR]-[NNN]` on DA approval; service book immutable after DA; cron: retirement alerts at 180/90/60/30 days; on Retired/Resigned, disable linked user |

**Open questions:**

5. Aadhaar eKYC: live UIDAI in Phase 1 or simulated?
6. Recruitment: external job postings or internal only?
7. CGEGIS: simple deduction record or LIC/govt integration?
8. TA/DA approval: DV only or full DA?
9. Pre-retirement alert: email only or also SMS?

---

### Phase 3b — M-02: Trader & Asset ID Management

**Goal:** Licence lifecycle (traders, functionaries, Hamali/Weighmen, assistant traders), asset register (shops, godowns, offices), shop allotment, blocking log, MSP settings. Extends current traders/agreements.

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `trader_licences`, `assistant_traders`, `assets`, `asset_allotments`, `trader_blocking_log`, `msp_settings`; migrate/align `yards` from M-10 |
| **API** | Licence CRUD + workflow; asset CRUD; allotment CRUD; block/unblock + log; MSP config; reports (licence holder, Hamali/Weighmen, APMC-wise, etc.) |
| **Client routes** | `/traders/licences`, `/traders/licences/:id`, `/traders/functionaries`, `/traders/hamali`, `/traders/assistants`, `/assets`, `/assets/allotments`, `/assets/vacant`, `/traders/msp`, `/traders/reports` |
| **Logic** | Licence: DO→DV→DA → licence no issued; renewal reminder 30 days before expiry; cron: auto-block on expiry; asset ID format `[LOC]/[TYPE]-[NNN]` |

**Open questions:**

10. Functionaries, Hamali, Assistant Traders: same table with type or separate tables?
11. Assistant sub-licence: tied to primary licence expiry or independent?
12. GSTIN mandatory for all or only above threshold?
13. Stock Opening Balance (67 legacy): migrate in M-02 or M-04?
14. Trader portal: online licence application in Phase 1 or counter-only?

---

### Phase 4a — M-03: Rent / GST Tax Invoice

**Goal:** Monthly auto-invoice for allotted assets; GST (CGST+SGST 9% each); rent deposit ledger; credit notes; GSTR-1 export. Depends on M-02 (allotments).

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `rent_invoices`, `rent_deposit_ledger`, `credit_notes` (link to invoices) |
| **API** | Invoice list/detail; batch approve (DV/DA); ledger by tenant/asset; credit note create/approve; GSTR-1 export (JSON); reports |
| **Client routes** | `/rent/invoices`, `/rent/invoices/:id`, `/rent/credit-notes`, `/rent/gstr1`, `/rent/reports` |
| **Logic** | Cron 1st of month 00:01 — create Draft invoice per active allotment (idempotent); Govt entity → Pre-Receipt, no GST; credit note only if invoice not fully paid; DA approves credit note |

**Open questions:**

15. TDS on rent: who deducts, and effect on ledger?
16. Interest on arrears: auto-calc? Rate?
17. GSTR-1: per-yard or consolidated GAPLMB?
18. Govt entities: full list of Track B allottees?
19. Migrate legacy rent deposit opening balances?

---

### Phase 4b — M-04: Market Fee & Commodities

**Goal:** Purchase/transaction entry at yards, check post inward/outward, exit permits, market fee computation, MSP, weighbridge, bank deposits. Depends on M-02 (licences) and M-05 (receipts).

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `commodities`, `market_fee_rates`, `farmers`, `purchase_transactions`, `check_post_inward`, `check_post_inward_commodities`, `check_post_outward`, `exit_permits`, `check_post_bank_deposits` |
| **API** | Commodity/fee rate/farmer CRUD; purchase entry (DO→DV→DA, then receipt via M-05); check post inward/outward; exit permit; bank deposit + verify; registers (permit, stock, market fee); reports |
| **Client routes** | `/market/transactions`, `/market/commodities`, `/market/fee-rates`, `/market/farmers`, `/checkpost/inward`, `/checkpost/outward`, `/checkpost/exit-permits`, `/checkpost/bank-deposits`, `/market/registers`, `/market/reports` |
| **Logic** | Market fee = declared_value × fee_percent / 100; inward has commodity sub-table; bank deposit: Record → Verify (different roles); optimise inward list (paginate) |

**Open questions:**

20. Weighbridge: device API or manual weight?
21. Passway/Transit: exempt from market fee?
22. Farmer registry: eKYC/Aadhaar or name+village only?
23. Grading: officer-assessed or self-declared?
24. Check post bank deposits: dedicated Cashier role?
25. Commodity returns: trigger and effect on Stock Register?

---

### Phase 5a — M-06: Payment Voucher Management

**Goal:** Expenditure vouchers (salary, contractor, operational, advance, refund); DO→DV→DA; link to M-07 (fuel/repair), M-08 (works), M-01 (advances). Monthly statement per yard per head.

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `expenditure_heads`, `payment_vouchers`, `advance_requests` |
| **API** | Voucher CRUD + workflow; advance CRUD; expenditure heads config; monthly statement (by yard + head) |
| **Client routes** | `/vouchers`, `/vouchers/create`, `/vouchers/:id`, `/vouchers/advances`, `/vouchers/statements` |
| **Logic** | Voucher number sequential per yard per FY; supporting docs (e.g. file URLs); rejection with reason; Paid when payment_ref recorded |

**Open questions:**

31. Salary: computed in M-01 and M-06 only records payment, or M-06 computes?
32. Supporting docs: Supabase Storage or external DMS? (→ use project storage or S3-compatible)
33. Advance recovery: automated deduction from payslips?
34. Expenditure heads: government account code list to seed?
35. Budget/limits per head per yard per year?

---

### Phase 5b — M-07: Vehicle Fleet Management

**Goal:** GAPLMB vehicles — master, trip log, fuel register, maintenance (linked to M-06 vouchers), fitness/insurance alerts. Depends on M-06 and M-01 (driver = employee).

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `vehicles`, `vehicle_trip_log`, `vehicle_fuel_register`, `vehicle_maintenance` |
| **API** | Vehicle CRUD (DO→DV→DA); trip log CRUD; fuel register; maintenance CRUD; link voucher_id for fuel/repair bills |
| **Client routes** | `/fleet/vehicles`, `/fleet/vehicles/:id`, `/fleet/trips`, `/fleet/fuel`, `/fleet/maintenance`, `/fleet/reports` |
| **Logic** | Trip: distance_km = odometer_end - start; fitness/insurance alerts at 60 and 30 days before expiry; next_service_date drives maintenance alerts |

**Open questions:**

36. Approximate number of GAPLMB vehicles (for seed)?
37. Dedicated driver role or any officer logs trips?
38. Fuel: per-trip (pump) or central bulk store?
39. Maintenance interval: km-based or calendar?

---

### Phase 5c — M-08: Construction & Maintenance

**Goal:** Works register, contractor bills (→ M-06), AMC contracts, land register (immutable), fixed assets. Depends on M-06.

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `works`, `works_bills`, `amc_contracts`, `amc_bills`, `land_records`, `fixed_assets` |
| **API** | Works CRUD + bills; AMC CRUD + bills; land create-only (no update/delete); fixed assets + disposal (DA approval) |
| **Client routes** | `/construction/works`, `/construction/works/:id`, `/construction/amc`, `/construction/land`, `/construction/assets`, `/construction/reports` |
| **Logic** | Land: DB trigger to block DELETE; no UPDATE (append-only or new record + remarks); fixed asset depreciation SLM on read; AMC renewal alert 60/30 days before contract_end |

**Open questions:**

40. Fixed asset depreciation: system-computed (SLM/WDV) or manual entry?
41. AMC bills: auto-generated by cron or manual each time?
42. Land: can errors be corrected or strictly immutable?
43. Works: public tendering (GovTender) or internal estimates only?

---

### Phase 5d — M-09: Correspondence Management

**Goal:** Inward/outward dak (tapal); diary/despatch numbers; routing; action tracking; SLA and escalation. Depends only on M-10.

**Deliverables:**

| Item | Description |
|------|-------------|
| **Schema** | `dak_inward`, `dak_outward`, `dak_action_log`, `dak_escalations` |
| **API** | Inward/outward CRUD; assign/reassign; status update; action log; escalation creation (cron when deadline passed); SLA report |
| **Client routes** | `/correspondence/inward`, `/correspondence/inward/:id`, `/correspondence/outward`, `/correspondence/files`, `/correspondence/sla`, `/correspondence/reports` |
| **Logic** | Diary no: DAK-IN/[YYYY-MM]/[NNN]; Despatch no: DAK-OUT/[YYYY-MM]/[NNN]; daily cron: deadline < today and status ≠ Closed → escalate + notify; no DO→DV→DA on dak (routing is workflow) |

**Open questions:**

44. Dak numbering: per-yard or central HO?
45. Scanned letter attachments: project storage?
46. Escalation: always Secretary or assignee’s supervisor?
47. Outward: print template (GAPLMB letterhead)?

---

## 5. Cross-cutting implementation notes

- **Auth:** Replace hardcoded admin with M-10 users + session/JWT; include `user.id`, `role`, `yard_ids` in token or session.
- **Audit helper:** Single function `writeAuditLog(userId, module, action, recordId, before, after, ip)` called from API layer on every create/update/delete.
- **Location scope:** All list APIs filter by `yard_id IN (user.yard_ids)` unless role is Admin; draft records only visible to creator’s yard.
- **Client route layout:** Use existing layout/sidebar; add menu groups: Admin (M-10), HR (M-01), Traders & Assets (M-02), Rent (M-03), Market & Check Post (M-04), Receipts (M-05), Vouchers (M-06), Fleet (M-07), Construction (M-08), Correspondence (M-09).
- **Cron jobs:** Use node-cron or a small scheduler process for: monthly invoice (M-03), receipt sequence reset if needed, licence auto-block (M-02), retirement alerts (M-01), AMC/fitness/insurance alerts (M-07, M-08), dak SLA escalation (M-09), monthly expenditure statement (M-06).

---

## 6. Open questions — consolidated checklist

Resolve before or during the phase indicated:

| # | Module | Question |
|---|--------|----------|
| 1–4 | M-10 | DV/DA same user? HO read-only? SSO? Config approval? |
| 5–9 | M-01 | eKYC live? Recruitment scope? CGEGIS? TA/DA approval? Alert channel? |
| 10–14 | M-02 | Licence table structure? Assistant validity? GSTIN? Stock balance? Trader portal? |
| 15–19 | M-03 | TDS? Interest rate? GSTR-1 scope? Govt list? Ledger migration? |
| 20–25 | M-04 | Weighbridge? Passway fee? Farmer eKYC? Grading? Cashier role? Returns? |
| 26–30 | M-05 | Gateway? Head codes? Public verify? Legacy mapping? Dishonour? |
| 31–35 | M-06 | Salary source? Doc storage? Advance recovery? Head codes? Budget? |
| 36–39 | M-07 | Vehicle count? Driver role? Fuel source? Maintenance interval? |
| 40–43 | M-08 | Depreciation? AMC billing? Land edits? Tendering? |
| 44–47 | M-09 | Dak numbering? Attachments? Escalation recipient? Letterhead? |

---

## 7. Document references

- **Module overview:** GAPLMB_IOMS_ModuleOverview.docx  
- **Gap vs current app:** `Current app vs IOMS (quick map).md`  
- **DB structure:** `gapmc_db_structure.md` (update as new tables are added)  
- **This plan:** `execution plan.md`

---

*Last updated: from GAPLMB IOMS Module-Wise Dev Prompts; adapted for Express + React/Vite + Drizzle + PostgreSQL.*
