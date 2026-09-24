/**
 * Leave balance debit / credit (approval & revision supersession).
 * EL consumes set-off first on debit; revision credit restores the same split when recorded.
 */
import { and, eq } from "drizzle-orm";
import { leaveTypeSkipsBalanceDebit } from "@shared/hr-leave-display";
import { db } from "./db";
import { employeeLeaveBalances } from "@shared/db-schema";

type DbExecutor = Pick<typeof db, "select" | "update">;

/** Balance account debited (Commuted → HPL). */
export function balanceLeaveTypeFor(leaveType: string): string {
  return leaveType === "COMMUTED" ? "HPL" : leaveType;
}

export type LeaveDebitSplit = {
  fromSetOff: number;
  fromBalance: number;
};

/**
 * Debit leave balance on DA approval. For EL, consumes non-expired set-off days first.
 * Returns how many days came from set-off vs main balance (for revision reversal).
 */
export async function debitLeaveBalanceOnApproval(
  tx: DbExecutor,
  params: { employeeId: string; leaveType: string; debitDays: number; asOfDate?: string },
): Promise<LeaveDebitSplit> {
  const { employeeId, leaveType, debitDays } = params;
  if (debitDays <= 0) return { fromSetOff: 0, fromBalance: 0 };
  if (leaveTypeSkipsBalanceDebit(leaveType)) return { fromSetOff: 0, fromBalance: 0 };

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
  let fromSetOff = 0;

  if (balLeaveType === "EL" && setOffDays > 0 && (!setOffExpiry || setOffExpiry >= asOf)) {
    fromSetOff = Math.min(setOffDays, remaining);
    setOffDays -= fromSetOff;
    remaining -= fromSetOff;
  }

  if (remaining > 0) {
    if (balanceDays + 1e-9 < remaining) throw new Error("LEAVE_INSUFFICIENT_BALANCE");
  }

  await tx
    .update(employeeLeaveBalances)
    .set({
      balanceDays: remaining > 0 ? balanceDays - remaining : balanceDays,
      setOffDays: setOffDays > 0 ? setOffDays : 0,
      setOffExpiryDate: setOffDays > 0 ? bal.setOffExpiryDate : null,
      updatedAt: ts,
    })
    .where(eq(employeeLeaveBalances.id, bal.id));

  return { fromSetOff, fromBalance: remaining };
}

/**
 * Credit leave balance when an approved leave is superseded by a revised order.
 * Prefer restoring the original debit split (set-off vs balance) when provided.
 * Fallback (legacy rows): credit all days back to balanceDays.
 */
export async function creditLeaveBalanceOnReversal(
  tx: DbExecutor,
  params: {
    employeeId: string;
    leaveType: string;
    creditDays: number;
    fromSetOff?: number | null;
    fromBalance?: number | null;
    /** Restore set-off expiry when putting days back into set-off (from original leave if known). */
    setOffExpiryDate?: string | null;
  },
): Promise<void> {
  const { employeeId, leaveType, creditDays } = params;
  if (creditDays <= 0) return;
  if (leaveTypeSkipsBalanceDebit(leaveType)) return;

  const balLeaveType = balanceLeaveTypeFor(leaveType);
  const [bal] = await tx
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, balLeaveType)))
    .limit(1);

  const ts = new Date().toISOString();
  if (!bal) {
    throw new Error("LEAVE_BALANCE_MISSING");
  }

  const hasSplit =
    params.fromSetOff != null &&
    Number.isFinite(Number(params.fromSetOff)) &&
    params.fromBalance != null &&
    Number.isFinite(Number(params.fromBalance));

  let restoreSetOff = 0;
  let restoreBalance = creditDays;
  if (hasSplit) {
    restoreSetOff = Math.max(0, Number(params.fromSetOff));
    restoreBalance = Math.max(0, Number(params.fromBalance));
    // Guard: if split doesn't add up (data drift), fall back to all → balance
    if (Math.abs(restoreSetOff + restoreBalance - creditDays) > 1e-6) {
      restoreSetOff = 0;
      restoreBalance = creditDays;
    }
  }

  const nextSetOff = Number(bal.setOffDays ?? 0) + restoreSetOff;
  const nextBalance = Number(bal.balanceDays ?? 0) + restoreBalance;
  const nextExpiry =
    restoreSetOff > 0
      ? params.setOffExpiryDate?.trim() || bal.setOffExpiryDate || null
      : bal.setOffExpiryDate;

  await tx
    .update(employeeLeaveBalances)
    .set({
      balanceDays: nextBalance,
      setOffDays: nextSetOff > 0 ? nextSetOff : 0,
      setOffExpiryDate: nextSetOff > 0 ? nextExpiry : null,
      updatedAt: ts,
    })
    .where(eq(employeeLeaveBalances.id, bal.id));
}

/** Same rules as debit, for use inside the approval transaction. */
export async function assertSufficientBalanceForApprovalTx(
  tx: DbExecutor,
  employeeId: string,
  leaveType: string,
  debitDays: number,
  asOfDate?: string,
): Promise<void> {
  if (debitDays <= 0) return;
  if (leaveTypeSkipsBalanceDebit(leaveType)) return;
  const balLeaveType = balanceLeaveTypeFor(leaveType);
  const [bal] = await tx
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, balLeaveType)))
    .limit(1);
  if (!bal) throw new Error("LEAVE_INSUFFICIENT_BALANCE");

  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10);
  let available = Number(bal.balanceDays ?? 0);
  if (balLeaveType === "EL") {
    const setOff = Number(bal.setOffDays ?? 0);
    const expiry = bal.setOffExpiryDate ? String(bal.setOffExpiryDate).trim() : "";
    if (setOff > 0 && (!expiry || expiry >= asOf)) available += setOff;
  }
  if (available + 1e-9 < debitDays) throw new Error("LEAVE_INSUFFICIENT_BALANCE");
}
