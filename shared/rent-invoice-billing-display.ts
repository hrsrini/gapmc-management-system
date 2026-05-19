import type { RentBillingConfigSnapshot, RentBillingType } from "./rent-invoice-billing";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatPeriodMonthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym).trim().slice(0, 7));
  if (!m) return ym;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${m[1]}` : ym;
}

/** Display label for billing type on UI/PDF. */
export function rentBillingTypeLabel(t: string | null | undefined): string {
  switch (String(t ?? "").trim()) {
    case "Prorated":
      return "Prorated / partial month";
    case "Overstay":
      return "Overstay / fine rent";
    default:
      return "Full month rent";
  }
}

export type RentInvoiceBillingBreakdown = {
  billingType: RentBillingType;
  billingTypeLabel: string;
  periodMonth: string;
  periodMonthLabel: string;
  occupancyFrom: string | null;
  occupancyTo: string | null;
  baseMonthlyRent: number | null;
  daysInMonth: number | null;
  billableDays: number | null;
  billingFactor: number | null;
  rentAmount: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
  configSnapshot: RentBillingConfigSnapshot | null;
  summaryLines: Array<{ label: string; value: string }>;
};

export function buildRentInvoiceBillingBreakdown(inv: {
  billingType?: string | null;
  periodMonth: string;
  occupancyFrom?: string | null;
  occupancyTo?: string | null;
  baseMonthlyRent?: number | null;
  daysInMonth?: number | null;
  billableDays?: number | null;
  billingFactor?: number | null;
  rentAmount: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
  billingConfigJson?: string | null;
}): RentInvoiceBillingBreakdown {
  const billingType = (String(inv.billingType ?? "FullMonth").trim() || "FullMonth") as RentBillingType;
  let configSnapshot: RentBillingConfigSnapshot | null = null;
  if (inv.billingConfigJson?.trim()) {
    try {
      configSnapshot = JSON.parse(inv.billingConfigJson) as RentBillingConfigSnapshot;
    } catch {
      configSnapshot = null;
    }
  }

  const baseMonthlyRent =
    inv.baseMonthlyRent != null && Number.isFinite(Number(inv.baseMonthlyRent))
      ? Number(inv.baseMonthlyRent)
      : null;
  const daysInMonth = inv.daysInMonth != null ? Number(inv.daysInMonth) : null;
  const billableDays = inv.billableDays != null ? Number(inv.billableDays) : null;
  const billingFactor = inv.billingFactor != null ? Number(inv.billingFactor) : null;

  const summaryLines: Array<{ label: string; value: string }> = [];
  if (baseMonthlyRent != null) summaryLines.push({ label: "Monthly rent", value: String(baseMonthlyRent) });
  if (daysInMonth != null) summaryLines.push({ label: "Days in month", value: String(daysInMonth) });

  if (billingType === "Prorated") {
    if (billableDays != null) summaryLines.push({ label: "Occupied days", value: String(billableDays) });
    if (billingFactor != null) summaryLines.push({ label: "Prorata factor", value: String(billingFactor) });
    summaryLines.push({ label: "Prorated rent", value: String(inv.rentAmount) });
  } else if (billingType === "Overstay") {
    if (billingFactor != null) summaryLines.push({ label: "Overstay factor", value: String(billingFactor) });
    if (billableDays != null) summaryLines.push({ label: "Overstay days", value: String(billableDays) });
    summaryLines.push({ label: "Fine rent", value: String(inv.rentAmount) });
  } else {
    summaryLines.push({ label: "Rent amount", value: String(inv.rentAmount) });
  }

  summaryLines.push(
    { label: "CGST", value: String(inv.cgst) },
    { label: "SGST", value: String(inv.sgst) },
    { label: "Total", value: String(inv.totalAmount) },
  );

  return {
    billingType,
    billingTypeLabel: rentBillingTypeLabel(billingType),
    periodMonth: inv.periodMonth,
    periodMonthLabel: formatPeriodMonthLabel(inv.periodMonth),
    occupancyFrom: inv.occupancyFrom?.trim() || null,
    occupancyTo: inv.occupancyTo?.trim() || null,
    baseMonthlyRent,
    daysInMonth,
    billableDays,
    billingFactor,
    rentAmount: inv.rentAmount,
    cgst: inv.cgst,
    sgst: inv.sgst,
    totalAmount: inv.totalAmount,
    configSnapshot,
    summaryLines,
  };
}
