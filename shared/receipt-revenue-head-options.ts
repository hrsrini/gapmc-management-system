import {
  isStandardRevenueHead,
  normalizeLedgerName,
  STANDARD_REVENUE_HEADS,
  type StandardRevenueHead,
} from "./manual-receipt-types";

export type ReceiptRevenueHeadOption = {
  /** Match key — stored revenue head or Tally ledger name. */
  value: string;
  /** Dropdown label. */
  label: string;
};

const STANDARD_REVENUE_HEAD_LABELS: Record<StandardRevenueHead, string> = {
  Rent: "Rent",
  GSTInvoice: "GST Invoice",
  RentArrearsInterest: "Rent Arrears Interest",
  MarketFee: "Market Fee",
  LicenceFee: "Licence Fee",
  SecurityDeposit: "Security Deposit",
  Miscellaneous: "Miscellaneous",
};

/** Human-readable Tally / revenue head for All Receipts Type and Revenue head columns. */
export function receiptRevenueHeadDisplayLabel(rawHead: string): string {
  const h = String(rawHead ?? "").trim();
  if (!h) return "—";
  if (h === "M-02-PRE-RECEIPT") return STANDARD_REVENUE_HEAD_LABELS.Rent;
  if (isStandardRevenueHead(h)) {
    return STANDARD_REVENUE_HEAD_LABELS[h as StandardRevenueHead];
  }
  return normalizeLedgerName(h);
}

/** Build deduplicated revenue-head filter options for All Receipts / reports. */
export function buildReceiptRevenueHeadOptions(sources: {
  tallyLedgerNames?: string[];
  manualReceiptLedgerNames?: string[];
  extraHeads?: string[];
}): ReceiptRevenueHeadOption[] {
  const seen = new Set<string>();
  const options: ReceiptRevenueHeadOption[] = [];

  const add = (raw: string, label?: string) => {
    const value = normalizeLedgerName(raw);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ value, label: label ?? value });
  };

  for (const name of sources.tallyLedgerNames ?? []) add(name);
  for (const name of sources.manualReceiptLedgerNames ?? []) add(name);
  for (const head of STANDARD_REVENUE_HEADS) {
    add(head, STANDARD_REVENUE_HEAD_LABELS[head]);
  }
  for (const head of sources.extraHeads ?? []) add(head);

  options.sort((a, b) => a.label.localeCompare(b.label));
  return options;
}
