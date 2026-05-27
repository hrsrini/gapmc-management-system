import { eq } from "drizzle-orm";
import { assetAllotments, assets, entityAllotments } from "@shared/db-schema";
import { db } from "./db";

export type RentAllotmentInvoiceRefInput = {
  allotmentId: string;
  allotmentKind?: string | null;
  assetId: string;
};

/** Human-readable premises id (`assets.asset_id`), e.g. VAL/SHOP-S5 — for receipt PDF face. */
export async function resolveRentPremisesAssetId(
  inv: RentAllotmentInvoiceRefInput,
): Promise<string> {
  const [asset] = await db
    .select({ assetId: assets.assetId })
    .from(assets)
    .where(eq(assets.id, inv.assetId))
    .limit(1);
  return asset?.assetId?.trim() || inv.assetId;
}

/** Formal allotment ref for receipt face, e.g. VAL/SHOP-S5-Y-VAL-01 (premises_ref_no when set). */
export async function resolveRentFormalAllotmentRefNo(
  inv: RentAllotmentInvoiceRefInput,
): Promise<string> {
  const assetCode = await resolveRentPremisesAssetId(inv);
  const kind = String(inv.allotmentKind ?? "").trim();
  if (kind === "Entity") {
    const [ea] = await db
      .select({ premisesRefNo: entityAllotments.premisesRefNo })
      .from(entityAllotments)
      .where(eq(entityAllotments.id, inv.allotmentId))
      .limit(1);
    if (ea?.premisesRefNo?.trim()) return ea.premisesRefNo.trim();
  } else {
    const [aa] = await db
      .select({ premisesRefNo: assetAllotments.premisesRefNo })
      .from(assetAllotments)
      .where(eq(assetAllotments.id, inv.allotmentId))
      .limit(1);
    if (aa?.premisesRefNo?.trim()) return aa.premisesRefNo.trim();
  }
  return assetCode;
}

/** Premises type label from Premises Master (`assets.asset_type`), e.g. "Shop No. VAL/SHOP-S5". */
export function formatPremisesTypeWithNo(
  assetType: string | null | undefined,
  premisesAssetId: string,
): string {
  const type = String(assetType ?? "").trim() || "Premises";
  const id = String(premisesAssetId ?? "").trim();
  if (!id) return type;
  return `${type} No. ${id}`;
}

export type RentReceiptPremisesPrint = {
  premisesAssetId: string;
  assetType: string;
  premisesLabel: string;
  allotmentReferenceNo: string;
};

export async function resolveRentReceiptPremisesPrint(
  inv: RentAllotmentInvoiceRefInput,
): Promise<RentReceiptPremisesPrint> {
  const [asset] = await db
    .select({ assetId: assets.assetId, assetType: assets.assetType })
    .from(assets)
    .where(eq(assets.id, inv.assetId))
    .limit(1);
  const premisesAssetId = asset?.assetId?.trim() || inv.assetId;
  const assetType = String(asset?.assetType ?? "").trim() || "Premises";
  const allotmentReferenceNo = await resolveRentFormalAllotmentRefNo(inv);
  return {
    premisesAssetId,
    assetType,
    premisesLabel: formatPremisesTypeWithNo(assetType, premisesAssetId),
    allotmentReferenceNo,
  };
}

/** Premises code + formal allotment ref (no tenant / entity name). */
export async function resolveRentAllotmentReferenceNo(
  inv: RentAllotmentInvoiceRefInput,
): Promise<string> {
  const [asset] = await db
    .select({ assetId: assets.assetId })
    .from(assets)
    .where(eq(assets.id, inv.assetId))
    .limit(1);
  const assetCode = asset?.assetId?.trim() || inv.assetId;

  let premisesRef: string | null = null;
  const kind = String(inv.allotmentKind ?? "").trim();
  if (kind === "Entity") {
    const [ea] = await db
      .select({ premisesRefNo: entityAllotments.premisesRefNo })
      .from(entityAllotments)
      .where(eq(entityAllotments.id, inv.allotmentId))
      .limit(1);
    if (ea?.premisesRefNo?.trim()) premisesRef = ea.premisesRefNo.trim();
  } else {
    const [aa] = await db
      .select({ premisesRefNo: assetAllotments.premisesRefNo })
      .from(assetAllotments)
      .where(eq(assetAllotments.id, inv.allotmentId))
      .limit(1);
    if (aa?.premisesRefNo?.trim()) premisesRef = aa.premisesRefNo.trim();
  }

  if (premisesRef && premisesRef !== assetCode) return `${assetCode} · ${premisesRef}`;
  return premisesRef ?? assetCode;
}
