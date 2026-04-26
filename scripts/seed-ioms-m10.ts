/**
 * Seed IOMS M-10: 14 locations (yards/check posts), default system_config, roles.
 * Run after db:push. Usage: npx tsx scripts/seed-ioms-m10.ts (or tsx script with dotenv)
 */
import "dotenv/config";
import { hash } from "bcryptjs";
import { db } from "../server/db";
import {
  yards,
  systemConfig,
  roles,
  userRoles,
  permissions,
  rolePermissions,
  users,
  userYards,
  employees,
} from "../shared/db-schema";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { SYSTEM_CONFIG_DEFAULTS } from "../shared/system-config-defaults";

/** BR-USR-10 compliant (≥12 chars, mixed case, digit, special) — change in production. */
const DEFAULT_ADMIN_PASSWORD = "GapmcAdmin@2026!";

const LOCATIONS = [
  { name: "Canacona", code: "CANC", type: "Yard" },
  { name: "Curchorem", code: "CURC", type: "Yard" },
  { name: "Dhargal", code: "DHAR", type: "CheckPost" },
  { name: "GSAMB", code: "GSAM", type: "Yard" },
  { name: "Keri", code: "KERI", type: "CheckPost" },
  { name: "Mapusa", code: "MAPU", type: "Yard" },
  { name: "Mapusa Sub Yard", code: "MPSB", type: "CheckPost" },
  { name: "Margao", code: "MARG", type: "Yard" },
  { name: "Mollem", code: "MOLM", type: "CheckPost" },
  { name: "Pernem", code: "PERM", type: "Yard" },
  { name: "Pollem", code: "POLM", type: "CheckPost" },
  { name: "Ponda", code: "POND", type: "Yard" },
  { name: "Sanquelim", code: "SANQ", type: "Yard" },
  { name: "Valpoi", code: "VALP", type: "Yard" },
];

const ROLE_TIERS = [
  { name: "Data Originator", tier: "DO", description: "Creates and submits records" },
  { name: "Data Verifier", tier: "DV", description: "Verifies submitted records" },
  { name: "Data Approver", tier: "DA", description: "Approves verified records" },
  { name: "Read Only", tier: "READ_ONLY", description: "View only access" },
  { name: "System Admin", tier: "ADMIN", description: "Full system administration" },
];

async function seed() {
  const now = new Date().toISOString();

  // 1. Yards (idempotent by code)
  const existingYards = await db.select({ id: yards.id, code: yards.code }).from(yards);
  const existingCodes = new Set(existingYards.map((y) => y.code));
  for (const loc of LOCATIONS) {
    if (existingCodes.has(loc.code)) continue;
    const id = nanoid();
    await db.insert(yards).values({
      id,
      name: loc.name,
      code: loc.code,
      type: loc.type,
      isActive: true,
    });
  }
  const allYardRows = await db.select({ id: yards.id }).from(yards);
  const yardIds = allYardRows.map((y) => y.id);
  console.log("Seeded yards/check posts");

  // 2. System config (skip secrets so re-seed does not wipe admin-set values)
  for (const [key, value] of Object.entries(SYSTEM_CONFIG_DEFAULTS)) {
    if (key === "aadhaar_hmac_secret") continue;
    await db.insert(systemConfig).values({
      key,
      value,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: systemConfig.key,
      set: { value, updatedAt: now },
    });
  }
  console.log("Seeded system_config");

  // 3. Roles (idempotent: reuse existing by name)
  const existingRoles = await db.select().from(roles);
  const roleIdMap: Record<string, string> = {};
  for (const r of existingRoles) {
    roleIdMap[r.tier] = r.id;
  }
  for (const r of ROLE_TIERS) {
    if (roleIdMap[r.tier]) continue;
    const id = nanoid();
    roleIdMap[r.tier] = id;
    await db.insert(roles).values({
      id,
      name: r.name,
      tier: r.tier,
      description: r.description,
    });
  }
  console.log("Seeded roles");

  // 4. Permissions (minimal: one per module per action for matrix)
  const modules = ["M-01", "M-02", "M-03", "M-04", "M-05", "M-06", "M-07", "M-08", "M-09", "M-10"];
  const actions = ["Create", "Read", "Update", "Delete", "Approve"];
  const existingPerms = await db.select().from(permissions);
  const existingSet = new Set(existingPerms.map((p) => `${p.module}:${p.action}`));
  for (const mod of modules) {
    for (const action of actions) {
      if (existingSet.has(`${mod}:${action}`)) continue;
      await db.insert(permissions).values({
        id: nanoid(),
        module: mod,
        action,
      });
    }
  }
  console.log("Seeded permissions matrix");

  // 4b. Assign all M-10 permissions to ADMIN role (so permission matrix and DB stay in sync)
  const adminRoleIdForPerms = roleIdMap["ADMIN"];
  if (adminRoleIdForPerms) {
    const m10Perms = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.module, "M-10"));
    for (const p of m10Perms) {
      await db.insert(rolePermissions).values({ roleId: adminRoleIdForPerms, permissionId: p.id }).onConflictDoNothing();
    }
    if (m10Perms.length > 0) console.log("Assigned M-10 permissions to ADMIN role");
  }

  // 4c. Assign all "Read" permissions to READ_ONLY role (so READ_ONLY can view but not create/update/delete)
  const readOnlyRoleId = roleIdMap["READ_ONLY"];
  if (readOnlyRoleId) {
    const readPerms = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.action, "Read"));
    for (const p of readPerms) {
      await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: p.id }).onConflictDoNothing();
    }
    if (readPerms.length > 0) console.log("Assigned Read-only permissions to READ_ONLY role");
  }

  // 4d. DA role: M-01 Read / Update / Approve (employee registration approval, leave workflow updates on /api/hr)
  const daRoleIdForHr = roleIdMap["DA"];
  if (daRoleIdForHr) {
    const daHrPerms = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(eq(permissions.module, "M-01"), inArray(permissions.action, ["Read", "Update", "Approve"])));
    for (const p of daHrPerms) {
      await db.insert(rolePermissions).values({ roleId: daRoleIdForHr, permissionId: p.id }).onConflictDoNothing();
    }
    if (daHrPerms.length > 0) console.log("Assigned M-01 Read/Update/Approve to DA role");
  }

  // 4e. DO role: M-01 Create / Read / Update (employee registration Draft/Submit)
  const doRoleIdForHr = roleIdMap["DO"];
  if (doRoleIdForHr) {
    const doHrPerms = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(eq(permissions.module, "M-01"), inArray(permissions.action, ["Create", "Read", "Update"])));
    for (const p of doHrPerms) {
      await db.insert(rolePermissions).values({ roleId: doRoleIdForHr, permissionId: p.id }).onConflictDoNothing();
    }
    if (doHrPerms.length > 0) console.log("Assigned M-01 Create/Read/Update to DO role");
  }

  // 4f. DV role: M-01 Read / Update (leave verification and other HR updates on /api/hr)
  const dvRoleIdForHr = roleIdMap["DV"];
  if (dvRoleIdForHr) {
    const dvHrPerms = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(eq(permissions.module, "M-01"), inArray(permissions.action, ["Read", "Update"])));
    for (const p of dvHrPerms) {
      await db.insert(rolePermissions).values({ roleId: dvRoleIdForHr, permissionId: p.id }).onConflictDoNothing();
    }
    if (dvHrPerms.length > 0) console.log("Assigned M-01 Read/Update to DV role");
  }

  // 5. Bootstrap employee for admin (SRS §1.4 — user must link to active employee)
  let bootstrapEmpId: string | null = null;
  const firstYardId = yardIds[0];
  if (firstYardId) {
    const [existingBoot] = await db
      .select()
      .from(employees)
      .where(eq(employees.workEmail, "admin.bootstrap@gapmc.local"))
      .limit(1);
    if (existingBoot) {
      bootstrapEmpId = existingBoot.id;
    } else {
      const eid = nanoid();
      await db.insert(employees).values({
        id: eid,
        empId: "EMP-BOOT-ADMIN",
        firstName: "System",
        surname: "Admin",
        designation: "Administrator",
        yardId: firstYardId,
        employeeType: "Regular",
        joiningDate: now.slice(0, 10),
        status: "Active",
        workEmail: "admin.bootstrap@gapmc.local",
        createdAt: now,
        updatedAt: now,
      });
      bootstrapEmpId = eid;
      console.log("Seeded bootstrap employee for admin user (SRS §1.4)");
    }
  }

  // 6. Optional: one admin user (email admin@gapmc.local) with hashed password
  const adminRoleId = roleIdMap["ADMIN"];
  const existingAdmin = await db.select().from(users).where(eq(users.email, "admin@gapmc.local"));
  const passwordHash = await hash(DEFAULT_ADMIN_PASSWORD, 10);
  if (adminRoleId && existingAdmin.length === 0) {
    const adminUserId = nanoid();
    await db.insert(users).values({
      id: adminUserId,
      email: "admin@gapmc.local",
      username: "admin",
      name: "System Admin",
      employeeId: bootstrapEmpId,
      passwordHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    if (bootstrapEmpId) {
      await db
        .update(employees)
        .set({ userId: adminUserId, updatedAt: now })
        .where(eq(employees.id, bootstrapEmpId));
    }

    await db.insert(userRoles).values({
      userId: adminUserId,
      roleId: adminRoleId,
    }).onConflictDoNothing();

    for (const yid of yardIds) {
      await db.insert(userYards).values({
        userId: adminUserId,
        yardId: yid,
      }).onConflictDoNothing();
    }
    console.log("Seeded admin user (admin@gapmc.local) with ADMIN role and all yards. Password: " + DEFAULT_ADMIN_PASSWORD);
  } else if (existingAdmin.length > 0) {
    const a = existingAdmin[0];
    const patch: {
      passwordHash?: string;
      username?: string;
      employeeId?: string | null;
      updatedAt: string;
    } = { updatedAt: now };
    if (!a.passwordHash) patch.passwordHash = passwordHash;
    if (!a.username) patch.username = "admin";
    if (!a.employeeId && bootstrapEmpId) {
      patch.employeeId = bootstrapEmpId;
      await db
        .update(employees)
        .set({ userId: a.id, updatedAt: now })
        .where(eq(employees.id, bootstrapEmpId));
    }
    if (Object.keys(patch).length > 1) {
      await db.update(users).set(patch).where(eq(users.id, a.id));
      if (!a.passwordHash) console.log("Updated admin user with password hash. Password: " + DEFAULT_ADMIN_PASSWORD);
      if (!a.username) console.log("Set admin username to 'admin' for email-or-username login");
      if (!a.employeeId && bootstrapEmpId) console.log("Linked admin user to bootstrap employee (SRS §1.4)");
    } else {
      console.log("Admin user already exists, skipping");
    }
  }

  // 7. Legacy DBs: admin exists but still has no employee_id (bootstrap row missing or never linked)
  const [admFix] = await db.select().from(users).where(eq(users.email, "admin@gapmc.local")).limit(1);
  if (admFix && !admFix.employeeId && yardIds.length > 0) {
    const eid = nanoid();
    const y0 = yardIds[0]!;
    await db.insert(employees).values({
      id: eid,
      empId: `EMP-ADMIN-${nanoid(8)}`,
      firstName: "System",
      surname: "Admin",
      designation: "Administrator",
      yardId: y0,
      employeeType: "Regular",
      joiningDate: now.slice(0, 10),
      status: "Active",
      workEmail: admFix.email,
      userId: admFix.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.update(users).set({ employeeId: eid, updatedAt: now }).where(eq(users.id, admFix.id));
    await db.insert(userYards).values({ userId: admFix.id, yardId: y0 }).onConflictDoNothing();
    console.log("Linked admin@gapmc.local to new employee row (had no employee_id). Password (if unset): " + DEFAULT_ADMIN_PASSWORD);
  }

  console.log("IOMS M-10 seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
