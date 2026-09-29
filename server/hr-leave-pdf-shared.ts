/** Server-side leave PDF helpers (re-export shared display rules). */
export {
  employeeHonorific,
  formatLeaveCopyToLine,
  formatLeaveOrderDateDisplay as formatLeaveOrderDate,
} from "@shared/hr-leave-display";
import { and, asc, eq, sql } from "drizzle-orm";
import { auditLog } from "@shared/db-schema";
import { db } from "./db";

/** Today's date on the sanction order header: DD/MM/YYYY. */
export function formatLeaveOrderDateToday(d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function ymdFromIsoish(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** Leave application date from the Create audit row (YYYY-MM-DD), or "". */
export async function resolveLeaveApplicationDateFromAudit(leaveRequestId: string): Promise<string> {
  const [row] = await db
    .select({ createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.module, "HR"), eq(auditLog.action, "Create"), eq(auditLog.recordId, leaveRequestId)))
    .orderBy(asc(auditLog.createdAt))
    .limit(1);
  return ymdFromIsoish(row?.createdAt);
}

/** Sanction order date from the first Approved status Update in audit (YYYY-MM-DD), or "". */
export async function resolveLeaveOrderDateFromAudit(leaveRequestId: string): Promise<string> {
  const [row] = await db
    .select({ createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.module, "HR"),
        eq(auditLog.action, "Update"),
        eq(auditLog.recordId, leaveRequestId),
        sql`COALESCE(${auditLog.afterValue}->>'status', '') = 'Approved'`,
      ),
    )
    .orderBy(asc(auditLog.createdAt))
    .limit(1);
  return ymdFromIsoish(row?.createdAt);
}
