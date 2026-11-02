/**
 * GSTIN uniqueness for Track B (and related) masters — used on Entity create/edit.
 */
import { and, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { entities, traderLicences, adHocEntities } from "@shared/db-schema";

const ACTIVE_ENTITY_STATUSES = ["Active", "Draft"] as const;
const ACTIVE_LICENCE_STATUSES = ["Draft", "Pending", "Query", "Active"] as const;

/** Indian GSTIN (15 chars). */
export const INDIAN_GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function normalizeGstinInput(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function isValidGstin(gstin: string): boolean {
  return gstin.length === 15 && INDIAN_GSTIN_RE.test(gstin);
}

export type GstinConflictKind = "TrackBEntity" | "AdHocEntity" | "TraderLicence";

export type GstinConflict = {
  kind: GstinConflictKind;
  id: string;
  label: string;
  status?: string | null;
};

function gstEq(col: any, gstUpper: string) {
  return and(isNotNull(col), sql`upper(trim(${col})) = ${gstUpper}`);
}

export function formatGstinDuplicateMessage(conflict: GstinConflict): string {
  return `GSTIN is already used by ${conflict.label}.`;
}

export type GstinUniquenessArgs = {
  gstinUpper: string;
  excludeEntityId?: string | null;
  excludeAdHocEntityId?: string | null;
  excludeTraderLicenceId?: string | null;
};

export async function findGstinConflictAcrossActiveMasters(
  args: GstinUniquenessArgs,
): Promise<GstinConflict | null> {
  const gst = args.gstinUpper.toUpperCase();

  {
    const conds: any[] = [gstEq(entities.gstin, gst), inArray(entities.status, [...ACTIVE_ENTITY_STATUSES])];
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

  {
    const conds: any[] = [
      gstEq(traderLicences.gstin, gst),
      inArray(traderLicences.status, [...ACTIVE_LICENCE_STATUSES]),
    ];
    if (args.excludeTraderLicenceId) conds.push(ne(traderLicences.id, args.excludeTraderLicenceId));
    const rows = await db
      .select({
        id: traderLicences.id,
        firmName: traderLicences.firmName,
        licenceNo: traderLicences.licenceNo,
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

  {
    const conds: any[] = [
      gstEq(adHocEntities.gstin, gst),
      inArray(adHocEntities.status, [...ACTIVE_ENTITY_STATUSES]),
    ];
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

  return null;
}
