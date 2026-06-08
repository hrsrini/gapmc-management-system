import { and, desc, eq, inArray, or } from "drizzle-orm";
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
import {
  addInvoiceTenantLicenceRefs,
  collectReceiptLicenceLookupRefs,
  loadLicenceDisplayMaps,
  mergeReceiptLicenceLookupRefs,
  resolveLicenceDisplayFromRefs,
  type ReceiptLicenceLookupRefs,
} from "./ioms-receipt-licence-display";

export type RentDepositLedgerRow = InferSelectModel<typeof rentDepositLedger>;

export type RentDepositLedgerEnriched = RentDepositLedgerRow & {
  assetDisplay: string | null;
  invoiceNo: string | null;
  receiptNo: string | null;
  refDisplay: string;
  unifiedEntityDisplayName: string;
  tenantLicenceDisplayName: string;
  /** Licence no. (Track A) or ENT-… entity code (Track B). */
  licenceOrEntityIdDisplay: string;
  invoiceStatus?: string | null;
  /** Latest Paid/Reconciled M-03 rent/GST receipt for this invoice (for Rent ledger lines). */
  invoicePaidReceiptId?: string | null;
  invoicePaidReceiptNo?: string | null;
};

/** Map invoice id → latest paid principal rent receipt (M-03). */
async function paidRentReceiptsByInvoiceId(
  invoiceIds: string[],
): Promise<Map<string, { id: string; receiptNo: string }>> {
  const out = new Map<string, { id: string; receiptNo: string }>();
  if (invoiceIds.length === 0) return out;
  const rows = await db
    .select({
      id: iomsReceipts.id,
      receiptNo: iomsReceipts.receiptNo,
      sourceRecordId: iomsReceipts.sourceRecordId,
      createdAt: iomsReceipts.createdAt,
    })
    .from(iomsReceipts)
    .where(
      and(
        eq(iomsReceipts.sourceModule, "M-03"),
        inArray(iomsReceipts.sourceRecordId, invoiceIds),
        inArray(iomsReceipts.status, ["Paid", "Reconciled"]),
        or(eq(iomsReceipts.revenueHead, "Rent"), eq(iomsReceipts.revenueHead, "GSTInvoice")),
      ),
    )
    .orderBy(desc(iomsReceipts.createdAt));
  for (const r of rows) {
    const invId = String(r.sourceRecordId ?? "").trim();
    if (!invId || out.has(invId)) continue;
    out.set(invId, { id: r.id, receiptNo: String(r.receiptNo ?? "").trim() || r.id });
  }
  return out;
}

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
      invoiceStatus: rentInvoices.status,
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
      invoiceStatus: j.invoiceStatus ?? null,
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
>(list: T[]): Promise<
  Array<T & { unifiedEntityDisplayName: string; tenantLicenceDisplayName: string; licenceOrEntityIdDisplay: string }>
> {
  const tenantIds = Array.from(
    new Set(
      list
        .map((r) => String(r.tenantLicenceId ?? "").trim())
        .filter((t) => t && !/^(TA|TB|AH):/i.test(t)),
    ),
  );
  const firmByLicenceId = new Map<string, string>();
  if (tenantIds.length > 0) {
    const licRows = await db
      .select({ id: traderLicences.id, firmName: traderLicences.firmName })
      .from(traderLicences)
      .where(inArray(traderLicences.id, tenantIds));
    for (const l of licRows) {
      firmByLicenceId.set(l.id, String(l.firmName ?? "").trim() || l.id);
    }
  }

  const licenceRefsByRow: ReceiptLicenceLookupRefs[] = [];
  const mergedLicenceRefs: ReceiptLicenceLookupRefs = {
    traderIds: new Set(),
    entityIds: new Set(),
    adHocIds: new Set(),
  };
  for (const row of list) {
    const refs = collectReceiptLicenceLookupRefs({
      unifiedEntityId: ledgerRowEffectiveUnifiedEntityId(row),
      sourceModule: String(row.invoiceId ?? "").trim() ? "M-03" : null,
      sourceRecordId: row.invoiceId,
    });
    addInvoiceTenantLicenceRefs(row.invoiceTenantLicenceId, row.invoiceEntityId, refs);
    const ledgerTid = String(row.tenantLicenceId ?? "").trim();
    if (ledgerTid && !/^(TA|TB|AH):/i.test(ledgerTid)) refs.traderIds.add(ledgerTid);
    licenceRefsByRow.push(refs);
    mergeReceiptLicenceLookupRefs(mergedLicenceRefs, refs);
  }
  const licenceMaps = await loadLicenceDisplayMaps(mergedLicenceRefs);

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

  return list.map((row, index) => {
    const tidRaw = String(row.tenantLicenceId ?? "").trim();
    const tidBare = /^(TA|TB|AH):/i.test(tidRaw) ? "" : tidRaw;
    const firm = tidBare ? (firmByLicenceId.get(tidBare) ?? null) : null;
    const licNo = resolveLicenceDisplayFromRefs(licenceRefsByRow[index], licenceMaps);
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
    const licenceOrEntityIdDisplay = licNo ?? tenantLicenceDisplayName;

    return { ...row, unifiedEntityDisplayName, tenantLicenceDisplayName, licenceOrEntityIdDisplay };
  });
}

export async function listRentDepositLedgerEnriched(): Promise<RentDepositLedgerEnriched[]> {
  const withRefs = await fetchRentDepositLedgerWithRefs();
  const invIds = [
    ...new Set(withRefs.map((r) => String(r.invoiceId ?? "").trim()).filter(Boolean)),
  ] as string[];
  const paidByInv = await paidRentReceiptsByInvoiceId(invIds);
  const withPaid = withRefs.map((r) => {
    const invId = String(r.invoiceId ?? "").trim();
    const paid = invId ? paidByInv.get(invId) : undefined;
    return {
      ...r,
      invoicePaidReceiptId: paid?.id ?? null,
      invoicePaidReceiptNo: paid?.receiptNo ?? null,
    };
  });
  const enriched = await enrichRentDepositLedgerPartyNames(withPaid);
  return enriched.map(({ invoiceTenantLicenceId: _t, invoiceEntityId: _e, ...row }) => row);
}
