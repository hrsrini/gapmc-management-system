/** Shared constants & validation for M-01 Posting & Reporting Officer Update. */

export const POSTING_CHANGE_TYPES = [
  "Transfer",
  "AssignAdditionalCharge",
  "WithdrawAdditionalCharge",
  "ChangeReportingOfficer",
] as const;

export type PostingChangeType = (typeof POSTING_CHANGE_TYPES)[number];

export const POSTING_UPDATE_STATUSES = [
  "PendingVerification",
  "PendingApproval",
  "Approved",
  "ReturnedToDO",
  "Rejected",
] as const;

export type PostingUpdateStatus = (typeof POSTING_UPDATE_STATUSES)[number];

export const POSTING_OPEN_STATUSES: PostingUpdateStatus[] = [
  "PendingVerification",
  "PendingApproval",
  "ReturnedToDO",
];

export const HO_SECTION_OPTIONS = ["Accounts Section", "Admin Section", "Inspection Section"] as const;

export function isPostingChangeType(v: unknown): v is PostingChangeType {
  return typeof v === "string" && (POSTING_CHANGE_TYPES as readonly string[]).includes(v);
}

export function postingChangeTypeLabel(t: PostingChangeType): string {
  switch (t) {
    case "Transfer":
      return "Transfer / new posting";
    case "AssignAdditionalCharge":
      return "Assign additional charge";
    case "WithdrawAdditionalCharge":
      return "Withdraw additional charge";
    case "ChangeReportingOfficer":
      return "Change reporting officer";
    default:
      return t;
  }
}

export function postingServiceBookTypeLabel(t: PostingChangeType): string {
  switch (t) {
    case "Transfer":
      return "Transfer";
    case "AssignAdditionalCharge":
      return "Additional charge";
    case "WithdrawAdditionalCharge":
      return "Charge withdrawn";
    case "ChangeReportingOfficer":
      return "Reporting officer changed";
    default:
      return t;
  }
}

export function effectiveFromLabel(t: PostingChangeType): string {
  switch (t) {
    case "Transfer":
      return "Effective from (date of joining)";
    case "AssignAdditionalCharge":
      return "Charge effective from";
    case "WithdrawAdditionalCharge":
      return "Withdrawn with effect from";
    case "ChangeReportingOfficer":
      return "Effective from";
    default:
      return "Effective from";
  }
}

/** YYYY-MM-DD calendar compare; returns negative if a < b. */
export function compareIsoDate(a: string, b: string): number {
  return String(a).localeCompare(String(b));
}

export type PostingSubmitInput = {
  changeType: PostingChangeType;
  newYardId?: string | null;
  newSection?: string | null;
  newReportingOfficerEmployeeId?: string | null;
  additionalYardIds?: string[];
  hoSectionByYardId?: Record<string, string>;
  withdrawYardIds?: string[];
  effectiveFrom?: string | null;
  orderNo?: string | null;
  orderDate?: string | null;
  remarks?: string | null;
};

export type PostingFieldErrors = Record<string, string>;

/**
 * Client/server shared submit validation (spec §6).
 * `todayYmd` must be local calendar YYYY-MM-DD.
 * `isHeadOfficeYardId` decides when HO section is mandatory.
 */
export function validatePostingSubmit(
  input: PostingSubmitInput,
  opts: {
    todayYmd: string;
    isHeadOfficeYardId: (yardId: string) => boolean;
  },
): PostingFieldErrors {
  const errors: PostingFieldErrors = {};
  const t = input.changeType;
  const effectiveFrom = String(input.effectiveFrom ?? "").trim();
  const orderNo = String(input.orderNo ?? "").trim();
  const orderDate = String(input.orderDate ?? "").trim();
  const orderRequired = t !== "ChangeReportingOfficer";

  if (!effectiveFrom) {
    errors.effectiveFrom = "Enter the effective date.";
  } else if (compareIsoDate(effectiveFrom, opts.todayYmd) > 0) {
    errors.effectiveFrom = "Effective date cannot be a future date.";
  } else if (orderDate && compareIsoDate(effectiveFrom, orderDate) < 0) {
    errors.effectiveFrom = "Effective date cannot be earlier than the order date.";
  }

  if (orderRequired && !orderNo) errors.orderNo = "Enter the order number.";
  if (orderRequired && !orderDate) errors.orderDate = "Enter the order date.";
  if (orderDate && compareIsoDate(orderDate, opts.todayYmd) > 0) {
    errors.orderDate = "Order date cannot be a future date.";
  }

  if (t === "Transfer") {
    const yardId = String(input.newYardId ?? "").trim();
    if (!yardId) errors.newYardId = "Select a location.";
    else if (opts.isHeadOfficeYardId(yardId) && !String(input.newSection ?? "").trim()) {
      errors.newSection = "Select the section.";
    }
    if (!String(input.newReportingOfficerEmployeeId ?? "").trim()) {
      errors.newReportingOfficerEmployeeId = "Select the reporting officer.";
    }
  }

  if (t === "ChangeReportingOfficer") {
    if (!String(input.newReportingOfficerEmployeeId ?? "").trim()) {
      errors.newReportingOfficerEmployeeId = "Select the reporting officer.";
    }
  }

  if (t === "AssignAdditionalCharge") {
    const ids = (input.additionalYardIds ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (ids.length === 0) errors.additionalYardIds = "Select at least one location.";
    const hoMap = input.hoSectionByYardId ?? {};
    for (const id of ids) {
      if (opts.isHeadOfficeYardId(id) && !String(hoMap[id] ?? "").trim()) {
        errors[`hoSection_${id}`] = "Select the section.";
        if (!errors.hoSection) errors.hoSection = "Select the section.";
      }
    }
  }

  if (t === "WithdrawAdditionalCharge") {
    const ids = (input.withdrawYardIds ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (ids.length === 0) errors.withdrawYardIds = "Select at least one additional charge to withdraw.";
  }

  return errors;
}
