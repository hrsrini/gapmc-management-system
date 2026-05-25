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
