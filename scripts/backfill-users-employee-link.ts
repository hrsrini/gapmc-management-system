/**
 * Ensure every app user maps to an employee master row (SRS §1.4).
 * - Users with null employeeId: inserts a minimal Active employee and links both ways.
 * - Users with employeeId but employees.user_id out of sync: fixes employees.user_id.
 *
 * Usage: npx tsx scripts/backfill-users-employee-link.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { users, employees, yards } from "../shared/db-schema";
import { nanoid } from "nanoid";

async function main() {
  const now = new Date().toISOString();
  const [firstYard] = await db.select({ id: yards.id }).from(yards).limit(1);
  if (!firstYard) {
    console.error("No yards in database; seed locations first.");
    process.exit(1);
  }

  const allUsers = await db.select().from(users);
  let createdEmp = 0;
  let fixedSync = 0;

  for (const u of allUsers) {
    let employeeId = u.employeeId;

    if (!employeeId) {
      const eid = nanoid();
      const workEmail = u.email;
      const parts = (u.name || "User").trim().split(/\s+/);
      const firstName = parts[0] || "User";
      const surname = parts.length > 1 ? parts.slice(1).join(" ") : "Account";
      await db.insert(employees).values({
        id: eid,
        empId: `EMP-LINK-${u.id.slice(0, 8)}`,
        firstName,
        surname,
        designation: "Staff",
        yardId: firstYard.id,
        employeeType: "Regular",
        joiningDate: now.slice(0, 10),
        status: "Active",
        workEmail,
        userId: u.id,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .update(users)
        .set({ employeeId: eid, updatedAt: now })
        .where(eq(users.id, u.id));
      employeeId = eid;
      createdEmp++;
      console.log(`Created employee ${eid} for user ${u.email}`);
    }

    const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId!)).limit(1);
    if (emp && emp.userId !== u.id) {
      await db.update(employees).set({ userId: u.id, updatedAt: now }).where(eq(employees.id, emp.id));
      fixedSync++;
      console.log(`Synced employees.user_id for ${emp.id} → user ${u.email}`);
    }
  }

  console.log(`Done. New employees from orphan users: ${createdEmp}. Sync fixes: ${fixedSync}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
