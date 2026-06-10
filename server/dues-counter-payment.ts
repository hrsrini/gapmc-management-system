import {
  type CounterDuesPaymentMode,
  duesPaymentTypeToMode,
  formatBankWithBranch,
  type DuesPaymentTypeUi,
} from "@shared/dues-counter-payment";
import { initialDepositStatusForPaymentMode } from "@shared/receipt-deposit";

export class DuesCounterPaymentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DuesCounterPaymentError";
  }
}

const COUNTER_MODES = new Set<CounterDuesPaymentMode>(["Cash", "Cheque", "DD", "Online"]);

export interface ParsedCounterDuesPayment {
  paymentMode: CounterDuesPaymentMode;
  paymentDateYmd: string | null;
  chequeNo: string | null;
  chequeDateYmd: string | null;
  bankName: string | null;
  gatewayRef: string | null;
}

function parseYmdFromBody(body: Record<string, unknown>, key: string): string | null {
  const raw = body[key];
  if (raw == null || String(raw).trim() === "") return null;
  const t = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new DuesCounterPaymentError("DUES_PAY_DATE_INVALID", `${key} must be YYYY-MM-DD`);
  }
  return t;
}

function normalizeMode(body: Record<string, unknown>): CounterDuesPaymentMode {
  const raw = String(body.paymentMode ?? body.paymentType ?? "Cash").trim();
  if (raw === "NeftRtgs" || raw === "NEFT" || raw === "NEFT/RTGS") return "Online";
  const ui = raw as DuesPaymentTypeUi | CounterDuesPaymentMode;
  if (ui === "Cash" || ui === "Cheque" || ui === "DD" || ui === "Online") {
    if (COUNTER_MODES.has(ui)) return ui;
  }
  if (ui === "NeftRtgs") return duesPaymentTypeToMode(ui);
  throw new DuesCounterPaymentError(
    "DUES_PAY_MODE_INVALID",
    "paymentMode must be Cash, Cheque, DD, or Online (NEFT/RTGS)",
  );
}

/** Parse and validate counter-payment fields on dues pay endpoints. */
export function parseCounterDuesPaymentBody(body: Record<string, unknown>): ParsedCounterDuesPayment {
  const paymentMode = normalizeMode(body);
  const paymentDateYmd = parseYmdFromBody(body, "paymentDate");
  const chequeDateYmd = parseYmdFromBody(body, "chequeDate");
  const chequeNo = body.chequeNo != null ? String(body.chequeNo).trim() : "";
  const bankRaw = body.bankName != null ? String(body.bankName).trim() : "";
  const branchRaw = body.branchName != null ? String(body.branchName).trim() : "";
  const bankName = bankRaw ? formatBankWithBranch(bankRaw, branchRaw) : "";
  const gatewayRef = body.gatewayRef != null ? String(body.gatewayRef).trim() : "";

  if (paymentMode === "Cash") {
    if (!paymentDateYmd) {
      throw new DuesCounterPaymentError("DUES_PAY_CASH_DATE", "paymentDate is required for cash payments");
    }
    return {
      paymentMode: "Cash",
      paymentDateYmd,
      chequeNo: null,
      chequeDateYmd: null,
      bankName: null,
      gatewayRef: "Manual",
    };
  }

  if (paymentMode === "Cheque") {
    if (!chequeNo) throw new DuesCounterPaymentError("DUES_PAY_CHEQUE_NO", "chequeNo is required");
    if (!chequeDateYmd) throw new DuesCounterPaymentError("DUES_PAY_CHEQUE_DATE", "chequeDate is required");
    if (!bankName) throw new DuesCounterPaymentError("DUES_PAY_BANK", "bankName is required");
    return {
      paymentMode: "Cheque",
      paymentDateYmd: paymentDateYmd ?? chequeDateYmd,
      chequeNo,
      chequeDateYmd,
      bankName,
      gatewayRef: null,
    };
  }

  if (paymentMode === "Online") {
    if (!gatewayRef) {
      throw new DuesCounterPaymentError("DUES_PAY_UTR", "gatewayRef (UTR) is required for NEFT/RTGS");
    }
    if (!paymentDateYmd) {
      throw new DuesCounterPaymentError("DUES_PAY_TXN_DATE", "paymentDate (transaction date) is required");
    }
    if (!bankName) throw new DuesCounterPaymentError("DUES_PAY_BANK", "bankName is required");
    return {
      paymentMode: "Online",
      paymentDateYmd,
      chequeNo: null,
      chequeDateYmd: null,
      bankName,
      gatewayRef,
    };
  }

  // DD (optional future UI)
  if (!chequeNo) throw new DuesCounterPaymentError("DUES_PAY_DD_NO", "Instrument number is required for DD");
  if (!chequeDateYmd) throw new DuesCounterPaymentError("DUES_PAY_DD_DATE", "chequeDate is required for DD");
  if (!bankName) throw new DuesCounterPaymentError("DUES_PAY_BANK", "bankName is required");
  return {
    paymentMode: "DD",
    paymentDateYmd: paymentDateYmd ?? chequeDateYmd,
    chequeNo,
    chequeDateYmd,
    bankName,
    gatewayRef: null,
  };
}

export function receiptCreatedAtFromPaymentDate(paymentDateYmd: string | null): string | undefined {
  if (!paymentDateYmd) return undefined;
  return `${paymentDateYmd}T12:00:00.000Z`;
}

/** Fields for `createIomsReceipt` on counter pay flows. */
export function counterPaymentCreateParams(parsed: ParsedCounterDuesPayment) {
  return {
    paymentMode: parsed.paymentMode,
    counterDuesPayment: true as const,
    chequeNo: parsed.chequeNo,
    bankName: parsed.bankName,
    chequeDate: parsed.chequeDateYmd,
    gatewayRef: parsed.gatewayRef,
    paymentDateYmd: parsed.paymentDateYmd,
  };
}

/** DB update when marking a counter receipt Paid (preserve UTR / avoid overwriting cheque). */
export function counterPaymentPaidUpdate(parsed: ParsedCounterDuesPayment): {
  status: "Paid";
  depositStatus: ReturnType<typeof initialDepositStatusForPaymentMode>;
  gatewayRef?: string;
} {
  return {
    status: "Paid",
    depositStatus: initialDepositStatusForPaymentMode(parsed.paymentMode),
    ...(parsed.gatewayRef != null ? { gatewayRef: parsed.gatewayRef } : {}),
  };
}

export function buildReceiptInstrumentUpdate(parsed: ParsedCounterDuesPayment): {
  gatewayRef: string | null;
  chequeNo: string | null;
  bankName: string | null;
  chequeDate: string | null;
  createdAt?: string;
} {
  const createdAt = receiptCreatedAtFromPaymentDate(parsed.paymentDateYmd);
  return {
    gatewayRef: parsed.gatewayRef,
    chequeNo: parsed.chequeNo,
    bankName: parsed.bankName,
    chequeDate: parsed.chequeDateYmd,
    ...(createdAt ? { createdAt } : {}),
  };
}
