/**
 * M-02 Track B pre-receipt issue: resolve premises/rent from active entity allotment.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { assets, entityAllotments, preReceipts } from "@shared/db-schema";

export type PreReceiptPrintFields = {
  allotmentId: string;
  rentPremisesType: string;
  /** Human-readable premises id (`assets.asset_id`), e.g. VAL/SHOP-S1 — printed as Shop/Godown No. */
  rentPremisesId: string;
  /** Formal allotment reference, e.g. VAL/SHOP-S1-Y-VAL-01. */
  rentAllotmentReferenceNo: string;
  amount: number;
  yardId: string;
  agreementFrom: string;
  agreementTo: string;
};

export type PreReceiptIssueContext = PreReceiptPrintFields;

export function billingMonthWithinAllotment(ym: string, fromDate: string, toDate: string): boolean {
  const month = ym.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const start = String(fromDate).trim().slice(0, 7);
  const end = String(toDate).trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return false;
  return month >= start && month <= end;
}

export async function resolvePreReceiptPrintFields(entityId: string): Promise<PreReceiptPrintFields | null> {
  const allotments = await db
    .select()
    .from(entityAllotments)
    .where(
      and(
        eq(entityAllotments.entityId, entityId),
        eq(entityAllotments.status, "Active"),
        eq(entityAllotments.approvalStatus, "Approved"),
      ),
    )
    .orderBy(desc(entityAllotments.toDate));
  const allot = allotments[0];
  if (!allot) return null;

  const [asset] = await db.select().from(assets).where(eq(assets.id, allot.assetId)).limit(1);
  const premisesType = String(asset?.assetType ?? "").trim() || "Premises";
  const premisesId = String(asset?.assetId ?? "").trim() || allot.assetId;
  const allotmentRef = String(allot.premisesRefNo ?? "").trim() || premisesId;
  const amount = Number(allot.monthlyRent ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    allotmentId: allot.id,
    rentPremisesType: premisesType,
    rentPremisesId: premisesId,
    rentAllotmentReferenceNo: allotmentRef,
    amount,
    yardId: String(asset?.yardId ?? "").trim(),
    agreementFrom: allot.fromDate,
    agreementTo: allot.toDate,
  };
}

export async function resolvePreReceiptIssueContext(entityId: string): Promise<PreReceiptIssueContext | null> {
  return resolvePreReceiptPrintFields(entityId);
}

export async function findDuplicatePreReceiptForMonth(
  entityId: string,
  rentBillingMonth: string,
  excludeId?: string,
): Promise<{ id: string; preReceiptNo: string | null } | null> {
  const ym = rentBillingMonth.trim().slice(0, 7);
  const rows = await db
    .select({
      id: preReceipts.id,
      preReceiptNo: preReceipts.preReceiptNo,
      status: preReceipts.status,
    })
    .from(preReceipts)
    .where(and(eq(preReceipts.entityId, entityId), eq(preReceipts.rentBillingMonth, ym)));
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    if (String(r.status ?? "") === "Cancelled") continue;
    return { id: r.id, preReceiptNo: r.preReceiptNo };
  }
  return null;
}
