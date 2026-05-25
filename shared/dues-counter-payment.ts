/** Counter payment modes stored on `ioms_receipts.payment_mode`. */
export type CounterDuesPaymentMode = "Cash" | "Cheque" | "DD" | "Online";

export type DuesPaymentTypeUi = "Cash" | "Cheque" | "NeftRtgs";

export function duesPaymentTypeToMode(ui: DuesPaymentTypeUi): CounterDuesPaymentMode {
  if (ui === "NeftRtgs") return "Online";
  return ui;
}

export function formatBankWithBranch(bankName: string, branchName?: string): string {
  const bank = String(bankName ?? "").trim();
  const branch = String(branchName ?? "").trim();
  if (!bank) return "";
  if (!branch) return bank;
  return `${bank} — ${branch}`;
}

export const COMMON_INDIAN_BANKS = [
  "State Bank of India",
  "Bank of Baroda",
  "Canara Bank",
  "Punjab National Bank",
  "Bank of India",
  "Union Bank of India",
  "Indian Bank",
  "Central Bank of India",
  "Indian Overseas Bank",
  "UCO Bank",
  "Bank of Maharashtra",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "IDBI Bank",
  "Yes Bank",
  "Federal Bank",
  "IDFC First Bank",
  "Other",
] as const;
