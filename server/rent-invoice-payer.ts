import { eq } from "drizzle-orm";
import { db } from "./db";
import { entities, traderLicences, rentInvoices } from "@shared/db-schema";
import type { InferSelectModel } from "drizzle-orm";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA, unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";

export type InvoicePayerResolved = {
  payerName: string;
  payerType: string;
  payerRefId: string;
  unifiedEntityId: string;
  payerGstin: string | null;
};

/** Counterparty naming for receipts / dues from `rent_invoices` (Track A licence id vs Track B unified id). */
export async function resolveRentInvoiceCounterparty(inv: InferSelectModel<typeof rentInvoices>): Promise<InvoicePayerResolved> {
  const ue = parseUnifiedEntityId(inv.tenantLicenceId);
  if (ue?.kind === "TB") {
    const eid = String(inv.entityId ?? ue.refId).trim();
    const [ent] = await db.select().from(entities).where(eq(entities.id, eid)).limit(1);
    const gstin = ent?.gstin != null ? String(ent.gstin).trim() : "";
    return {
      payerName: ent?.name?.trim() ?? inv.tenantLicenceId,
      payerType: "TrackBEntity",
      payerRefId: eid,
      unifiedEntityId: unifiedEntityIdFromTrackB(eid),
      payerGstin: gstin || null,
    };
  }
  const traderId = ue?.kind === "TA" ? ue.refId : inv.tenantLicenceId.trim();
  const [lic] = await db
    .select({ firmName: traderLicences.firmName, gstin: traderLicences.gstin })
    .from(traderLicences)
    .where(eq(traderLicences.id, traderId))
    .limit(1);
  const gstin = lic?.gstin != null ? String(lic.gstin).trim() : "";
  return {
    payerName: (lic?.firmName?.trim() && lic.firmName) || traderId,
    payerType: "TenantLicence",
    payerRefId: traderId,
    unifiedEntityId: unifiedEntityIdFromTrackA(traderId),
    payerGstin: gstin || null,
  };
}
