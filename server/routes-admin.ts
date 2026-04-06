/**
 * IOMS M-10: RBAC & System Administration API routes.
 * All tables in gapmc schema (yards, users, roles, system_config, audit_log).
 */
import type { Express } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { db } from "./db";
import {
  yards,
  users,
  roles,
  userRoles,
  userYards,
  systemConfig,
  slaConfig,
  auditLog,
  permissions,
  rolePermissions,
  employees,
  expenditureHeads,
  tallyLedgers,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import { SYSTEM_CONFIG_KEYS } from "@shared/system-config-defaults";
import { getMergedSystemConfig } from "./system-config";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";

function userSnapshotForAudit(u: Record<string, unknown> | undefined) {
  if (!u) return undefined;
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

export function registerAdminRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Yards (locations) -----
  app.get("/api/admin/yards", async (_req, res) => {
    try {
      const list = await db.select().from(yards).orderBy(yards.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch yards");
    }
  });

  app.post("/api/admin/yards", async (req, res) => {
    try {
      const { name, code, type, phone, mobile, address } = req.body;
      if (!name || !code || !type) {
        return sendApiError(res, 400, "ADMIN_YARD_FIELDS_REQUIRED", "name, code, type required");
      }
      const id = nanoid();
      await db.insert(yards).values({
        id,
        name: String(name),
        code: String(code),
        type: String(type),
        phone: phone ? String(phone) : null,
        mobile: mobile ? String(mobile) : null,
        address: address ? String(address) : null,
        isActive: true,
      });
      const [row] = await db.select().from(yards).where(eq(yards.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateLocation", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create yard");
    }
  });

  app.put("/api/admin/yards/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [before] = await db.select().from(yards).where(eq(yards.id, id)).limit(1);
      const { name, code, type, phone, mobile, address, isActive } = req.body;
      await db.update(yards).set({
        ...(name != null && { name: String(name) }),
        ...(code != null && { code: String(code) }),
        ...(type != null && { type: String(type) }),
        ...(phone !== undefined && { phone: phone ? String(phone) : null }),
        ...(mobile !== undefined && { mobile: mobile ? String(mobile) : null }),
        ...(address !== undefined && { address: address ? String(address) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      }).where(eq(yards.id, id));
      const [row] = await db.select().from(yards).where(eq(yards.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_YARD_NOT_FOUND", "Yard not found");
      writeAuditLog(req, { module: "M-10", action: "UpdateLocation", recordId: id, beforeValue: before, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update yard");
    }
  });

  // ----- System config (defaults merged for UI; PUT only allows known keys) -----
  app.get("/api/admin/config", async (_req, res) => {
    try {
      const merged = await getMergedSystemConfig();
      res.json(merged);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch config");
    }
  });

  app.put("/api/admin/config", async (req, res) => {
    try {
      const userId = req.user!.id;
      const body = req.body as Record<string, unknown>;
      const before = await getMergedSystemConfig();
      for (const key of SYSTEM_CONFIG_KEYS) {
        if (!(key in body)) continue;
        const value = String(body[key] ?? "");
        await db
          .insert(systemConfig)
          .values({
            key,
            value,
            updatedBy: userId,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value, updatedBy: userId, updatedAt: now() },
          });
      }
      const after = await getMergedSystemConfig();
      writeAuditLog(req, {
        module: "M-10",
        action: "Update",
        recordId: "system_config",
        beforeValue: before,
        afterValue: after,
      }).catch((err) => console.error("Audit log failed:", err));
      res.json(after);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update config");
    }
  });

  // ----- Roles -----
  app.get("/api/admin/roles", async (_req, res) => {
    try {
      const list = await db.select().from(roles).orderBy(roles.tier);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch roles");
    }
  });

  app.post("/api/admin/roles", async (req, res) => {
    try {
      const { name, tier, description } = req.body;
      if (!name || !tier || typeof name !== "string" || typeof tier !== "string") {
        return sendApiError(res, 400, "ADMIN_ROLE_FIELDS_REQUIRED", "name and tier required");
      }
      const id = nanoid();
      await db.insert(roles).values({
        id,
        name: name.trim(),
        tier: tier.trim(),
        description: description != null && description !== "" ? String(description).trim() : null,
      });
      const [row] = await db.select().from(roles).where(eq(roles.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateRole", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      const err = e as { code?: string };
      if (err.code === "23505") return sendApiError(res, 400, "ADMIN_ROLE_DUPLICATE", "Role name or tier already exists");
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create role");
    }
  });

  app.put("/api/admin/roles/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { name, tier, description } = req.body;
      const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_ROLE_NOT_FOUND", "Role not found");
      const updates: Record<string, string | null> = {};
      if (name !== undefined) {
        const v = String(name).trim();
        if (!v) return sendApiError(res, 400, "ADMIN_ROLE_NAME_EMPTY", "name cannot be empty");
        updates.name = v;
      }
      if (tier !== undefined) {
        const v = String(tier).trim();
        if (!v) return sendApiError(res, 400, "ADMIN_ROLE_TIER_EMPTY", "tier cannot be empty");
        updates.tier = v;
      }
      if (description !== undefined) updates.description = description === "" || description == null ? null : String(description).trim();
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(roles).where(eq(roles.id, id));
        return res.json(row);
      }
      await db.update(roles).set(updates).where(eq(roles.id, id));
      const [row] = await db.select().from(roles).where(eq(roles.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_ROLE_NOT_FOUND", "Role not found");
      writeAuditLog(req, { module: "M-10", action: "UpdateRole", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      const err = e as { code?: string };
      if (err.code === "23505") return sendApiError(res, 400, "ADMIN_ROLE_DUPLICATE", "Role name or tier already exists");
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update role");
    }
  });

  app.delete("/api/admin/roles/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_ROLE_NOT_FOUND", "Role not found");
      const inUse = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, id)).limit(1);
      if (inUse.length > 0) {
        return sendApiError(res, 400, "ADMIN_ROLE_IN_USE", "Cannot delete role: it is assigned to one or more users");
      }
      writeAuditLog(req, { module: "M-10", action: "DeleteRole", recordId: id, beforeValue: existing }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      await db.delete(roles).where(eq(roles.id, id));
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete role");
    }
  });

  // ----- Users -----
  app.get("/api/admin/users", async (_req, res) => {
    try {
      const list = await db.select().from(users).orderBy(users.name);
      const roleAssignments = await db
        .select({
          userId: userRoles.userId,
          id: roles.id,
          name: roles.name,
          tier: roles.tier,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId));
      const yardAssignments = await db
        .select({
          userId: userYards.userId,
          id: yards.id,
          name: yards.name,
        })
        .from(userYards)
        .innerJoin(yards, eq(yards.id, userYards.yardId));

      const rolesByUser = new Map<string, { id: string; name: string; tier: string }[]>();
      for (const r of roleAssignments) {
        const arr = rolesByUser.get(r.userId) ?? [];
        arr.push({ id: r.id, name: r.name, tier: r.tier });
        rolesByUser.set(r.userId, arr);
      }
      const yardsByUser = new Map<string, { id: string; name: string }[]>();
      for (const y of yardAssignments) {
        const arr = yardsByUser.get(y.userId) ?? [];
        arr.push({ id: y.id, name: y.name });
        yardsByUser.set(y.userId, arr);
      }

      const enriched = list.map((u) => ({
        ...u,
        roles: rolesByUser.get(u.id) ?? [],
        yards: yardsByUser.get(u.id) ?? [],
      }));
      res.json(enriched);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch users");
    }
  });

  app.post("/api/admin/users", async (req, res) => {
    try {
      const { email, username, name, phone, roleIds, yardIds, password, employeeId: employeeIdBody } = req.body;
      if (!email || !name) {
        return sendApiError(res, 400, "ADMIN_USER_FIELDS_REQUIRED", "email, name required");
      }
      const employeeIdRaw = employeeIdBody != null ? String(employeeIdBody).trim() : "";
      if (!employeeIdRaw) {
        return sendApiError(
          res,
          400,
          "ADMIN_USER_EMPLOYEE_ID_REQUIRED",
          "employeeId required: each user must be linked to an active employee (SRS §1.4).",
        );
      }
      const [emp] = await db.select().from(employees).where(eq(employees.id, employeeIdRaw)).limit(1);
      if (!emp || emp.status !== "Active") {
        return sendApiError(res, 400, "ADMIN_USER_EMPLOYEE_INVALID", "Employee not found or not Active");
      }
      if (emp.userId) {
        return sendApiError(res, 400, "ADMIN_USER_EMPLOYEE_ALREADY_LINKED", "Employee is already linked to another user");
      }
      const passwordStr = password != null ? String(password) : "";
      if (passwordStr.length < 8) {
        return sendApiError(res, 400, "ADMIN_USER_PASSWORD_REQUIRED", "password required (min 8 characters)");
      }
      const emailNorm = String(email).trim().toLowerCase();
      const rawU = username != null ? String(username).trim().toLowerCase() : "";
      const usernameVal = rawU === "" ? null : rawU;
      const passwordHash = await hash(passwordStr, 10);
      const id = nanoid();
      await db.insert(users).values({
        id,
        email: emailNorm,
        username: usernameVal,
        name: String(name),
        phone: phone ? String(phone) : null,
        employeeId: employeeIdRaw,
        passwordHash,
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      });
      await db
        .update(employees)
        .set({ userId: id, updatedAt: now() })
        .where(eq(employees.id, employeeIdRaw));
      if (Array.isArray(roleIds) && roleIds.length) {
        for (const roleId of roleIds) {
          await db.insert(userRoles).values({ userId: id, roleId: String(roleId) }).onConflictDoNothing();
        }
      }
      if (Array.isArray(yardIds) && yardIds.length) {
        for (const yardId of yardIds) {
          await db.insert(userYards).values({ userId: id, yardId: String(yardId) }).onConflictDoNothing();
        }
      }
      const [row] = await db.select().from(users).where(eq(users.id, id));
      writeAuditLog(req, {
        module: "M-10",
        action: "CreateUser",
        recordId: id,
        afterValue: userSnapshotForAudit(row as unknown as Record<string, unknown>),
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e: unknown) {
      console.error(e);
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
      if (code === "23505") {
        return sendApiError(res, 409, "ADMIN_USER_DUPLICATE", "Email or username already exists");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create user");
    }
  });

  app.put("/api/admin/users/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [beforeUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!beforeUser) return sendApiError(res, 404, "ADMIN_USER_NOT_FOUND", "User not found");
      const { email, username, name, phone, isActive, roleIds, yardIds, password, employeeId: employeeIdBody } = req.body;
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
        if (passwordStr.length < 8) {
          return sendApiError(res, 400, "ADMIN_USER_PASSWORD_TOO_SHORT", "password must be at least 8 characters");
        }
        passwordUpdate = { passwordHash: await hash(passwordStr, 10) };
      }
      let employeeIdUpdate: { employeeId: string | null } | Record<string, never> = {};
      if (employeeIdBody !== undefined) {
        const eid = employeeIdBody === null || String(employeeIdBody).trim() === "" ? null : String(employeeIdBody).trim();
        if (eid) {
          const [emp] = await db.select().from(employees).where(eq(employees.id, eid)).limit(1);
          if (!emp || emp.status !== "Active") {
            return sendApiError(res, 400, "ADMIN_USER_EMPLOYEE_INVALID", "Employee not found or not Active");
          }
          if (emp.userId && emp.userId !== id) {
            return sendApiError(res, 400, "ADMIN_USER_EMPLOYEE_ALREADY_LINKED", "Employee is already linked to another user");
          }
        }
        employeeIdUpdate = { employeeId: eid };
      }

      await db.update(users).set({
        ...(email != null && { email: String(email).trim().toLowerCase() }),
        ...usernameUpdate,
        ...(name != null && { name: String(name) }),
        ...(phone !== undefined && { phone: phone ? String(phone) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...passwordUpdate,
        ...employeeIdUpdate,
        updatedAt: now(),
      }).where(eq(users.id, id));

      if (employeeIdBody !== undefined) {
        const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        await db.update(employees).set({ userId: null, updatedAt: now() }).where(eq(employees.userId, id));
        if (u?.employeeId) {
          await db.update(employees).set({ userId: id, updatedAt: now() }).where(eq(employees.id, u.employeeId));
        }
      }
      if (Array.isArray(roleIds)) {
        await db.delete(userRoles).where(eq(userRoles.userId, id));
        for (const roleId of roleIds) {
          await db.insert(userRoles).values({ userId: id, roleId: String(roleId) }).onConflictDoNothing();
        }
      }
      if (Array.isArray(yardIds)) {
        await db.delete(userYards).where(eq(userYards.userId, id));
        for (const yardId of yardIds) {
          await db.insert(userYards).values({ userId: id, yardId: String(yardId) }).onConflictDoNothing();
        }
      }
      const [row] = await db.select().from(users).where(eq(users.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_USER_NOT_FOUND", "User not found");
      writeAuditLog(req, {
        module: "M-10",
        action: "UpdateUser",
        recordId: id,
        beforeValue: userSnapshotForAudit(beforeUser as unknown as Record<string, unknown>),
        afterValue: userSnapshotForAudit(row as unknown as Record<string, unknown>),
      }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e: unknown) {
      console.error(e);
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
      if (code === "23505") {
        return sendApiError(res, 409, "ADMIN_USER_DUPLICATE", "Email or username already exists");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update user");
    }
  });

  // ----- Expenditure head → Tally ledger (M-10 / finance mapping) -----
  app.put("/api/admin/expenditure-heads/:id/tally-ledger", async (req, res) => {
    try {
      const id = req.params.id;
      const tallyLedgerId = req.body?.tallyLedgerId;
      const tl =
        tallyLedgerId === null || tallyLedgerId === undefined || String(tallyLedgerId).trim() === ""
          ? null
          : String(tallyLedgerId).trim();
      const [before] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id)).limit(1);
      if (!before) return sendApiError(res, 404, "ADMIN_EXPENDITURE_HEAD_NOT_FOUND", "Expenditure head not found");
      if (tl) {
        const [exists] = await db.select().from(tallyLedgers).where(eq(tallyLedgers.id, tl)).limit(1);
        if (!exists) return sendApiError(res, 400, "ADMIN_TALLY_LEDGER_UNKNOWN", "Unknown tally ledger id");
      }
      await db.update(expenditureHeads).set({ tallyLedgerId: tl }).where(eq(expenditureHeads.id, id));
      const [row] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id)).limit(1);
      await writeAuditLog(req, {
        module: "Admin",
        action: "Update",
        recordId: id,
        beforeValue: before,
        afterValue: row,
      }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update tally mapping");
    }
  });

  // ----- Audit log -----
  app.get("/api/admin/audit", async (req, res) => {
    try {
      const { module: mod, userId, limit = "100" } = req.query;
      const limitN = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const conditions = [];
      if (mod && typeof mod === "string") conditions.push(eq(auditLog.module, mod));
      if (userId && typeof userId === "string") conditions.push(eq(auditLog.userId, userId));
      const rows = conditions.length
        ? await db
            .select({
              id: auditLog.id,
              userId: auditLog.userId,
              module: auditLog.module,
              action: auditLog.action,
              recordId: auditLog.recordId,
              beforeValue: auditLog.beforeValue,
              afterValue: auditLog.afterValue,
              ip: auditLog.ip,
              createdAt: auditLog.createdAt,
              userEmail: users.email,
              userName: users.name,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .where(and(...conditions))
            .orderBy(desc(auditLog.createdAt))
            .limit(limitN)
        : await db
            .select({
              id: auditLog.id,
              userId: auditLog.userId,
              module: auditLog.module,
              action: auditLog.action,
              recordId: auditLog.recordId,
              beforeValue: auditLog.beforeValue,
              afterValue: auditLog.afterValue,
              ip: auditLog.ip,
              createdAt: auditLog.createdAt,
              userEmail: users.email,
              userName: users.name,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .orderBy(desc(auditLog.createdAt))
            .limit(limitN);
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch audit log");
    }
  });

  // ----- Permissions (read-only for matrix) -----
  app.get("/api/admin/permissions", async (_req, res) => {
    try {
      const list = await db.select().from(permissions);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch permissions");
    }
  });

  app.get("/api/admin/role-permissions", async (_req, res) => {
    try {
      const list = await db.select().from(rolePermissions);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch role permissions");
    }
  });

  app.post("/api/admin/role-permissions", async (req, res) => {
    try {
      const { roleId, permissionId } = req.body;
      if (!roleId || !permissionId) {
        return sendApiError(res, 400, "ADMIN_PERMISSION_MATRIX_FIELDS", "roleId and permissionId required");
      }
      await db.insert(rolePermissions).values({
        roleId: String(roleId),
        permissionId: String(permissionId),
      }).onConflictDoNothing();
      writeAuditLog(req, {
        module: "M-10",
        action: "AssignRolePermission",
        recordId: `${roleId}:${permissionId}`,
        afterValue: { roleId: String(roleId), permissionId: String(permissionId) },
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json({ roleId: String(roleId), permissionId: String(permissionId) });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to assign permission to role");
    }
  });

  app.delete("/api/admin/role-permissions", async (req, res) => {
    try {
      const { roleId, permissionId } = req.query;
      if (!roleId || !permissionId || typeof roleId !== "string" || typeof permissionId !== "string") {
        return sendApiError(res, 400, "ADMIN_PERMISSION_MATRIX_QUERY", "roleId and permissionId required (query params)");
      }
      writeAuditLog(req, {
        module: "M-10",
        action: "RemoveRolePermission",
        recordId: `${roleId}:${permissionId}`,
        beforeValue: { roleId, permissionId },
      }).catch((e) => console.error("Audit log failed:", e));
      await db.delete(rolePermissions).where(
        and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId))
      );
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to remove permission from role");
    }
  });

  // ----- SLA Config (M-10) -----
  app.get("/api/admin/sla-config", async (_req, res) => {
    try {
      const list = await db.select().from(slaConfig).orderBy(slaConfig.workflow);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch SLA config");
    }
  });

  app.post("/api/admin/sla-config", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(slaConfig).values({
        id,
        workflow: String(body.workflow ?? ""),
        hours: Number(body.hours ?? 24),
        alertRole: body.alertRole ? String(body.alertRole) : null,
      });
      const [row] = await db.select().from(slaConfig).where(eq(slaConfig.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateSlaConfig", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create SLA config");
    }
  });

  app.put("/api/admin/sla-config/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(slaConfig).where(eq(slaConfig.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_SLA_CONFIG_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["workflow", "hours", "alertRole"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "hours") updates[k] = Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(slaConfig).set(updates as Record<string, string | number | null>).where(eq(slaConfig.id, id));
      const [row] = await db.select().from(slaConfig).where(eq(slaConfig.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_SLA_CONFIG_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "M-10", action: "UpdateSlaConfig", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update SLA config");
    }
  });
}
