import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { iomsReceipts, manualReceiptTypes, rentInvoices, users, yards } from "@shared/db-schema";
import { isStandardRevenueHead, manualReceiptPostingHead } from "@shared/manual-receipt-types";
import { parseM03ReceiptBreakdown, resolveM03ReceiptGstAmounts } from "@shared/m03-receipt-breakdown";
import { isM05ConsolidatedReceipt, parseM05ConsolidatedBreakdown } from "@shared/manual-consolidated-receipt";
import { invoiceGstSnapshot } from "./m03-receipt-gst-display";
import { db } from "./db";
import { attachPayerDisplayNames } from "./ioms-receipt-payer-display";
import { resolveReceiptPartyIdLine } from "./ioms-receipt-licence-display";
import { resolveRentReceiptPremisesPrint } from "./rent-allotment-reference";
import { formatBillingMonthLabel } from "./pre-receipt-pdf";
import {
  formatInrAmountWordsReceiptFace,
  formatReceiptDateDmYyyy,
  formatReceiptPaymentDetailLine,
  getReceiptPdfBranding,
  marketFeeReceiptTitleForYard,
  otherReceiptTitleForYard,
  rentReceiptTitleForYard,
} from "./receipt-pdf-shared";
import { loadMarketFeeReceiptPdfDetail } from "./market-fee-receipt-pdf-detail";
import type { MarketFeeReceiptPdfDetail } from "@shared/market-fee-receipt-pdf";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;

export type ReceiptPdfParticularRow = {
  sn: number;
  label: string;
  amount: number;
};

export type ReceiptPdfLayoutContext = {
  payerDisplayName: string;
  /** Payer / lessee name on receipt face. */
  receivedFromLine: string;
  /**
   * Licence No. / Entity No. shown on the same line as the payer name.
   * Null when New Party or no identifier — do not print a blank placeholder.
   */
  partyIdLine: string | null;
  /** @deprecated Prefer partyIdLine; kept for call-site compatibility. */
  licenceNo: string | null;
  /** @deprecated Prefer partyIdLine. */
  showLicenceNo: boolean;
  /** New Party only; omitted when blank. */
  newPartyAddressLine: string | null;
  newPartyContactLine: string | null;
  branding: ReturnType<typeof getReceiptPdfBranding>;
  receiptTitle: string;
  receiptNo: string;
  dateLabel: string;
  paymentDetailLine: string;
  remarks: string;
  amountWords: string;
  rows: ReceiptPdfParticularRow[];
  totalAmount: number;
  isGracePeriod: boolean;
  revenueHead: string;
  /** Always null — Allotment Ref. No. removed from receipt face. */
  allotmentReferenceLine: string | null;
  generatedByUsername: string;
  /** Present when revenueHead is MarketFee and source detail was resolved. */
  marketFeeDetail: MarketFeeReceiptPdfDetail | null;
};

async function resolveManualLedgerLabel(receipt: ReceiptRow): Promise<string | null> {
  const typeId = String(receipt.manualReceiptTypeId ?? "").trim();
  if (!typeId) return null;
  const [mrt] = await db
    .select({ ledgerName: manualReceiptTypes.ledgerName })
    .from(manualReceiptTypes)
    .where(eq(manualReceiptTypes.id, typeId))
    .limit(1);
  return mrt?.ledgerName ? manualReceiptPostingHead(mrt.ledgerName) : null;
}

function isManualReceipt(receipt: ReceiptRow): boolean {
  return String(receipt.sourceModule ?? "").trim() === "M-05-MANUAL";
}

async function buildRemarks(receipt: ReceiptRow): Promise<string> {
  const mode = String(receipt.paymentMode ?? "").trim();
  const payWord = mode === "Cash" ? "Cash" : mode === "Cheque" || mode === "DD" ? "Cheque" : mode || "payment";
  if (isManualReceipt(receipt)) {
    const consolidated = parseM05ConsolidatedBreakdown(
      (receipt as { m03BreakdownJson?: string | null }).m03BreakdownJson,
    );
    if (consolidated?.lines?.length) {
      const narr = String(receipt.narration ?? "").trim();
      // Keep face remarks short — listing every Tally head here caused slip overflow/overwrite;
      // heads are printed in the Particulars table (and CONTINUED A5 pages when needed).
      if (narr) return narr.length > 100 ? `${narr.slice(0, 97)}...` : narr;
      const n = consolidated.lines.length;
      return n === 1
        ? `Consolidated payment: ${consolidated.lines[0].ledgerName}.`
        : `Consolidated payment (${n} heads of account) as detailed below.`;
    }
    const ledger = await resolveManualLedgerLabel(receipt);
    if (ledger) return `${ledger}.`;
  }
  if (String(receipt.sourceModule ?? "") === "M-03" && receipt.sourceRecordId) {
    const [inv] = await db
      .select({
        periodMonth: rentInvoices.periodMonth,
        allotmentId: rentInvoices.allotmentId,
        allotmentKind: rentInvoices.allotmentKind,
        assetId: rentInvoices.assetId,
      })
      .from(rentInvoices)
      .where(eq(rentInvoices.id, receipt.sourceRecordId))
      .limit(1);
    if (inv) {
      const month = formatBillingMonthLabel(inv.periodMonth, String(receipt.createdAt ?? ""));
      const premises = await resolveRentReceiptPremisesPrint(inv);
      return `Rent,CGST,SGST for the month of ${month} of ${premises.premisesLabel}.`;
    }
  }
  const rh = String(receipt.revenueHead ?? "").trim();
  if (rh === "MarketFee") {
    return `Market fee payment (${payWord}).`;
  }
  if (rh === "SecurityDeposit") {
    return "Security Deposit.";
  }
  if (rh === "SecurityDepositRefund") {
    return "Refund of Security Deposit of Premises.";
  }
  return `${rh || "payment"}.`;
}

async function loadAdvanceAdjustmentRows(invoiceId: string): Promise<Omit<ReceiptPdfParticularRow, "sn">[]> {
  const { listAdvanceAdjustmentsForInvoice, getAdvanceRentDepositDetail } = await import(
    "./advance-rent-deposit-service"
  );
  const adjustments = await listAdvanceAdjustmentsForInvoice(invoiceId);
  const out: Omit<ReceiptPdfParticularRow, "sn">[] = [];
  for (const adj of adjustments) {
    const amt = Math.abs(Number(adj.amountInr ?? 0));
    if (amt <= 0.005) continue;
    const detail = await getAdvanceRentDepositDetail(adj.depositId);
    const depNo = detail?.depositReceiptNo ?? "—";
    const depDate = detail?.depositDate
      ? formatReceiptDateDmYyyy(`${detail.depositDate}T00:00:00.000Z`)
      : "—";
    const ref = adj.adjustmentRef ? ` · ${adj.adjustmentRef}` : "";
    const bal =
      detail?.balanceAmount != null
        ? ` · Deposit balance after adjustment INR ${Number(detail.balanceAmount).toFixed(2)}`
        : "";
    out.push({
      label: `Less: Advance deposit adjusted — ${depNo} dated ${depDate}${ref}${bal}`,
      amount: -amt,
    });
  }
  return out;
}

async function buildParticularRows(receipt: ReceiptRow): Promise<ReceiptPdfParticularRow[]> {
  const rh = String(receipt.revenueHead ?? "").trim();
  const sourceModule = String(receipt.sourceModule ?? "").trim();
  const m03Br = parseM03ReceiptBreakdown((receipt as { m03BreakdownJson?: string | null }).m03BreakdownJson);
  const rows: Omit<ReceiptPdfParticularRow, "sn">[] = [];

  // Advance rent deposit collection receipt face.
  if (sourceModule === "M-03-ADV-DEPOSIT") {
    rows.push({ label: "Advance rent deposit received", amount: Number(receipt.totalAmount ?? receipt.amount ?? 0) });
    return rows.map((r, i) => ({ sn: i + 1, ...r }));
  }

  if (isManualReceipt(receipt)) {
    const consolidated = parseM05ConsolidatedBreakdown(
      (receipt as { m03BreakdownJson?: string | null }).m03BreakdownJson,
    );
    if (consolidated?.lines?.length) {
      for (const line of consolidated.lines) {
        const premises =
          line.premisesLabels && line.premisesLabels.length
            ? ` (${line.premisesLabels.join(", ")})`
            : "";
        const remark = line.remarks ? ` — ${line.remarks}` : "";
        rows.push({
          label: `${line.ledgerName}${premises}${remark}`,
          amount: Number(line.amount) || 0,
        });
        if ((Number(line.cgst) || 0) > 0.005) {
          rows.push({ label: `CGST on ${line.ledgerName}`, amount: Number(line.cgst) });
        }
        if ((Number(line.sgst) || 0) > 0.005) {
          rows.push({ label: `SGST on ${line.ledgerName}`, amount: Number(line.sgst) });
        }
      }
      return rows.map((r, i) => ({ sn: i + 1, ...r }));
    }
    const ledger =
      (await resolveManualLedgerLabel(receipt)) ||
      (isStandardRevenueHead(rh) ? null : rh) ||
      rh ||
      "Amount";
    const amount = Number(receipt.totalAmount ?? receipt.amount ?? 0);
    rows.push({ label: ledger, amount });
    return rows.map((r, i) => ({ sn: i + 1, ...r }));
  }

  if (rh === "MarketFee") {
    // Placeholder; Market Fee face uses marketFeeDetail + dedicated drawer.
    rows.push({ label: "Market Fee", amount: Number(receipt.amount ?? 0) });
  } else if (rh === "SecurityDeposit") {
    const { parseM02SecdepBreakdown } = await import("@shared/premises-security-deposit");
    const secLines = parseM02SecdepBreakdown(
      (receipt as { m03BreakdownJson?: string | null }).m03BreakdownJson,
    );
    if (secLines?.lines?.length) {
      for (const line of secLines.lines) {
        rows.push({
          label: `Security Deposit : ${line.premisesLabel}`,
          amount: Number(line.amount) || 0,
        });
      }
    } else {
      rows.push({ label: "Security Deposit", amount: Number(receipt.totalAmount ?? receipt.amount ?? 0) });
    }
  } else if (rh === "SecurityDepositRefund") {
    const { parseM02SecrefBreakdown } = await import("@shared/premises-security-deposit");
    const ref = parseM02SecrefBreakdown(
      (receipt as { m03BreakdownJson?: string | null }).m03BreakdownJson,
    );
    if (ref) {
      for (const d of ref.deposits) {
        const rec =
          d.depositReceiptNo != null
            ? ` (receipt ${d.depositReceiptNo}${d.depositReceiptDate ? ` dated ${d.depositReceiptDate}` : ""})`
            : "";
        rows.push({
          label: `Security Deposit : ${d.premisesLabel}${rec}`,
          amount: Number(d.amount) || 0,
        });
      }
      for (const ded of ref.deductions) {
        rows.push({ label: `Less: ${ded.reason}`, amount: -(Number(ded.amount) || 0) });
      }
      rows.push({ label: "Net refund paid", amount: Number(ref.netPayable) || 0 });
    } else {
      rows.push({
        label: "Security Deposit Refund",
        amount: Number(receipt.totalAmount ?? receipt.amount ?? 0),
      });
    }
  } else if (rh === "RentArrearsInterest") {
    const interest = Number(receipt.amount ?? 0);
    if (interest > 0.005) rows.push({ label: "Interest on Rent", amount: interest });
  } else {
    let rentBase = Number(receipt.amount ?? 0);
    let cgst = Number(receipt.cgst ?? 0);
    let sgst = Number(receipt.sgst ?? 0);
    let advanceLess: Omit<ReceiptPdfParticularRow, "sn">[] = [];

    if (String(receipt.sourceModule ?? "") === "M-03" && receipt.sourceRecordId) {
      advanceLess = await loadAdvanceAdjustmentRows(String(receipt.sourceRecordId));
      const [inv] = await db
        .select({
          rentAmount: rentInvoices.rentAmount,
          cgst: rentInvoices.cgst,
          sgst: rentInvoices.sgst,
          totalAmount: rentInvoices.totalAmount,
        })
        .from(rentInvoices)
        .where(eq(rentInvoices.id, receipt.sourceRecordId))
        .limit(1);
      // When advance was applied, show full invoice face then Less: deposit (mockup Screen 8).
      if (advanceLess.length > 0 && inv) {
        rentBase = Number(inv.rentAmount ?? 0);
        cgst = Number(inv.cgst ?? 0);
        sgst = Number(inv.sgst ?? 0);
      } else if (cgst < 0.005 && sgst < 0.005) {
        const parts = resolveM03ReceiptGstAmounts(receipt, inv ? invoiceGstSnapshot(inv) : null);
        rentBase = parts.amount;
        cgst = parts.cgst;
        sgst = parts.sgst;
      }
    }

    if (rentBase > 0.005) rows.push({ label: "Rent", amount: rentBase });
    if (cgst > 0.005) rows.push({ label: "CGST", amount: cgst });
    if (sgst > 0.005) rows.push({ label: "SGST", amount: sgst });
    const tds = Number(receipt.tdsAmount ?? 0);
    if (tds > 0.005) rows.push({ label: "TDS", amount: -tds });
    const interest = m03Br?.interestAmount != null ? Number(m03Br.interestAmount) : 0;
    if (interest > 0.005) rows.push({ label: "Interest on Rent", amount: interest });
    rows.push(...advanceLess);
  }

  if (rows.length === 0) {
    rows.push({ label: rh || "Amount", amount: Number(receipt.totalAmount ?? receipt.amount ?? 0) });
  }

  return rows.map((r, i) => ({ sn: i + 1, ...r }));
}

function receiptTitle(receipt: ReceiptRow, yardCode: string | null, yardName: string | null): string {
  if (String(receipt.sourceModule ?? "").trim() === "M-03-ADV-DEPOSIT") {
    return "ADVANCE RENT DEPOSIT RECEIPT";
  }
  const rh = String(receipt.revenueHead ?? "").trim();
  if (rh === "MarketFee") return marketFeeReceiptTitleForYard(yardCode);
  if (rh === "Rent" || rh === "GSTInvoice" || rh === "RentArrearsInterest") {
    return rentReceiptTitleForYard(yardCode, yardName);
  }
  return otherReceiptTitleForYard(yardName, yardCode);
}

export async function loadReceiptPdfLayoutContext(receipt: ReceiptRow): Promise<ReceiptPdfLayoutContext> {
  const [yard] = await db
    .select({
      name: yards.name,
      code: yards.code,
      address: yards.address,
      phone: yards.phone,
    })
    .from(yards)
    .where(eq(yards.id, receipt.yardId))
    .limit(1);

  let payerDisplayName = String(receipt.payerName ?? receipt.payerRefId ?? "—");
  try {
    const enriched = await attachPayerDisplayNames([receipt]);
    payerDisplayName = enriched[0]?.payerDisplayName ?? payerDisplayName;
  } catch {
    /* use fallback */
  }

  const partyId = await resolveReceiptPartyIdLine(receipt);
  const partyIdLine = partyId?.label?.trim() || null;
  const licenceNo = partyId?.kind === "licence" ? partyId.label.replace(/^Licence No:\s*/i, "") : null;

  let newPartyAddressLine: string | null = null;
  let newPartyContactLine: string | null = null;
  if (String(receipt.payerPartyType ?? "").trim() === "NewParty") {
    const addr = String(receipt.payerAddress ?? "").trim();
    const contact = String(receipt.payerContact ?? "").trim();
    if (addr) newPartyAddressLine = `Address : ${addr}`;
    if (contact) newPartyContactLine = `Contact No. : ${contact}`;
  }

  let remarks = await buildRemarks(receipt);
  if (String(receipt.sourceModule ?? "").trim() === "M-03-ADV-DEPOSIT") {
    remarks = "Advance rent deposit. Adjustable against rent invoices for the premises.";
  }

  const marketFeeDetail =
    String(receipt.revenueHead ?? "").trim() === "MarketFee"
      ? await loadMarketFeeReceiptPdfDetail(receipt)
      : null;

  const totalAmount = marketFeeDetail
    ? marketFeeDetail.rounding.finalAmount
    : Number(receipt.totalAmount ?? 0);
  const branding = getReceiptPdfBranding(yard?.address ?? null, yard?.name ?? null);

  /** Allotment Ref. No. removed from receipt face per format revision. */
  const allotmentReferenceLine: string | null = null;

  const receivedFromLine = `Received with thanks From : ${payerDisplayName}`;

  let generatedByUsername = String(receipt.createdBy ?? "").trim() || "—";
  if (receipt.createdBy) {
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, receipt.createdBy))
      .limit(1);
    if (u?.name?.trim()) generatedByUsername = u.name.trim();
  }

  let paymentDetailLine = formatReceiptPaymentDetailLine(receipt);
  if (String(receipt.sourceModule ?? "").trim() === "M-03" && receipt.sourceRecordId) {
    const advanceLess = await loadAdvanceAdjustmentRows(String(receipt.sourceRecordId));
    const adjTotal = advanceLess.reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
    if (adjTotal > 0.005) {
      const mode = String(receipt.paymentMode ?? "Cash").trim() || "Cash";
      paymentDetailLine = `${mode}, after adjustment of INR ${adjTotal.toFixed(2)} from advance deposit`;
    }
  }

  const rows = await buildParticularRows(receipt);
  if (marketFeeDetail) {
    // Keep rows coherent for any non-MF drawer fallback.
    rows.length = 0;
    rows.push({ sn: 1, label: "Market Fee", amount: marketFeeDetail.totalMarketFee });
    if (marketFeeDetail.fineAmount > 0.005) {
      rows.push({ sn: 2, label: "Fine", amount: marketFeeDetail.fineAmount });
    }
  }

  return {
    payerDisplayName,
    receivedFromLine,
    allotmentReferenceLine,
    partyIdLine,
    licenceNo,
    showLicenceNo: Boolean(partyIdLine),
    newPartyAddressLine,
    newPartyContactLine,
    branding,
    receiptTitle: receiptTitle(receipt, yard?.code ?? null, yard?.name ?? null),
    receiptNo: receipt.receiptNo,
    dateLabel: formatReceiptDateDmYyyy(receipt.createdAt),
    paymentDetailLine,
    remarks,
    amountWords: formatInrAmountWordsReceiptFace(totalAmount),
    rows,
    totalAmount,
    isGracePeriod: Boolean((receipt as { isGracePeriod?: boolean | null }).isGracePeriod),
    revenueHead: isM05ConsolidatedReceipt(receipt)
      ? "Consolidated"
      : isManualReceipt(receipt)
        ? (await resolveManualLedgerLabel(receipt)) ?? String(receipt.revenueHead ?? "")
        : String(receipt.revenueHead ?? ""),
    generatedByUsername,
    marketFeeDetail,
  };
}
