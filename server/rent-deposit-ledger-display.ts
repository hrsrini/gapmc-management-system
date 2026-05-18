import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import {
  adHocEntities,
  assets,
  entities,
  iomsReceipts,
  rentDepositLedger,
  rentInvoices,
  traderLicences,
  yards,
} from "@shared/db-schema";
import type { InferSelectModel } from "drizzle-orm";
import { ledgerRowEffectiveUnifiedEntityId } from "./rent-ledger-scope";
import { parseUnifiedEntityId } from "@shared/unified-entity-id";

export type RentDepositLedgerRow = InferSelectModel<typeof rentDepositLedger>;

export type RentDepositLedgerEnriched = RentDepositLedgerRow & {
  assetDisplay: string | null;
  invoiceNo: string | null;
  receiptNo: string | null;
  refDisplay: string;
  unifiedEntityDisplayName: string;
  tenantLicenceDisplayName: string;
};

function resolveInvoiceLabel(
  invoiceId: string | null | undefined,
  storedNo: string | null | undefined,
): string | null {
  const id = String(invoiceId ?? "").trim();
  if (!id) return null;
  const explicit = String(storedNo ?? "").trim();
  if (explicit) return explicit;
  return null;
}

/** Load ledger rows with premises code, invoice no, and receipt no via SQL joins (not yard-scoped). */
export async function fetchRentDepositLedgerWithRefs(): Promise<
  Array<
    RentDepositLedgerRow & {
      assetDisplay: string | null;
      invoiceNo: string | null;
      receiptNo: string | null;
      refDisplay: string;
      invoiceTenantLicenceId: string | null;
      invoiceEntityId: string | null;
    }
  >
> {
  const joined = await db
    .select({
      ledger: rentDepositLedger,
      assetPremisesCode: assets.assetId,
      invoiceNo: rentInvoices.invoiceNo,
      invoicePeriodMonth: rentInvoices.periodMonth,
      invoiceTenantLicenceId: rentInvoices.tenantLicenceId,
      invoiceEntityId: rentInvoices.entityId,
      yardCode: yards.code,
      receiptNo: iomsReceipts.receiptNo,
    })
    .from(rentDepositLedger)
    .leftJoin(
      assets,
      or(eq(assets.id, rentDepositLedger.assetId), eq(assets.assetId, rentDepositLedger.assetId)),
    )
    .leftJoin(rentInvoices, eq(rentInvoices.id, rentDepositLedger.invoiceId))
    .leftJoin(yards, eq(yards.id, rentInvoices.yardId))
    .leftJoin(iomsReceipts, eq(iomsReceipts.id, rentDepositLedger.receiptId))
    .orderBy(desc(rentDepositLedger.entryDate));

  return joined.map((j) => {
    const row = j.ledger;
    const invId = String(row.invoiceId ?? "").trim();
    const invoiceNo = resolveInvoiceLabel(invId, j.invoiceNo);
    const assetDisplay = String(j.assetPremisesCode ?? "").trim() || null;
    const receiptNo = String(j.receiptNo ?? "").trim() || null;
    const refDisplay =
      invoiceNo ?? receiptNo ?? invId ?? (String(row.receiptId ?? "").trim() || "—");
    return {
      ...row,
      assetDisplay,
      invoiceNo,
      receiptNo,
      refDisplay,
      invoiceTenantLicenceId: j.invoiceTenantLicenceId,
      invoiceEntityId: j.invoiceEntityId,
    };
  });
}

export async function enrichRentDepositLedgerPartyNames<
  T extends RentDepositLedgerRow & {
    invoiceTenantLicenceId?: string | null;
    invoiceEntityId?: string | null;
  },
>(list: T[]): Promise<Array<T & { unifiedEntityDisplayName: string; tenantLicenceDisplayName: string }>> {
  const tenantIds = Array.from(
    new Set(
      list
        .map((r) => String(r.tenantLicenceId ?? "").trim())
        .filter((t) => t && !/^(TA|TB|AH):/i.test(t)),
    ),
  );
  const firmByLicenceId = new Map<string, string>();
  const licenceNoById = new Map<string, string | null>();
  if (tenantIds.length > 0) {
    const licRows = await db
      .select({ id: traderLicences.id, firmName: traderLicences.firmName, licenceNo: traderLicences.licenceNo })
      .from(traderLicences)
      .where(inArray(traderLicences.id, tenantIds));
    for (const l of licRows) {
      firmByLicenceId.set(l.id, String(l.firmName ?? "").trim() || l.id);
      const no = l.licenceNo != null ? String(l.licenceNo).trim() : "";
      licenceNoById.set(l.id, no || null);
    }
  }

  const tbRefFromInvoice = (row: T): string | null => {
    const eid = String(row.invoiceEntityId ?? "").trim();
    if (eid) return eid;
    const t = String(row.invoiceTenantLicenceId ?? "").trim();
    const p = parseUnifiedEntityId(t);
    return p?.kind === "TB" ? p.refId : null;
  };

  const tbIds = Array.from(
    new Set(
      list.flatMap((r) => {
        const out: string[] = [];
        const eff = ledgerRowEffectiveUnifiedEntityId(r);
        const p1 = eff ? parseUnifiedEntityId(eff) : null;
        if (p1?.kind === "TB" && p1.refId) out.push(p1.refId);
        const invRef = tbRefFromInvoice(r);
        if (invRef) out.push(invRef);
        return out;
      }),
    ),
  );
  const ahIds = Array.from(
    new Set(
      list
        .map((r) => {
          const eff = ledgerRowEffectiveUnifiedEntityId(r);
          const p = eff ? parseUnifiedEntityId(eff) : null;
          return p?.kind === "AH" ? p.refId : null;
        })
        .filter((x): x is string => Boolean(x)),
    ),
  );

  const entityNameById = new Map<string, string>();
  const entityNameByEntityCode = new Map<string, string>();
  if (tbIds.length > 0) {
    const entRows = await db
      .select({ id: entities.id, entityCode: entities.entityCode, name: entities.name })
      .from(entities)
      .where(or(inArray(entities.id, tbIds), inArray(entities.entityCode, tbIds)));
    for (const er of entRows) {
      const label = String(er.name ?? "").trim() || er.id;
      entityNameById.set(er.id, label);
      const code = er.entityCode != null ? String(er.entityCode).trim() : "";
      if (code) entityNameByEntityCode.set(code, label);
    }
  }
  const adhocNameById = new Map<string, string>();
  if (ahIds.length > 0) {
    const ahRows = await db
      .select({ id: adHocEntities.id, name: adHocEntities.name })
      .from(adHocEntities)
      .where(inArray(adHocEntities.id, ahIds));
    for (const ar of ahRows) {
      adhocNameById.set(ar.id, String(ar.name ?? "").trim() || ar.id);
    }
  }

  return list.map((row) => {
    const tidRaw = String(row.tenantLicenceId ?? "").trim();
    const tidBare = /^(TA|TB|AH):/i.test(tidRaw) ? "" : tidRaw;
    const firm = tidBare ? (firmByLicenceId.get(tidBare) ?? null) : null;
    const licNo = tidBare ? (licenceNoById.get(tidBare) ?? null) : null;
    const effUe = ledgerRowEffectiveUnifiedEntityId(row);
    const parsed = effUe ? parseUnifiedEntityId(effUe) : null;
    const resolveTb = (ref: string) => entityNameById.get(ref) ?? entityNameByEntityCode.get(ref);
    const invTbRef = tbRefFromInvoice(row);

    const unifiedEntityDisplayName = (() => {
      if (!parsed) {
        if (invTbRef) {
          const n = resolveTb(invTbRef);
          if (n) return n;
        }
        return firm || tidBare || "—";
      }
      if (parsed.kind === "TA") {
        return (firmByLicenceId.get(parsed.refId) ?? firm ?? tidBare) || "—";
      }
      if (parsed.kind === "TB") {
        return resolveTb(parsed.refId) ?? (invTbRef ? resolveTb(invTbRef) : undefined) ?? firm ?? "—";
      }
      if (parsed.kind === "AH") {
        return adhocNameById.get(parsed.refId) ?? "—";
      }
      return firm || tidBare || "—";
    })();

    const tenantLicenceDisplayName = (licNo ?? tidBare) || "—";
    return { ...row, unifiedEntityDisplayName, tenantLicenceDisplayName };
  });
}

export async function listRentDepositLedgerEnriched(): Promise<RentDepositLedgerEnriched[]> {
  const withRefs = await fetchRentDepositLedgerWithRefs();
  const enriched = await enrichRentDepositLedgerPartyNames(withRefs);
  return enriched.map(({ invoiceTenantLicenceId: _t, invoiceEntityId: _e, ...row }) => row);
}
