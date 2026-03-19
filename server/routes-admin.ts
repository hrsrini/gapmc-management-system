/**
 * IOMS M-10: RBAC & System Administration API routes.
 * All tables in gapmc schema (yards, users, roles, system_config, audit_log).
 */
import type { Express } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
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
} from "@shared/db-schema";
import { nanoid } from "nanoid";

export function registerAdminRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Yards (locations) -----
  app.get("/api/admin/yards", async (_req, res) => {
    try {
      const list = await db.select().from(yards).orderBy(yards.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch yards" });
    }
  });

  app.post("/api/admin/yards", async (req, res) => {
    try {
      const { name, code, type, phone, mobile, address } = req.body;
      if (!name || !code || !type) {
        return res.status(400).json({ error: "name, code, type required" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create yard" });
    }
  });

  app.put("/api/admin/yards/:id", async (req, res) => {
    try {
      const id = req.params.id;
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
      if (!row) return res.status(404).json({ error: "Yard not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update yard" });
    }
  });

  // ----- System config -----
  app.get("/api/admin/config", async (_req, res) => {
    try {
      const rows = await db.select().from(systemConfig);
      const config: Record<string, string> = {};
      for (const r of rows) config[r.key] = r.value;
      res.json(config);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch config" });
    }
  });

  app.put("/api/admin/config", async (req, res) => {
    try {
      const body = req.body as Record<string, string>;
      for (const [key, value] of Object.entries(body)) {
        await db.insert(systemConfig).values({
          key,
          value: String(value),
          updatedAt: now(),
        }).onConflictDoUpdate({
          target: systemConfig.key,
          set: { value: String(value), updatedAt: now() },
        });
      }
      const rows = await db.select().from(systemConfig);
      const config: Record<string, string> = {};
      for (const r of rows) config[r.key] = r.value;
      res.json(config);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update config" });
    }
  });

  // ----- Roles -----
  app.get("/api/admin/roles", async (_req, res) => {
    try {
      const list = await db.select().from(roles).orderBy(roles.tier);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  });

  app.post("/api/admin/roles", async (req, res) => {
    try {
      const { name, tier, description } = req.body;
      if (!name || !tier || typeof name !== "string" || typeof tier !== "string") {
        return res.status(400).json({ error: "name and tier required" });
      }
      const id = nanoid();
      await db.insert(roles).values({
        id,
        name: name.trim(),
        tier: tier.trim(),
        description: description != null && description !== "" ? String(description).trim() : null,
      });
      const [row] = await db.select().from(roles).where(eq(roles.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      const err = e as { code?: string };
      if (err.code === "23505") return res.status(400).json({ error: "Role name or tier already exists" });
      res.status(500).json({ error: "Failed to create role" });
    }
  });

  app.put("/api/admin/roles/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { name, tier, description } = req.body;
      const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Role not found" });
      const updates: Record<string, string | null> = {};
      if (name !== undefined) {
        const v = String(name).trim();
        if (!v) return res.status(400).json({ error: "name cannot be empty" });
        updates.name = v;
      }
      if (tier !== undefined) {
        const v = String(tier).trim();
        if (!v) return res.status(400).json({ error: "tier cannot be empty" });
        updates.tier = v;
      }
      if (description !== undefined) updates.description = description === "" || description == null ? null : String(description).trim();
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(roles).where(eq(roles.id, id));
        return res.json(row);
      }
      await db.update(roles).set(updates).where(eq(roles.id, id));
      const [row] = await db.select().from(roles).where(eq(roles.id, id));
      if (!row) return res.status(404).json({ error: "Role not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      const err = e as { code?: string };
      if (err.code === "23505") return res.status(400).json({ error: "Role name or tier already exists" });
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  app.delete("/api/admin/roles/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Role not found" });
      const inUse = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, id)).limit(1);
      if (inUse.length > 0) {
        return res.status(400).json({ error: "Cannot delete role: it is assigned to one or more users" });
      }
      await db.delete(roles).where(eq(roles.id, id));
      res.status(204).send();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete role" });
    }
  });

  // ----- Users -----
  app.get("/api/admin/users", async (_req, res) => {
    try {
      const list = await db.select().from(users).orderBy(users.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users", async (req, res) => {
    try {
      const { email, username, name, phone, roleIds, yardIds } = req.body;
      if (!email || !name) {
        return res.status(400).json({ error: "email, name required" });
      }
      const emailNorm = String(email).trim().toLowerCase();
      const rawU = username != null ? String(username).trim().toLowerCase() : "";
      const usernameVal = rawU === "" ? null : rawU;
      const id = nanoid();
      await db.insert(users).values({
        id,
        email: emailNorm,
        username: usernameVal,
        name: String(name),
        phone: phone ? String(phone) : null,
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.put("/api/admin/users/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { email, username, name, phone, isActive, roleIds, yardIds } = req.body;
      const usernameUpdate =
        username === undefined
          ? {}
          : {
              username:
                username === null || String(username).trim() === ""
                  ? null
                  : String(username).trim().toLowerCase(),
            };
      await db.update(users).set({
        ...(email != null && { email: String(email).trim().toLowerCase() }),
        ...usernameUpdate,
        ...(name != null && { name: String(name) }),
        ...(phone !== undefined && { phone: phone ? String(phone) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        updatedAt: now(),
      }).where(eq(users.id, id));
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
      if (!row) return res.status(404).json({ error: "User not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update user" });
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
      res.status(500).json({ error: "Failed to fetch audit log" });
    }
  });

  // ----- Permissions (read-only for matrix) -----
  app.get("/api/admin/permissions", async (_req, res) => {
    try {
      const list = await db.select().from(permissions);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch permissions" });
    }
  });

  app.get("/api/admin/role-permissions", async (_req, res) => {
    try {
      const list = await db.select().from(rolePermissions);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch role permissions" });
    }
  });

  app.post("/api/admin/role-permissions", async (req, res) => {
    try {
      const { roleId, permissionId } = req.body;
      if (!roleId || !permissionId) {
        return res.status(400).json({ error: "roleId and permissionId required" });
      }
      await db.insert(rolePermissions).values({
        roleId: String(roleId),
        permissionId: String(permissionId),
      }).onConflictDoNothing();
      res.status(201).json({ roleId: String(roleId), permissionId: String(permissionId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to assign permission to role" });
    }
  });

  app.delete("/api/admin/role-permissions", async (req, res) => {
    try {
      const { roleId, permissionId } = req.query;
      if (!roleId || !permissionId || typeof roleId !== "string" || typeof permissionId !== "string") {
        return res.status(400).json({ error: "roleId and permissionId required (query params)" });
      }
      await db.delete(rolePermissions).where(
        and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId))
      );
      res.status(204).send();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to remove permission from role" });
    }
  });

  // ----- SLA Config (M-10) -----
  app.get("/api/admin/sla-config", async (_req, res) => {
    try {
      const list = await db.select().from(slaConfig).orderBy(slaConfig.workflow);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch SLA config" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create SLA config" });
    }
  });

  app.put("/api/admin/sla-config/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(slaConfig).where(eq(slaConfig.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["workflow", "hours", "alertRole"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "hours") updates[k] = Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(slaConfig).set(updates as Record<string, string | number | null>).where(eq(slaConfig.id, id));
      const [row] = await db.select().from(slaConfig).where(eq(slaConfig.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update SLA config" });
    }
  });
}
