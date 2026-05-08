/**
 * M-04: Resolve trader reference from POST/PUT body to canonical trader_licences.id
 * and human-readable licence line (issued / provisional / ENT code).
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { traderLicences } from "@shared/db-schema";

export type ResolvedPurchaseTrader = {
  id: string;
  firmName: string;
  licenceDisplay: string | null;
};

function licenceDisplayFromRow(r: {
  licenceNo: string | null;
  provisionalLicenceNo: string | null;
  entityPublicCode: string | null;
}): string | null {
  const a = r.licenceNo != null && String(r.licenceNo).trim() !== "" ? String(r.licenceNo).trim() : null;
  const b =
    r.provisionalLicenceNo != null && String(r.provisionalLicenceNo).trim() !== ""
      ? String(r.provisionalLicenceNo).trim()
      : null;
  const c =
    r.entityPublicCode != null && String(r.entityPublicCode).trim() !== ""
      ? String(r.entityPublicCode).trim()
      : null;
  return a ?? b ?? c ?? null;
}

const traderPickCols = {
  id: traderLicences.id,
  firmName: traderLicences.firmName,
  licenceNo: traderLicences.licenceNo,
  provisionalLicenceNo: traderLicences.provisionalLicenceNo,
  entityPublicCode: traderLicences.entityPublicCode,
};

/**
 * Accepts row id, TA:&lt;id&gt;, public licence_no (e.g. GAPMC/AUTO/…), or entity_public_code.
 */
export async function resolvePurchaseTransactionTraderRef(rawInput: string): Promise<ResolvedPurchaseTrader | null> {
  const raw = String(rawInput ?? "").trim();
  if (!raw) return null;

  const taStripped = raw.toUpperCase().startsWith("TA:") ? raw.slice(3).trim() : null;
  const idCandidate = taStripped ?? raw;

  async function pick(where: ReturnType<typeof eq>) {
    const [row] = await db.select(traderPickCols).from(traderLicences).where(where).limit(1);
    return row;
  }

  let row = await pick(eq(traderLicences.id, idCandidate));
  if (!row && taStripped && taStripped !== raw) row = await pick(eq(traderLicences.id, raw));
  if (!row) row = await pick(eq(traderLicences.licenceNo, raw));
  if (!row && idCandidate !== raw) row = await pick(eq(traderLicences.licenceNo, idCandidate));
  if (!row) row = await pick(eq(traderLicences.entityPublicCode, raw));
  if (!row && idCandidate !== raw) row = await pick(eq(traderLicences.entityPublicCode, idCandidate));

  if (!row) return null;
  const firmName = String(row.firmName ?? "").trim();
  return {
    id: row.id,
    firmName: firmName || "—",
    licenceDisplay: licenceDisplayFromRow(row),
  };
}

/** True when two raw refs denote the same trader_licences row (id, TA:id, licence_no, entity code). */
export async function tradersRefEquivalent(a: string, b: string): Promise<boolean> {
  const ra = await resolvePurchaseTransactionTraderRef(String(a ?? "").trim());
  const rb = await resolvePurchaseTransactionTraderRef(String(b ?? "").trim());
  const ta = String(a ?? "").trim();
  const tb = String(b ?? "").trim();
  if (ra && rb) return ra.id === rb.id;
  if (ra) return ra.id === tb;
  if (rb) return rb.id === ta;
  return ta === tb;
}
