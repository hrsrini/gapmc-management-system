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

export type M03InvoiceGstSnapshot = {
  rentAmount: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
};

type ReceiptGstResolveInput = {
  amount: number;
  cgst?: number | null;
  sgst?: number | null;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
  m03BreakdownJson?: string | null;
  revenueHead?: string | null;
};

/**
 * When M-03 rent receipts store the full payment in `amount` with cgst/sgst = 0,
 * derive taxable rent + CGST + SGST from the linked invoice (PDF / API display).
 */
export function resolveM03ReceiptGstAmounts(
  receipt: ReceiptGstResolveInput,
  invoice?: M03InvoiceGstSnapshot | null,
): { amount: number; cgst: number; sgst: number } {
  const amount = Number(receipt.amount ?? 0);
  const cgst = Number(receipt.cgst ?? 0);
  const sgst = Number(receipt.sgst ?? 0);
  const rh = String(receipt.revenueHead ?? "").trim();
  if (rh !== "Rent" && rh !== "GSTInvoice") {
    return { amount, cgst, sgst };
  }
  if (cgst >= 0.005 || sgst >= 0.005) {
    return { amount, cgst, sgst };
  }
  if (String(receipt.sourceModule ?? "") !== "M-03" || !String(receipt.sourceRecordId ?? "").trim() || !invoice) {
    return { amount, cgst, sgst };
  }
  const invCgst = Number(invoice.cgst ?? 0);
  const invSgst = Number(invoice.sgst ?? 0);
  if (invCgst + invSgst < 0.005) {
    return { amount, cgst, sgst };
  }
  const m03Br = parseM03ReceiptBreakdown(receipt.m03BreakdownJson);
  const rentPay =
    m03Br?.rentAmount != null && Number.isFinite(m03Br.rentAmount)
      ? Number(m03Br.rentAmount)
      : Math.round((amount + cgst + sgst) * 100) / 100;
  return splitM03RentPaymentGst({
    rentPay,
    invoiceRentAmount: Number(invoice.rentAmount ?? 0),
    invoiceCgst: invCgst,
    invoiceSgst: invSgst,
    invoiceTotalAmount: Number(invoice.totalAmount ?? 0),
  });
}

/** Split a rent payment (invoice outstanding portion) into taxable rent + CGST + SGST per invoice ratios. */
export function splitM03RentPaymentGst(args: {
  rentPay: number;
  invoiceRentAmount: number;
  invoiceCgst: number;
  invoiceSgst: number;
  invoiceTotalAmount: number;
}): { amount: number; cgst: number; sgst: number } {
  const rentPay = Math.round(Number(args.rentPay) * 100) / 100;
  const invTotal = Number(args.invoiceTotalAmount) || 1;
  const f = rentPay / invTotal;
  let amount = Math.round(Number(args.invoiceRentAmount) * f * 100) / 100;
  let cgst = Math.round(Number(args.invoiceCgst) * f * 100) / 100;
  let sgst = Math.round(Number(args.invoiceSgst) * f * 100) / 100;
  const drift = Math.round((rentPay - (amount + cgst + sgst)) * 100) / 100;
  amount = Math.round((amount + drift) * 100) / 100;
  return { amount, cgst, sgst };
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
