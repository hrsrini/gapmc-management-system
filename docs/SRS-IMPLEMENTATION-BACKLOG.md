# SRS v3.0 / clarifications Excel → implementation backlog

**Purpose:** Track **gaps between** `GAPLMB-GOA-IOMS-SRS-v3.0.pdf` and `GAPLMB-IOMS-Clarifications-SRS-Updated.xlsx` (“Pending questions” sheet, **SRS Resolution Note**) **and this repository**. **Remaining gaps** → [Priority backlog](#priority-backlog-remaining-gaps); **implemented slices** (Excel-aligned or no longer tracked as gaps) → [Satisfied in repo](#satisfied-in-repo).  
**Sources:** Excel resolves most rows as `RESOLVED`; workbook may still show `OPEN` for Q51/Q53 while code already implements HMAC + system audit actor — this file reflects **code in this repo**.

**How to use:** Pick by **Priority**; each row has **Next action** for engineering, product, client, or infra.

## Operators (DB + config)

| Action | Command / location |
|--------|---------------------|
| Rent invoice TDS columns | `npm run db:apply-rent-invoice-tds` → `scripts/migrations/004-rent-invoice-tds.sql` |
| IOMS receipt `tds_amount` | `npm run db:apply-ioms-receipt-tds` → `scripts/migrations/005-ioms-receipt-tds.sql` |
| Or use Drizzle | `npm run db:push` (after reviewing schema) |
| Seed defaults | `npm run db:seed-ioms-m10` (merges `system_config` from `shared/system-config-defaults.ts`) |
| Admin UI | `/admin/config` — all keys in `SYSTEM_CONFIG_KEYS` including retention years, `tally_xml_export_enabled`, `rent_dishonour_bank_charge_hint`, rent TDS thresholds, AMC gate, etc. |
| Env samples | `.env.example` (`OBJECT_STORAGE_DRIVER`, receipt PDF vars, cron notes) |

## Implementation snapshot (2026-04-20)

| Area | Delivered in repo | Still open |
|------|-------------------|------------|
| **P0 #15 TDS** | Indian **FY (Apr–Mar)** cumulative **Approved+Paid** rent before invoice `period_month` + current month vs threshold; **monthly×12**; PAN + `rent_tds_*` config; **`rent_invoices.tds_*`**; **`ioms_receipts.tds_amount`** + **receipt PDF** line; sync TDS on linked receipt; **YYYY-MM** `periodMonth` enforced for TDS | **GL posting** for TDS; optional **marginal** TDS (first month over threshold); run **`004` / `005`** migrations on each DB |
| **P0 §8.6 (partial)** | **`RECEIPT_PDF_PRINT_MODE`** (`full` \| `body-only` \| `preprinted`), **`RECEIPT_PDF_SIGNATORY_NAME`** (text line) | Cryptographic **DSC** / officer signature |
| **P1 #50** | **`GET /api/admin/data-retention-summary`** — counts past policy for: `ioms_receipts`, `payment_vouchers`, `dak_inward`, `dak_outward`, `audit_log`, `employees`, **`users`** (`created_at` when present), `rent_invoices` (by `period_month`), `land_records`, `bug_tickets`, **`purchase_transactions`** (`transaction_date`), **`check_post_inward`** (`entry_date`). Matching **`data_retention_*_years`** keys in `system_config`. | Session/login tables when present; other modules when policy years exist |
| **P1 #49** | **`GET /api/ioms/reports/tally-export`** — `format=csv` (legacy + `columns=srs`), **`format=xml`** → `gapmcTallyExport` v1 (`server/tally-export-xml.ts`); **`tally_xml_export_enabled`** | Native Tally Prime **import** XML without CA transform |
| **P1 #17** | **`GET /api/ioms/rent/gstr1`** — strict **`fromMonth`/`toMonth`**, **`warnings`**, **`tdsFyRule`**, GSTIN hint, **`gstnDraftMapping`** (draft B2B-style line list + `fp`; not filed JSON) | Final GSTN schema in filing tool; counterparty GSTIN / dates |
| **P2 #28–30** | **`GET /api/ioms/reference/tally-ledgers/stats`** — counts + **`expectedSrsTallyHeads`** (38) + **`activeHeadCountMatchesSrs`** / **`mapEntryCountMatchesActiveLedgers`** | DA workflow if live chart ≠ 38 |
| **P2 #31** | **`rent_dishonour_bank_charge_hint`** + **`rent_dishonour_bank_charge_inr`** (hints only) on dishonour **interest** hint (`routes-receipts-ioms`) | Auto **bank charge voucher** / fee line item |
| **P2 #39–40** | **`GET /api/ioms/fleet/maintenance-due`**, shared **`listFleetMaintenanceDueEnriched`**, **operational digest** cron/notify includes **maintenance-due count** (60d); fuel/maintenance **`voucherId`**, trip odometer/km, `routeParamString` on fleet routes | Full BR-VEH calendar SLA / alerts parity |
| **P2 #16** | After prior **M-03** dishonour for same invoice: **`rentArrearsDisclosure`** on **`GET /api/ioms/receipts/:id`** + PDF line (`rent-receipt-arrears`, `receipt-pdf`) | Ledger posting of interest; UI copy beyond receipt detail |

Rows that are **fully done for the Excel slice** appear under [Satisfied in repo](#satisfied-in-repo). **Partial** deliveries stay in the snapshot above and may also appear in the priority table with narrowed “Next action”.

## Satisfied in repo

| Ref | SRS / Excel anchor | What shipped |
|-----|---------------------|--------------|
| P1 #42 | §11.1 — AMC billing manual | **`amc_monthly_auto_generate`** default `false`; cron + `POST /api/cron/amc-monthly-bills` no-op unless `true`. |
| P1 #45 | §12.1 — Per-yard Dak only | Admin cannot save `dak_diary_sequence_scope` ≠ `per_yard`; inward auto diary **always per_yard**. |
| P2 #46 | §15.1 — **10 MB** scans | Dak + voucher multer **10 MB** (`routes-dak`, `routes-vouchers`). Tiered storage → **P0 #33**. |
| Q51 | §15.2 — Webhook HMAC | `server/payment-webhook-hmac.ts` + callback. |
| Q53 | §14.2 — Cron audit actor | `writeAuditLogSystem`, `AUDIT_SYSTEM_USER_ID`. |

*P2 #39–40 (fuel / maintenance / `maintenance-due`) is **partial** — see snapshot; not moved here so the priority table keeps BR-VEH follow-up visible.*

## Priority backlog (remaining gaps)

**Clarification column:** **`Q*n`** = row *n* in `GAPLMB-IOMS-Clarifications-SRS-Updated.xlsx`, summarized in [CLIENT-CLARIFICATION-PENDING.md](./CLIENT-CLARIFICATION-PENDING.md) when still open and/or [CLIENT-CLARIFICATION-RESPONSES-2026.md](./CLIENT-CLARIFICATION-RESPONSES-2026.md) when a decision is recorded. **SRS** = normative clause in **SRS v3.0 PDF** (`GAPLMB-GOA-IOMS-SRS-v3.0.pdf`, not committed here) only—no spreadsheet row, or cryptography / IdP sits outside the Q grid.

| Pri | # | SRS / Excel anchor | Target resolution (short) | Current state in repo | Clarification (Q# / doc) | Owner | Next action |
|-----|---|---------------------|---------------------------|-------------------------|----------------------------|--------|-------------|
| P0 | 15 | §6.1 FR-RENT-005; 194-I | TDS + receipt + **ledger** | FY + annualized TDS on invoice, M-05 receipt field, PDF; **no** TDS GL | [Q15 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses §15–17](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng | Finance: GL rules; optional marginal-month TDS |
| P0 | 33 | §15.1 Data Tier | Object storage + encryption | Local `uploads/` + `server/object-storage.ts` stub | [Q33](./CLIENT-CLARIFICATION-PENDING.md), [Q46](./CLIENT-CLARIFICATION-PENDING.md) (storage / scans) | Eng + Infra | S3-compatible adapter, encryption, migration runbook |
| P0 | — | §8.6 FR-PRT-001; Q52 | PDF + **digital signature** | PDF + QR + env signatory **text**; print modes | **SRS** §8.6 (DSC); [Q52](./CLIENT-CLARIFICATION-PENDING.md) = PDF *channel* (server vs print), not DSC | Eng | DSC / HSM per policy |
| P0 | SSO | §13.1 / §14.2 / §15.2 | SSO + **MFA** | Password sessions only | [Responses Q3](./CLIENT-CLARIFICATION-RESPONSES-2026.md); [SSO follow-up pending](./CLIENT-CLARIFICATION-PENDING.md) | Eng + Client IdP | OIDC/SAML + MFA for DA/ADMIN |
| P1 | 50 | §16.2 Data Retention | Full schedule | Many snapshot counts + **`users`**; **no purge** | [Q50 pending + interim note](./CLIENT-CLARIFICATION-PENDING.md); [Responses Q50](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng | Session/login tables when present; expand per policy |
| P1 | 49 | §8.3 FR-RCP-008 | Tally export | CSV + interchange **XML** + admin toggle | [Q49 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses Q49](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng | UAT with finance / Tally Prime |
| P1 | 17 | §6.1 FR-RENT-003 | GSTR-1 / GSTIN | Export + **`gstnDraftMapping`** draft (not filed JSON) | [Q17 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses §15–17](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng | Counterparty GSTIN, date formats, filing-tool schema |
| P2 | 16 | FR-RENT-007 | Arrears on **next receipt** | Disclosure on **GET receipt** + **PDF** after prior dishonour (same invoice) | [Q16 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses §15–17](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng | Post interest to GL; richer pay-in UI |
| P2 | 18–19 | §5.2 / §5.5 | Allottee / Pre-Receipt | Partial data model + flows | [Q18–19 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses Q18–19](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng + BA | SRS appendix trace |
| P2 | 28–30 | §8.3 FR-RCP-006 | **38** Tally heads | Stats + **SRS 38** flags vs active/map counts | [Q28–30 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses Q28–30](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng | DA if chart ≠ 38 |
| P2 | 31 | BR-AST-35 / BR-RCP-34 | Dishonour fees + re-invoice | Reversal + interest + **hint + INR config** | [Responses Q31](./CLIENT-CLARIFICATION-RESPONSES-2026.md); voucher automation **off sheet** | Eng | Bank charge voucher automation |
| P2 | 39–40 | §10.1 FR-VEH | Calendar + km maintenance | `maintenance-due` + **digest count** | [Q39–40 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses Q39–40](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | Eng | BR-VEH SLA rules in product |
| P2 | 48 | §8.6 FR-PRT-001 | Letterhead assets | Admin logo + body-only PDF | [Q48 pending](./CLIENT-CLARIFICATION-PENDING.md); [Responses Q48](./CLIENT-CLARIFICATION-RESPONSES-2026.md) | **Client** | Supply assets |

## Priority legend

- **P0** — Legal / security / financial correctness or explicit Phase-1 blocker per SRS.  
- **P1** — Strong SRS vs code **mismatch** or incomplete **cross-cutting** compliance.  
- **P2** — Deepen behaviour to full SRS detail or UX polish.

## Owners legend

- **Eng** — Development team.  
- **Product** — PM when Excel vs SRS disagrees.  
- **Client** — GAPLMB assets, IdP, letterhead.  
- **Infra** — Cloud, keys, encryption, backups.  
- **BA** — SRS traceability.  
- **Docs** — Workbook + repo docs only.

## Related files in repo

| Topic | Paths |
|-------|--------|
| Rent TDS + FY | `server/rent-invoice-tds.ts`, `server/routes-rent-ioms.ts`, `scripts/migrations/004-rent-invoice-tds.sql` |
| GSTR-1 | `server/rent-gstr1.ts`, `GET /api/ioms/rent/gstr1` in `server/routes-rent-ioms.ts` |
| Receipt TDS + dishonour + arrears line | `server/routes-receipts-ioms.ts`, `server/rent-receipt-arrears.ts`, `scripts/migrations/005-ioms-receipt-tds.sql`, `server/receipt-pdf.ts` |
| Data retention | `server/data-retention-audit.ts`, `GET /api/admin/data-retention-summary`, `server/index.ts` (cron log), `client/src/pages/admin/AdminConfig.tsx` |
| Tally CSV/XML | `server/routes-reports.ts`, `server/tally-export-xml.ts` |
| Tally stats | `server/routes-finance-reference.ts` (`/api/ioms/reference/tally-ledgers/stats`) |
| Fleet + ops digest | `server/routes-fleet.ts`, `server/operational-alerts.ts`, `server/cron-operational-reminders.ts` |
| Config | `shared/system-config-defaults.ts`, `server/routes-admin.ts`, `server/system-config.ts` |
| Object storage stub | `server/object-storage.ts`, `.env.example` |
| Clarifications | [CLIENT-CLARIFICATION-PENDING.md](./CLIENT-CLARIFICATION-PENDING.md), [CLIENT-CLARIFICATION-RESPONSES-2026.md](./CLIENT-CLARIFICATION-RESPONSES-2026.md) |

---

*Last updated: 2026-04-20 — refresh when SRS, Excel, or repo behaviour changes.*
