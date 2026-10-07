/**
 * Purge leave requests, sanction/joining PDFs, and leave-related service book
 * History rows for one employee (test cleanup). Restores leave balances for
 * Approved leaves that recorded a debit split before deleting.
 *
 * Usage:
 *   dotenv -e .env -- tsx scripts/purge-employee-leave-test-data.ts --emp-id EMP-010
 *   dotenv -e .env -- tsx scripts/purge-employee-leave-test-data.ts --emp-id EMP-010 --confirm
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../server/db";
import { employees, leaveRequests, serviceBookEntries } from "../shared/db-schema";
import { creditLeaveBalanceOnReversal } from "../server/hr-leave-balance-debit";
import { assertSafeUploadRelativeKey, getUploadBlobStore } from "../server/object-storage";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function supportingDocKeyFromUrl(url: string | null | undefined): string | null {
  const u = String(url ?? "");
  const m = /[?&]key=([^&]+)/.exec(u);
  if (!m) return null;
  try {
    const key = decodeURIComponent(m[1]!);
    if (!key.startsWith("leaves/supporting-docs/")) return null;
    return assertSafeUploadRelativeKey(key);
  } catch {
    return null;
  }
}

async function main() {
  const empCode = (argValue("--emp-id") ?? process.env.EMP_ID ?? "EMP-010").trim();
  const confirm = process.argv.includes("--confirm");

  const [emp] = await db.select().from(employees).where(eq(employees.empId, empCode)).limit(1);
  if (!emp) {
    console.error(`Employee not found for empId=${empCode}`);
    process.exit(1);
  }

  const leaves = await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, emp.id));

  const sbRows = await db
    .select()
    .from(serviceBookEntries)
    .where(
      and(
        eq(serviceBookEntries.employeeId, emp.id),
        eq(serviceBookEntries.section, "History"),
        sql`${serviceBookEntries.content}->>'type' IN ('leave_sanction','leave_rejoining')`,
      ),
    );

  console.log(`Employee: ${emp.empId} — ${emp.firstName} ${emp.surname} (id=${emp.id})`);
  console.log(`Leave requests: ${leaves.length}`);
  for (const l of leaves) {
    console.log(
      `  - ${l.id} ${l.leaveType} ${l.fromDate}..${l.toDate} ${l.status} debit=${l.debitDays ?? 0} fileNo=${l.fileNo ?? "-"}`,
    );
  }
  console.log(`Leave-related service book History rows: ${sbRows.length}`);

  if (!confirm) {
    console.log("\nDry run only. Re-run with --confirm to delete.");
    process.exit(0);
  }

  const store = getUploadBlobStore();

  await db.transaction(async (tx) => {
    // Restore balances for currently Approved leaves that actually debited.
    // Skip Superseded — those were already credited when the revision was approved.
    for (const l of leaves) {
      if (String(l.status) !== "Approved") continue;
      const fromSetOff = l.debitFromSetOffDays != null ? Number(l.debitFromSetOffDays) : null;
      const fromBalance = l.debitFromBalanceDays != null ? Number(l.debitFromBalanceDays) : null;
      const recorded =
        (fromSetOff != null || fromBalance != null
          ? Number(fromSetOff ?? 0) + Number(fromBalance ?? 0)
          : Number(l.debitDays ?? 0)) || 0;
      if (recorded <= 0) continue;
      await creditLeaveBalanceOnReversal(tx, {
        employeeId: l.employeeId,
        leaveType: l.leaveType,
        creditDays: recorded,
        fromSetOff,
        fromBalance,
      });
      console.log(`  credited ${recorded}d ${l.leaveType} for leave ${l.id}`);
    }

    // Clear self-FKs then delete leave rows.
    if (leaves.length) {
      await tx
        .update(leaveRequests)
        .set({ revisedFromLeaveId: null, supersededByLeaveId: null })
        .where(eq(leaveRequests.employeeId, emp.id));
      await tx.delete(leaveRequests).where(eq(leaveRequests.employeeId, emp.id));
    }

    for (const sb of sbRows) {
      await tx.delete(serviceBookEntries).where(eq(serviceBookEntries.id, sb.id));
    }
  });

  // Blob cleanup (best-effort, outside TX).
  for (const l of leaves) {
    const keys = [
      `leaves/sanction-orders/${l.id}.pdf`,
      `leaves/joining-reports/${l.id}.pdf`,
      supportingDocKeyFromUrl(l.supportingDocumentUrl),
    ].filter(Boolean) as string[];
    for (const key of keys) {
      try {
        await store.del(assertSafeUploadRelativeKey(key));
        console.log(`  deleted blob ${key}`);
      } catch (e) {
        console.warn(`  blob delete skipped ${key}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  const leftLeaves = await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, emp.id));
  const leftSb = await db
    .select()
    .from(serviceBookEntries)
    .where(
      and(
        eq(serviceBookEntries.employeeId, emp.id),
        eq(serviceBookEntries.section, "History"),
        sql`${serviceBookEntries.content}->>'type' IN ('leave_sanction','leave_rejoining')`,
      ),
    );

  console.log(`\nDone. Remaining leave requests: ${leftLeaves.length}; leave History rows: ${leftSb.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
