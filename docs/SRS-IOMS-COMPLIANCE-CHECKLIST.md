# GAPLMB IOMS SRS — Compliance checklist

**Reference:** `GAPLMB-GOA-IOMS-SRS-v2-final.pdf` (GAPLMB-GOA-IOMS-SRS-v2.0, Mar 2026) — map each row to SRS **FR / UC / SCR** and **Appendix C RTM** where applicable.  
**Supporting inputs:** `tally_ledgers.pdf` (chart of accounts), `List of Exemption from GST.pdf` (govt. office/godown GST exemption list).  
**App:** `gapmc-management-system` (Express + React + Drizzle + PostgreSQL).  
**Traceability sheet:** [SRS-TRACEABILITY-SHEET.md](./SRS-TRACEABILITY-SHEET.md). **Client open items:** [SRS-OPEN-ITEMS-CLIENT.md](./SRS-OPEN-ITEMS-CLIENT.md).

## How to use

- Mark each item: **Done** | **Partial** | **N/A** | **Deferred** | **Open (client)**.
- Add **evidence** (route, table, PR) in the last column when closing an item.
- This list is **SRS-shaped**; reconcile wording with the PDF for formal sign-off.

---

## Cross-cutting (all modules) — verify alongside M-10

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| CC-01 | DO → DV → DA workflow on transactional records (draft visibility rules) | | `server/workflow.ts`, per-route |
| CC-02 | **BR-WF-01:** same **user** cannot be DO + DV + DA on the **same** record | Partial | Transitions: rent, vouchers, market tx. Stored roles: `assertRecordDoDvDaSeparation` on works, fleet vehicles, trader licences, allotments; leave self-approve blocked in `routes-hr.ts` |
| CC-03 | DA rejection: **reason code** + minimum **remarks** length; **revision count** where SRS specifies | Partial | `shared/workflow-rejection.ts`; vouchers `routes-vouchers.ts` + `VoucherDetail` / `VouchersList`; leave `routes-hr.ts` + `LeaveRequests`; rent `routes-rent-ioms.ts` + `IomsRentInvoiceDetail`; M-04 purchase `routes-market-ioms.ts` + `MarketTransactions` (**Verified→Draft** DV return, `dvReturnRemarks`, revision count) |
| CC-04 | **Audit log** on material mutations (who, when, before/after, IP) | | `audit_log` + helpers |
| CC-05 | **Location / yard scoping** on APIs (non-admin) | Partial | `routes-traders-assets.ts` (licences, assistants, assets, vacant, allotments, blocking log); other IOMS routes as before |
| CC-06 | **Notifications** (email/SMS) on submit / verify / approve / return / reject / SLA breach | Partial | `server/notify-stub.ts` — replace with provider; SLA tick calls stub |
| CC-07 | **SLA escalation job** (reads `sla_config`, notifies `alert_role`) | Partial | `sla-reminder.ts`: M-03 Draft rent + M-06 Draft/Submitted voucher overdue counts → `sendNotificationStub` |
| CC-08 | **PWA:** manifest, service worker, installability (if SRS mandates) | Partial | `manifest.webmanifest`, `sw.js`, prod registration in `main.tsx` |
| CC-09 | **Offline + sync** at check posts (if SRS mandates) | | |
| CC-10 | **WCAG 2.1 AA** + GIGW-oriented UX | | Audit |
| CC-11 | **Data retention / archival** per SRS §16 | | |
| CC-12 | **Error code registry** + consistent API errors | Done | `server/api-errors.ts` `sendApiError`: all route modules + `auth.ts` use `{ error, code, details? }` for **4xx/5xx** (`INTERNAL_ERROR` on catch paths); client `readApiErrorMessage` + 401 branch in `fetchApiGet`; dev **port scan** `PORT`…`PORT+19`; **`npm run smoke`** → `GET /api/health` |
| CC-13 | **User ↔ active employee** coupling; disable user when employee inactive (**SRS §1.4**) | Partial | `POST/PUT /api/hr/employees/:id/login`, `GET /api/hr/employees/:id/login-profile`; `employees.user_id` / `users.employee_id`; HR employee `PUT` deactivates linked login |
| CC-14 | **Tally COA mapping** — ledger catalogue + revenue/expenditure head → Tally ledger for export | Partial | Schema + seed; `PUT /api/admin/expenditure-heads/:id/tally-ledger`; `AdminFinanceMappings.tsx`; `GET /api/ioms/reports/tally-export` |
| CC-15 | **Govt. office/godown GST exempt categories** (7 named entities) — licence link + M-03/M-05 zero tax | Partial | Seed + API + `TraderLicenceDetail` category editor; rent + receipt server logic |

---

## M-10 — RBAC & system administration (do this section first)

### M-10.1 Identity & provisioning

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-01 | Users table: login identity, `employee_id` link, active flag, password/session policy | | `users`, `auth` |
| M10-02 | **No IOMS user** without **active** employee (if SRS is binding) | Partial | App login is always created in context of an employee: `POST /api/hr/employees/:id/login` (no standalone user without `employee_id`) |
| M10-03 | **Transactional disable** of user when employee becomes inactive (same transaction as HR update) | Partial | `routes-hr.ts` employee `PUT` |
| M10-04 | User CRUD API (create, read, update, deactivate) with permission checks | Partial | **Create/update/deactivate login:** `routes-hr.ts` `POST|PUT /api/hr/employees/:id/login`. **No** `/api/admin/users` — `routes-admin.ts` is roles, locations, config, audit, matrix, SLA, finance mappings |
| M10-05 | Admin UI: list users, assign **roles** and **yards/locations** | Partial | **No** standalone `/admin/users`. **HR** `HrEmployeeDetail` → **Login & roles** (`EmployeeLoginAccessSection.tsx`) for login, roles, yards; **M-10** `/admin/permissions` for module×action matrix |
| M10-06 | Optional: password reset / admin-set password policy per SRS | | |
| M10-07 | SSO / government IdP / OTP login (if in scope) | | Currently password session |

### M-10.2 Roles & permission matrix

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-10 | Role tiers: DO, DV, DA, READ_ONLY, ADMIN (or as per SRS naming) | | `roles.tier`, seed |
| M10-11 | **Permissions** granular by **module (M-01…M-10)** and **action** (Create/Read/Update/Delete/Approve) | | `permissions`, `role_permissions` |
| M10-12 | **Permission matrix** UI: view role × module × action | | Admin Roles page |
| M10-13 | **Permission matrix** UI: **edit** + maker–checker **if** SRS requires (vs admin-only) | | |
| M10-14 | API enforcement: every protected route checks permission + yard scope | | Middleware |
| M10-15 | **Auditor** (read-only) persona: scoped reports/views if SRS defines | | |

### M-10.3 Locations (yards / check posts / HO)

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-20 | Master: yards + check posts (+ HO if applicable): code, name, type, address, contact | | `yards`, seed `seed-ioms-m10.ts` |
| M10-21 | User–location assignment (`user_yards` or equivalent) | | |
| M10-22 | Location CRUD API + admin UI | | Admin locations |
| M10-23 | Rules for **HO-raised** records vs yard-scoped users (read-only vs hidden) | | Document + enforce |

### M-10.4 System configuration

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-30 | `system_config` key–value store; audit changes | | |
| M10-31 | Financial year and operational defaults (market fee %, MSP, licence fee, etc.) | | Seed + admin |
| M10-32 | **Sensitive keys:** DA approval or maker–checker if SRS requires | | |

### M-10.5 SLA configuration

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-40 | `sla_config`: workflow, hours, alert_role | | Admin + API |
| M10-41 | Runtime **SLA breach detection** + **escalation** actions | | Job + notifications |
| M10-42 | SLA reports / dashboard widgets | | |

### M-10.6 Audit & compliance views

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-50 | Audit log: filter by user, module, date, action, record id | | `/admin/audit` |
| M10-51 | Export audit (CSV/PDF) if SRS requires | | |
| M10-52 | Immutable audit store (append-only); retention policy | | |

### M-10.7 Notifications administration (if under M-10)

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-60 | Notification templates (email/SMS) per event type | | |
| M10-61 | Provider config (SMTP, SMS gateway), non-production masking | | |

### M-10.8 Security & operations

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M10-70 | Session security (httpOnly, secure cookie, idle timeout) per SRS | | `connect-pg-simple`, etc. |
| M10-71 | Production **session store** artifacts (e.g. `table.sql` in `dist`) documented in deploy | | `script/build.ts` |
| M10-72 | OWASP ASVS-aligned practices referenced in SRS | | Review |

---

## M-01 — HRMS & service record management

### M-01.1 Employee master

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M01-01 | Employee lifecycle: onboarding → active → transfer → exit | | |
| M01-02 | **EMP-ID** format `EMP-[LOC]-[YEAR]-[NNN]` on approval (or SRS exact format) | | |
| M01-03 | Profile tabs: Personal / Identity / Organisation / Bank / Documents | | |
| M01-04 | **Aadhaar:** tokenised storage, no plaintext; **UIDAI** / eKYC flow if in scope | | |
| M01-05 | **PAN** validation; **GSTIN** where applicable | | |
| M01-06 | **IFSC** verification (RBI API — warn vs block per SRS) | | |
| M01-07 | Document upload: type/size limits, **virus scan** on server | | |

### M-01.2 Attendance & time

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M01-10 | Attendance capture (check-in/out), policies | | |
| M01-11 | Timesheets / validation rules | | |

### M-01.3 Leave

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M01-20 | Leave types (EL/HPL/CL/ML/CCL/PL/SL, etc.) per SRS | | |
| M01-21 | Balance engine, accrual, encashment | | |
| M01-22 | Sandwich / holiday / weekly off rules (**confirm open items**) | | |
| M01-23 | Leave request DO→DV→DA + notifications | | |

### M-01.4 Service book & contracts

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M01-30 | Service book entries; **immutable after DA** | | |
| M01-31 | Contracts / recruitment if in v1.0 scope | | |

### M-01.5 TA/DA, LTC, CGEGIS

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M01-40 | TA/DA: tour programme, controlling officer, entitlement matrix, retroactive rules | | |
| M01-41 | LTC claims workflow | | |
| M01-42 | CGEGIS / deductions as per SRS | | |

### M-01.6 Alerts & integration

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M01-50 | Pre-retirement alerts (180/90/60/30 days) + **disable linked user** | | Cron |
| M01-51 | Employee self-service scope (own records only) | | |

### M-01.7 Configuration console (if SRS SCR-CFG-01)

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M01-60 | Maker–checker for HR/payroll **configuration** proposals | | Beyond `system_config` |

---

## M-02 — Trader & asset ID management

### M-02.1 Licences & traders

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M02-01 | Licence lifecycle DO→DV→DA; licence number on approval | | |
| M02-02 | **Track A vs Track B** (government / GST exempt / pre-receipt mode) | | |
| M02-03 | **Pre-receipt** lifecycle: issued → dispatched → acknowledged → settled | | |
| M02-04 | Renewal, expiry; **cron auto-block** on expiry | | |
| M02-05 | Alerts **60/30/7** days (agreement/licence per SRS) | | |
| M02-06 | **Duplicate PAN / expired licence** hard blocks on fee/invoice paths | | |
| M02-07 | Functionaries, Hamali/Weighmen, assistant traders as per SRS | | |
| M02-08 | **Trader self-service** portal (applications, payments) if in scope | | |

### M-02.2 Assets & allotments

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M02-10 | Asset register; ID format `[LOC]/[TYPE]-[NNN]` | | |
| M02-11 | Shop allotment linked to asset + trader; vacancy views | | |
| M02-12 | **Agreement** versioning, notarized PDF, size limits | | |
| M02-13 | **Blocking log** (block/unblock reasons) | | |

### M-02.3 MSP & reports

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M02-20 | MSP settings by commodity/period | | |
| M02-21 | Reports: licence holders, Hamali/Weighmen, APMC-wise, etc. | | |

---

## M-03 — Rent / GST tax invoice

### M-03.1 Invoicing

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M03-01 | Monthly **auto-invoice** (cron, idempotent) for active allotments | | |
| M03-02 | GST **CGST+SGST** (or as per SRS); Track B **pre-receipt** instead of tax invoice | | |
| M03-03 | Invoice DO→DV→DA; link to **allotment** | | |

### M-03.2 Ledger & credit notes

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M03-10 | **Rent deposit ledger** movements | | |
| M03-11 | **Credit notes** workflow; rules when invoice fully paid | | |
| M03-12 | **TDS** (194-I / 194C) if in scope | | |

### M-03.3 GSTN

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M03-20 | **GSTR-1** / **e-Invoice** export per **GSTN API** specs | | |
| M03-21 | Email dispatch flags for invoice PDF | | |

---

## M-04 — Market fee & commodities

### M-04.1 Masters

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M04-01 | Commodity master (variety, unit, grades, MSP link) | | |
| M04-02 | Market fee rates (by commodity/location/period) | | |
| M04-03 | Farmer / purchase entity registry (eKYC level per SRS) | | |

### M-04.2 Yard transactions

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M04-10 | Purchase/transaction entry; market fee = f(declared value, rate) | | |
| M04-11 | Weighbridge integration or manual (per client decision) | | |
| M04-12 | Returns / adjustments affecting registers | | |

### M-04.3 Check post

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M04-20 | Inward + commodity lines; transaction types (Permanent/Passway/Temporary/Prepaid) | | |
| M04-21 | Outward + **exit permit** | | |
| M04-22 | **Bank deposits** record + verify (segregation of duties) | | |
| M04-23 | **Offline capture + sync** at check post | | |

### M-04.4 Registers & reports

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M04-30 | Registers: permit, stock, market fee, inward/outward | | |
| M04-31 | **Daily arrival** / **commodity aggregation** | | |
| M04-32 | **Advance market fee deposit** ledger | | |
| M04-33 | Periodic reports (weekly / fortnightly / monthly) per SRS §7.6 | | |
| M04-34 | **Monthly returns** submission flow §7.7 | | |

---

## M-05 — Receipts online (central engine)

### M-05.1 Numbering & heads

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M05-01 | Canonical receipt no: **GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]** | | |
| M05-02 | Sequence per location + FY + **revenue head** (thread-safe) | | `receipt_sequence` |
| M05-03 | Revenue heads: Rent, GSTInvoice, MarketFee, LicenceFee, SecurityDeposit, Miscellaneous (confirm codes) | | |

### M-05.2 Payments

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M05-10 | **Payment gateway** + webhooks; reconciliation | | |
| M05-11 | Counter / manual payment path | | |
| M05-12 | Cheque/DD **dishonour** / reversal process | | |

### M-05.3 Documents & public verify

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M05-20 | **PDF + QR**; download | | |
| M05-21 | **Public verify** by receipt number / QR | | |

### M-05.4 Integration

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M05-30 | M-02/M-03/M-04/M-06/M-08 call **internal create receipt**; no ad-hoc duplicate engines | | |

---

## M-06 — Payment voucher management

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M06-01 | Expenditure **heads** master (govt account codes if provided) | | |
| M06-02 | Voucher DO→DV→DA; sequential number per yard/FY | | |
| M06-03 | Types: salary, contractor, operational, advance, refund | | |
| M06-04 | Links: M-08 work, M-07 vehicle, M-01 advance employee | | |
| M06-05 | Supporting documents storage + metadata | | |
| M06-06 | **Paid** state when payment reference recorded | | |
| M06-07 | Monthly statement by yard + head | | |
| M06-08 | Budget/limits per head/yard/year (if SRS) | | |
| M06-09 | Advance recovery rules (payslip integration if SRS) | | |

---

## M-07 — Vehicle fleet management

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M07-01 | Vehicle master (registration, type, capacity, yard, insurance, fitness) | | |
| M07-02 | Trip / log: odometer, distance, purpose, route | | |
| M07-03 | Fuel register (pump vs bulk — per client) | | |
| M07-04 | Maintenance records + link to **M-06 voucher** | | |
| M07-05 | Alerts **60/30** days before insurance/fitness expiry | | |
| M07-06 | Driver linkage to **employee** (M-01) | | |
| M07-07 | Fleet reports | | |

---

## M-08 — Construction & maintenance

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M08-01 | Works register DO→DV→DA; estimates, contractor, dates | | |
| M08-02 | Work bills linked to **M-06** | | |
| M08-03 | AMC contracts + bills; renewal alerts **60/30** days | | |
| M08-04 | **Land register:** immutable / no delete; correction policy | | |
| M08-05 | **Fixed assets** + depreciation (SLM/WDV per client) + disposal (DA) | | |
| M08-06 | Construction reports | | |

---

## M-09 — Correspondence (dak)

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| M09-01 | Inward: diary number **DAK-IN/[YYYY-MM]/[NNN]** (or SRS exact) | | |
| M09-02 | Outward: despatch **DAK-OUT/[YYYY-MM]/[NNN]** | | |
| M09-03 | Assignment, routing, action log, deadlines | | |
| M09-04 | Subject files / linking | | |
| M09-05 | Attachments storage | | |
| M09-06 | **SLA:** overdue detection; escalation + notifications | | |
| M09-07 | Outward letterhead / print template | | |
| M09-08 | Dak reports (pending, SLA breach) | | |

---

## Suggested implementation order (after M-10 RTM)

1. **M-10** — complete checklist + cross-cutting CC rows.  
2. **M-05** + **M-02** — receipt engine and master data for rent/market.  
3. **M-03**, **M-04** — parallel where possible.  
4. **M-06** — vouchers; then **M-07**, **M-08** with voucher links.  
5. **M-09** — dak (depends on M-10 + notifications).  
6. **M-01** — HRMS depth + **user provisioning** alignment.

---

## Document control

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-02-26 | Initial checklist: M-10 first, then M-01–M-09 + cross-cutting |

*End of checklist.*
