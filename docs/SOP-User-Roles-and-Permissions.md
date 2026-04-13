# SOP: User roles, module permissions, and employee login

**Purpose:** Standard steps to give staff access to IOMS modules (“forms”) and to use DO / DV / DA workflow tiers correctly.

**Scope:** GAPMC Management System — Admin (RBAC), HR employee record **Login & roles**.

---

## 1. Concepts (read once)

| Term | Meaning in this system |
|------|------------------------|
| **Role** | Named bucket (e.g. “Market DO”, “Accounts DV”). Each role has a **tier** (DO, DV, DA, READ_ONLY, ADMIN) and is linked to **module permissions** in the Permission matrix. |
| **Module (M-01 … M-10)** | Area of the app (HR, Traders & Assets, Rent, Market Fee, Receipts, Vouchers, Fleet, Construction, Dak, Admin). API and screens check these for **Read / Create / Update / Delete / Approve** as applicable. |
| **DO / DV / DA (tier)** | **Workflow** roles: **D**ata **O**riginator, **V**erifier, **A**pprover. They control who may move records through verification/approval **when the workflow enforces segregation**. They do **not** replace the Permission matrix: the user still needs module permissions to open menus and call APIs. |
| **Locations (yards)** | Limits **yard-scoped** data to selected sites for that login. |
| **One login per employee** | Each employee may have at most one app user account, linked from HR. |

---

## 2. Prerequisites

| Task | Required permission |
|------|---------------------|
| Open **Admin → Permission matrix** (`/admin/permissions`) | **M-10 Read** (typically **M-10 Update** to change checkboxes) |
| View **Employee → Login & roles** | **M-10 Read** |
| **Create** a new app login for an employee | **M-10 Create** |
| **Change** login (roles, yards, password, active flag) | **M-10 Update** |

If you only have HR (M-01) access, ask an administrator to perform login and role assignment.

---

## 3. Procedure A — Configure what each **role** can do (modules / forms)

**Do this when:** You introduce a new role, change responsibilities, or onboard a new module for a team.

1. Sign in as a user with **M-10** access.
2. Go to **Admin → Permission matrix** (sidebar: *Permission matrix*).
3. Review **columns**: roles; **rows**: permissions grouped by module (M-01 … M-10) and action (Create, Read, Update, Delete, Approve where defined).
4. For each **role** that should access a module:
   - Tick the cells for the **minimum** actions needed (e.g. list screens need **Read**; data entry needs **Create** / **Update** as required).
5. Save or confirm changes per the UI (toggles apply to `role_permissions` on the server).
6. **Tip:** Users with **multiple roles** receive the **union** of all permissions from those roles.

**ADMIN tier:** Users with an **ADMIN** role generally bypass the permission matrix for normal module APIs; Admin screens still use **M-10** rules where enforced.

---

## 4. Procedure B — Assign **login**, **roles**, and **locations** to an employee

**Do this when:** A staff member needs to sign in, or their access must change.

1. Ensure the **employee record is Active** (new logins cannot be created for inactive employees).
2. Open **HR → Employees**, select the employee (**detail** or **edit** form).
3. Open the **Login & roles** section (card on the same page).
4. **If no login exists yet**
   - Fill **Email** and **Display name** (required).
   - Optionally set **Username** (sign-in alias), **Phone** (10-digit Indian mobile if provided).
   - Set **Password** and **Confirm** (minimum **8** characters).
   - Under **Roles**, tick one or more roles (these carry the tiers DO / DV / DA / etc. as defined under **Admin → Roles**).
   - Under **Locations**, tick every yard/check post / HO scope the user should see for yard-filtered data.
   - Submit / save. Confirm success message (“Login settings saved” / created).
5. **If login already exists**
   - Adjust email, name, username, phone as allowed by your **M-10 Update** rights.
   - Use **Account active** to allow or block sign-in without deleting the link.
   - Optional **New password** (leave blank to keep current); if set, minimum **8** characters and must match confirm.
   - Update **Roles** and **Locations** checkboxes as needed; save.

---

## 5. Rules and validations (must follow)

| Rule | Detail |
|------|--------|
| **DV + DA** | The same user **must not** be assigned **both** a **DV-tier** role and a **DA-tier** role. The system rejects save with an error (segregation of duties at assignment time). |
| **DO + DV** | **Allowed** on the same user (system permits). |
| **Email** | Must be a valid personal/work email format (server validates). |
| **Phone** | If provided, must be a valid **10-digit Indian** mobile number. |
| **Password** | Minimum **8** characters on create; on update, only validated when a new password is entered. |
| **Duplicates** | Email and username (if used) must be unique; employee cannot already be linked to another login. |
| **Workflow segregation** | Even with correct roles, some workflows block the **same person** from verifying or approving their own prior step (e.g. cannot DV own DO submission; cannot DA if they were DO/DV on that record). **ADMIN** may be exempt where the workflow allows. |

---

## 6. Recommended order for new staff

1. Confirm **Admin → Roles** lists the roles you need (create or edit roles there if your process allows).
2. Set **Admin → Permission matrix** for those roles (Procedure A).
3. In **HR**, activate the employee, then complete **Login & roles** (Procedure B).
4. Ask the user to sign in and verify they can reach the intended menus; if a screen says access denied, adjust the **Permission matrix** for their **role(s)**, not only the tier.

---

## 7. Quick reference — where things live in the app

| Need | Navigation |
|------|------------|
| Module/form access per role | **Admin → Permission matrix** (`/admin/permissions`) |
| Role names and tiers | **Admin → Roles** (`/admin/roles`) |
| Yards / locations master | **Admin → Locations** (`/admin/locations`) |
| Link login + assign roles & yards | **HR → Employees → [employee] → Login & roles** |

---

## 8. Document control

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-04-12 | Initial SOP aligned with current RBAC and HR login APIs. |

Adjust dates and local policy (who approves matrix changes) to match your organisation.
