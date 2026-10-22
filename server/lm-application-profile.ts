/**
 * License Manager (public.applications) display overlay for trader licence detail.
 * App 2 does not write LM; this is read-only enrichment for accurate labels/values.
 */
import { pool } from "./db";

export type LmPreviousTraderLicenceDetails = {
  licenceNo: string | null;
  classOfLicense: string | null;
  receiptNo: string | null;
  dated: string | null;
  securityDeposit: number | null;
};

export type LmApplicationProfile = {
  traderName: string | null;
  typeOfFirm: string | null;
  businessAddress: string | null;
  licenseFee: number | null;
  receiptNo: string | null;
  securityDeposit: number | null;
  bankName: string | null;
  ifscCode: string | null;
  accountNo: string | null;
  aadhaarMasked: string | null;
  /** Present only when LM application recorded a previous-licence linkage. */
  previousTraderLicence: LmPreviousTraderLicenceDetails | null;
};

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

/** YYYY-MM-DD from a Date / ISO string (IST calendar day when timestamptz). */
function ymdFromLmDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Mask Aadhaar for display: XXXXXX1234 style (last 4 visible). */
export function maskAadhaarForDisplay(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 4) return strOrNull(raw);
  if (digits.length === 12) return `${"X".repeat(8)}${digits.slice(-4)}`;
  return `${"X".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/**
 * Parse LM free-text like "MAA/24-25/00098 dated 16/11/2024" into receipt + dated (YYYY-MM-DD when possible).
 */
export function parsePreviousDepositReceiptText(raw: string | null | undefined): {
  receiptNo: string | null;
  dated: string | null;
} {
  const t = String(raw ?? "").trim();
  if (!t) return { receiptNo: null, dated: null };
  const m = /^(.*?)\s+(?:dated|date)\s*[:=]?\s*(.+)$/i.exec(t);
  if (!m) return { receiptNo: t, dated: null };
  const receiptNo = m[1].trim() || null;
  const datedRaw = m[2].trim();
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(datedRaw);
  if (dmy) {
    return {
      receiptNo,
      dated: `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`,
    };
  }
  return { receiptNo, dated: datedRaw || null };
}

type LmAppRow = {
  trader_name: string | null;
  type_of_firm: string | null;
  business_address: string | null;
  license_fee: unknown;
  security_deposit: unknown;
  deposit_amount: unknown;
  bank_name: string | null;
  ifsc_code: string | null;
  bank_account_number: string | null;
  aadhar_card_number: string | null;
  cash_payment_receipt_number: string | null;
  online_payment_receipt_number: string | null;
  original_license_number: string | null;
  previous_deposit_receipt_number: string | null;
  license_class: string | null;
  cash_payment_date: unknown;
};

type LmPrevRow = {
  license_number: string | null;
  license_class: string | null;
  security_deposit: unknown;
  deposit_amount: unknown;
  cash_payment_receipt_number: string | null;
  cash_payment_date: unknown;
  issue_date: unknown;
};

async function applicationsTableExists(): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.applications') IS NOT NULL AS exists`,
  );
  return Boolean(r.rows[0]?.exists);
}

export async function fetchLmApplicationProfile(
  licenceNo: string | null | undefined,
): Promise<LmApplicationProfile | null> {
  const no = String(licenceNo ?? "").trim();
  if (!no) return null;
  if (!(await applicationsTableExists())) return null;

  const cur = await pool.query<LmAppRow>(
    `
    SELECT
      trader_name,
      type_of_firm,
      business_address,
      license_fee,
      security_deposit,
      deposit_amount,
      bank_name,
      ifsc_code,
      bank_account_number,
      aadhar_card_number,
      cash_payment_receipt_number,
      online_payment_receipt_number,
      original_license_number,
      previous_deposit_receipt_number,
      license_class,
      cash_payment_date
    FROM public.applications
    WHERE license_number = $1
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [no],
  );
  const a = cur.rows[0];
  if (!a) return null;

  const receiptNo =
    strOrNull(a.cash_payment_receipt_number) ?? strOrNull(a.online_payment_receipt_number);

  const sd = numOrNull(a.security_deposit) ?? numOrNull(a.deposit_amount);

  let previousTraderLicence: LmPreviousTraderLicenceDetails | null = null;
  const originalNo = strOrNull(a.original_license_number);
  const prevReceiptText = strOrNull(a.previous_deposit_receipt_number);
  if (originalNo || prevReceiptText) {
    let prev: LmPrevRow | null = null;
    if (originalNo) {
      const pr = await pool.query<LmPrevRow>(
        `
        SELECT
          license_number,
          license_class,
          security_deposit,
          deposit_amount,
          cash_payment_receipt_number,
          cash_payment_date,
          issue_date
        FROM public.applications
        WHERE license_number = $1
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
        `,
        [originalNo],
      );
      prev = pr.rows[0] ?? null;
    }
    const parsed = parsePreviousDepositReceiptText(prevReceiptText);
    previousTraderLicence = {
      licenceNo: originalNo ?? strOrNull(prev?.license_number),
      classOfLicense: strOrNull(prev?.license_class),
      receiptNo: parsed.receiptNo ?? strOrNull(prev?.cash_payment_receipt_number),
      dated:
        parsed.dated ??
        ymdFromLmDate(prev?.cash_payment_date) ??
        ymdFromLmDate(prev?.issue_date),
      securityDeposit: numOrNull(prev?.security_deposit) ?? numOrNull(prev?.deposit_amount),
    };
  }

  return {
    traderName: strOrNull(a.trader_name),
    typeOfFirm: strOrNull(a.type_of_firm),
    businessAddress: strOrNull(a.business_address),
    licenseFee: numOrNull(a.license_fee),
    receiptNo,
    securityDeposit: sd,
    bankName: strOrNull(a.bank_name),
    ifscCode: strOrNull(a.ifsc_code),
    accountNo: strOrNull(a.bank_account_number),
    aadhaarMasked: maskAadhaarForDisplay(a.aadhar_card_number),
    previousTraderLicence,
  };
}
