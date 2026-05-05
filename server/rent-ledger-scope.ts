import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { rentDepositLedger } from "@shared/db-schema";
import type { InferSelectModel } from "drizzle-orm";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";

type LedgerRow = InferSelectModel<typeof rentDepositLedger>;

/** Rent invoices store bare trader licence id for Track A; Track B entity rent uses `TB:<entity_id>` in tenant_licence_id. */
export function rentInvoiceLedgerScope(inv: { tenantLicenceId: string }): {
  ledgerTenantLicenceId: string | null;
  unifiedEntityId: string;
} {
  const p = parseUnifiedEntityId(inv.tenantLicenceId);
  if (p?.kind === "TB") {
    return { ledgerTenantLicenceId: null, unifiedEntityId: inv.tenantLicenceId.trim() };
  }
  const tid = p?.kind === "TA" ? p.refId : inv.tenantLicenceId.trim();
  return { ledgerTenantLicenceId: tid, unifiedEntityId: unifiedEntityIdFromTrackA(tid) };
}

export async function latestRentDepositLedgerRowForInvoice(inv: {
  tenantLicenceId: string;
  assetId: string;
}): Promise<LedgerRow | undefined> {
  const sc = rentInvoiceLedgerScope(inv);
  if (sc.ledgerTenantLicenceId != null) {
    const rows = await db
      .select()
      .from(rentDepositLedger)
      .where(and(eq(rentDepositLedger.tenantLicenceId, sc.ledgerTenantLicenceId), eq(rentDepositLedger.assetId, inv.assetId)))
      .orderBy(desc(rentDepositLedger.entryDate), desc(rentDepositLedger.id))
      .limit(1);
    return rows[0];
  }
  const rows = await db
    .select()
    .from(rentDepositLedger)
    .where(
      and(isNull(rentDepositLedger.tenantLicenceId), eq(rentDepositLedger.unifiedEntityId, sc.unifiedEntityId), eq(rentDepositLedger.assetId, inv.assetId)),
    )
    .orderBy(desc(rentDepositLedger.entryDate), desc(rentDepositLedger.id))
    .limit(1);
  return rows[0];
}
