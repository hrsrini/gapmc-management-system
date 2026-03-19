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

/** Rent invoice status flow: Draft → Verified → Approved (then Paid/Cancelled) */
const RENT_INVOICE_FLOW = {
  Draft: ["Verified"], // DV can verify
  Verified: ["Approved", "Draft"], // DA can approve; DV can send back to Draft
  Approved: ["Paid", "Cancelled"], // DA can set Paid/Cancelled
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
      setDaUser: newStatus === "Approved" || newStatus === "Paid" || newStatus === "Cancelled",
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
  if (currentStatus === "Approved" && (newStatus === "Paid" || newStatus === "Cancelled")) {
    return hasRole(user, DA) ? { allowed: true } : { allowed: false };
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

// ----- M-01: Leave requests (Pending → Approved | Rejected; approvedBy set on approve/reject) -----
const LEAVE_REQUEST_FLOW: Record<string, string[]> = {
  Pending: ["Approved", "Rejected"],
  Approved: [],
  Rejected: [],
};

export function canTransitionLeaveRequest(
  user: AuthUser | undefined,
  currentStatus: string,
  newStatus: string
): { allowed: boolean; setApprovedBy?: boolean } {
  if (!user) return { allowed: false };
  if (hasRole(user, ADMIN)) {
    return {
      allowed: true,
      setApprovedBy: newStatus === "Approved" || newStatus === "Rejected",
    };
  }
  const allowed = LEAVE_REQUEST_FLOW[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) return { allowed: false };
  if ((currentStatus === "Pending") && (newStatus === "Approved" || newStatus === "Rejected")) {
    return hasRole(user, DA) ? { allowed: true, setApprovedBy: true } : { allowed: false };
  }
  return { allowed: false };
}

export function canCreateLeaveRequest(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [DO, ADMIN]);
}

export function canEditLeaveRequest(user: AuthUser | undefined): boolean {
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
