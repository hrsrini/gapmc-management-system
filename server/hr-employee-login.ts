/**
 * App login (IOMS user) as part of employee management — not exposed as standalone user admin.
 * POST/PUT /api/hr/employees/:id/login; profiles for GET includeApp / login-profile.
 */
import type { Request, Response } from "express";
import { hash } from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import {
  users,
  employees,
  userRoles,
  userYards,
  roles,
  yards,
  permissions,
  rolePermissions,
} from "@shared/db-schema";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { sendTransactionalEmailTo } from "./notify";
import { assertRoleIdsNoDvDaConflict } from "./role-constraints";
import {
  assertPasswordComplexityBrUsr10,
  assertPersonalEmailFormat,
  HrEmployeeRuleError,
  normalizeMobile10,
} from "./hr-employee-rules";

function userSnapshotForAudit(u: Record<string, unknown> | undefined) {
  if (!u) return undefined;
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

const now = () => new Date().toISOString();

export async function resolveUserIdForEmployee(employeeId: string): Promise<string | null> {
  const [emp] = await db
    .select({ userId: employees.userId })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (emp?.userId) return emp.userId;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeId)).limit(1);
  return u?.id ?? null;
}

function sendHrRule(res: Response, e: unknown): boolean {
  if (e instanceof HrEmployeeRuleError) {
    sendApiError(res, 400, e.code, e.message);
    return true;
  }
  return false;
}

function dedupeSortPerms(list: { module: string; action: string }[]): { module: string; action: string }[] {
  const seen = new Set<string>();
  const out: { module: string; action: string }[] = [];
  for (const p of list) {
    const k = `${p.module}:${p.action}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.sort((a, b) => a.module.localeCompare(b.module) || a.action.localeCompare(b.action));
}

async function effectivePermissionsByUserIds(userIds: string[]): Promise<Map<string, { module: string; action: string }[]>> {
  const out = new Map<string, { module: string; action: string }[]>();
  if (userIds.length === 0) return out;

  const assignments = await db
    .select({
      userId: userRoles.userId,
      roleId: userRoles.roleId,
      tier: roles.tier,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, userIds));

  const userToRoleRows = new Map<string, { roleId: string; tier: string }[]>();
  for (const a of assignments) {
    const arr = userToRoleRows.get(a.userId) ?? [];
    arr.push({ roleId: a.roleId, tier: a.tier });
    userToRoleRows.set(a.userId, arr);
  }

  const allPermRows = await db.select({ module: permissions.module, action: permissions.action }).from(permissions);
  const allPermList = allPermRows.map((p) => ({ module: p.module, action: p.action }));

  const nonAdminRoleIds = new Set<string>();
  for (const uid of userIds) {
    const rts = userToRoleRows.get(uid) ?? [];
    if (rts.some((r) => r.tier === "ADMIN")) {
      out.set(uid, dedupeSortPerms(allPermList));
    } else {
      for (const r of rts) nonAdminRoleIds.add(r.roleId);
    }
  }

  let permsByRole = new Map<string, { module: string; action: string }[]>();
  if (nonAdminRoleIds.size > 0) {
    const rpRows = await db
      .select({
        roleId: rolePermissions.roleId,
        module: permissions.module,
        action: permissions.action,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(rolePermissions.roleId, Array.from(nonAdminRoleIds)));
    permsByRole = new Map();
    for (const row of rpRows) {
      const arr = permsByRole.get(row.roleId) ?? [];
      arr.push({ module: row.module, action: row.action });
      permsByRole.set(row.roleId, arr);
    }
  }

  for (const uid of userIds) {
    if (out.has(uid)) continue;
    const rts = userToRoleRows.get(uid) ?? [];
    const seen = new Set<string>();
    const acc: { module: string; action: string }[] = [];
    for (const r of rts) {
      for (const p of permsByRole.get(r.roleId) ?? []) {
        const k = `${p.module}:${p.action}`;
        if (seen.has(k)) continue;
        seen.add(k);
        acc.push(p);
      }
    }
    out.set(uid, dedupeSortPerms(acc));
  }

  for (const uid of userIds) {
    if (!out.has(uid)) out.set(uid, []);
  }
  return out;
}

export type AppLoginProfile = {
  id: string;
  email: string;
  username: string | null;
  name: string;
  phone: string | null;
  employeeId: string | null;
  isActive: boolean;
  roles: { id: string; name: string; tier: string }[];
  yards: { id: string; name: string }[];
  effectivePermissions: { module: string; action: string }[];
};

export async function buildLoginProfileForEmployee(employeeId: string): Promise<{ login: AppLoginProfile | null }> {
  const uid = await resolveUserIdForEmployee(employeeId);
  if (!uid) return { login: null };

  const [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  if (!u) return { login: null };

  const roleRows = await db
    .select({ id: roles.id, name: roles.name, tier: roles.tier })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, uid));

  const yardRows = await db
    .select({ id: yards.id, name: yards.name })
    .from(userYards)
    .innerJoin(yards, eq(yards.id, userYards.yardId))
    .where(eq(userYards.userId, uid));

  const permMap = await effectivePermissionsByUserIds([uid]);
  const effectivePermissions = permMap.get(uid) ?? [];

  return {
    login: {
      id: u.id,
      email: u.email,
      username: u.username ?? null,
      name: u.name,
      phone: u.phone ?? null,
      employeeId: u.employeeId ?? null,
      isActive: Boolean(u.isActive),
      roles: roleRows,
      yards: yardRows,
      effectivePermissions,
    },
  };
}

export async function enrichEmployeesWithAppLogin<T extends { id: string; userId: string | null }>(
  rows: T[],
): Promise<Array<T & { appLogin: AppLoginProfile | null }>> {
  if (rows.length === 0) return [];

  const empIds = rows.map((r) => r.id);
  const userIdsFromEmp = rows.map((r) => r.userId).filter((x): x is string => Boolean(x));

  const usersByEmployeeId = await db.select().from(users).where(inArray(users.employeeId, empIds));
  const empIdToUserId = new Map<string, string>();
  for (const e of rows) {
    if (e.userId) empIdToUserId.set(e.id, e.userId);
  }
  for (const u of usersByEmployeeId) {
    if (u.employeeId && !empIdToUserId.has(u.employeeId)) empIdToUserId.set(u.employeeId, u.id);
  }

  const linkedUserIds = Array.from(new Set(Array.from(empIdToUserId.values())));
  if (linkedUserIds.length === 0) {
    return rows.map((r) => ({ ...r, appLogin: null }));
  }

  const userRows = await db.select().from(users).where(inArray(users.id, linkedUserIds));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const roleAssignments = await db
    .select({
      userId: userRoles.userId,
      id: roles.id,
      name: roles.name,
      tier: roles.tier,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, linkedUserIds));

  const rolesByUser = new Map<string, { id: string; name: string; tier: string }[]>();
  for (const r of roleAssignments) {
    const arr = rolesByUser.get(r.userId) ?? [];
    arr.push({ id: r.id, name: r.name, tier: r.tier });
    rolesByUser.set(r.userId, arr);
  }

  const yardAssignments = await db
    .select({
      userId: userYards.userId,
      id: yards.id,
      name: yards.name,
    })
    .from(userYards)
    .innerJoin(yards, eq(yards.id, userYards.yardId))
    .where(inArray(userYards.userId, linkedUserIds));

  const yardsByUser = new Map<string, { id: string; name: string }[]>();
  for (const y of yardAssignments) {
    const arr = yardsByUser.get(y.userId) ?? [];
    arr.push({ id: y.id, name: y.name });
    yardsByUser.set(y.userId, arr);
  }

  const permByUser = await effectivePermissionsByUserIds(linkedUserIds);

  return rows.map((emp) => {
    const uid = empIdToUserId.get(emp.id) ?? null;
    if (!uid) return { ...emp, appLogin: null };
    const u = userById.get(uid);
    if (!u) return { ...emp, appLogin: null };
    return {
      ...emp,
      appLogin: {
        id: u.id,
        email: u.email,
        username: u.username ?? null,
        name: u.name,
        phone: u.phone ?? null,
        employeeId: u.employeeId ?? null,
        isActive: Boolean(u.isActive),
        roles: rolesByUser.get(uid) ?? [],
        yards: yardsByUser.get(uid) ?? [],
        effectivePermissions: permByUser.get(uid) ?? [],
      },
    };
  });
}

export async function handleCreateEmployeeLogin(req: Request, res: Response, employeeIdParam: string): Promise<void> {
  try {
    const employeeIdRaw = String(employeeIdParam ?? "").trim();
    const { email, username, name, phone, roleIds, yardIds, password } = req.body ?? {};
    if (!email || !name) {
      sendApiError(res, 400, "HR_LOGIN_FIELDS_REQUIRED", "email, name required");
      return;
    }
    const [emp] = await db.select().from(employees).where(eq(employees.id, employeeIdRaw)).limit(1);
    if (!emp || emp.status !== "Active") {
      sendApiError(res, 400, "HR_LOGIN_EMPLOYEE_INVALID", "Employee not found or not Active");
      return;
    }
    if (emp.userId) {
      sendApiError(res, 400, "HR_LOGIN_EMPLOYEE_ALREADY_LINKED", "Employee already has an app login");
      return;
    }
    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeIdRaw)).limit(1);
    if (existingUser.length > 0) {
      sendApiError(res, 400, "HR_LOGIN_EMPLOYEE_ALREADY_LINKED", "Employee already linked to a user record");
      return;
    }
    const passwordStr = password != null ? String(password) : "";
    if (passwordStr.length === 0) {
      sendApiError(res, 400, "HR_LOGIN_PASSWORD_REQUIRED", "password is required");
      return;
    }
    try {
      assertPasswordComplexityBrUsr10(passwordStr);
    } catch (e) {
      if (sendHrRule(res, e)) return;
      throw e;
    }
    if (Array.isArray(roleIds) && roleIds.length > 0) {
      const ridList = roleIds.map((r) => String(r));
      const dvDa = await assertRoleIdsNoDvDaConflict(ridList);
      if (!dvDa.ok) {
        sendApiError(res, 400, "HR_ROLE_DV_DA_CONFLICT", dvDa.message);
        return;
      }
    }
    const emailNorm = String(email).trim().toLowerCase();
    try {
      assertPersonalEmailFormat(emailNorm);
    } catch (e) {
      if (sendHrRule(res, e)) return;
      throw e;
    }
    let phoneNorm: string | null = null;
    if (phone != null && String(phone).trim() !== "") {
      try {
        phoneNorm = normalizeMobile10(String(phone));
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
    }
    const rawU = username != null ? String(username).trim().toLowerCase() : "";
    const usernameVal = rawU === "" ? null : rawU;
    const passwordHash = await hash(passwordStr, 10);
    const id = nanoid();
    const ts = now();
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id,
        email: emailNorm,
        username: usernameVal,
        name: String(name),
        phone: phoneNorm,
        employeeId: employeeIdRaw,
        passwordHash,
        isActive: true,
        disabledAt: null,
        createdAt: ts,
        updatedAt: ts,
      });
      await tx.update(employees).set({ userId: id, updatedAt: ts }).where(eq(employees.id, employeeIdRaw));
      if (Array.isArray(roleIds) && roleIds.length) {
        for (const roleId of roleIds) {
          await tx.insert(userRoles).values({ userId: id, roleId: String(roleId) }).onConflictDoNothing();
        }
      }
      if (Array.isArray(yardIds) && yardIds.length) {
        for (const yardId of yardIds) {
          await tx.insert(userYards).values({ userId: id, yardId: String(yardId) }).onConflictDoNothing();
        }
      }
    });
    const [row] = await db.select().from(users).where(eq(users.id, id));
    writeAuditLog(req, {
      module: "M-01",
      action: "CreateEmployeeLogin",
      recordId: id,
      afterValue: userSnapshotForAudit(row as unknown as Record<string, unknown>),
    }).catch((e) => console.error("Audit log failed:", e));
    const loginHint =
      usernameVal != null
        ? `Sign in with this email address or username "${usernameVal}" and the password set by your administrator.`
        : "Sign in with this email address and the password set by your administrator.";
    await sendTransactionalEmailTo(
      emailNorm,
      "IOMS user account provisioned",
      `Hello ${String(name).trim()},\n\nAn IOMS application user account was created for you (M-10 / SRS §1.4).\n\n${loginHint} Change your password after first sign-in if prompted.\n\nIf you did not expect this message, contact your system administrator.\n\n— GAPMC IOMS`,
    );
    res.status(201).json(row);
  } catch (e: unknown) {
    console.error(e);
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    if (code === "23505") {
      sendApiError(res, 409, "HR_LOGIN_DUPLICATE", "Email or username already exists");
      return;
    }
    sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create app login");
  }
}

/** Update login for this employee only; does not reassign to another employee. */
export async function handleUpdateEmployeeLogin(req: Request, res: Response, employeeIdParam: string): Promise<void> {
  try {
    const employeeIdRaw = String(employeeIdParam ?? "").trim();
    const [emp] = await db.select().from(employees).where(eq(employees.id, employeeIdRaw)).limit(1);
    if (!emp) {
      sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      return;
    }
    let id = emp.userId;
    if (!id) {
      const [u] = await db.select().from(users).where(eq(users.employeeId, employeeIdRaw)).limit(1);
      id = u?.id ?? null;
    }
    if (!id) {
      sendApiError(res, 404, "HR_LOGIN_NOT_FOUND", "No app login for this employee");
      return;
    }

    const [beforeUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!beforeUser) {
      sendApiError(res, 404, "HR_LOGIN_NOT_FOUND", "User not found");
      return;
    }

    const { email, username, name, phone, isActive, roleIds, yardIds, password } = req.body ?? {};
    const usernameUpdate =
      username === undefined
        ? {}
        : {
            username:
              username === null || String(username).trim() === ""
                ? null
                : String(username).trim().toLowerCase(),
          };
    let passwordUpdate: { passwordHash: string } | Record<string, never> = {};
    if (password !== undefined && password !== null && String(password) !== "") {
      const passwordStr = String(password);
      try {
        assertPasswordComplexityBrUsr10(passwordStr);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
      passwordUpdate = { passwordHash: await hash(passwordStr, 10) };
    }

    let emailUpdate: { email: string } | Record<string, never> = {};
    if (email != null) {
      const emailNorm = String(email).trim().toLowerCase();
      try {
        assertPersonalEmailFormat(emailNorm);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
      emailUpdate = { email: emailNorm };
    }

    let phoneUpdate: { phone: string | null } | Record<string, never> = {};
    if (phone !== undefined) {
      if (phone == null || String(phone).trim() === "") {
        phoneUpdate = { phone: null };
      } else {
        try {
          phoneUpdate = { phone: normalizeMobile10(String(phone)) };
        } catch (e) {
          if (sendHrRule(res, e)) return;
          throw e;
        }
      }
    }

    const employmentActive = emp.status === "Active";
    let nextIsActive = Boolean(beforeUser.isActive);
    if (isActive !== undefined) {
      if (!employmentActive && Boolean(isActive)) {
        sendApiError(
          res,
          400,
          "HR_LOGIN_EMPLOYEE_NOT_ACTIVE",
          "Cannot enable user account while employee record is not Active in M-01 (US-M10-001 / §1.4).",
        );
        return;
      }
      nextIsActive = Boolean(isActive);
    }
    if (!employmentActive) {
      nextIsActive = false;
    }
    const ts = now();
    const nextDisabledAt = nextIsActive ? null : ts;

    if (Array.isArray(roleIds)) {
      const ridList = roleIds.map((r) => String(r));
      const dvDa = await assertRoleIdsNoDvDaConflict(ridList);
      if (!dvDa.ok) {
        sendApiError(res, 400, "HR_ROLE_DV_DA_CONFLICT", dvDa.message);
        return;
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          ...emailUpdate,
          ...usernameUpdate,
          ...(name != null && { name: String(name) }),
          ...phoneUpdate,
          isActive: nextIsActive,
          disabledAt: nextDisabledAt,
          ...passwordUpdate,
          employeeId: employeeIdRaw,
          updatedAt: ts,
        })
        .where(eq(users.id, id));

      await tx.update(employees).set({ userId: null, updatedAt: ts }).where(eq(employees.userId, id));
      await tx.update(employees).set({ userId: id, updatedAt: ts }).where(eq(employees.id, employeeIdRaw));

      if (Array.isArray(roleIds)) {
        const ridList = roleIds.map((r) => String(r));
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
        for (const roleId of ridList) {
          await tx.insert(userRoles).values({ userId: id, roleId: String(roleId) }).onConflictDoNothing();
        }
      }
      if (Array.isArray(yardIds)) {
        await tx.delete(userYards).where(eq(userYards.userId, id));
        for (const yardId of yardIds) {
          await tx.insert(userYards).values({ userId: id, yardId: String(yardId) }).onConflictDoNothing();
        }
      }
    });

    const [row] = await db.select().from(users).where(eq(users.id, id));
    if (!row) {
      sendApiError(res, 404, "HR_LOGIN_NOT_FOUND", "User not found");
      return;
    }
    writeAuditLog(req, {
      module: "M-01",
      action: "UpdateEmployeeLogin",
      recordId: id,
      beforeValue: userSnapshotForAudit(beforeUser as unknown as Record<string, unknown>),
      afterValue: userSnapshotForAudit(row as unknown as Record<string, unknown>),
    }).catch((e) => console.error("Audit log failed:", e));
    res.json(row);
  } catch (e: unknown) {
    console.error(e);
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    if (code === "23505") {
      sendApiError(res, 409, "HR_LOGIN_DUPLICATE", "Email or username already exists");
      return;
    }
    sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update app login");
  }
}
