import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import { employees, traderLicences, entities, adHocEntities } from "@shared/db-schema";

const ACTIVE_EMPLOYEE_STATUSES = ["Active", "Draft", "Submitted", "Recommended"] as const;
const ACTIVE_ENTITY_STATUSES = ["Active", "Draft"] as const;
const ACTIVE_LICENCE_STATUSES = ["Draft", "Pending", "Query", "Active"] as const;

function panEq(col: any, panUpper: string) {
  return and(isNotNull(col), sql`upper(trim(${col})) = ${panUpper}`);
}

export async function isPanTakenAcrossActiveMasters(args: {
  panUpper: string;
  excludeEmployeeId?: string | null;
  excludeEntityId?: string | null;
  excludeAdHocEntityId?: string | null;
  excludeTraderLicenceId?: string | null;
}): Promise<boolean> {
  const pan = args.panUpper.toUpperCase();

  // Employees (Active / Draft / Submitted / Recommended)
  {
    const conds: any[] = [panEq(employees.pan, pan), inArray(employees.status, [...ACTIVE_EMPLOYEE_STATUSES])];
    if (args.excludeEmployeeId) conds.push(ne(employees.id, args.excludeEmployeeId));
    const rows = await db.select({ id: employees.id }).from(employees).where(and(...conds)).limit(1);
    if (rows.length) return true;
  }

  // Track B entities
  {
    const conds: any[] = [panEq(entities.pan, pan), inArray(entities.status, [...ACTIVE_ENTITY_STATUSES])];
    if (args.excludeEntityId) conds.push(ne(entities.id, args.excludeEntityId));
    const rows = await db.select({ id: entities.id }).from(entities).where(and(...conds)).limit(1);
    if (rows.length) return true;
  }

  // Ad-hoc entities
  {
    const conds: any[] = [panEq(adHocEntities.pan, pan), inArray(adHocEntities.status, [...ACTIVE_ENTITY_STATUSES])];
    if (args.excludeAdHocEntityId) conds.push(ne(adHocEntities.id, args.excludeAdHocEntityId));
    const rows = await db.select({ id: adHocEntities.id }).from(adHocEntities).where(and(...conds)).limit(1);
    if (rows.length) return true;
  }

  // Track A trader licences (entity-like identity)
  {
    const conds: any[] = [panEq(traderLicences.pan, pan), inArray(traderLicences.status, [...ACTIVE_LICENCE_STATUSES])];
    if (args.excludeTraderLicenceId) conds.push(ne(traderLicences.id, args.excludeTraderLicenceId));
    const rows = await db.select({ id: traderLicences.id }).from(traderLicences).where(and(...conds)).limit(1);
    if (rows.length) return true;
  }

  return false;
}

