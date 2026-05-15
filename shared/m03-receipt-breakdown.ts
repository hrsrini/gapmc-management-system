/**
 * M-03 IOMS receipt JSON in `ioms_receipts.m03_breakdown_json`:
 * splits rent (invoice) vs arrears interest for combined payments and links settled interest ledger rows.
 */
export type M03ReceiptBreakdownV1 = {
  /** Portion of the receipt that retires M-03 rent invoice outstanding (excludes arrears interest). */
  rentAmount?: number;
  /** Portion applied to rent deposit ledger interest accrual rows. */
  interestAmount?: number;
  /** `rent_deposit_ledger.id` rows with entry_type Interest being settled by this receipt. */
  interestLedgerEntryIds?: string[];
};

export function parseM03ReceiptBreakdown(json: string | null | undefined): M03ReceiptBreakdownV1 | null {
  if (json == null || String(json).trim() === "") return null;
  try {
    const o = JSON.parse(String(json)) as unknown;
    if (!o || typeof o !== "object") return null;
    const x = o as Record<string, unknown>;
    const rentAmount = x.rentAmount != null ? Number(x.rentAmount) : undefined;
    const interestAmount = x.interestAmount != null ? Number(x.interestAmount) : undefined;
    const idsRaw = x.interestLedgerEntryIds;
    const interestLedgerEntryIds = Array.isArray(idsRaw)
      ? idsRaw.map((id) => String(id ?? "").trim()).filter(Boolean)
      : undefined;
    return {
      rentAmount: Number.isFinite(rentAmount) ? rentAmount : undefined,
      interestAmount: Number.isFinite(interestAmount) ? interestAmount : undefined,
      interestLedgerEntryIds,
    };
  } catch {
    return null;
  }
}

export function stringifyM03ReceiptBreakdown(b: M03ReceiptBreakdownV1): string {
  return JSON.stringify(b);
}

/** Amount from this receipt that reduces rent **invoice** outstanding (not arrears interest). */
export function m03ReceiptPrincipalTowardInvoice(r: {
  sourceModule: string | null;
  sourceRecordId: string | null;
  status: string | null;
  revenueHead: string;
  totalAmount: number | null;
  m03BreakdownJson?: string | null;
}): number {
  if (String(r.sourceModule ?? "") !== "M-03" || !r.sourceRecordId) return 0;
  const st = String(r.status ?? "");
  if (st !== "Paid" && st !== "Reconciled") return 0;
  const rh = String(r.revenueHead ?? "");
  if (rh === "RentArrearsInterest") return 0;
  if (rh !== "Rent" && rh !== "GSTInvoice") return 0;
  const br = parseM03ReceiptBreakdown(r.m03BreakdownJson);
  if (br && typeof br.rentAmount === "number" && Number.isFinite(br.rentAmount) && br.rentAmount >= 0) {
    return Math.round(br.rentAmount * 100) / 100;
  }
  return Math.round(Number(r.totalAmount ?? 0) * 100) / 100;
}
