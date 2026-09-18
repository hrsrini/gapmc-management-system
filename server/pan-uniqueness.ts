import { and, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { employees, traderLicences, entities, adHocEntities, traders } from "@shared/db-schema";

const ACTIVE_EMPLOYEE_STATUSES = ["Active", "Draft", "Submitted", "Recommended", "SUS"] as const;
const ACTIVE_ENTITY_STATUSES = ["Active", "Draft"] as const;
const ACTIVE_LICENCE_STATUSES = ["Draft", "Pending", "Query", "Active"] as const;

export type PanConflictKind =
  | "Employee"
  | "TrackBEntity"
  | "AdHocEntity"
  | "TraderLicence"
  | "LegacyTrader";

export type PanConflict = {
  kind: PanConflictKind;
  id: string;
  /** Human-readable label for UI / API error messages. */
  label: string;
  status?: string | null;
};

function panEq(col: any, panUpper: string) {
  return and(isNotNull(col), sql`upper(trim(${col})) = ${panUpper}`);
}

function empDisplayName(first: string, middle: string | null | undefined, surname: string): string {
  return [first, middle, surname].filter((p) => String(p ?? "").trim()).join(" ").replace(/\s+/g, " ").trim();
}

/** User-facing duplicate PAN message including who already holds it. */
export function formatPanDuplicateMessage(conflict: PanConflict): string {
  return `PAN is already used by ${conflict.label}.`;
}

export type PanUniquenessArgs = {
  panUpper: string;
  excludeEmployeeId?: string | null;
  excludeEntityId?: string | null;
  excludeAdHocEntityId?: string | null;
  excludeTraderLicenceId?: string | null;
  excludeTraderId?: string | null;
};

/**
 * Find the first active master record using this PAN (employees, Track B, ad-hoc, Track A licences, legacy traders).
 * Returns null when the PAN is free (for the given excludes).
 */
export async function findPanConflictAcrossActiveMasters(args: PanUniquenessArgs): Promise<PanConflict | null> {
  const pan = args.panUpper.toUpperCase();

  // Track A trader licences first — most common duplicate when creating Track B entities
  {
    const conds: any[] = [panEq(traderLicences.pan, pan), inArray(traderLicences.status, [...ACTIVE_LICENCE_STATUSES])];
    if (args.excludeTraderLicenceId) conds.push(ne(traderLicences.id, args.excludeTraderLicenceId));
    const rows = await db
      .select({
        id: traderLicences.id,
        firmName: traderLicences.firmName,
        licenceNo: traderLicences.licenceNo,
        provisionalLicenceNo: traderLicences.provisionalLicenceNo,
        entityPublicCode: traderLicences.entityPublicCode,
        status: traderLicences.status,
      })
      .from(traderLicences)
      .where(and(...conds))
      .limit(1);
    const r = rows[0];
    if (r) {
      const code =
        (r.licenceNo && String(r.licenceNo).trim()) ||
        (r.entityPublicCode && String(r.entityPublicCode).trim()) ||
        (r.provisionalLicenceNo && String(r.provisionalLicenceNo).trim()) ||
        r.id;
      const firm = String(r.firmName ?? "").trim() || "Trader";
      return {
        kind: "TraderLicence",
        id: r.id,
        status: r.status,
        label: `active trader licence ${code} — ${firm} (Track A)`,
      };
    }
  }

  // Track B entities
  {
    const conds: any[] = [panEq(entities.pan, pan), inArray(entities.status, [...ACTIVE_ENTITY_STATUSES])];
    if (args.excludeEntityId) conds.push(ne(entities.id, args.excludeEntityId));
    const rows = await db
      .select({
        id: entities.id,
        name: entities.name,
        entityCode: entities.entityCode,
        status: entities.status,
      })
      .from(entities)
      .where(and(...conds))
      .limit(1);
    const r = rows[0];
    if (r) {
      const code = (r.entityCode && String(r.entityCode).trim()) || r.id;
      const name = String(r.name ?? "").trim() || "Entity";
      return {
        kind: "TrackBEntity",
        id: r.id,
        status: r.status,
        label: `active entity ${code} — ${name} (Track B)`,
      };
    }
  }

  // Ad-hoc entities
  {
    const conds: any[] = [panEq(adHocEntities.pan, pan), inArray(adHocEntities.status, [...ACTIVE_ENTITY_STATUSES])];
    if (args.excludeAdHocEntityId) conds.push(ne(adHocEntities.id, args.excludeAdHocEntityId));
    const rows = await db
      .select({
        id: adHocEntities.id,
        name: adHocEntities.name,
        entityCode: adHocEntities.entityCode,
        status: adHocEntities.status,
      })
      .from(adHocEntities)
      .where(and(...conds))
      .limit(1);
    const r = rows[0];
    if (r) {
      const code = (r.entityCode && String(r.entityCode).trim()) || r.id;
      const name = String(r.name ?? "").trim() || "Ad-hoc entity";
      return {
        kind: "AdHocEntity",
        id: r.id,
        status: r.status,
        label: `active ad-hoc entity ${code} — ${name}`,
      };
    }
  }

  // Legacy gapmc.traders (M-04 / rent flows)
  {
    const conds: any[] = [panEq(traders.pan, pan), inArray(traders.status, ["Active", "Pending"])];
    if (args.excludeTraderId) conds.push(ne(traders.id, args.excludeTraderId));
    const rows = await db
      .select({
        id: traders.id,
        name: traders.name,
        firmName: traders.firmName,
        status: traders.status,
      })
      .from(traders)
      .where(and(...conds))
      .limit(1);
    const r = rows[0];
    if (r) {
      const name =
        (r.firmName && String(r.firmName).trim()) ||
        (r.name && String(r.name).trim()) ||
        "Legacy trader";
      return {
        kind: "LegacyTrader",
        id: r.id,
        status: r.status,
        label: `active legacy trader — ${name}`,
      };
    }
  }

  // Employees
  {
    const conds: any[] = [panEq(employees.pan, pan), inArray(employees.status, [...ACTIVE_EMPLOYEE_STATUSES])];
    if (args.excludeEmployeeId) conds.push(ne(employees.id, args.excludeEmployeeId));
    const rows = await db
      .select({
        id: employees.id,
        empId: employees.empId,
        firstName: employees.firstName,
        middleName: employees.middleName,
        surname: employees.surname,
        status: employees.status,
      })
      .from(employees)
      .where(and(...conds))
      .limit(1);
    const r = rows[0];
    if (r) {
      const code = (r.empId && String(r.empId).trim()) || r.id;
      const name = empDisplayName(r.firstName, r.middleName, r.surname) || "Employee";
      return {
        kind: "Employee",
        id: r.id,
        status: r.status,
        label: `active employee ${code} — ${name}`,
      };
    }
  }

  return null;
}

export async function isPanTakenAcrossActiveMasters(args: PanUniquenessArgs): Promise<boolean> {
  return (await findPanConflictAcrossActiveMasters(args)) != null;
}
