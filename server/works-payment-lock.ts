/**
 * When an M-06 payment voucher becomes Approved, lock linked Works bills (client decision 3.4).
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { worksBills, worksPaymentAllocations } from "@shared/db-schema";

export async function lockWorksBillsForApprovedVoucher(voucherId: string): Promise<number> {
  const allocs = await db
    .select()
    .from(worksPaymentAllocations)
    .where(eq(worksPaymentAllocations.voucherId, voucherId));
  if (!allocs.length) return 0;
  const ts = new Date().toISOString();
  const billIds = Array.from(new Set(allocs.map((a) => a.billId)));
  let locked = 0;
  for (const billId of billIds) {
    const [bill] = await db.select().from(worksBills).where(eq(worksBills.id, billId)).limit(1);
    if (!bill) continue;
    if (bill.status === "Locked" && bill.lockedAt) continue;
    await db
      .update(worksBills)
      .set({
        status: "Locked",
        lockedAt: ts,
        voucherId,
        updatedAt: ts,
      })
      .where(eq(worksBills.id, billId));
    locked += 1;
  }
  return locked;
}
