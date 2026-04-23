/** GSTR-1 helper JSON (M-03) — validation only; GSTN filing shape is client/CA responsibility. */

const MONTH_YM = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidYearMonthYm(s: string): boolean {
  return MONTH_YM.test(String(s ?? "").trim());
}

/** India GSTIN 15-char pattern (basic structural check). */
export function isPlausibleGstin(s: string | null | undefined): boolean {
  if (s == null) return false;
  const t = String(s).trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(t);
}

export function validateGstr1MonthRange(fromMonth: string, toMonth: string): { ok: true } | { ok: false; error: string } {
  const f = String(fromMonth ?? "").trim();
  const t = String(toMonth ?? "").trim();
  if (!f || !t) return { ok: false, error: "fromMonth and toMonth are required (YYYY-MM)." };
  if (!isValidYearMonthYm(f)) return { ok: false, error: "fromMonth must be YYYY-MM." };
  if (!isValidYearMonthYm(t)) return { ok: false, error: "toMonth must be YYYY-MM." };
  if (f > t) return { ok: false, error: "fromMonth must be on or before toMonth." };
  return { ok: true };
}

export function gstr1ExportWarnings(gstinFromEnv: string | null): string[] {
  const w: string[] = [];
  if (!gstinFromEnv?.trim()) {
    w.push("GSTIN is not set (env GSTIN); add for consolidated filing metadata.");
  } else if (!isPlausibleGstin(gstinFromEnv)) {
    w.push("GSTIN env value does not match the usual 15-character structural pattern; verify before filing.");
  }
  w.push(
    "Response includes `supplies` (internal) plus `gstnDraftMapping` (GSTN-oriented draft — not filed JSON); verify POS and final field names in your filing tool.",
  );
  return w;
}

/** First day of `YYYY-MM` as DD-MM-YYYY (invoice date hint for rent period month). */
export function rentPeriodMonthToInvoiceDdMmYyyy(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim().slice(0, 7));
  if (!m) return String(ym ?? "").trim().slice(0, 10);
  return `01-${m[2]}-${m[1]}`;
}

export function normalizedCounterpartyGstin(g: string | null | undefined): string | null {
  const t = String(g ?? "").trim().toUpperCase();
  if (!t) return null;
  return isPlausibleGstin(t) ? t : null;
}

export function gstr1CounterpartyGstinIssues(
  lines: {
    invoiceNo: string;
    tenantLicenceId: string;
    counterpartyGstin: string | null;
    isNonGstEntity?: boolean | null;
  }[],
): string[] {
  const w: string[] = [];
  for (const l of lines) {
    if (l.isNonGstEntity) continue;
    const raw = (l.counterpartyGstin ?? "").trim();
    if (!raw) {
      w.push(
        `Invoice ${l.invoiceNo}: tenant licence ${l.tenantLicenceId} has no GSTIN; set trader_licences.gstin for B2B ctin.`,
      );
    } else if (!isPlausibleGstin(raw)) {
      w.push(`Invoice ${l.invoiceNo}: GSTIN "${raw}" failed basic structural validation.`);
    }
  }
  return w;
}

/** GSTN filing period token `MMYYYY` derived from API `YYYY-MM` (uses month + year of given period). */
export function filingPeriodMMYYYYFromYearMonth(ym: string): string {
  const t = String(ym ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (!m) return "";
  const y = m[1];
  const mm = m[2];
  return `${mm}${y}`;
}

export type RentGstr1SupplyForDraft = {
  invoiceNo: string;
  periodMonth: string;
  tenantLicenceId: string;
  /** Trader licence GSTIN when present (B2B counterparty). */
  counterpartyGstin: string | null;
  /** Declared unregistered / non-GST tenant — ctin omitted in draft mapping. */
  isNonGstEntity?: boolean | null;
  customerRef: string | null;
  assetId: string | null;
  yardId: string;
  taxableValue: number | null;
  cgst: number | null;
  sgst: number | null;
  totalAmount: number | null;
  tdsApplicable: boolean | null;
  tdsAmount: number | null;
};

/**
 * Draft outward-supply mapping hints (B2B-style line list). Not a GSTN filing payload — tool/version specific.
 */
export function buildRentGstr1DraftGstnMapping(params: {
  gstin: string | null;
  /** Typically `toMonth` from the export query (YYYY-MM). */
  filingPeriodMonth: string;
  supplies: RentGstr1SupplyForDraft[];
}): Record<string, unknown> {
  const fp = filingPeriodMMYYYYFromYearMonth(params.filingPeriodMonth);
  return {
    schemaNote:
      "Draft GSTR-1 alignment aid only — not GSTN JSON. `ctin` is set from tenant `trader_licences.gstin` when structurally valid (omitted for `isNonGstEntity`). Verify POS and your filing tool’s field names.",
    gstin: params.gstin,
    fp: fp || null,
    b2bPlaceholderInvoices: params.supplies.map((s) => {
      const ctin =
        s.isNonGstEntity ? null : normalizedCounterpartyGstin(s.counterpartyGstin ?? null);
      const idtDdMmYyyy = rentPeriodMonthToInvoiceDdMmYyyy(s.periodMonth);
      return {
        inum: s.invoiceNo,
        idtIso: `${s.periodMonth}-01`,
        idtDdMmYyyy,
        ctin,
        posSuggested: "37",
        txval: Number(s.taxableValue ?? 0),
        camt: Number(s.cgst ?? 0),
        samt: Number(s.sgst ?? 0),
        csamt: 0,
        tds194I: s.tdsApplicable
          ? { applicable: true, amt: Number(s.tdsAmount ?? 0) }
          : { applicable: false, amt: 0 },
      };
    }),
  };
}
