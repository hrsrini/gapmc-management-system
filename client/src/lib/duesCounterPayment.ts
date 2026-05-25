import { parseDisplayDateToYmd, formatDisplayDate } from "@/lib/dateFormat";
import {
  duesPaymentTypeToMode,
  formatBankWithBranch,
  type DuesPaymentTypeUi,
} from "@shared/dues-counter-payment";

export type { DuesPaymentTypeUi };

export interface PaymentPreferenceValue {
  paymentType: DuesPaymentTypeUi;
  paidAmount: string;
  paymentDate: string;
  chequeNo: string;
  chequeDate: string;
  bankName: string;
  branchName: string;
  utr: string;
  transactionDate: string;
  remarks: string;
}

export function defaultPaymentPreferenceValue(amount?: number): PaymentPreferenceValue {
  const today = formatDisplayDate(new Date());
  const amt = amount != null && Number.isFinite(amount) ? String(Math.round(amount * 100) / 100) : "";
  return {
    paymentType: "Cash",
    paidAmount: amt,
    paymentDate: today,
    chequeNo: "",
    chequeDate: today,
    bankName: "",
    branchName: "",
    utr: "",
    transactionDate: today,
    remarks: "",
  };
}

export function validatePaymentPreference(value: PaymentPreferenceValue): string | null {
  const amt = Number(value.paidAmount);
  if (!Number.isFinite(amt) || amt <= 0) return "Enter a valid paid amount.";

  if (value.paymentType === "Cash") {
    if (!parseDisplayDateToYmd(value.paymentDate)) return "Enter a valid payment date (DD-MM-YYYY).";
    return null;
  }

  if (value.paymentType === "Cheque") {
    if (!value.chequeNo.trim()) return "Cheque number is required.";
    if (!parseDisplayDateToYmd(value.chequeDate)) return "Enter a valid cheque date (DD-MM-YYYY).";
    if (!value.bankName.trim()) return "Bank name is required.";
    if (!value.branchName.trim()) return "Branch name is required.";
    return null;
  }

  if (!value.utr.trim()) return "UTR / transaction reference is required.";
  if (!parseDisplayDateToYmd(value.transactionDate)) return "Enter a valid transaction date (DD-MM-YYYY).";
  if (!value.bankName.trim()) return "Bank name is required.";
  return null;
}

export function buildCounterDuesPaymentApiBody(
  value: PaymentPreferenceValue,
  amount: number,
): Record<string, unknown> {
  const mode = duesPaymentTypeToMode(value.paymentType);
  const remarks = value.remarks.trim() || undefined;

  if (value.paymentType === "Cash") {
    return {
      amount,
      paymentMode: mode,
      paymentDate: parseDisplayDateToYmd(value.paymentDate),
      remarks,
    };
  }

  if (value.paymentType === "Cheque") {
    const bankName = formatBankWithBranch(value.bankName, value.branchName);
    return {
      amount,
      paymentMode: mode,
      chequeNo: value.chequeNo.trim(),
      chequeDate: parseDisplayDateToYmd(value.chequeDate),
      bankName,
      paymentDate: parseDisplayDateToYmd(value.chequeDate),
      remarks,
    };
  }

  return {
    amount,
    paymentMode: mode,
    gatewayRef: value.utr.trim(),
    bankName: formatBankWithBranch(value.bankName, value.branchName),
    paymentDate: parseDisplayDateToYmd(value.transactionDate),
    remarks,
  };
}
