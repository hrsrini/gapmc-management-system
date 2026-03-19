# Pending from GAPLMB IOMS Module-Wise Dev Prompts

This document maps **what is still pending** when comparing the **GAPLMB IOMS Module-Wise Dev Prompts** (Next.js 14 + Supabase) to the **current codebase** (Express + React/Vite + Drizzle/PostgreSQL).  
Stack differs; feature parity is the goal. Items below are **screens, APIs, or behaviours** described in the prompts that are **not yet implemented** or are **partial**.

---

## M-10 RBAC & System Administration

| Doc item | Status | Notes |
|----------|--------|------|
| User List + Form | ✅ Done | `/admin/users` |
| Role List | ✅ Done | `/admin/roles` (list only) |
| **Permission Matrix** | ❌ Pending | Doc: Module × Action (Create/Read/Update/Delete/Approve) grid. We have `/api/admin/permissions` and role-permissions API but **no UI grid** to view/edit role–permission matrix. |
| Location Config | ✅ Done | `/admin/locations` (yards CRUD) |
| Default Values | ✅ Done | `/admin/config` — Market Fee %, MSP Rate, Admin Charges, Licence Fee. |
| **SLA Config** | ❌ Pending | Doc: Per-workflow SLA (hours/days), breach alert recipient. We have `sla_config` table in schema but **no SLA config screen** or cron that uses it. |
| Audit Log | ✅ Done | `/admin/audit` with filters. |
| **Notification Rules** | ❌ Pending | Doc: Email + in-app trigger config per workflow event per role. Not implemented. |
| 14 locations seed | ⚠️ Partial | Seed has yards; doc lists 14 named (Canacona, Curchorem, etc.) — confirm seed matches. |

---

## M-01 HRMS & Service Record

| Doc item | Status | Notes |
|----------|--------|------|
| Employee List | ✅ Done | `/hr/employees` (table). |
| **Employee Form (3 tabs)** | ❌ Pending | Doc: Public Info, Personal Info (Aadhaar, PAN, DOB), HR Settings. Current form is single view. |
| **Photo card gallery** | ❌ Pending | Doc: Default list view = photo card gallery + table. We have table only. |
| Contracts | ✅ API | API exists; **no dedicated Contracts screen** (only via employee?). |
| Recruitment | ✅ Done | `/hr/recruitment` + API. |
| **Attendance** | ⚠️ API only | Check-in/out API; **no Attendance screen** (daily log UI). |
| **Timesheets** | ⚠️ API only | API exists; **no Timesheet validation screen** (fortnightly + Validate workflow). |
| **Service Book** | ⚠️ API only | API per employee; **no Service Book tabbed UI** (Appendix, Audit Comments, Verification, History, Certificates, Mutable/Immutable). |
| Leave Management | ✅ Done | `/hr/leaves` list + Approve/Reject. |
| **LTC / TA-DA claims** | ⚠️ API only | APIs exist; **no Claims screens** (`/hr/claims` list + forms). |
| **Reports** | ❌ Pending | Staff List Report, Service History Report, Consolidated HR Report. |
| **EMP-ID auto** | ❌ Pending | Doc: EMP-[LOC]-[YEAR]-[NNN] on DA approval. Not implemented. |
| **Pre-retirement alerts** | ❌ Pending | Cron at 180/90/60/30 days before `retirement_date`; disable user on Retired/Resigned. |
| **Aadhaar eKYC** | ❌ Pending | Doc: validate on creation; Phase 1 may be simulated. |

---

## M-02 Trader & Asset ID Management

| Doc item | Status | Notes |
|----------|--------|------|
| Trader Licence List/Form | ✅ Done | `/traders/licences` + API. |
| **Market Functionaries / Hamali / Weighmen** | ⚠️ Same table | Doc: separate screens; we use licence type filter. Dedicated screens optional. |
| Assistant Trader | ✅ Done | API + list. |
| Asset Register | ✅ Done | `/assets` (AssetList) + API. |
| Allotments | ✅ API | API; **Shop Allotment screen** may be partial (allotments list/form). |
| **Shop Vacant** | ❌ Pending | Doc: Vacated assets list; previous allottee, officer, rent. No dedicated `/assets/vacant` view. |
| Blocking Log | ✅ API | API; **no dedicated Blocking Log screen** (may be in licence detail). |
| MSP Settings | ✅ API | API; **no MSP screen** (`/traders/msp`). |
| **Reports** | ❌ Pending | Licence Holder, Hamali/Weighmen, APMC-wise, Assistant Traders, Coconut Traders, Outstanding Functionaries, Licence Rejections. |
| **Licence lifecycle** | ⚠️ Partial | DO→DV→DA in API; **licence number issued only after DA** — confirm. |
| **Auto-block cron** | ❌ Pending | Daily check `valid_to`; set blocked + log. |
| **Asset ID format** | ⚠️ Check | Doc: [LOC]/[TYPE]-[NNN]. Confirm schema/display. |

---

## M-03 Rent / GST Tax Invoice

| Doc item | Status | Notes |
|----------|--------|------|
| Invoice List | ✅ Done | IOMS rent invoices list + Verify/Approve. |
| **Invoice Detail** | ❌ Pending | Doc: Single invoice view with tenant, asset, period, payment status. We have list + actions; no `/rent/invoices/[id]` IOMS detail page. |
| **Pre-Receipt (Govt)** | ⚠️ Backend | `is_govt_entity` in schema; **no dedicated Pre-Receipt screen** or flow. |
| Rent Deposit Ledger | ✅ API | Ledger API; **no Ledger screen** (per tenant per asset). |
| Credit Note | ✅ Done | IOMS credit notes list + API. |
| **GSTR-1 Export** | ❌ Pending | Doc: Quarterly JSON export; GSTIN validation before export. Not implemented. |
| **Reports** | ❌ Pending | Shop Details, Allotment List, Vacant List, Rent Deposit Report, Godown-wise Rent, Outstanding Dues. |
| **Auto-generation cron** | ❌ Pending | 1st of month 00:01 — create Draft invoice per active allotment; idempotent. |

---

## M-04 Market Fee & Commodities

| Doc item | Status | Notes |
|----------|--------|------|
| Purchase/Transaction Entry | ✅ Done | Market transactions list + Verify/Approve + API. |
| Commodity Master | ✅ Done | `/market/commodities` + API. |
| **Market Fee Rate Screen** | ⚠️ API only | Fee-rates API; **no `/market/fee-rates` page**. |
| **Farmer Registry Screen** | ⚠️ API only | Farmers API; **no `/market/farmers` page**. |
| Check Post Inward | ✅ Done | `/checkpost/inward` list + Verify + API. |
| **Check Post Outward Screen** | ⚠️ API only | Outward API; **no outward list/form page**. |
| **Exit Permits Screen** | ⚠️ API only | Exit permits API; **no `/checkpost/exit-permits` page**. |
| **Bank Deposits Screen** | ⚠️ API only | Bank deposits API; **no `/checkpost/bank-deposits` page** or **verification step** UI. |
| **Registers** | ❌ Pending | Permit Register, Stock Register, Market Fee Register, Check Post Inward/Outward (date-range). |
| **Reports** | ❌ Pending | Commodity-wise, Trader-wise, Permit-wise, Stock Register, Market Fee Register, Arrival, Grading, Returns, Consolidated, Officer-wise, Yard-wise. |
| **Weighbridge integration** | ❌ Pending | Doc: weight from device API or manual. |
| **Check Post Verification** | ⚠️ Partial | Inward has Draft→Verified; doc also mentions QR/barcode scan + encoded data. |

---

## M-05 Receipts Online

| Doc item | Status | Notes |
|----------|--------|------|
| Receipt List | ✅ Done | IOMS receipt list. |
| **Receipt Detail** | ❌ Pending | Doc: Receipt no, payer, head, amount, payment mode, gateway ref, **QR download**. No `/receipts/[id]` IOMS detail with QR. |
| **Online Payment Gateway** | ❌ Pending | SBI ePay / NSDL / RazorpayGov redirect; **no gateway integration** or **callback API** implemented. |
| Counter Payment | ⚠️ Partial | Receipt create exists; doc says manual cash/cheque/DD with cheque no, bank, date. |
| Receipt Register | ✅ Done | Report + CSV export. |
| Reconciliation | ✅ Done | API + reconciliation data. |
| **Revenue Head Collection Summary** | ⚠️ Partial | Reports exist; dedicated **summary screen** per head per yard per period. |
| **QR PDF** | ❌ Pending | Generate PDF with QR (receipt no, amount, date) on Paid. |
| **Public verify** | ✅ Done | `/verify/:receiptNo`. |

---

## M-06 Payment Voucher Management

| Doc item | Status | Notes |
|----------|--------|------|
| Voucher List | ✅ Done | List + Verify/Approve/Reject/Mark Paid. |
| **Voucher Create Form** | ❌ Pending | Doc: Dedicated create form (type, payee, head, amount, supporting docs, source link). We have list actions; **no `/vouchers/create` page**. |
| **Voucher Detail** | ❌ Pending | Doc: `/vouchers/[id]` — detail + approval actions. No detail page. |
| **Advance Request Screen** | ⚠️ API only | Advances API; **no `/vouchers/advances` list page**. |
| Expenditure Heads | ✅ API | API; may be used in voucher form when built. |
| **Monthly Statement** | ❌ Pending | Doc: Auto-generated per yard per head; downloadable PDF/Excel. |
| **Approval Queue** | ❌ Pending | Doc: “Pending my action” (DV/DA) view; bulk approve. |
| **Supporting docs** | ⚠️ Schema | `supporting_docs` jsonb; doc says upload to storage — **file upload UI** not confirmed. |

---

## M-07 Vehicle Fleet Management

| Doc item | Status | Notes |
|----------|--------|------|
| Vehicle List | ✅ Done | `/fleet` (FleetVehicles). |
| **Vehicle Form** | ❌ Pending | Doc: Create/edit vehicle (registration, type, capacity, yard, dates, etc.). **No create/edit vehicle page** (only list). |
| **Vehicle Detail** | ❌ Pending | Doc: `/fleet/vehicles/[id]` with tabs: Trips, Fuel, Maintenance. We have APIs per vehicle; **no detail page**. |
| **Trip Log Screen** | ⚠️ API only | Trips API; **no trip list/entry page**. |
| **Fuel Register Screen** | ⚠️ API only | Fuel API; **no fuel page**. |
| **Maintenance Screen** | ⚠️ API only | Maintenance API; **no maintenance page**. |
| **Fitness & Insurance alerts** | ❌ Pending | Cron at 60 and 30 days before expiry; alert yard officer + admin. |
| **Reports** | ❌ Pending | Vehicle-wise utilisation, fuel consumption, maintenance cost, driver-wise mileage. |

---

## M-08 Construction & Maintenance

| Doc item | Status | Notes |
|----------|--------|------|
| Works Register | ✅ Done | Construction works list + API. |
| **Works Form** | ❌ Pending | Doc: Create/edit work (type, yard, contractor, estimate, tender, dates). **No create/edit work page**. |
| **Works Detail** | ❌ Pending | Doc: `/construction/works/[id]` + bills tab. We have GET `/api/ioms/works/:id`; **no detail page**. |
| **Contractor Bill** | ⚠️ API only | Works bills API; **no bill list/form screen** (per work). |
| **AMC Register Screen** | ⚠️ API only | AMC API; **no `/construction/amc` page**. |
| **AMC Bill Screen** | ⚠️ API only | amc_bills in schema; **no AMC bills UI**. |
| **Land Register Screen** | ⚠️ API only | Land records API; **no land register page** (create only, no edit/delete per doc). |
| **Fixed Assets Screen** | ⚠️ API only | Fixed assets API; **no fixed assets page**. |
| **Land immutability** | ❌ Pending | Doc: DB trigger BEFORE DELETE raise exception; RLS no DELETE. |
| **AMC renewal alert** | ❌ Pending | Cron 60/30 days before contract_end. |
| **Reports** | ❌ Pending | Works-wise expenditure, AMC summary, fixed asset register, land holding. |

---

## M-09 Correspondence (Dak)

| Doc item | Status | Notes |
|----------|--------|------|
| Inward Register | ✅ Done | Dak inward list (yard-scoped). |
| **Inward Entry Form** | ❌ Pending | Doc: Create/edit inward (diary no, date, from-party, subject, mode, assigned-to, deadline). **No create/edit inward page** (only list). |
| **Inward Detail** | ❌ Pending | Doc: `/correspondence/inward/[id]` + action log + outward reply link. |
| **Outward Register Screen** | ⚠️ API only | Outward API; **no outward list page**. |
| **Outward Entry Form** | ❌ Pending | Create outward; link to inward if reply. |
| **Action Tracking** | ⚠️ API only | Actions API; **no “My pending dak” or action tracking view**. |
| **File / Subject Grouping** | ⚠️ Field | `file_ref` in schema; **no subject file grouping screen** (`/correspondence/files`). |
| **SLA Dashboard** | ❌ Pending | Doc: Pending by officer; overdue highlighted; SLA breach list. **No `/correspondence/sla` page**. |
| **Diary/Despatch no auto** | ❌ Pending | Doc: DAK-IN/[YYYY-MM]/[NNN], DAK-OUT/... sequential per month. |
| **SLA cron** | ❌ Pending | Daily: if deadline &lt; today and status ≠ Closed → escalation + notify. |
| **Reports** | ❌ Pending | Pending by officer, by subject, by date; despatch register; SLA breach. |

---

## Cross-cutting (from doc “Common rules”)

| Item | Status | Notes |
|------|--------|------|
| DO→DV→DA on all modules | ✅ Done | Enforced in workflow + APIs. |
| Draft not visible outside creator's yard | ⚠️ Check | Location scope applied; confirm “draft visibility” rule. |
| Every mutation → audit_log | ✅ Done | Audit on key mutations. |
| **Supabase RLS** | N/A | We use Express middleware + `scopedLocationIds`; no RLS. |

---

## Summary: High-impact pending

1. **M-10:** Permission Matrix UI, SLA Config screen, Notification Rules.
2. **M-01:** Employee 3-tab form, photo cards, Service Book UI, Attendance/Timesheets/Claims screens, Reports, EMP-ID auto, pre-retirement cron.
3. **M-02:** Shop Vacant view, MSP screen, Reports, auto-block cron.
4. **M-03:** Invoice detail page, Rent Deposit Ledger screen, GSTR-1 export, Reports, auto-invoice cron.
5. **M-04:** Fee-rates, Farmers, Check Post Outward, Exit Permits, Bank Deposits (with verification) **screens**; Registers; Reports.
6. **M-05:** Receipt detail + QR download, **payment gateway + callback**, QR PDF generation.
7. **M-06:** Voucher **create** and **detail** pages, Advances list, Monthly Statement, Approval Queue.
8. **M-07:** Vehicle **create/edit**, Vehicle **detail** (tabs), Trip/Fuel/Maintenance **screens**, renewal alerts, Reports.
9. **M-08:** Works **form**, Works **detail** + bills, AMC/Land/Fixed Assets **screens**, land immutability, AMC renewal cron, Reports.
10. **M-09:** Inward **form** and **detail**, Outward **screens**, Action tracking, File grouping, **SLA dashboard**, diary/despatch auto, SLA cron, Reports.

---

*Generated from GAPLMB IOMS Module-Wise Dev Prompts vs current Express + React + Drizzle codebase.*
