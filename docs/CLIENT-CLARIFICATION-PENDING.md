# GAPLMB IOMS — clarification still pending (for client circulation)

**Purpose:** Items from the merged clarification list (`docs/CLARIFICATION-QUESTIONS-MERGED.md`) where the **answer was blank** or **only partly answered** in the latest client spreadsheet (IDs 14–53, 2026). Send this table back for written sign-off before build or policy freeze.

**Engineering backlog (SRS v3 + Excel vs code):** [SRS-IMPLEMENTATION-BACKLOG.md](./SRS-IMPLEMENTATION-BACKLOG.md) — prioritized gaps and next actions.

**Note:** Answered items and what was implemented in code are summarized in `docs/CLIENT-CLARIFICATION-RESPONSES-2026.md`.

**Implementation (Q51 / Q53):** Payment gateway **`POST /api/ioms/receipts/payments/callback`** is public with optional **SHA256-HMAC** (`PAYMENT_WEBHOOK_HMAC_SECRET`, optional `PAYMENT_WEBHOOK_REQUIRE_HMAC`). Cron/webhook audit actor: **`AUDIT_SYSTEM_USER_ID`** or default **`system`** (`server/audit.ts`). UAT mock completion uses **`POST /api/ioms/receipts/:id/payments/dev-simulate-callback`** (see `.env.example`).

**Follow-up (answered in principle, confirm for Phase 1):** Government **SSO / IdP** (beyond email, mobile OTP, and user ID + password) — required or deferred?

## Pending client decision (no interim substitute)

| # | Area | Question (summary) |
|---|------|---------------------|
| 15 | M-03 | TDS on rent: who deducts; rent deposit ledger; rates, thresholds, ledger names. |
| 16 | M-03 | Interest on arrears: auto-calculate? If yes, rate and rules? |
| 17 | M-03 | GSTR-1 export: per-yard filing or consolidated for whole GAPLMB? |
| 18 | M-03 / SRS | Authoritative office/godown **allottee list**, **sub-units mapping**, Track B category codes (trader/non-trader **Non-GST** flag at registration is already specified and implemented). |
| 19 | M-03 / SRS | Track B / pre-receipt: invoice vs receipt document titles (align SRS). |
| 28 | M-05 | Receipt head short codes: final sign-off (e.g. RENT, MFEE). |
| 29 | M-05 | Public verification (receipt + QR without login): production policy confirmation. |
| 30 | M-05 | Legacy **~64** receipt types → six revenue heads: who signs off? |
| 32 | M-06 | Salary: computed in M-01 with M-06 recording payment, or computed in M-06? |
| 33 | M-06 | Supporting documents: app disk, S3, or DMS? |
| 35 | M-06 | Expenditure heads: source/authority for government account code list. |
| 36 | M-06 | Budget / limits per head per yard per year — required? |
| 39 | M-07 | Fuel: per trip (pump) vs central bulk store? |
| 40 | M-07 | Maintenance: km-based, calendar-based, or both? |
| 46 | M-09 | Scanned attachments: project storage vs DMS standard? |
| 48 | M-09 | Outward letters: who provides official print template / letterhead? |
| 49 | Cross-cutting | Tally export: confirm CSV column order and path. |
| ~~50~~ | Cross-cutting | ~~Data retention / archival: years per record class.~~ **Interim in app:** configurable years in Admin → Config + `GET /api/admin/data-retention-summary` + `POST /api/cron/data-retention-audit` (read-only counts; no delete). |
| 52 | M-05 / UX | Receipt PDF: mandatory server-generated branded PDF vs browser print-to-PDF? |

**Row #50:** Interim **policy years** and **read-only counts** are in the app (see table); **physical archival / purge** still needs client process and sign-off.

---

## Interim defaults in code (client cell was blank — confirm for production)

These **do not replace** written answers; they are configurable defaults so UAT can proceed:

| # | What was added |
|---|----------------|
| 29 | `PUBLIC_RECEIPT_VERIFY_ENABLED=false` disables public verify regardless of DB; else `public_receipt_verify_enabled` in system_config (`server/auth.ts`). |
| 42 | `CRON_AMC_MONTHLY_BILLS=true` + `POST /api/cron/amc-monthly-bills` creates **Monthly** AMC bills when missing for the current month; Quarterly/Annual stay manual until client confirms cadence. |
| 45 | `dak_diary_sequence_scope` in Admin Config (`per_yard` \| `central`); blank diary no on create → auto `DAK/{LOC}/{FY}/{NNNNN}` via `gapmc.dak_diary_sequence`. |
| ~~51~~ | **Done in app:** public callback + HMAC (`payment-webhook-hmac.ts`, `payment-gateway-callback.ts`); staging may set `PAYMENT_DEV_CALLBACK_ENABLED` for session-based simulate. |
| ~~53~~ | **Done in app:** `writeAuditLogSystem` / `getAuditSystemUserId()` (`server/audit.ts`); crons and payment webhook use system actor + optional IP on webhook. |
