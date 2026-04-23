# IOMS – Next steps

After sample data and current implementation, suggested next steps:

1. ~~**Role-based actions in UI**~~ **Done**  
   Rent Invoices and Payment Vouchers list pages now have **Verify** (DV/ADMIN, Draft/Submitted → Verified), **Approve** / **Reject** (DA/ADMIN, Verified → Approved/Rejected), and **Mark Paid** (DA/ADMIN, Approved → Paid). Buttons call `PUT` with the new status and refetch the list.

2. ~~**Workflow on more modules**~~ **Done (Leave + Purchase)**  
   **M-01 Leave requests:** `canCreateLeaveRequest` / `canTransitionLeaveRequest`; POST creates only with status Pending; PUT enforces Pending → Approved/Rejected (DA) and sets `approvedBy`.  
   **M-04 Purchase transactions:** `canCreatePurchaseTransaction` / `canEditDraftPurchaseTransaction` / `canTransitionPurchaseTransaction`; POST sets status Draft and `doUser`; new PUT enforces Draft → Verified → Approved and sets `dvUser`/`daUser`, with audit log. Check post inward (Draft → Verified) can be added later if needed.

3. ~~**Yard scoping for remaining IOMS modules**~~ **Done**  
   **Fleet (M-07):** Vehicles list/get/post/put and trips/fuel/maintenance scoped by `req.scopedLocationIds`; create trip/fuel/maintenance checks vehicle’s yard.  
   **Construction (M-08):** Works, AMC, land records, fixed assets list/get/post scoped; works put and works/:workId/bills get/post scoped by work’s yard.  
   **Dak (M-09):** No `yardId` in schema; scoping skipped.

4. ~~**Audit log for more mutations**~~ **Done**  
   `writeAuditLog` added for IOMS receipt **create** and **patch** (Receipts module). Market purchase transaction updates already had audit. Other state-changing endpoints can be added as needed.

5. ~~**Client: 403 handling**~~ **Done**  
   On 403, client shows toast and redirects to **/access-denied**. New `AccessDenied` page with message and “Back to dashboard” link. `Auth403Listener` uses `setLocation("/access-denied")`.

6. ~~**Reports and exports**~~ **Done**  
   **API:** `GET /api/ioms/reports/rent-summary`, `voucher-summary`, `receipt-register` (yard-scoped; optional `yardId`, `from`, `to`). `?format=csv` returns CSV download (UTF-8 BOM for Excel).  
   **Client:** **IOMS Reports & Export** page at `/reports/ioms` (sidebar under Receipts) with yard/from/to filters and “Download CSV” for each report.

---

### Done after “complete all next steps”

7. **Workflow actions in UI for Leave + Purchase**  
   **Market (M-04):** Purchase Transactions page has **Verify** (Draft → Verified) and **Approve** (Verified → Approved) buttons for DV/DA/ADMIN; calls `PUT /api/ioms/market/transactions/:id` with status.  
   **HR (M-01):** New **Leave requests** page at `/hr/leaves` (sidebar under HR) lists leave requests and shows **Approve** / **Reject** for Pending when user is DA/ADMIN; calls `PUT /api/hr/leaves/:id` with status.

---

### Done (optional follow-ups)

8. **Audit on more mutations**  
   **Fleet:** `writeAuditLog` on vehicle create and update (module `"Fleet"`).  
   **Construction:** `writeAuditLog` on work create and update (module `"Construction"`).  
   **HR:** `writeAuditLog` on leave request create and update (module `"HR"`).

9. **GET single work**  
   `GET /api/ioms/works/:id` added with yard scope (404 if work not found or yard not in `req.scopedLocationIds`). Registered before `.../works/:workId/bills` so detail vs bills paths do not conflict.

10. **Check post inward (M-04) workflow**  
   **Server:** `canVerifyCheckPostInward(user)` in workflow (DV/ADMIN only). `PUT /api/ioms/checkpost/inward/:id` added: only DV/ADMIN can set status Draft → Verified; other fields updatable; audit log (module `"CheckPost"`).  
   **Client:** Check Post Inward page has **Verify** button (DV/ADMIN, Draft → Verified); calls PUT and refetches list.

11. **Dak by yard (M-09)**  
   **Schema:** Optional `yardId` added to `dak_inward` and `dak_outward` in `shared/db-schema.ts`. Run `npm run db:push` to add columns.  
   **Server:** Dak routes yard-scoped. List inward/outward: when `req.scopedLocationIds` is set, only rows with `yardId` in scope or `yardId` null. GET inward/:id and PUT inward check yard scope; POST inward/outward require yardId in scope when provided. Actions and escalations: creating or listing scoped by inward’s yard. Optional `?yardId=` filter on list.  
   **Backward compatible:** Null `yardId` = visible to all; existing rows stay visible until assigned to a yard.

---

### Done (complete all pending steps + continue)

12. **M-06 Vouchers:** Voucher **create** form (`/vouchers/create`) and **detail** page (`/vouchers/:id`) with Verify/Approve/Reject/Mark Paid; list links to create and to detail.

13. **M-07 Fleet:** **Vehicle create/edit** form (`/fleet/vehicles/new`, `/fleet/vehicles/:id/edit`), **vehicle detail** (`/fleet/vehicles/:id`) with tabs (Trips, Fuel, Maintenance) and **Add trip**, **Add fuel**, **Add maintenance** dialogs; list has “Add vehicle” and registration links to detail.

14. **M-08 Construction:** **Work form** (create/edit), **Work detail** (`/construction/works/:id`) with **Bills** tab and **Add bill** dialog; **AMC**, **Land records**, **Fixed assets** list pages; list has “Add work” and work-no link to detail.

15. **M-09 Dak:** **Inward form** (create/edit), **Inward detail** with **Action log** and “Add action”; **Outward** list and **Add outward** form.

16. **M-04 Market / Check post:** **Fee rates**, **Farmers**, **Check post outward**, **Exit permits**, **Bank deposits** list pages; **MSP settings** list (`/market/msp`).

17. **M-10 Admin:** **Permission matrix** (`/admin/permissions`) read-only grid; **SLA config** (`/admin/sla-config`) list + Add/Edit; API `GET/POST/PUT /api/admin/sla-config`.

18. **IOMS Rent / Receipts / HR / Ledger:** **Rent invoice detail** (`/rent/ioms/invoices/:id`) with Verify/Approve/Reject; **Receipt detail** (`/receipts/ioms/:id`); **Rent deposit ledger** (`/rent/ioms/ledger`); **HR Claims** (LTC + TA-DA) at `/hr/claims`; **Attendance** (`/hr/attendance`), **Timesheets** (`/hr/timesheets`).

19. **Sample data:** `npm run db:seed-ioms-sample` seeds data for **all sidebar menu items** and **employee users for role-wise login** (password: `GapmcUsers@2026!`): `do@gapmc.local` (DO), `dv@gapmc.local` (DV), `da@gapmc.local` (DA), `readonly@gapmc.local` (Read Only). Admin remains `admin@gapmc.local` (password: `GapmcAdmin@2026!`). Seeds: trader licences, blocking log, assets, asset allotments, credit notes (M-03), advance requests (M-06), recruitment, leave requests; plus employees, market fee rates, fleet (vehicles + trips/fuel/maintenance), construction (works, bills, AMC, land, fixed assets), dak (inward, outward, action log), check post (inward, outward, exit permits, bank deposits), attendances, timesheets, LTC/TA-DA claims, rent invoices, rent ledger, IOMS receipts, MSP settings, SLA config. Run after `db:push` and `db:seed-ioms-m10`.

20. **Work detail – Add bill:** Construction Work detail Bills tab has **Add bill** dialog (bill no, date, amount, cumulative paid, status); calls `POST /api/ioms/works/bills`.

21. **Dak inward – actionBy:** Inward detail “Add action” now uses the current user’s name or email from auth (`useAuth()` → `user?.name ?? user?.email ?? "Current User"`).

22. **Employee detail + Service Book:** **HrEmployeeDetail** at `/hr/employees/:id` shows employee overview (designation, yard, type, status, joining/DOB/mobile/email) and a **Service Book** tab that lists entries (section, status, content, approved by/at) and has **Add entry** (section, content text, status) calling `POST /api/hr/employees/:employeeId/service-book`.

23. **Employees list → detail:** HR Employees list links Emp ID and Name to `/hr/employees/:id`; route added in App.tsx.

24. **Shop Vacant view (M-02):** **API** `GET /api/ioms/assets/vacant?yardId=` returns assets with no active allotment; each row includes asset, last allotment (previous allottee, toDate, daUser), and last rent amount from rent invoices. **Page** at `/assets/vacant` (sidebar: Assets → Shop Vacant) with optional yard filter and table: Asset ID, Yard, Type, Complex, Previous allottee, Vacated on, Officer (DA), Last rent.

25. **Employee 3-tab form (M-01):** **HrEmployeeForm** at `/hr/employees/new` (create) and `/hr/employees/:id/edit` (edit) with three tabs: **Public info** (first name, middle, surname, photo URL, designation, yard, employee type, Emp ID when editing), **Personal info** (Aadhaar token, PAN, DOB, mobile, work email), **HR settings** (joining date, retirement date, status, user ID link). List page has “Add employee” → new; detail page has “Edit” → edit. POST/PUT use existing `/api/hr/employees` and `/api/hr/employees/:id`.

26. **Timesheet validation (M-01):** **API** `PUT /api/hr/timesheets/:id` — can set `status` (Draft ↔ Validated) and optional `totalAttendance` / `totalTimesheet`; when transitioning Draft → Validated, `validatedBy` is set to current user (id or name from auth). **UI** — Timesheets page has a **Validate** button per row for Draft timesheets; on success the list refetches and the row shows Validated with validated-by.

27. **Shop Allotments (M-02):** **AssetAllotments** page at `/assets/allotments` (sidebar: Assets → Shop Allotments): list of allotments with optional filter by asset; table shows Asset (display id), Allottee, Licence, From/To dates, Status, Security deposit. **Add allotment** dialog: Asset (dropdown), Trader licence (dropdown), Allottee name, From/To date, Status (Active/Vacated), Security deposit; POST to `/api/ioms/assets/allotments`. Uses existing GET/POST APIs.

28. **Blocking log (M-02):** **TraderBlockingLog** page at `/traders/blocking-log` (sidebar: Traders → Blocking log): list of block/unblock entries with optional filter by trader licence; table shows Licence, Action (Blocked/Unblocked), Reason, Actioned by, Actioned at. **Add entry** dialog: Trader licence (dropdown), Action (Blocked/Unblocked), Reason; actionedBy set from current user (auth). Uses existing GET/POST `/api/ioms/traders/blocking-log`.

29. **Employee Contracts (M-01):** **HrEmployeeDetail** now has a **Contracts** tab alongside Service book: lists contracts (contract type, pay scale, start/end date) and **Add contract** dialog (contract type, pay scale, start date, end date); POST to `/api/hr/employees/:employeeId/contracts`. Uses existing GET/POST APIs.

30. **Staff list report (M-01):** **API** `GET /api/hr/reports/staff-list?yardId=&format=csv` returns employee list (optional yard filter); `format=csv` returns CSV with columns empId, firstName, middleName, surname, designation, yardId, employeeType, joiningDate, status, mobile, workEmail, dob, retirementDate (UTF-8 BOM for Excel). **UI** — IOMS Reports page has a **Staff list (HR)** card with **Download CSV**; uses same yard filter as other reports.

31. **Consolidated HR report (M-01):** **API** `GET /api/hr/reports/consolidated?yardId=` returns JSON: `{ total, byYard, byStatus, byEmployeeType }` (headcount by yard, status, employee type). **UI** — IOMS Reports has a **Consolidated HR** card that fetches and shows total employees and breakdown by status, type, and (when no yard filter) by yard; same **Download CSV** as Staff list.

32. **Trader licence detail (M-02):** **TraderLicenceDetail** at `/traders/licences/:id`: loads licence via `GET /api/ioms/traders/licences/:id`, shows licence no, firm name, status/type badges, yard, contact, mobile, email, address, validity, fee, receipt, block reason when blocked. **Blocking log** section lists entries for this licence (`GET /api/ioms/traders/blocking-log?traderLicenceId=`) with link to add entry on Blocking log page. **TraderLicences** list links licence no and firm name to detail; route added in App.tsx.

33. **Receipt QR download (M-05):** **IomsReceiptDetail** now generates a QR code encoding the public verify URL (`/verify/:receiptNo`) and shows it inline with a **Download QR (PNG)** button. Keeps compatibility with existing `qrCodeUrl` when present.

---

### Enabling Admin: Users, Roles, Permission matrix

For **Users**, **Roles**, and **Permission matrix** to work:

1. **Run the M-10 seed** so that the admin user and roles exist:  
   `npm run db:push` then `npm run db:seed-ioms-m10`
2. **Log in as administrator**: **admin@gapmc.local** / **GapmcAdmin@2026!**
3. **Use the same origin for API and UI** so the session cookie is sent: start the app with `npm run dev` (single server on port 5000 that serves both API and client). If you use a separate Vite dev server, ensure the proxy forwards cookies to the backend.
4. **Access is permission-based**: Admin API access is controlled by the **Permission matrix** (M-10). **ADMIN** tier always has full access. **READ_ONLY** role is seeded with all "Read" permissions (so they can open Admin and view Users, Roles, Permission matrix but not create/edit/delete). Other roles get only what is assigned in the matrix.

**How to test (READ_ONLY across all menus):**
- **Full access:** Log in as **admin@gapmc.local** / **GapmcAdmin@2026!** (ADMIN) — full access to all menus and actions.
- **Read-only access:** Run `npm run db:seed-ioms-m10` (assigns all "Read" permissions to READ_ONLY role), then log in as **readonly@gapmc.local** / **GapmcUsers@2026!**. This user can open **all** sidebar menus and **view** lists and details (GET allowed). Any **create / edit / delete** (POST, PUT, PATCH, DELETE) returns **403**. So: Dashboard, Rent, Traders, Assets, Market Fee, Check Post, Receipts, Vouchers, Fleet, Construction, Correspondence, HR, and Admin (Users, Roles, Permission matrix) are all viewable; Add/Edit/Delete buttons or form submits will fail with 403.

---

### Automated tests (Playwright)

- **Install browser once:** `npm run test:pw:install` (Chromium).
- **API tests** (`tests/api/` — health, login, session + yards): `npm run test:pw:api`
- **Browser E2E** (`tests/e2e/`): `npm run test:pw:e2e`
- **All:** `npm run test:pw` — starts `npm run dev` automatically unless **`PW_NO_WEBSERVER=1`** (then use an already-running server). Set **`PLAYWRIGHT_BASE_URL`** if not on port 5000 (see `.env.example`). Optional **`PW_ADMIN_EMAIL`** / **`PW_ADMIN_PASSWORD`** if your admin password is not the seeded default.

---

All listed next steps are done. Further enhancements (e.g. more reports, notifications) can be added as needed.
