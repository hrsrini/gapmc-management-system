# Scenario test pack: User roles, permissions, and employee login

**Purpose:** Executable test scenarios for QA / UAT, aligned with [`SOP-User-Roles-and-Permissions.md`](./SOP-User-Roles-and-Permissions.md).

**Conventions**

- **Actor:** Who performs the step (Admin, HR-M10, User-A, etc.).
- **Preconditions:** Data and access state before the scenario.
- **Steps:** Ordered actions (UI or API).
- **Expected:** Observable outcome (HTTP, message, UI, data).

**APIs (reference)**

| Operation | Method | Path |
|-----------|--------|------|
| Create employee login | `POST` | `/api/hr/employees/:employeeId/login` |
| Update employee login | `PUT` | `/api/hr/employees/:employeeId/login` |
| List/update role permissions | `GET` / `POST` / `DELETE` | `/api/admin/role-permissions` … |

---

## Suite A — Permission matrix (M-10)

| ID | Title | Preconditions | Steps | Expected |
|----|--------|---------------|-------|----------|
| **A1** | Matrix visible with M-10 Read | User has M-10 **Read** only | Open **Admin → Permission matrix** | Page loads; matrix visible (read-only or no save, per UI). |
| **A2** | Toggle permission with M-10 Update | User has M-10 **Update**; pick role R1, permission P | Toggle one cell for R1 × P; persist per UI | Change saved; refresh shows same state; API reflects `role_permissions`. |
| **A3** | Union of two roles | User U has roles R1 and R2; R1 has M-02 Read only; R2 has M-02 Create | Sign in as U; open M-02 screens / APIs that need Read vs Create | Read works; Create works only if **either** role grants Create (union). |
| **A4** | ADMIN bypasses matrix for module APIs | User has role with tier **ADMIN** | Call a module API that non-admin needs explicit permission for | Allowed without that role’s matrix row (per server: ADMIN gets full permission list). |
| **A5** | No M-10 — matrix blocked | User has no M-10 Read | Navigate to `/admin/permissions` | Redirect / access denied (per `AdminRoute` / client guards). |

---

## Suite B — Employee login create (`POST …/login`)

| ID | Title | Preconditions | Steps | Expected |
|----|--------|---------------|-------|----------|
| **B1** | Happy path — new login | Employee **Active**, no `userId`, unique email | HR **Login & roles**: email, name, password ≥8, optional username/phone, roles, yards; save **or** `POST` with body | `201`; user created; employee linked; can sign in. |
| **B2** | Inactive employee | Employee status ≠ Active | Attempt create login | `400` `HR_LOGIN_EMPLOYEE_INVALID` — *Employee not found or not Active*. |
| **B3** | Duplicate employee link | Employee already has login | Attempt second `POST` for same employee | `400` `HR_LOGIN_EMPLOYEE_ALREADY_LINKED`. |
| **B4** | Missing email or name | Active employee, no login | `POST` without `email` or `name` | `400` `HR_LOGIN_FIELDS_REQUIRED` — *email, name required*. |
| **B5** | Password fails BR-USR-10 | Active employee, no login | Password too short or missing complexity | `400` `HR_LOGIN_PASSWORD_COMPLEXITY` or `HR_LOGIN_PASSWORD_REQUIRED` — see server message (min 12 chars, upper, lower, digit, special). |
| **B6** | DV + DA conflict | Two roles: one tier DV, one tier DA | Assign both on create | `400` `HR_ROLE_DV_DA_CONFLICT` — *A user cannot hold both Data Verifier (DV) and Data Approver (DA) roles.* |
| **B7** | DO + DV allowed | One DO-tier role, one DV-tier role | Assign both on create | `201`; no DV/DA conflict error. |
| **B8** | Invalid email | — | Email `not-an-email` | `400` `HR_EMP_EMAIL_FORMAT` — *Personal email must be a valid email address.* |
| **B9** | Invalid phone | — | Phone not 10-digit Indian mobile | `400` `HR_EMP_MOBILE_FORMAT` — *Mobile must be a valid 10-digit Indian number.* |
| **B10** | Duplicate email/username | Another user uses same email or username | Create with that email/username | `409` `HR_LOGIN_DUPLICATE` — *Email or username already exists*. |
| **B11** | Empty roles/yards | Valid payload, `roleIds`/`yardIds` empty or omitted | Create | `201`; user has no roles / no yards until updated. |

---

## Suite C — Employee login update (`PUT …/login`)

| ID | Title | Preconditions | Steps | Expected |
|----|--------|---------------|-------|----------|
| **C1** | Happy path — patch fields | Login exists | Update name, email, roles, yards, active | `200` / success; changes visible after refresh. |
| **C2** | No login | Employee without linked user | `PUT` | `404` `HR_LOGIN_NOT_FOUND` — *No app login for this employee*. |
| **C3** | New password fails BR-USR-10 | Login exists | `PUT` with weak `password` | `400` `HR_LOGIN_PASSWORD_COMPLEXITY`. |
| **C4** | Skip password | Login exists | `PUT` without `password` field or empty password | Password unchanged; other fields may update. |
| **C5** | DV + DA on update | Login exists; body sets `roleIds` with DV+DA | `PUT` | `400` `HR_ROLE_DV_DA_CONFLICT` (same message as B6). |
| **C6** | Deactivate account | Login exists | Set **Account active** off / `isActive: false` | User cannot sign in (or session invalidated per app policy). |
| **C7** | Clear phone | Login had phone | `PUT` with `phone` null or `""` | Phone cleared; no format error. |

---

## Suite D — End-to-end access (RBAC + menus)

| ID | Title | Preconditions | Steps | Expected |
|----|--------|---------------|-------|----------|
| **D1** | Module denied | User’s roles have no M-XX permission | Open module menu / deep link / API | Access denied or 403 per `requireModulePermissionByPath`. |
| **D2** | Read-only | Role has M-XX Read only | Open list; attempt Create | List OK; create action hidden or API 403. |
| **D3** | HR without M-10 | User M-01 only | Open employee with Login section | Login section hidden or disabled (per `EmployeeLoginAccessSection` M-10 checks). |
| **D4** | Yard scope | User has yards Y1 only; record at Y2 | List yard-scoped data | Record at Y2 not visible (or filtered), per yard rules. |

---

## Suite E — Workflow segregation (spot checks)

*Exact screens vary by module; use a module that calls `workflow` tier checks.*

| ID | Title | Preconditions | Steps | Expected |
|----|--------|---------------|-------|----------|
| **E1** | Cannot DV own DO | Same user created (DO) and tries verify (DV) | Submit as DO; same login attempts DV transition | Blocked with workflow error (not necessarily same as role-assignment DV+DA). |
| **E2** | ADMIN exemption | User ADMIN tier | Perform action non-admin is blocked on | Allowed where workflow exempts ADMIN. |

---

## Traceability (SOP → scenarios)

| SOP section | Scenario IDs |
|-------------|----------------|
| Procedure A (Permission matrix) | A1–A5 |
| Procedure B (Login & roles) | B1–B11, C1–C7, D3 |
| Rules: DV+DA, DO+DV | B6–B7, C5 |
| Email / phone / password | B5, B8–B9, C3–C4, C7 |
| Duplicates / inactive | B2–B3, B10 |
| Union of roles | A3 |
| ADMIN | A4, E2 |
| Workflow vs assignment | E1 |

---

## Document control

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-04-12 | Initial scenario pack for roles, matrix, and HR login APIs. |
