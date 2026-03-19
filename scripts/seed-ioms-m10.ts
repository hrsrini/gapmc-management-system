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
} from "../shared/db-schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const DEFAULT_ADMIN_PASSWORD = "Apmc@2026";

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

const DEFAULT_CONFIG: Record<string, string> = {
  "market_fee_percent": "1.00",
  "msp_rate": "10.00",
  "admin_charges": "0.00",
  "licence_fee": "300.00",
};

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

  // 2. System config
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
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

  // 5. Optional: one admin user (email admin@gapmc.local) with hashed password
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
      passwordHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

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
    const patch: { passwordHash?: string; username?: string; updatedAt: string } = { updatedAt: now };
    if (!a.passwordHash) patch.passwordHash = passwordHash;
    if (!a.username) patch.username = "admin";
    if (Object.keys(patch).length > 1) {
      await db.update(users).set(patch).where(eq(users.id, a.id));
      if (!a.passwordHash) console.log("Updated admin user with password hash. Password: " + DEFAULT_ADMIN_PASSWORD);
      if (!a.username) console.log("Set admin username to 'admin' for email-or-username login");
    } else {
      console.log("Admin user already exists, skipping");
    }
  }

  console.log("IOMS M-10 seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
