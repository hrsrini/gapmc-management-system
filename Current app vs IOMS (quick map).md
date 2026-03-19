## 1. Current app vs IOMS (quick map)

| IOMS module | In current GAPMC app | Gap |
|-------------|----------------------|-----|
| **M-01 HRMS** | — | New. No employee, attendance, leave, service book, TA/DA, CGEGIS, retirement. |
| **M-02 Trader & Asset** | Traders, agreements, yards (client-side list). | No licence lifecycle, eKYC, asset register, shop allotment, blocking log, MSP settings, 14 yards/check posts as DB master. |
| **M-03 Rent / GST** | Invoices, rent, GST. | No auto-generation on 1st, no Govt Track B, no credit note workflow, no GSTR-1 export, no rent deposit ledger as described. |
| **M-04 Market Fee** | Fee collection, import/export, stock returns. | No commodity master in DB, no check post inward/outward, no exit permit, no weighbridge, no MSP, no purchase entity/farmer. |
| **M-05 Receipts** | Receipt list/form, receipt types. | No unified receipt engine, no GAPLMB/[LOC]/[FY]/[HEAD]/[NNN], no online gateway, no QR PDF. |
| **M-06 Payment Voucher** | — | New. Expenditure, advances, DO→DV→DA. |
| **M-07 Fleet** | — | New. Vehicle master, log, fuel, maintenance. |
| **M-08 Construction** | — | New. Works, AMC, land, fixed assets. |
| **M-09 Correspondence** | — | New. Inward/outward dak, action, escalation. |
| **M-10 RBAC & Admin** | Simple login (admin hardcoded). | No roles (DO/DV/DA), no location scope, no permission matrix, no SLA, no full audit log. |

So you need: **cross-cutting workflow + RBAC first**, then **extend existing modules**, then **add new modules**.

---

## 2. Cross-cutting: do these first

All modules assume:

- **Three-tier approval:** DO (create/edit) → DV (verify) → DA (approve). Record is “draft” until DA approves.
- **RBAC (M-10):** Users have role (DO/DV/DA/Admin/Read-only) and **location scope** (which yards/HO they can see).
- **Audit:** Every state change stored (who, when, before/after, IP).

**Suggested approach:**

1. **DB**
   - `gapmc.users` (or reuse/extend auth): user id, login, role (DO/DV/DA/Admin/ReadOnly), employee_id (nullable, for M-01 link later).
   - `gapmc.user_locations`: user_id, location_id (yard/HO).
   - `gapmc.locations`: id, code, name, type (Yard/CheckPost/HO), address, etc. (move from client `yards.ts` into DB).
   - `gapmc.audit_log`: table_name, record_id, action, user_id, old_value (jsonb), new_value (jsonb), ip, created_at.
   - `gapmc.workflow_state`: optional; or add `status` + `approved_by` + `approved_at` on each transactional table.

2. **Backend**
   - Middleware: resolve user from session/JWT, attach `user` and `scopedLocationIds` to `req`.
   - Helper: “can user in role X perform action Y on this record?” (and optionally “in this location?”).
   - On every create/update/delete of business data: insert into `audit_log`; enforce “only DO can create draft”, “only DV can move to verified”, “only DA can approve”.

3. **Frontend**
   - Route guard: allow access by role + location (e.g. hide “Approve” unless DA, hide other yards unless Admin).
   - Lists/filters: restrict to `scopedLocationIds` (and optionally “pending my action” for DV/DA).

Once this is in place, every new module can use the same pattern: status (Draft → Verified → Approved), approval fields, and audit.

---

## 3. Per-module: what to add and how

### M-01 HRMS & Service Record

- **New schema:** employees, employment_contracts, attendance_events, timesheets, service_book_entries, leave_requests, leave_allocations, lta_ltc, cgegis_records, ta_da_claims, recruitment (job, application, interview_stages).
- **APIs:** CRUD for each entity; attendance check-in/out; leave request workflow (DO→DV→DA); service book append-only after DA approval.
- **UI:** Employee master (list/form with Aadhaar eKYC flow), contracts, attendance, timesheet validation, leave requests/approvals, service book view, LTC/TA/DA, retirement alerts (e.g. dashboard widget + cron that sets “retirement due” and disables user).
- **Integration:** Employee id linked to `gapmc.users` for M-10; TA/DA/advances can later link to M-06.

Start with: employee master + one workflow (e.g. leave request) to validate DO/DV/DA and audit.

---

### M-02 Trader & Asset ID (extend current)

- **DB:**  
  - `gapmc.locations` (yards + check posts).  
  - `gapmc.assets`: yard_id, asset_code ([LOC]/[TYPE]-[NNN]), type (Shop/Godown/Office), plinth_area, valuation, order_ref; status.  
  - `gapmc.traders`: add licence_number, licence_start, licence_end, status (Active/Blocked/Expired), ekyc_verified_at, blocking_reason, etc.  
  - `gapmc.shop_allotments`: asset_id, trader_id, from_date, to_date, status; DO/DV/DA fields.  
  - `gapmc.trader_blocking_log`: trader_id, action (Block/Unblock), reason, by_user_id, at.  
  - `gapmc.msp_settings`: commodity_id, from_date, to_date, msp_value (or in commodity master).
- **APIs:** Locations CRUD; assets CRUD; trader licence lifecycle (apply → DV → DA → issue licence); allotment CRUD with workflow; block/unblock + log; MSP config; reports (licence holder, hamali/weighmen, etc.).
- **UI:** Yard/check post master; trader licence application + document upload + eKYC step; licence renewal; asset register; allotment screen (with vacancy); blocking log; MSP settings screen; existing trader list/agreements adapted to “licence + allotment” model.

Your current traders/agreements become “licence holder + allotment”; add licence dates and blocking so auto-block on expiry (cron) and manual block/unblock are straightforward.

---

### M-03 Rent / GST Tax Invoice (extend current)

- **DB:**  
  - Invoices: add status (Draft/Verified/Approved), approved_by, approved_at; link to allotment_id.  
  - `gapmc.rent_deposit_ledger`: entity_id (trader), asset_id, period, opening_balance, rent, interest, cgst, sgst, collections, closing_balance (or one row per movement).  
  - `gapmc.credit_notes`: invoice_id, amount, reason, status (Draft→Approved); no direct invoice “cancellation.”
- **Logic:**  
  - Nightly cron (1st of month 00:01): for each active allotment, create invoice if not exists (idempotent).  
  - Govt entity (Track B): flag on tenant or allotment; generate “Pre-Receipt” instead of GST invoice.  
  - Credit note: only for approved invoices; if invoice fully paid, disallow or restrict.
- **APIs:** Invoice list (with status filter); approve batch (DV/DA); rent deposit ledger by entity/asset; credit note create + approve; GSTR-1 export (JSON for GSTN).
- **UI:** Invoice register (search, filter by status/yard/period); “Review batch” for DO; “Verify” for DV, “Approve” for DA; ledger view; credit note form; GSTR-1 export button + validation (all have GSTIN).

---

### M-04 Market Fee & Commodities (extend current)

- **DB:**  
  - `gapmc.commodities`: id, name, variety, unit, grade_types, msp (or separate msp_periods).  
  - `gapmc.market_fee_rates`: commodity_id, rate_pct, valid_from, valid_to, location_id (optional).  
  - `gapmc.farmers` / `gapmc.purchase_entities`: for buyer/seller at yard.  
  - Purchase/transaction: expand current market_fees or new `gapmc.yard_transactions` (commodity, variety, quantity, declared_value, market_fee, weighbridge_ref, DO/DV/DA).  
  - `gapmc.check_post_inward`: vehicle, licence, invoice, commodity, quantity, value, transaction_type (Permanent/Passway/Temporary/Prepaid), location_id, etc.  
  - `gapmc.check_post_outward`: link to inward_id, exit time.  
  - `gapmc.exit_permits`: inward_id, permit_no, issued_at.  
  - `gapmc.check_post_bank_deposits`: location_id, amount, deposited_by, verified_at.
- **APIs:** Commodity/master CRUD; purchase entry (with auto market fee); adjusted returns (original + credit note); check post inward/outward; exit permit; bank deposits; registers (permit, stock, market fee, inward/outward); all with location filter and DO/DV/DA where needed.
- **UI:** Commodity master; market fee rate config; farmer/entity registry; purchase entry (with optional weighbridge integration); check post inward/outward screens; exit permit; bank deposit + verification; existing fee collection/returns adapted to new structure and workflow.

---

### M-05 Receipts Online (unify current receipts)

- **DB:**  
  - Single `gapmc.receipts` (or refactor existing): receipt_no (GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]), location_id, financial_year, revenue_head (Rent, GST Invoice, Market Fee, Licence Fee, Security Deposit, Miscellaneous), amount, payer, payment_mode, gateway_ref, source_module, source_id (e.g. invoice_id), pdf_path or generated on demand.  
  - Sequence/per-location-per-fy-per-head for [NNN].
- **Logic:**  
  - When M-02/M-03/M-04/M-06/M-08 “approves” a payment, create receipt (or “receipt request” for counter payment).  
  - Online: integrate SBI ePay/NSDL/RazorpayGov; webhook/cron to match transaction to receipt and store reference.  
  - PDF with QR (receipt no, amount, date); public verification page (optional).
- **APIs:** Create receipt (from payment or manual counter); list with filters (location, head, date range); reconciliation endpoint (gateway vs receipts); generate PDF.
- **UI:** Receipt register (search/filter); “Issue receipt” for counter; reconciliation screen; download PDF; map existing receipt flows to new head codes and numbering.

---

### M-06 Payment Voucher (new)

- **DB:**  
  - `gapmc.expenditure_heads`: code, name, type (Salary/Contractor/Operational/Advance/Refund).  
  - `gapmc.payment_vouchers`: type, payee, amount, head_id, location_id, status (Draft→Verified→Approved), work_id (M-08), vehicle_id (M-07), advance_employee_id (M-01), supporting_doc_refs, approved_by, approved_at.
- **APIs:** Voucher CRUD; DO/DV/DA transitions; monthly statement (by head, location).
- **UI:** Create voucher (type, payee, head, amount, links to work/vehicle/advance); list with “pending my action”; approve flow; monthly statement report.

---

### M-07 Vehicle Fleet (new)

- **DB:**  
  - `gapmc.vehicles`: registration_no, type, capacity, yard_id, purchase_date, insurance_expiry, fitness_expiry.  
  - `gapmc.vehicle_logs`: vehicle_id, date, driver_employee_id, start_odometer, end_odometer, purpose, route, fuel_consumed.  
  - `gapmc.fuel_issuance`: vehicle_id, date, quantity, receipt_ref.  
  - `gapmc.vehicle_maintenance`: vehicle_id, type (service/repair), date, description, amount, voucher_id (M-06).
- **APIs:** Vehicle CRUD; log CRUD; fuel register; maintenance CRUD; alerts for insurance/fitness (cron or query).
- **UI:** Vehicle master; daily log entry; fuel register; maintenance schedule + link to payment voucher; renewal alerts on dashboard.

---

### M-08 Construction & Maintenance (new)

- **DB:**  
  - `gapmc.works`: type, location_id, contractor, estimate, tender_value, work_order_date, start_date, end_date, status; DO/DV/DA.  
  - `gapmc.work_bills`: work_id, amount, voucher_id (M-06), bill_date.  
  - `gapmc.amc_contracts`: location_id, contractor, amount, start_date, end_date, renewal_alert.  
  - `gapmc.land_register`: survey_no, village, area, sale_deed_ref, encumbrance; no delete (DB constraint).  
  - `gapmc.fixed_assets`: name, type, acquisition_date, location_id, depreciation_schedule, disposal_date (null until disposed); link to M-02 shop assets if needed.
- **APIs:** Works CRUD + bill tracking; AMC CRUD; land read-only (or append-only); fixed assets CRUD + disposal (DA only).
- **UI:** Works register; work-wise bills and link to M-06; AMC list + renewal alerts; land register (read-only); fixed asset register + disposal approval.

---

### M-09 Correspondence (new)

- **DB:**  
  - `gapmc.inward_dak`: diary_no, received_date, from_party, subject, received_by, assigned_to, status (Pending/InProgress/Closed), deadline, file_id.  
  - `gapmc.outward_dak`: despatch_no, despatch_date, to_party, subject, mode, inward_id (if reply).  
  - `gapmc.dak_actions`: inward_id, assigned_to, status, updated_at.  
  - `gapmc.subject_files`: subject, linked_inward_ids (or junction table).
- **Logic:** SLA = deadline − received_date; cron or scheduled job to flag “overdue” and trigger escalation (notification to supervisor/Secretary).
- **APIs:** Inward/outward CRUD; assign/reassign; status update; list by officer/date/subject; SLA breach report.
- **UI:** Inward register (stamp, assign, set deadline); outward register; “My pending dak”; action tracking; subject file view; escalation/SLA report.

---

### M-10 RBAC & System Administration (foundation)

- **DB:** Already suggested above: users, user_locations, roles, permissions (matrix per module/role), audit_log; add `gapmc.system_config`: key-value (financial_year, default_market_fee_pct, etc.).
- **APIs:** User CRUD; role/permission matrix; location list; SLA config; notification config; audit log search (user, module, date, action).
- **UI:** User management (create, assign role, assign locations); permission matrix (table: module × role → CRUD); SLA and notification settings; audit log viewer + export; system config (FY, defaults).

Implement M-10 (and the cross-cutting workflow + audit) first; then every other module “plugs into” the same user, role, location, and audit.

---

## 4. Suggested implementation order

1. **Phase 0 – Foundation**  
   - Locations in DB (from `yards.ts`).  
   - Users + roles (DO/DV/DA/Admin) + user_locations.  
   - Middleware: auth + scope.  
   - Audit log (table + write on every change).  
   - Status + approval fields on 1–2 existing entities (e.g. invoices, traders) and one DO→DV→DA flow.

2. **Phase 1 – Core workflow**  
   - M-10 RBAC & Admin (screens + permission checks).  
   - M-02 extensions (licence, assets, allotment, blocking).  
   - M-03 extensions (auto-invoice, ledger, credit note, GSTR-1).  
   - M-05 receipt engine (numbering, heads, link from M-02/M-03/M-04).

3. **Phase 2 – Market & fee**  
   - M-04 full (commodity master, check post, exit permit, bank deposits, registers).  
   - M-02 MSP settings and reports.

4. **Phase 3 – New modules**  
   - M-06 Payment Voucher (and link to M-07/M-08/M-01 where needed).  
   - M-07 Fleet.  
   - M-08 Construction & Maintenance.  
   - M-09 Correspondence.

5. **Phase 4 – HRMS**  
   - M-01 (employee, attendance, leave, service book, TA/DA, retirement alerts), with user–employee link and advances linking to M-06 later.

---

## 5. Docs and config to add

- **gapmc_db_structure.md:** Extend with every new table (workflow_state, audit_log, user_locations, assets, allotments, payment_vouchers, vehicles, works, inward_dak, etc.) and note which module each serves.
- **.env.example:** Document any new env vars (payment gateway keys, SMS/email for notifications, etc.).
- **SRS v1.0:** Use the same document as the source of truth for field-level validations, receipt number format, and report layouts so you don’t drift from “GAPLMB IOMS” spec.
