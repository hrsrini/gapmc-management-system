/**
 * Leave and Licence Agreement Generator — shared calculations and types
 * (Developer Hand-off Nov 15, 2026).
 */

export const LEAVE_LICENCE_STATUSES = ["Draft", "Final", "Executed", "Cancelled"] as const;
export type LeaveLicenceStatus = (typeof LEAVE_LICENCE_STATUSES)[number];

export const LEAVE_LICENCE_VERSION_KINDS = ["Draft", "Final", "Voided", "Executed"] as const;
export type LeaveLicenceVersionKind = (typeof LEAVE_LICENCE_VERSION_KINDS)[number];

export const DEFAULT_PLACE_OF_EXECUTION = "Margao";
export const DEFAULT_TERMINATION_MONTHS = 3;
export const DEFAULT_NOTICE_DAYS = 10;
export const DEFAULT_RENT_DUE_DAY = 10;
export const DEFAULT_INTEREST_RATE_TEXT = "15% per annum compounded on monthly basis";
export const DEFAULT_DAMAGES_MULTIPLIER = 2;
export const DEFAULT_GST_NOTE_PCT = 18;

export type LeaveLicenceDepositReceipt = {
  kind: "Original" | "Differential" | "Other";
  receiptNo: string;
  receiptDate: string;
  amount: number;
  particulars: string;
};

export type LeaveLicencePremiseRow = {
  assetId: string;
  premisesId: string;
  assetType: string;
  location: string;
  areaSqm: number;
  monthlyRent: number;
  depositShare: number;
};

export type LeaveLicenceSnapshot = {
  basis: "New" | "Renewal";
  allotmentRef: string;
  licenceOrEntityNo: string;
  renewalNo: number;
  traderOrEntityName: string;
  yardName: string;
  yardId: string;
  premises: LeaveLicencePremiseRow[];
  totalAreaSqm: number;
  totalRent: number;
  previousAgreementDate: string | null;
  previousFromDate: string | null;
  previousToDate: string | null;
  previousMonthlyRent: number | null;
  agreementDate: string;
  placeOfExecution: string;
  startDate: string;
  termMonths: number;
  endDate: string;
  depositMonths: number;
  requiredDeposit: number;
  originalDepositHeld: number;
  differentialDeposit: number;
  totalDeposit: number;
  depositReceipts: LeaveLicenceDepositReceipt[];
  continuousMonthsForTermination: number;
  noticeDays: number;
  rentDueDay: number;
  interestRateText: string;
  damagesMultiplier: number;
  damagesPerDay: number;
  gstNotePct: number;
  purposeOfUse: string;
  licensorSigningOfficer: string;
  licensorMeetingNo: string;
  licensorMeetingDate: string;
  licensorResolutionNo: string;
  licensorOfficeAddress: string;
  licensorClause: string;
  licenseeSignsInPerson: boolean;
  representativeName: string;
  representativeParentage: string;
  representativeAge: string;
  representativeAddress: string;
  representativeAuthority: string;
  licenseeClause: string;
  stampSerialNo: string;
  stampValue: number | null;
  stampPurchaseDate: string;
  stampVendor: string;
  stampPlaceOfPurchase: string;
  stampPurchasedInNameOf: string;
  witness1Name: string;
  witness1Address: string;
  witness2Name: string;
  witness2Address: string;
  startDateOverrideReason: string;
};

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim().slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

export function addMonthsYmd(ymd: string, months: number): string | null {
  const a = parseYmd(ymd);
  if (!a || !Number.isFinite(months)) return null;
  const dt = new Date(Date.UTC(a.y, a.m - 1, a.d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const a = parseYmd(ymd);
  if (!a) return null;
  const dt = new Date(Date.UTC(a.y, a.m - 1, a.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** End date = start + term months − 1 day. */
export function calcAgreementEndDate(startYmd: string, termMonths: number): string | null {
  const after = addMonthsYmd(startYmd, termMonths);
  if (!after) return null;
  return addDaysYmd(after, -1);
}

export function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Damages per day = ceil(multiplier × totalRent ÷ 30). */
export function calcDamagesPerDay(totalRent: number, multiplier = DEFAULT_DAMAGES_MULTIPLIER): number {
  const raw = (multiplier * (Number(totalRent) || 0)) / 30;
  return Math.ceil(raw);
}

export function calcRequiredDeposit(totalRent: number, depositMonths: number): number {
  return roundMoney2((Number(totalRent) || 0) * (Number(depositMonths) || 0));
}

export function ymdToDmy(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s || "—";
}

const ORDINALS = [
  "zeroth",
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
  "11th",
  "12th",
  "13th",
  "14th",
  "15th",
  "16th",
  "17th",
  "18th",
  "19th",
  "20th",
  "21st",
  "22nd",
  "23rd",
  "24th",
  "25th",
  "26th",
  "27th",
  "28th",
  "29th",
  "30th",
  "31st",
];

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Long-form agreement date: "14th day of November 2026". */
export function ymdToLongForm(ymd: string | null | undefined): string {
  const a = parseYmd(String(ymd ?? ""));
  if (!a) return String(ymd ?? "—");
  const ord = ORDINALS[a.d] ?? `${a.d}th`;
  return `${ord} day of ${MONTHS_LONG[a.m - 1]} ${a.y}`;
}

/** Short long-form used mid-sentence: "8 December 2026". */
export function ymdToLongShort(ymd: string | null | undefined): string {
  const a = parseYmd(String(ymd ?? ""));
  if (!a) return String(ymd ?? "—");
  return `${a.d} ${MONTHS_LONG[a.m - 1]} ${a.y}`;
}

export function formatRsFigure(amount: number): string {
  const n = roundMoney2(amount);
  const hasPaise = Math.abs(n - Math.floor(n)) > 0.001;
  const digits = n.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `Rs.${digits}/-`;
}

export function defaultLicensorClause(args: {
  signingOfficer: string;
  meetingNo: string;
  meetingDate: string;
  resolutionNo: string;
  officeAddress: string;
}): string {
  const officer = args.signingOfficer.trim() || "SHRI SATYAVAN DESSAI";
  const meetingNo = args.meetingNo.trim() || "33/2021-22";
  const meetingDate = args.meetingDate.trim() || "26.10.2021";
  const resolutionNo = args.resolutionNo.trim() || "3";
  const office = args.officeAddress.trim() || "Margao Main-Yard, Arlem, Raia, Salcete-Goa";
  return (
    `The Goa Agricultural Produce & Livestock Marketing Board, a body corporate ` +
    `established under Section 10 of The Goa Agricultural Produce and Livestock ` +
    `Marketing (Promotion & Facilitation) Act, 2007 ("the said Act"), represented herein ` +
    `by its Secretary ${officer}, major in age, with office at ${office}, for self and also ` +
    `on behalf of Chairman of the Marketing Board as resolved in the Marketing Board ` +
    `meeting No. ${meetingNo} dated ${meetingDate} under Resolution No. ${resolutionNo}, ` +
    `hereinafter called "the Licensor" (which expression shall include its successors in ` +
    `interest/business and assigns), of the ONE PART.`
  );
}

export function defaultLicenseeClause(args: {
  name: string;
  parentage?: string;
  ageYears?: string | number | null;
  maritalStatus?: string;
  address?: string;
  representative?: {
    name: string;
    parentage?: string;
    ageYears?: string;
    address?: string;
    authority?: string;
  } | null;
}): string {
  const name = args.name.trim() || "[LICENSEE NAME]";
  const parentage = (args.parentage ?? "").trim();
  const age = args.ageYears != null && String(args.ageYears).trim() ? `${args.ageYears} years of age` : "major in age";
  const status = (args.maritalStatus ?? "").trim() || "resident";
  const address = (args.address ?? "").trim() || "[address]";
  const base =
    `${name}${parentage ? `, ${parentage}` : ""}, ${age}` +
    (status && status !== "resident" ? `, ${status}` : "") +
    `, resident of ${address}`;

  if (args.representative?.name?.trim()) {
    const r = args.representative;
    return (
      `${base}, represented by ${r.name.trim()}` +
      `${r.parentage ? `, ${r.parentage}` : ""}` +
      `${r.ageYears ? `, ${r.ageYears} years of age` : ""}` +
      `${r.address ? `, resident of ${r.address}` : ""}` +
      `${r.authority ? `, authorised under ${r.authority}` : ""}` +
      `, hereinafter called the "Licensee", OF THE OTHER PART.`
    );
  }
  return `${base}, hereinafter called the "Licensee", OF THE OTHER PART.`;
}

export type LeaveLicenceValidationIssue = {
  id: string;
  severity: "Block" | "Warn";
  message: string;
};

export function validateLeaveLicenceSnapshot(
  snap: LeaveLicenceSnapshot,
  opts?: { forFinal?: boolean },
): LeaveLicenceValidationIssue[] {
  const issues: LeaveLicenceValidationIssue[] = [];
  const forFinal = Boolean(opts?.forFinal);

  if (!snap.agreementDate || !parseYmd(snap.agreementDate)) {
    issues.push({ id: "V-01", severity: "Block", message: "Agreement (execution) date is required." });
  }
  if (!snap.startDate || !parseYmd(snap.startDate)) {
    issues.push({ id: "V-01", severity: "Block", message: "Start date is required." });
  }
  if (!snap.placeOfExecution?.trim()) {
    issues.push({ id: "V-01", severity: "Block", message: "Place of execution is required." });
  }
  const term = Number(snap.termMonths);
  if (!Number.isInteger(term) || term < 1 || term > 120) {
    issues.push({ id: "V-02", severity: "Block", message: "Term must be a whole number from 1 to 120 months." });
  }
  const depMonths = Number(snap.depositMonths);
  if (!Number.isInteger(depMonths) || depMonths < 1) {
    issues.push({ id: "V-01", severity: "Block", message: "Deposit months must be an integer ≥ 1." });
  }
  if (!snap.premises?.length) {
    issues.push({ id: "V-06", severity: "Block", message: "At least one premises is required." });
  }
  for (const p of snap.premises ?? []) {
    if (!(Number(p.monthlyRent) > 0)) {
      issues.push({
        id: "V-08",
        severity: "Block",
        message: `Rent for premises ${p.premisesId || p.assetId} must be greater than zero.`,
      });
    }
  }

  if (snap.basis === "Renewal" && snap.previousToDate) {
    const expected = addDaysYmd(snap.previousToDate, 1);
    if (expected && snap.startDate && snap.startDate !== expected && !snap.startDateOverrideReason?.trim()) {
      issues.push({
        id: "V-03",
        severity: "Warn",
        message: `Start date should be previous end + 1 day (${ymdToDmy(expected)}). Provide a reason to override.`,
      });
    }
  }

  if (snap.agreementDate && snap.startDate && snap.agreementDate > snap.startDate) {
    issues.push({
      id: "V-05",
      severity: "Warn",
      message: "Agreement date is later than the start date.",
    });
  }

  if (snap.renewalNo > 0 && snap.renewalNo % 4 === 0 && snap.previousMonthlyRent != null) {
    if (roundMoney2(snap.totalRent) === roundMoney2(snap.previousMonthlyRent)) {
      issues.push({
        id: "V-09",
        severity: "Block",
        message: "Renewal no. is a multiple of 4: rent revision is mandatory (rent must differ from previous).",
      });
    }
  }

  const required = calcRequiredDeposit(snap.totalRent, snap.depositMonths);
  const totalDep = roundMoney2(snap.originalDepositHeld + snap.differentialDeposit);
  if (Math.abs(totalDep - required) > 0.02 && totalDep > 0) {
    issues.push({
      id: "V-DEP",
      severity: "Warn",
      message: `Total deposit (${totalDep}) does not equal required deposit (${required}).`,
    });
  }

  if (forFinal) {
    if (!snap.stampSerialNo?.trim() || !snap.stampPurchaseDate?.trim() || !snap.stampVendor?.trim()) {
      issues.push({
        id: "V-STAMP",
        severity: "Block",
        message: "Stamp paper serial no., purchase date and vendor are required before Final PDF.",
      });
    }
    if (!snap.purposeOfUse?.trim()) {
      issues.push({ id: "V-01", severity: "Block", message: "Purpose of use is required." });
    }
    if (!snap.licensorClause?.trim() || !snap.licenseeClause?.trim()) {
      issues.push({ id: "V-01", severity: "Block", message: "Licensor and Licensee clauses are required." });
    }
  }

  return issues;
}

export function applyDerivedFields(snap: LeaveLicenceSnapshot): LeaveLicenceSnapshot {
  const totalRent = roundMoney2(
    snap.premises?.reduce((s, p) => s + (Number(p.monthlyRent) || 0), 0) ?? snap.totalRent,
  );
  const totalArea = roundMoney2(
    snap.premises?.reduce((s, p) => s + (Number(p.areaSqm) || 0), 0) ?? snap.totalAreaSqm,
  );
  const endDate = calcAgreementEndDate(snap.startDate, snap.termMonths) ?? snap.endDate;
  const requiredDeposit = calcRequiredDeposit(totalRent, snap.depositMonths);
  const damagesPerDay = calcDamagesPerDay(totalRent, snap.damagesMultiplier || DEFAULT_DAMAGES_MULTIPLIER);
  const original = roundMoney2(snap.originalDepositHeld);
  const differential = roundMoney2(snap.differentialDeposit);
  const premises = (snap.premises ?? []).map((p) => {
    const area = Number(p.areaSqm) || 0;
    const share =
      totalArea > 0 ? roundMoney2((area / totalArea) * requiredDeposit) : roundMoney2(requiredDeposit / Math.max(snap.premises.length, 1));
    return { ...p, depositShare: share };
  });
  return {
    ...snap,
    premises,
    totalRent,
    totalAreaSqm: totalArea,
    endDate,
    requiredDeposit,
    damagesPerDay,
    totalDeposit: roundMoney2(original + differential),
  };
}
