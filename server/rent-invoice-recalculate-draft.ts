/**
 * Recalculate billing fields on a Draft M-03 rent invoice (Full month / Prorated / Overstay).
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { rentInvoices } from "@shared/db-schema";
import {
  defaultOccupancyForBillingType,
  inferBillingTypeForMonth,
  type RentBillingType,
} from "@shared/rent-invoice-billing";
import { computeRentInvoiceGstInr, rentInvoiceTotalInr } from "@shared/rent-invoice-gst";
import { rentInvoiceValidationErrorMessage } from "@shared/rent-invoice-amount-validation";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { tenantLicenceIsGstExempt } from "./gst-exempt";
import { resolveRentInvoiceTdsFields } from "./rent-invoice-tds";
import {
  buildRentInvoiceBillingCalculation,
  fetchAllotmentAgreement,
} from "./rent-invoice-billing-service";

function parseNonGstSum(json: string | null | undefined): number {
  if (json == null || String(json).trim() === "") return 0;
  try {
    const arr = JSON.parse(String(json)) as unknown;
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((s, o) => {
      const amt = Number((o as { amount?: unknown }).amount);
      return s + (Number.isFinite(amt) && amt > 0 ? amt : 0);
    }, 0);
  } catch {
    return 0;
  }
}

export async function recalculateDraftRentInvoiceBilling(args: {
  invoiceId: string;
  billingType?: RentBillingType;
  occupancyFrom?: string | null;
  occupancyTo?: string | null;
}): Promise<
  | { ok: true; invoice: typeof rentInvoices.$inferSelect }
  | { ok: false; error: string; code?: string }
> {
  const [existing] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, args.invoiceId)).limit(1);
  if (!existing) return { ok: false, error: "Rent invoice not found.", code: "RENT_INVOICE_NOT_FOUND" };
  if (String(existing.status ?? "") !== "Draft") {
    return { ok: false, error: "Only Draft invoices can be recalculated.", code: "RENT_INVOICE_NOT_DRAFT" };
  }
  if (!existing.allotmentId?.trim()) {
    return { ok: false, error: "Invoice has no allotment linked.", code: "RENT_INVOICE_NO_ALLOTMENT" };
  }

  const agreement = await fetchAllotmentAgreement(existing.allotmentId);
  if (!agreement) return { ok: false, error: "Allotment not found.", code: "ALLOTMENT_NOT_FOUND" };

  const periodMonth = String(existing.periodMonth ?? "").trim();
  let billingType: RentBillingType =
    args.billingType && ["FullMonth", "Prorated", "Overstay"].includes(args.billingType)
      ? args.billingType
      : (["FullMonth", "Prorated", "Overstay"].includes(String(existing.billingType ?? ""))
          ? (existing.billingType as RentBillingType)
          : inferBillingTypeForMonth({
              periodMonth,
              agreementFrom: agreement.fromDate,
              agreementTo: agreement.toDate,
            }));

  let occupancyFrom = args.occupancyFrom?.trim().slice(0, 10) || null;
  let occupancyTo = args.occupancyTo?.trim().slice(0, 10) || null;
  if (!occupancyFrom || !occupancyTo) {
    const defaults = defaultOccupancyForBillingType({
      billingType,
      periodMonth,
      agreementFrom: agreement.fromDate,
      agreementTo: agreement.toDate,
    });
    if (!defaults) {
      return {
        ok: false,
        error: "Cannot derive occupancy dates for this billing type and month.",
        code: "BILLING_OCCUPANCY",
      };
    }
    occupancyFrom = defaults.occupancyFrom;
    occupancyTo = defaults.occupancyTo;
  }

  const built = await buildRentInvoiceBillingCalculation({
    allotmentId: existing.allotmentId,
    periodMonth,
    billingType,
    occupancyFrom,
    occupancyTo,
  });
  if (!built.ok) return { ok: false, error: built.error, code: "RENT_BILLING_CALC" };

  const calc = built.calculation;
  const rentAmount = calc.rentAmount;
  const nonGstSum = parseNonGstSum(existing.nonGstChargesJson);

  const tenant = String(existing.tenantLicenceId ?? "");
  const trackAExempt =
    tenant && !tenant.startsWith("TB:") ? await tenantLicenceIsGstExempt(tenant) : false;
  const gstExempt = Boolean(trackAExempt || existing.isGovtEntity);

  let cgst = 0;
  let sgst = 0;
  let totalAmount = rentAmount;
  if (!gstExempt) {
    const mergedCfg = await getMergedSystemConfig();
    const cgstPct = parseSystemConfigNumber(mergedCfg, "rent_invoice_cgst_percent");
    const sgstPct = parseSystemConfigNumber(mergedCfg, "rent_invoice_sgst_percent");
    const g = computeRentInvoiceGstInr(rentAmount, false, cgstPct, sgstPct);
    cgst = g.cgst;
    sgst = g.sgst;
    totalAmount = rentInvoiceTotalInr(rentAmount, nonGstSum, cgst, sgst);
  } else {
    totalAmount = rentInvoiceTotalInr(rentAmount, nonGstSum, 0, 0);
  }

  const zeroMsg = rentInvoiceValidationErrorMessage(rentAmount, totalAmount);
  if (zeroMsg) return { ok: false, error: zeroMsg, code: "RENT_INVOICE_ZERO_AMOUNT" };

  const tdsRes = await resolveRentInvoiceTdsFields({
    tenantLicenceId: tenant,
    rentAmount,
    periodMonth,
    isGstExemptTenant: gstExempt,
    excludeInvoiceId: existing.id,
  });
  if ("error" in tdsRes) return { ok: false, error: tdsRes.error, code: "RENT_INVOICE_TDS" };

  await db
    .update(rentInvoices)
    .set({
      billingType: calc.billingType,
      occupancyFrom: calc.occupancyFrom,
      occupancyTo: calc.occupancyTo,
      daysInMonth: calc.daysInMonth,
      billableDays: calc.billableDays,
      billingFactor: calc.billingFactor,
      baseMonthlyRent: calc.baseMonthlyRent,
      billingConfigJson: JSON.stringify(calc.configSnapshot),
      rentAmount,
      cgst,
      sgst,
      totalAmount,
      tdsApplicable: tdsRes.tdsApplicable,
      tdsAmount: tdsRes.tdsAmount,
    })
    .where(eq(rentInvoices.id, existing.id));

  const [row] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, existing.id)).limit(1);
  if (!row) return { ok: false, error: "Rent invoice not found after update.", code: "RENT_INVOICE_NOT_FOUND" };

  return { ok: true, invoice: row };
}
