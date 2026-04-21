# GAPLMB IOMS — client clarification responses applied (2026)

**Sources:** Client Q&A spreadsheet (open questions 1–53) reconciled with `docs/CLARIFICATION-QUESTIONS-MERGED.md`.  
**Pending rows** are listed in `docs/CLIENT-CLARIFICATION-PENDING.md`.  
**Prioritized build gaps (SRS v3 + clarifications Excel vs code):** [SRS-IMPLEMENTATION-BACKLOG.md](./SRS-IMPLEMENTATION-BACKLOG.md).

## Decisions and implementation notes

| # | Decision | Code / docs |
|---|----------|-------------|
| 1 | A user **must not** hold both **DV** and **DA** roles; **DO+DV** allowed. | `server/role-constraints.ts`, enforced in `server/hr-employee-login.ts` (`HR_ROLE_DV_DA_CONFLICT`). |
| 2 | Location-scoped users: **read-only** on HO-raised records; search by licence no. / trader name (product behaviour; APIs already yard-scoped where applicable). | Documented here; list/search UX remains module-specific. |
| 3 | Login: email+password, mobile+OTP, or userId+password. | Existing auth paths; **government IdP/SSO** deferred — confirm in `CLIENT-CLARIFICATION-PENDING` follow-up. |
| 4 | All configurable parameters: **maker–checker** + audit logs (Jt. Sec / Sec). | Enforce via admin workflow/audit as keys are wired; treat every `system_config` change through the same pattern. |
| 5 | Aadhaar eKYC **out of scope**. | No UIDAI integration; tokens/masks only as already designed. |
| 6 | Recruitment **not in scope**; system starts post-joining. | Recruitment table remains non-blocking stub. |
| 7 | CGEGIS **on hold**. | No integration built. |
| 8 | TA/DA: full **DO → DV → DA** (same segregation as leave). | `ta_da_claims` workflow fields; `PUT /api/hr/claims/tada/:id`; `workflow.ts` (`canTransitionTaDaClaim`, `taDaClaimAwaitingMyAction`); HR Claims UI. |
| 9 | Outbound alerts: **email and SMS** (client SMS gateway). | `NOTIFY_SMS_WEBHOOK_URL` in `server/notify.ts` + `.env.example`. |
| 10 | Functionaries: applicant types **Trader** and **Assistant to Trader** (among licence types). | Already modelled in `licence_type` / seeds. |
| 11 | Assistant validity tied to **one active primary** trader. | `POST /api/ioms/traders/assistants` requires **Active** primary, yard match (`ASSISTANT_PRIMARY_NOT_ACTIVE`, `ASSISTANT_YARD_MISMATCH`). |
| 12 | **GSTIN not mandatory**; use when present on tax invoices. | Schema optional `gstin`; no validation change required. |
| 13 | Stock opening balance per trader with effective date. | Table `trader_stock_openings`; API under `/api/ioms/traders/licences/:id/stock-openings`; UI on **Trader licence detail** (M-02 Update). |
| 14 | Trader portal: **online licence application** | **Phase 2** — counter/back-office only in Phase 1. |
| 15–17 | TDS, interest, GSTR-1 scope | **Policy** in SRS v3 / client sheet; **interest hint** on cheque dishonour for M-03 rent receipts: `rent_arrears_interest_percent_per_annum` in Admin Config + `server/rent-interest.ts` (due = end of invoice `period_month` when `YYYY-MM`). |
| 18–19 | Govt / non-GST / pre-receipt wording | **Registration:** trader/non-trader indicates **Non-GST** via `trader_licences.is_non_gst_entity` + licence detail UI; `tenantLicenceIsGstExempt` treats non-GST like exempt for tax helpers. Govt list: `govtGstExemptCategoryId`. **Residual:** authoritative allottee/sub-units list — see pending doc. Pre-receipt titles **pending** client wording. |
| 20 | Rent deposit migration cut-off **31-Mar-2026**. | `system_config` key `rent_deposit_migration_cutoff` (default `2026-03-31`) in `SYSTEM_CONFIG_DEFAULTS` / Admin Config; migration job TBD when finance provides extract. Existing DBs: update key in Admin or re-seed. |
| 21 | Weighbridge: **manual weight** only. | No device integration. |
| 22 | Passway/transit: **exempt market fee**; **admin charges** only; track quantities separately / exclude from main arrival report where applicable. | `GET /api/ioms/reports/check-post-arrivals` (excludes `Passway/Transit`) and `GET /api/ioms/reports/check-post-passway-transit`; CSV from **IOMS Reports**; optional `from`/`to`/`checkPostId`. |
| 23 | Farmer registry: **Krishi card**, name, village, taluka, district. | `farmers.krishi_card_no` + API; seed sample taluks. |
| 24 | Grading **optional**, yard entry only. | Optional `grade` on transactions. |
| 25 | Check post: receipts + duty-end reports / bank deposit statement. | Existing check-post tables/routes; cashier role **pending** (merged Q25). |
| 26 | Commodity returns **monthly or quarterly**. | Configure in returns module when built. |
| 27 | Payment gateway **pending**; Phase 1 **cash and cheque**. | `createIomsReceipt` / POST receipts: **Cash, Cheque, DD** only unless `RECEIPT_ALLOW_ANY_PAYMENT_MODE=true`. `POST .../payments/initiate` disabled unless `PAYMENT_GATEWAY_INIT_ENABLED=true`. `.env.example` + `payment-gateway.ts`. |
| 28, 30 | Receipt head codes, legacy **~64** → six heads | **Pending** (client sign-off). |
| 29 | Public verify / QR without login | **`PUBLIC_RECEIPT_VERIFY_ENABLED=false`** turns off public verify + QR API until policy is confirmed. |
| 31 | Cheque dishonour: reverse receipt, recompute rent, apply interest (formula from GAPMB). | `PATCH /api/ioms/receipts/:id` with `status: "Reversed"` for **Paid/Reconciled** **Cheque** or **DD** receipts; optional `dishonourReason`; audit action `ChequeDishonour`. Response includes **`rentRecomputationNote`**: SRS-style **simple daily** interest hint for **Rent + M-03** (configurable % via **`rent_arrears_interest_percent_per_annum`**); **ledger posting** still manual per finance. |
| 32, 33, 35 | Salary split, doc storage, expenditure head source | **Pending** |
| 34 | Advance recovery from payroll | **Out of scope** — no automated recovery in Staff/Payroll (M-06). |
| 36 | Budget / limits per head per yard per year | **Pending** (client cell blank in latest sheet). |
| 37 | **3** vehicles seed. | `scripts/seed-ioms-sample-data.ts` seeds three vehicles when DB empty. |
| 38 | **Drivers** role for trips. | Seeded role (see `seed-ioms-m10`). |
| 39–40 | Fuel and maintenance model | **Pending** |
| 41 | Depreciation **manual** for first release. | Fixed assets support manual book value. |
| 42 | AMC bill generation cadence | **Optional automation:** `CRON_AMC_MONTHLY_BILLS` + `POST /api/cron/amc-monthly-bills` — **Monthly** `period_type` only; idempotent per calendar month. Quarterly/Annual still manual pending client rule. |
| 43 | Land register: errors corrected **after approval**. | `PUT /api/ioms/land-records/:id` — **DA or Admin** only, audited. |
| 44 | Public tendering **pending**; internal only for now. | — |
| 45 | Dak inward diary numbering | **`dak_diary_sequence_scope`** (`per_yard` \| `central`) in Admin Config (`SYSTEM_CONFIG_KEYS`); auto `DAK/{LOC}/{FY}/{NNNNN}` when diary no left blank; `gapmc.dak_diary_sequence`. |
| 46 | Scanned attachments: project vs DMS | **Pending** |
| 47 | Escalation to **assigned supervisor** (assignee). | `server/sla-reminder.ts` sets `dak_escalations.escalated_to` from `dak_inward.assigned_to` when set. |
| 48 | Outward letter template | **Pending** |
| 49 | Tally CSV column headings from client. | **`GET /api/ioms/reports/tally-export?format=csv&columns=srs`** — SRS column order; legacy export unchanged. **IOMS Reports** → two download buttons. |
| 50 | Data retention | **Pending** / TBD by volume. |
| 51 | Payment gateway webhook security | Public **`POST /api/ioms/receipts/payments/callback`** (no session). Optional **`PAYMENT_WEBHOOK_HMAC_SECRET`**: `X-Payment-Signature` or `X-Signature-Hmac-Sha256` = hex SHA256-HMAC of **raw** JSON (`server/payment-webhook-hmac.ts`). Optional **`PAYMENT_WEBHOOK_REQUIRE_HMAC=true`** fails closed if secret missing. Shared apply logic: `server/payment-gateway-callback.ts`. UAT UI uses **`POST /api/ioms/receipts/:id/payments/dev-simulate-callback`** (auth); production staging may set **`PAYMENT_DEV_CALLBACK_ENABLED=true`**. |
| 52 | Receipt PDF (server vs print) | **`GET /api/ioms/receipts/:id/pdf`** — server PDF (pdfkit): optional logo (`RECEIPT_PDF_LOGO_PATH` or `RECEIPT_PDF_LOGO_URL`), GAPLMB header, payer/amounts, embedded verify QR. **IOMS receipt detail** → **PDF** button. |
| 53 | Cron `audit_log` user id | **`getAuditSystemUserId()`** / `AUDIT_SYSTEM_USER_ID` — default literal **`system`**; set to a real `users.id` if compliance requires it. **`writeAuditLogSystem`** used from crons and payment webhook audit; optional **`{ ip }`** for webhook client IP (`server/audit.ts`). |

## Database follow-up

After pulling these changes, run:

`npm run db:push`

so new columns/tables exist: `ta_da_claims` workflow fields, `farmers.krishi_card_no`, `trader_licences.is_non_gst_entity`, `trader_stock_openings`, `gapmc.dak_diary_sequence`, and `system_config` keys `rent_deposit_migration_cutoff`, `dak_diary_sequence_scope` (via seed / Admin).
