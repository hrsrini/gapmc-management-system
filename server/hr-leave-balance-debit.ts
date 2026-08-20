import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { employeeLeaveBalances } from "@shared/db-schema";

type DbExecutor = Pick<typeof db, "select" | "update">;

/** Balance account debited (Commuted → HPL). */
export function balanceLeaveTypeFor(leaveType: string): string {
  return leaveType === "COMMUTED" ? "HPL" : leaveType;
}

/**
 * Debit leave balance on DA approval. For EL, consumes non-expired set-off days first.
 */
export async function debitLeaveBalanceOnApproval(
  tx: DbExecutor,
  params: { employeeId: string; leaveType: string; debitDays: number; asOfDate?: string },
): Promise<void> {
  const { employeeId, leaveType, debitDays } = params;
  if (debitDays <= 0) return;

  const balLeaveType = balanceLeaveTypeFor(leaveType);
  const [bal] = await tx
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, balLeaveType)))
    .limit(1);

  if (!bal) throw new Error("LEAVE_INSUFFICIENT_BALANCE");

  const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
  let remaining = debitDays;
  let setOffDays = Number(bal.setOffDays ?? 0);
  const balanceDays = Number(bal.balanceDays ?? 0);
  const setOffExpiry = bal.setOffExpiryDate ? String(bal.setOffExpiryDate).trim() : "";
  const ts = new Date().toISOString();

  if (balLeaveType === "EL" && setOffDays > 0 && (!setOffExpiry || setOffExpiry >= asOf)) {
    const fromSetOff = Math.min(setOffDays, remaining);
    setOffDays -= fromSetOff;
    remaining -= fromSetOff;
    await tx
      .update(employeeLeaveBalances)
      .set({
        setOffDays: setOffDays > 0 ? setOffDays : 0,
        setOffExpiryDate: setOffDays > 0 ? bal.setOffExpiryDate : null,
        updatedAt: ts,
      })
      .where(eq(employeeLeaveBalances.id, bal.id));
  }

  if (remaining > 0) {
    if (balanceDays + 1e-9 < remaining) throw new Error("LEAVE_INSUFFICIENT_BALANCE");
    await tx
      .update(employeeLeaveBalances)
      .set({ balanceDays: balanceDays - remaining, updatedAt: ts })
      .where(eq(employeeLeaveBalances.id, bal.id));
  }
}

/**
 * Credit leave balance when an approved leave is superseded by a revised order.
 * Credits plain balanceDays (does not restore set-off bucket).
 */
export async function creditLeaveBalanceOnReversal(
  tx: DbExecutor,
  params: { employeeId: string; leaveType: string; creditDays: number },
): Promise<void> {
  const { employeeId, leaveType, creditDays } = params;
  if (creditDays <= 0) return;

  const balLeaveType = balanceLeaveTypeFor(leaveType);
  const [bal] = await tx
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, balLeaveType)))
    .limit(1);

  const ts = new Date().toISOString();
  if (!bal) {
    // Insert via update path is not available without insert on DbExecutor — use select+throw if missing
    throw new Error("LEAVE_BALANCE_MISSING");
  }
  await tx
    .update(employeeLeaveBalances)
    .set({ balanceDays: Number(bal.balanceDays ?? 0) + creditDays, updatedAt: ts })
    .where(eq(employeeLeaveBalances.id, bal.id));
}
