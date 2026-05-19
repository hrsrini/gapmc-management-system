/**
 * M-02 Track B pre-receipt issue: resolve premises/rent from active entity allotment.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { assets, entityAllotments, preReceipts } from "@shared/db-schema";

export type PreReceiptIssueContext = {
  allotmentId: string;
  rentPremisesType: string;
  rentPremisesRef: string;
  amount: number;
  yardId: string;
};

export function billingMonthWithinAllotment(ym: string, fromDate: string, toDate: string): boolean {
  const month = ym.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const start = String(fromDate).trim().slice(0, 7);
  const end = String(toDate).trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return false;
  return month >= start && month <= end;
}

export async function resolvePreReceiptIssueContext(entityId: string): Promise<PreReceiptIssueContext | null> {
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
  const ref =
    String(allot.premisesRefNo ?? "").trim() ||
    String(asset?.assetId ?? "").trim() ||
    allot.assetId;
  const amount = Number(allot.monthlyRent ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    allotmentId: allot.id,
    rentPremisesType: premisesType,
    rentPremisesRef: ref,
    amount,
    yardId: String(asset?.yardId ?? "").trim(),
  };
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
