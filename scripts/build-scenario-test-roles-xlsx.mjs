/**
 * Generates docs/SCENARIO-TEST-User-Roles-and-Permissions.xlsx from the scenario pack.
 * Run: node scripts/build-scenario-test-roles-xlsx.mjs
 */
import * as XLSX from "xlsx";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "docs", "SCENARIO-TEST-User-Roles-and-Permissions.xlsx");

const scenarioHeader = [
  "Suite",
  "ID",
  "Title",
  "Preconditions",
  "Steps",
  "Expected",
  "Status",
  "Tester",
  "Date",
  "Notes",
];

const scenarios = [
  [
    "A — Permission matrix (M-10)",
    "A1",
    "Matrix visible with M-10 Read",
    "User has M-10 Read only",
    "Open Admin → Permission matrix",
    "Page loads; matrix visible (read-only or no save, per UI).",
  ],
  [
    "A — Permission matrix (M-10)",
    "A2",
    "Toggle permission with M-10 Update",
    "User has M-10 Update; pick role R1, permission P",
    "Toggle one cell for R1 × P; persist per UI",
    "Change saved; refresh shows same state; API reflects role_permissions.",
  ],
  [
    "A — Permission matrix (M-10)",
    "A3",
    "Union of two roles",
    "User U has roles R1 and R2; R1 has M-02 Read only; R2 has M-02 Create",
    "Sign in as U; open M-02 screens / APIs that need Read vs Create",
    "Read works; Create works only if either role grants Create (union).",
  ],
  [
    "A — Permission matrix (M-10)",
    "A4",
    "ADMIN bypasses matrix for module APIs",
    "User has role with tier ADMIN",
    "Call a module API that non-admin needs explicit permission for",
    "Allowed without that role's matrix row (per server: ADMIN gets full permission list).",
  ],
  [
    "A — Permission matrix (M-10)",
    "A5",
    "No M-10 — matrix blocked",
    "User has no M-10 Read",
    "Navigate to /admin/permissions",
    "Redirect / access denied (per AdminRoute / client guards).",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B1",
    "Happy path — new login",
    "Employee Active, no userId, unique email",
    "HR Login & roles: email, name, password ≥8, optional username/phone, roles, yards; save or POST with body",
    "201; user created; employee linked; can sign in.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B2",
    "Inactive employee",
    "Employee status ≠ Active",
    "Attempt create login",
    "400 HR_LOGIN_EMPLOYEE_INVALID — Employee not found or not Active.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B3",
    "Duplicate employee link",
    "Employee already has login",
    "Attempt second POST for same employee",
    "400 HR_LOGIN_EMPLOYEE_ALREADY_LINKED.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B4",
    "Missing email or name",
    "Active employee, no login",
    "POST without email or name",
    "400 HR_LOGIN_FIELDS_REQUIRED — email, name required.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B5",
    "Password too short",
    "Active employee, no login",
    "Password 7 chars",
    "400 HR_LOGIN_PASSWORD_REQUIRED — password is required.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B6",
    "DV + DA conflict",
    "Two roles: one tier DV, one tier DA",
    "Assign both on create",
    "400 HR_ROLE_DV_DA_CONFLICT — A user cannot hold both Data Verifier (DV) and Data Approver (DA) roles.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B7",
    "DO + DV allowed",
    "One DO-tier role, one DV-tier role",
    "Assign both on create",
    "201; no DV/DA conflict error.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B8",
    "Invalid email",
    "—",
    "Email not-an-email",
    "400 HR_EMP_EMAIL_FORMAT — Personal email must be a valid email address.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B9",
    "Invalid phone",
    "—",
    "Phone not 10-digit Indian mobile",
    "400 HR_EMP_MOBILE_FORMAT — Mobile must be a valid 10-digit Indian number.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B10",
    "Duplicate email/username",
    "Another user uses same email or username",
    "Create with that email/username",
    "409 HR_LOGIN_DUPLICATE — Email or username already exists.",
  ],
  [
    "B — Employee login create (POST …/login)",
    "B11",
    "Empty roles/yards",
    "Valid payload, roleIds/yardIds empty or omitted",
    "Create",
    "201; user has no roles / no yards until updated.",
  ],
  [
    "C — Employee login update (PUT …/login)",
    "C1",
    "Happy path — patch fields",
    "Login exists",
    "Update name, email, roles, yards, active",
    "200 / success; changes visible after refresh.",
  ],
  [
    "C — Employee login update (PUT …/login)",
    "C2",
    "No login",
    "Employee without linked user",
    "PUT",
    "404 HR_LOGIN_NOT_FOUND — No app login for this employee.",
  ],
  [
    "C — Employee login update (PUT …/login)",
    "C3",
    "New password too short",
    "Login exists",
    "PUT with password 7 chars",
    "400 HR_LOGIN_PASSWORD_COMPLEXITY — BR-USR-10 (min 12 chars, upper, lower, digit, special).",
  ],
  [
    "C — Employee login update (PUT …/login)",
    "C4",
    "Skip password",
    "Login exists",
    "PUT without password field or empty password",
    "Password unchanged; other fields may update.",
  ],
  [
    "C — Employee login update (PUT …/login)",
    "C5",
    "DV + DA on update",
    "Login exists; body sets roleIds with DV+DA",
    "PUT",
    "400 HR_ROLE_DV_DA_CONFLICT (same message as B6).",
  ],
  [
    "C — Employee login update (PUT …/login)",
    "C6",
    "Deactivate account",
    "Login exists",
    "Set Account active off / isActive: false",
    "User cannot sign in (or session invalidated per app policy).",
  ],
  [
    "C — Employee login update (PUT …/login)",
    "C7",
    "Clear phone",
    "Login had phone",
    "PUT with phone null or \"\"",
    "Phone cleared; no format error.",
  ],
  [
    "D — End-to-end access (RBAC + menus)",
    "D1",
    "Module denied",
    "User's roles have no M-XX permission",
    "Open module menu / deep link / API",
    "Access denied or 403 per requireModulePermissionByPath.",
  ],
  [
    "D — End-to-end access (RBAC + menus)",
    "D2",
    "Read-only",
    "Role has M-XX Read only",
    "Open list; attempt Create",
    "List OK; create action hidden or API 403.",
  ],
  [
    "D — End-to-end access (RBAC + menus)",
    "D3",
    "HR without M-10",
    "User M-01 only",
    "Open employee with Login section",
    "Login section hidden or disabled (per EmployeeLoginAccessSection M-10 checks).",
  ],
  [
    "D — End-to-end access (RBAC + menus)",
    "D4",
    "Yard scope",
    "User has yards Y1 only; record at Y2",
    "List yard-scoped data",
    "Record at Y2 not visible (or filtered), per yard rules.",
  ],
  [
    "E — Workflow segregation (spot checks)",
    "E1",
    "Cannot DV own DO",
    "Same user created (DO) and tries verify (DV)",
    "Submit as DO; same login attempts DV transition",
    "Blocked with workflow error (not necessarily same as role-assignment DV+DA).",
  ],
  [
    "E — Workflow segregation (spot checks)",
    "E2",
    "ADMIN exemption",
    "User ADMIN tier",
    "Perform action non-admin is blocked on",
    "Allowed where workflow exempts ADMIN.",
  ],
];

const apiRef = [
  ["Operation", "Method", "Path"],
  ["Create employee login", "POST", "/api/hr/employees/:employeeId/login"],
  ["Update employee login", "PUT", "/api/hr/employees/:employeeId/login"],
  ["Role permissions", "GET / POST / DELETE", "/api/admin/role-permissions (and related admin endpoints)"],
];

const traceability = [
  ["SOP section", "Scenario IDs"],
  ["Procedure A (Permission matrix)", "A1–A5"],
  ["Procedure B (Login & roles)", "B1–B11, C1–C7, D3"],
  ["Rules: DV+DA, DO+DV", "B6–B7, C5"],
  ["Email / phone / password", "B5, B8–B9, C3–C4, C7"],
  ["Duplicates / inactive", "B2–B3, B10"],
  ["Union of roles", "A3"],
  ["ADMIN", "A4, E2"],
  ["Workflow vs assignment", "E1"],
];

const wb = XLSX.utils.book_new();

const scenarioRows = [
  scenarioHeader,
  ...scenarios.map((row) => [...row, "", "", "", ""]),
];
const ws1 = XLSX.utils.aoa_to_sheet(scenarioRows);
ws1["!cols"] = [
  { wch: 36 },
  { wch: 6 },
  { wch: 28 },
  { wch: 42 },
  { wch: 48 },
  { wch: 52 },
  { wch: 10 },
  { wch: 14 },
  { wch: 12 },
  { wch: 24 },
];
XLSX.utils.book_append_sheet(wb, ws1, "Scenarios");

const ws2 = XLSX.utils.aoa_to_sheet(apiRef);
ws2["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 56 }];
XLSX.utils.book_append_sheet(wb, ws2, "API reference");

const ws3 = XLSX.utils.aoa_to_sheet(traceability);
ws3["!cols"] = [{ wch: 40 }, { wch: 36 }];
XLSX.utils.book_append_sheet(wb, ws3, "Traceability");

XLSX.writeFile(wb, outPath);
console.log("Wrote", outPath);
