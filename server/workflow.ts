/**
 * DO/DV/DA workflow helpers for IOMS.
 * DO = Data Originator (create, edit draft)
 * DV = Data Verifier (Draft → Verified)
 * DA = Data Approver (Verified → Approved)
 * ADMIN = can do any transition
 */
import type { AuthUser } from "./auth";

const ADMIN = "ADMIN";
const DO = "DO";
const DV = "DV";
const DA = "DA";

export function hasRole(user: AuthUser | undefined, tier: string): boolean {
  return Boolean(user?.roles?.some((r) => r.tier === tier));
}

export function hasAnyRole(user: AuthUser | undefined, tiers: string[]): boolean {
  return Boolean(user?.roles?.some((r) => tiers.includes(r.tier)));
}

/** BR-WF-01: same user must not act as DV on own DO work, nor DA on own DO/DV work (ADMIN exempt). */
export function assertSegregationDoDvDa(
  user: AuthUser | undefined,
  record: { doUser?: string | null; dvUser?: string | null; daUser?: string | null },
  flags: { setDvUser?: boolean; setDaUser?: boolean }
): { ok: true } | { ok: false; error: string } {
  if (!user?.id) return { ok: false, error: "Not authenticated" };
  if (hasRole(user, ADMIN)) return { ok: true };
  const uid = user.id;
  if (flags.setDvUser && record.doUser === uid) {
    return { ok: false, error: "Same user cannot verify (DV) a record they originated (DO)." };
  }
  if (flags.setDaUser && (record.doUser === uid || record.dvUser === uid)) {
    return { ok: false, error: "Same user cannot approve (DA) a record they originated or verified." };
  }
  return { ok: true };
}

/**
 * BR-WF-01 (record shape): DO, DV, and DA user ids on the same record must be pairwise distinct when set.
 * Use on PUT where clients may set doUser/dvUser/daUser directly (ADMIN exempt).
 */
export function assertRecordDoDvDaSeparation(
  user: AuthUser | undefined,
  record: { doUser?: string | null; dvUser?: string | null; daUser?: string | null }
): { ok: true } | { ok: false; error: string } {
  if (hasRole(user, ADMIN)) return { ok: true };
  const d = record.doUser;
  const v = record.dvUser;
  const a = record.daUser;
  if (d && v && d === v) return { ok: false, error: "DO and DV cannot be the same user on one record." };
  if (d && a && d === a) return { ok: false, error: "DO and DA cannot be the same user on one record." };
  if (v && a && v === a) return { ok: false, error: "DV and DA cannot be the same user on one record." };
  return { ok: true };
}

/** Rent invoice status flow: Draft → Verified → Approved (then Paid/Cancelled/Overdue) */
const RENT_INVOICE_FLOW = {
  Draft: ["Verified"], // DV can verify
  Verified: ["Approved", "Draft"], // DA can approve; DV can send back to Draft
  Approved: ["Paid", "Cancelled", "Overdue"], // DA can settle; Overdue also set by arrears cron
  Overdue: ["Paid", "Cancelled"], // DA settles overdue invoices
  Paid: [],
  Cancelled: [],
} as const;

export type RentInvoiceStatus = keyof typeof RENT_INVOICE_FLOW;

export function canTransitionRentInvoice(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDoUser?: boolean; setDvUser?: boolean; setDaUser?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDoUser: newStatus === "Draft" && !currentStatus,
      setDvUser: newStatus === "Verified",
      setDaUser:
        newStatus === "Approved" ||
        newStatus === "Paid" ||
        newStatus === "Cancelled" ||
        newStatus === "Overdue",
    };
  }
  const allowed = RENT_INVOICE_FLOW[currentStatus as RentInvoiceStatus];
  if (!allowed || !allowed.includes(newStatus as never)) return { allowed: false };

  if (currentStatus === "Draft" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Approved") {
    return hasRole(user, DA) ? { allowed: true, setDaUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Draft") {
    return hasRole(user, DV) ? { allowed: true } : { allowed: false };
  }
  if (
    currentStatus === "Approved" &&
    (newStatus === "Paid" || newStatus === "Cancelled" || newStatus === "Overdue")
  ) {
    return hasRole(user, DA)
      ? { allowed: true, setDaUser: newStatus === "Paid" || newStatus === "Cancelled" || newStatus === "Overdue" }
      : { allowed: false };
  }
  if (currentStatus === "Overdue" && (newStatus === "Paid" || newStatus === "Cancelled")) {
    return hasRole(user, DA) ? { allowed: true, setDaUser: true } : { allowed: false };
  }
  return { allowed: false };
}

/** Who can create a rent invoice (must be DO or ADMIN). */
export function canCreateRentInvoice(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

/** Who can edit a draft rent invoice (DO or ADMIN). */
export function canEditDraftRentInvoice(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

/** Rent revision override status flow (M-03 Sr.17): Draft → Verified → Approved */
const RENT_REVISION_FLOW = {
  Draft: ["Verified"],
  Verified: ["Approved", "Draft"],
  Approved: [],
} as const;

export type RentRevisionStatus = keyof typeof RENT_REVISION_FLOW;

export function canCreateRentRevision(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

export function canEditDraftRentRevision(user: AuthUser | undefined, record: { status: string; doUser?: string | null }): boolean {
  if (!user) return false;
  if (hasRole(user, ADMIN)) return true;
  if (record.status !== "Draft") return false;
  if (!hasAnyRole(user, [DO])) return false;
  return record.doUser === user.id;
}

export function canTransitionRentRevision(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDvUser?: boolean; setDaUser?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setDaUser: newStatus === "Approved",
    };
  }
  const allowed = RENT_REVISION_FLOW[currentStatus as RentRevisionStatus];
  if (!allowed || !allowed.includes(newStatus as never)) return { allowed: false };

  if (currentStatus === "Draft" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Approved") {
    return hasRole(user, DA) ? { allowed: true, setDaUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Draft") {
    return hasRole(user, DV) ? { allowed: true } : { allowed: false };
  }
  return { allowed: false };
}

/** Payment voucher status flow: Draft/Submitted → Verified → Approved → Paid | Rejected */
const VOUCHER_FLOW: Record<string, string[]> = {
  Draft: ["Submitted", "Verified"],
  Submitted: ["Draft", "Verified"],
  Verified: ["Approved", "Rejected"],
  Approved: ["Paid"],
  Paid: [],
  Rejected: [],
};

export function canTransitionVoucher(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDvUser?: boolean; setDaUser?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setDaUser: ["Approved", "Paid", "Rejected"].includes(newStatus),
    };
  }
  const allowed = VOUCHER_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if ((currentStatus === "Draft" || currentStatus === "Submitted") && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && (newStatus === "Approved" || newStatus === "Rejected")) {
    return hasRole(user, DA) ? { allowed: true, setDaUser: true } : { allowed: false };
  }
  if (currentStatus === "Approved" && newStatus === "Paid") {
    return hasRole(user, DA) ? { allowed: true } : { allowed: false };
  }
  if ((currentStatus === "Draft" || currentStatus === "Submitted") && (newStatus === "Draft" || newStatus === "Submitted")) {
    return hasAnyRole(user, [DO, ADMIN]) ? { allowed: true } : { allowed: false };
  }
  return { allowed: false };
}

export function canCreateVoucher(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

export function canEditDraftVoucher(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

/**
 * True if this voucher is waiting for a workflow step the user may perform (DV verify, DA approve/pay).
 * ADMIN: all non-terminal queue states in list scope. Respects BR-WF-01 for DV/DA (not own DO/DV record).
 */
export function voucherAwaitingMyAction(
  user: AuthUser | undefined,
  row: { status: string; doUser?: string | null; dvUser?: string | null },
): boolean {
  if (!user?.id) return false;
  const uid = user.id;
  const st = row.status;
  if (hasRole(user, ADMIN)) {
    return st === "Draft" || st === "Submitted" || st === "Verified" || st === "Approved";
  }
  let hit = false;
  if (hasRole(user, DV) && (st === "Draft" || st === "Submitted")) {
    if (!(row.doUser && row.doUser === uid)) hit = true;
  }
  if (hasRole(user, DA) && (st === "Verified" || st === "Approved")) {
    if (!(row.doUser && row.doUser === uid) && !(row.dvUser && row.dvUser === uid)) hit = true;
  }
  return hit;
}

// ----- M-01: Service book entries (Pending → Verified → Approved | Rejected; DV may return Verified → Pending) -----
const SERVICE_BOOK_FLOW: Record<string, string[]> = {
  Pending: ["Verified"],
  Verified: ["Approved", "Rejected", "Pending"],
  Approved: [],
  Rejected: [],
};

export function canTransitionServiceBookEntry(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string,
): { allowed: boolean; setDvUser?: boolean; setApprovedBy?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setApprovedBy: newStatus === "Approved" || newStatus === "Rejected",
    };
  }
  const allowed = SERVICE_BOOK_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if (currentStatus === "Pending" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && (newStatus === "Approved" || newStatus === "Rejected")) {
    return hasRole(user, DA) ? { allowed: true, setApprovedBy: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Pending") {
    return hasRole(user, DV) ? { allowed: true } : { allowed: false };
  }
  return { allowed: false };
}

export function canCreateServiceBookEntry(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

export function serviceBookEntryAwaitingMyAction(
  user: AuthUser | undefined,
  row: { status: string; doUser?: string | null; dvUser?: string | null },
): boolean {
  if (!user?.id) return false;
  const uid = user.id;
  const st = row.status;
  if (hasRole(user, ADMIN)) return st === "Pending" || st === "Verified";
  if (hasRole(user, DV) && st === "Pending") return !(row.doUser && row.doUser === uid);
  if (hasRole(user, DA) && st === "Verified") return !(row.doUser && row.doUser === uid) && !(row.dvUser && row.dvUser === uid);
  return false;
}

// ----- M-01: Leave requests (Pending → Verified → Approved | Rejected; DV may return Verified → Pending; DO/Admin may cancel Pending) -----
const LEAVE_REQUEST_FLOW: Record<string, string[]> = {
  Pending: ["Verified", "Cancelled"],
  Verified: ["Approved", "Rejected", "Pending"],
  Approved: [],
  Rejected: [],
  Cancelled: [],
};

export function canTransitionLeaveRequest(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDvUser?: boolean; setApprovedBy?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setApprovedBy: newStatus === "Approved" || newStatus === "Rejected",
    };
  }
  const allowed = LEAVE_REQUEST_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if (currentStatus === "Pending" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Pending" && newStatus === "Cancelled") {
    return hasRole(user, DO) ? { allowed: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && (newStatus === "Approved" || newStatus === "Rejected")) {
    return hasRole(user, DA) ? { allowed: true, setApprovedBy: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Pending") {
    return hasRole(user, DV) ? { allowed: true } : { allowed: false };
  }
  return { allowed: false };
}

/** DV queue: Pending; DA queue: Verified (approve/reject). ADMIN sees both. BR-WF-01: not own DO/DV row. */
export function leaveRequestAwaitingMyAction(
  user: AuthUser | undefined,
  row: { status: string; doUser?: string | null; dvUser?: string | null },
): boolean {
  if (!user?.id) return false;
  const uid = user.id;
  const st = row.status;
  if (hasRole(user, ADMIN)) {
    return st === "Pending" || st === "Verified";
  }
  if (hasRole(user, DV) && st === "Pending") {
    if (row.doUser && row.doUser === uid) return false;
    return true;
  }
  if (hasRole(user, DA) && st === "Verified") {
    if (row.doUser && row.doUser === uid) return false;
    if (row.dvUser && row.dvUser === uid) return false;
    return true;
  }
  return false;
}

export function canCreateLeaveRequest(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

export function canEditLeaveRequest(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

// ----- M-01: TA/DA claims (Pending → Verified → Approved | Rejected; DV may return Verified → Pending) -----
const TA_DA_CLAIM_FLOW: Record<string, string[]> = {
  Pending: ["Verified"],
  Verified: ["Approved", "Rejected", "Pending"],
  Approved: [],
  Rejected: [],
};

export function canTransitionTaDaClaim(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDvUser?: boolean; setApprovedBy?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setApprovedBy: newStatus === "Approved" || newStatus === "Rejected",
    };
  }
  const allowed = TA_DA_CLAIM_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if (currentStatus === "Pending" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && (newStatus === "Approved" || newStatus === "Rejected")) {
    return hasRole(user, DA) ? { allowed: true, setApprovedBy: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Pending") {
    return hasRole(user, DV) ? { allowed: true } : { allowed: false };
  }
  return { allowed: false };
}

/** DV queue: Pending; DA queue: Verified. Same segregation rules as leave. */
export function taDaClaimAwaitingMyAction(
  user: AuthUser | undefined,
  row: { status: string; doUser?: string | null; dvUser?: string | null },
): boolean {
  if (!user?.id) return false;
  const uid = user.id;
  const st = row.status;
  if (hasRole(user, ADMIN)) {
    return st === "Pending" || st === "Verified";
  }
  if (hasRole(user, DV) && st === "Pending") {
    if (row.doUser && row.doUser === uid) return false;
    return true;
  }
  if (hasRole(user, DA) && st === "Verified") {
    if (row.doUser && row.doUser === uid) return false;
    if (row.dvUser && row.dvUser === uid) return false;
    return true;
  }
  return false;
}

export function canCreateTaDaClaim(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

// ----- M-01: Tour programmes (Pending → Verified → Approved | Rejected; DV may return Verified → Pending) -----
const TOUR_PROGRAMME_FLOW: Record<string, string[]> = {
  Pending: ["Verified"],
  Verified: ["Approved", "Rejected", "Pending"],
  Approved: [],
  Rejected: [],
};

export function canTransitionTourProgramme(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDvUser?: boolean; setApprovedBy?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setApprovedBy: newStatus === "Approved" || newStatus === "Rejected",
    };
  }
  const allowed = TOUR_PROGRAMME_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if (currentStatus === "Pending" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && (newStatus === "Approved" || newStatus === "Rejected")) {
    return hasRole(user, DA) ? { allowed: true, setApprovedBy: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Pending") {
    return hasRole(user, DV) ? { allowed: true } : { allowed: false };
  }
  return { allowed: false };
}

export function tourProgrammeAwaitingMyAction(
  user: AuthUser | undefined,
  row: { status: string; doUser?: string | null; dvUser?: string | null },
): boolean {
  if (!user?.id) return false;
  const uid = user.id;
  const st = row.status;
  if (hasRole(user, ADMIN)) return st === "Pending" || st === "Verified";
  if (hasRole(user, DV) && st === "Pending") {
    if (row.doUser && row.doUser === uid) return false;
    return true;
  }
  if (hasRole(user, DA) && st === "Verified") {
    if (row.doUser && row.doUser === uid) return false;
    if (row.dvUser && row.dvUser === uid) return false;
    return true;
  }
  return false;
}

export function canCreateTourProgramme(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

// ----- M-01: LTC claims (Pending → Verified → Approved | Rejected; DV may return Verified → Pending) -----
const LTC_CLAIM_FLOW: Record<string, string[]> = {
  Pending: ["Verified"],
  Verified: ["Approved", "Rejected", "Pending"],
  Approved: ["Settled"],
  Rejected: [],
  Settled: [],
};

export function canTransitionLtcClaim(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDvUser?: boolean; setApprovedBy?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setApprovedBy: newStatus === "Approved" || newStatus === "Rejected",
    };
  }
  const allowed = LTC_CLAIM_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if (currentStatus === "Pending" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && (newStatus === "Approved" || newStatus === "Rejected")) {
    return hasRole(user, DA) ? { allowed: true, setApprovedBy: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && newStatus === "Pending") {
    return hasRole(user, DV) ? { allowed: true } : { allowed: false };
  }
  if (currentStatus === "Approved" && newStatus === "Settled") {
    return hasRole(user, DA) ? { allowed: true, setApprovedBy: true } : { allowed: false };
  }
  return { allowed: false };
}

export function ltcClaimAwaitingMyAction(
  user: AuthUser | undefined,
  row: { status: string; doUser?: string | null; dvUser?: string | null },
): boolean {
  if (!user?.id) return false;
  const uid = user.id;
  const st = row.status;
  if (hasRole(user, ADMIN)) {
    return st === "Pending" || st === "Verified";
  }
  if (hasRole(user, DV) && st === "Pending") {
    if (row.doUser && row.doUser === uid) return false;
    return true;
  }
  if (hasRole(user, DA) && st === "Verified") {
    if (row.doUser && row.doUser === uid) return false;
    if (row.dvUser && row.dvUser === uid) return false;
    return true;
  }
  return false;
}

export function canCreateLtcClaim(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

// ----- M-04: Purchase transactions (Draft → Verified → Approved; do/dv/da) -----
const PURCHASE_TX_FLOW: Record<string, string[]> = {
  Draft: ["Verified"],
  Verified: ["Approved", "Draft"],
  Approved: [],
};

export function canTransitionPurchaseTransaction(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setDvUser?: boolean; setDaUser?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setDvUser: newStatus === "Verified",
      setDaUser: newStatus === "Approved",
    };
  }
  const allowed = PURCHASE_TX_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if (currentStatus === "Draft" && newStatus === "Verified") {
    return hasRole(user, DV) ? { allowed: true, setDvUser: true } : { allowed: false };
  }
  if (currentStatus === "Verified" && (newStatus === "Approved" || newStatus === "Draft")) {
    return hasRole(user, DA) && newStatus === "Approved"
      ? { allowed: true, setDaUser: true }
      : hasRole(user, DV) && newStatus === "Draft"
        ? { allowed: true }
        : { allowed: false };
  }
  return { allowed: false };
}

export function canCreatePurchaseTransaction(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

export function canEditDraftPurchaseTransaction(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

// ----- M-04: Check post inward (Draft → Verified only; no do/dv/da columns) -----
export function canVerifyCheckPostInward(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DV, ADMIN]);
}
