/**
 * SRS §1.4: every app user maps to an employee master row.
 * Creates and links a minimal Active employee when missing or fixes stale links.
 * If `yards` is empty, inserts a single Head Office row so auto-link can run (fresh/minimal DBs).
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { users, employees, yards, userYards } from "@shared/db-schema";

async function getOrCreateAnyYardId(): Promise<string> {
  const [row] = await db.select({ id: yards.id }).from(yards).limit(1);
  if (row) return row.id;
  const yid = nanoid();
  const code = `HO-${nanoid(10)}`;
  await db.insert(yards).values({
    id: yid,
    name: "Head Office",
    code,
    type: "HO",
    isActive: true,
  });
  return yid;
}

/** When user has no yard mapping, attach primary yard so RBAC scoping has a default. */
async function ensureUserYardRow(userId: string, yardId: string): Promise<void> {
  const [uy] = await db.select({ yardId: userYards.yardId }).from(userYards).where(eq(userYards.userId, userId)).limit(1);
  if (uy) return;
  await db.insert(userYards).values({ userId, yardId }).onConflictDoNothing();
}

export async function ensureEmployeeRecordForUser(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  let employeeId = user.employeeId;

  if (employeeId) {
    const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (emp) {
      if (emp.userId !== user.id) {
        await db.update(employees).set({ userId: user.id, updatedAt: now }).where(eq(employees.id, emp.id));
      }
      await ensureUserYardRow(user.id, emp.yardId);
      return;
    }
    await db.update(users).set({ employeeId: null, updatedAt: now }).where(eq(users.id, userId));
    employeeId = null;
  }

  const yardId = await getOrCreateAnyYardId();

  const eid = nanoid();
  const parts = (user.name || "User").trim().split(/\s+/);
  const firstName = parts[0] || "User";
  const surname = parts.length > 1 ? parts.slice(1).join(" ") : "Account";
  const empIdTag = `AUTO-${nanoid(10)}`;
  await db.insert(employees).values({
    id: eid,
    empId: empIdTag,
    firstName,
    surname,
    designation: "Staff",
    yardId,
    employeeType: "Regular",
    joiningDate: now.slice(0, 10),
    status: "Active",
    workEmail: user.email,
    userId: user.id,
    createdAt: now,
    updatedAt: now,
  });
  await db.update(users).set({ employeeId: eid, updatedAt: now }).where(eq(users.id, userId));
  await ensureUserYardRow(user.id, yardId);
}
