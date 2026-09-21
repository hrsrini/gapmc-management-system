/**
 * Shared leave opening-balance import (JSON rows or CSV).
 */
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { employeeLeaveBalances } from "@shared/db-schema";
import { healLeaveBalanceEmployeeIds, resolveEmployeePkForLeaveBalance } from "./hr-leave-balance-resolve";

export type LeaveBalanceImportRow = {
  employeeId: string;
  leaveType: string;
  balanceDays: number;
  setOffDays?: number;
  setOffExpiryDate?: string | null;
};

export type LeaveBalanceImportResult = {
  upserted: number;
  skipped: { employeeId: string; leaveType: string; reason: string }[];
};

/** Minimal CSV line splitter (handles quoted cells and "" escapes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

const HEADER_ALIASES: Record<string, keyof LeaveBalanceImportRow | "employeeName"> = {
  employeeid: "employeeId",
  empid: "employeeId",
  employee: "employeeId",
  employeecode: "employeeId",
  employeename: "employeeName",
  name: "employeeName",
  leavetype: "leaveType",
  type: "leaveType",
  balancedays: "balanceDays",
  balance: "balanceDays",
  setoffdays: "setOffDays",
  setoff: "setOffDays",
  setoffexpirydate: "setOffExpiryDate",
  setoffexpiry: "setOffExpiryDate",
};

/**
 * Parse leave-balance CSV text into import rows.
 * Required columns: employeeId, leaveType, balanceDays.
 * Optional: setOffDays, setOffExpiryDate. employeeName is ignored if present.
 */
export function parseLeaveBalanceImportCsv(csvText: string): {
  rows: LeaveBalanceImportRow[];
  parseErrors: string[];
} {
  const parseErrors: string[] = [];
  const text = String(csvText ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) return { rows: [], parseErrors: ["CSV is empty"] };

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], parseErrors: ["CSV must include a header row and at least one data row"] };

  const headerCells = parseCsvLine(lines[0]!);
  const colIndex: Partial<Record<keyof LeaveBalanceImportRow | "employeeName", number>> = {};
  headerCells.forEach((h, i) => {
    const key = HEADER_ALIASES[normalizeHeader(h)];
    if (key) colIndex[key] = i;
  });

  if (colIndex.employeeId == null || colIndex.leaveType == null || colIndex.balanceDays == null) {
    return {
      rows: [],
      parseErrors: [
        "CSV header must include employeeId, leaveType, and balanceDays (employeeName optional).",
      ],
    };
  }

  const rows: LeaveBalanceImportRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]!);
    const employeeId = String(cells[colIndex.employeeId!] ?? "").trim();
    const leaveType = String(cells[colIndex.leaveType!] ?? "").trim();
    const balanceRaw = String(cells[colIndex.balanceDays!] ?? "").trim();
    if (!employeeId && !leaveType && !balanceRaw) continue;
    if (!leaveType) {
      // Blank template rows (employee only) — skip quietly
      continue;
    }

    const balanceDays = Number(balanceRaw);
    const setOffRaw =
      colIndex.setOffDays != null ? String(cells[colIndex.setOffDays] ?? "").trim() : "";
    const setOffDays = setOffRaw === "" ? 0 : Number(setOffRaw);
    const expiryRaw =
      colIndex.setOffExpiryDate != null
        ? String(cells[colIndex.setOffExpiryDate] ?? "").trim()
        : "";
    const setOffExpiryDate =
      !expiryRaw || expiryRaw.toLowerCase() === "null" || expiryRaw === "-" ? null : expiryRaw;

    if (!Number.isFinite(balanceDays)) {
      parseErrors.push(`Row ${li + 1}: balanceDays must be a number`);
      continue;
    }
    if (setOffRaw !== "" && !Number.isFinite(setOffDays)) {
      parseErrors.push(`Row ${li + 1}: setOffDays must be a number`);
      continue;
    }

    rows.push({
      employeeId,
      leaveType,
      balanceDays,
      setOffDays: Number.isFinite(setOffDays) ? setOffDays : 0,
      setOffExpiryDate,
    });
  }

  return { rows, parseErrors };
}

export async function upsertLeaveBalanceImportRows(
  balances: LeaveBalanceImportRow[],
): Promise<LeaveBalanceImportResult> {
  await healLeaveBalanceEmployeeIds();

  const now = new Date().toISOString();
  let upserted = 0;
  const skipped: LeaveBalanceImportResult["skipped"] = [];

  for (const b of balances) {
    const rawEmployeeId = String(b.employeeId ?? "").trim();
    const leaveType = String(b.leaveType ?? "")
      .trim()
      .toUpperCase();
    const balanceDays = Number(b.balanceDays ?? 0);
    const setOffDays = Number(b.setOffDays ?? 0);
    const setOffExpiryDate = b.setOffExpiryDate ? String(b.setOffExpiryDate).trim() : null;
    if (!rawEmployeeId || !leaveType) {
      skipped.push({
        employeeId: rawEmployeeId || "(empty)",
        leaveType: leaveType || "(empty)",
        reason: "missing employeeId or leaveType",
      });
      continue;
    }
    if (!Number.isFinite(balanceDays) || balanceDays < 0) {
      skipped.push({ employeeId: rawEmployeeId, leaveType, reason: "balanceDays must be >= 0" });
      continue;
    }
    if (!Number.isFinite(setOffDays) || setOffDays < 0) {
      skipped.push({ employeeId: rawEmployeeId, leaveType, reason: "setOffDays must be >= 0" });
      continue;
    }

    const employeeId = await resolveEmployeePkForLeaveBalance(rawEmployeeId);
    if (!employeeId) {
      skipped.push({
        employeeId: rawEmployeeId,
        leaveType,
        reason: "unknown employeeId (use EMP-NNNN or internal employee id)",
      });
      continue;
    }

    const [existing] = await db
      .select()
      .from(employeeLeaveBalances)
      .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, leaveType)))
      .limit(1);

    if (existing) {
      await db
        .update(employeeLeaveBalances)
        .set({
          balanceDays,
          setOffDays,
          setOffExpiryDate: setOffExpiryDate || null,
          updatedAt: now,
        })
        .where(eq(employeeLeaveBalances.id, existing.id));
    } else {
      await db.insert(employeeLeaveBalances).values({
        id: nanoid(),
        employeeId,
        leaveType,
        balanceDays,
        setOffDays,
        setOffExpiryDate: setOffExpiryDate || null,
        updatedAt: now,
      });
    }
    upserted++;
  }

  return { upserted, skipped };
}
