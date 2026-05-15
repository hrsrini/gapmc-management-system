import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { designationMaster, employees } from "@shared/db-schema";
import { HrEmployeeRuleError } from "./hr-employee-rules";

export async function resolveDesignationForEmployeeUpsert(body: {
  designationId?: unknown;
  designation?: unknown;
}): Promise<{ designation: string; designationId: string | null }> {
  const idRaw = body.designationId;
  const didRaw =
    idRaw !== null && idRaw !== undefined && String(idRaw).trim() !== "" && String(idRaw).trim().toLowerCase() !== "null"
      ? String(idRaw).trim()
      : "";
  if (didRaw) {
    const [dm] = await db.select().from(designationMaster).where(eq(designationMaster.id, didRaw)).limit(1);
    if (!dm) {
      throw new HrEmployeeRuleError("HR_DESIGNATION_MASTER_NOT_FOUND", "Selected designation was not found in the master.");
    }
    if (String(dm.status ?? "").trim() !== "Active") {
      throw new HrEmployeeRuleError(
        "HR_DESIGNATION_INACTIVE",
        "Selected designation is inactive. Choose an active designation or clear the link.",
      );
    }
    return { designation: String(dm.name).trim(), designationId: didRaw };
  }
  const dtext = body.designation != null ? String(body.designation).trim() : "";
  if (!dtext) {
    throw new HrEmployeeRuleError("HR_DESIGNATION_REQUIRED", "Designation is required.");
  }
  return { designation: dtext, designationId: null };
}

export async function countEmployeesUsingDesignation(designationId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(employees)
    .where(eq(employees.designationId, designationId));
  return Number(r?.c ?? 0);
}

const CODE_RE = /^[A-Z0-9_]{2,32}$/;

export function assertDesignationMasterCode(code: string): void {
  const c = code.trim().toUpperCase();
  if (!CODE_RE.test(c)) {
    throw new HrEmployeeRuleError(
      "HR_DESIGNATION_CODE_FORMAT",
      "Code must be 2–32 characters: uppercase letters, digits, or underscore (e.g. ASST_MGR).",
    );
  }
}
