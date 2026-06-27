import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { iomsReceipts, manualReceiptTypes, rentInvoices, users, yards } from "@shared/db-schema";
import { isStandardRevenueHead, manualReceiptPostingHead } from "@shared/manual-receipt-types";
import { parseM03ReceiptBreakdown, resolveM03ReceiptGstAmounts } from "@shared/m03-receipt-breakdown";
import { invoiceGstSnapshot } from "./m03-receipt-gst-display";
import { db } from "./db";
import { attachPayerDisplayNames } from "./ioms-receipt-payer-display";
import { isReceiptTrackAForPdf, resolveReceiptLicenceNo } from "./ioms-receipt-licence-display";
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
  licenceNo: string | null;
  /** Track A only — hide licence label/value for Track B, New Party, and unlinked manual payers. */
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
  /** M-03 rent: formal allotment ref line below payer (e.g. VAL/SHOP-S5-Y-VAL-01). */
  allotmentReferenceLine: string | null;
  generatedByUsername: string;
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
  return `${rh || "payment"}.`;
}

async function buildParticularRows(receipt: ReceiptRow): Promise<ReceiptPdfParticularRow[]> {
  const rh = String(receipt.revenueHead ?? "").trim();
  const m03Br = parseM03ReceiptBreakdown((receipt as { m03BreakdownJson?: string | null }).m03BreakdownJson);
  const rows: Omit<ReceiptPdfParticularRow, "sn">[] = [];

  if (isManualReceipt(receipt)) {
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
    rows.push({ label: "Market Fee", amount: Number(receipt.amount ?? 0) });
  } else if (rh === "SecurityDeposit") {
    rows.push({ label: "Security Deposit", amount: Number(receipt.totalAmount ?? receipt.amount ?? 0) });
  } else if (rh === "RentArrearsInterest") {
    const interest = Number(receipt.amount ?? 0);
    if (interest > 0.005) rows.push({ label: "Interest on Rent", amount: interest });
  } else {
    let rentBase = Number(receipt.amount ?? 0);
    let cgst = Number(receipt.cgst ?? 0);
    let sgst = Number(receipt.sgst ?? 0);

    if (
      cgst < 0.005 &&
      sgst < 0.005 &&
      String(receipt.sourceModule ?? "") === "M-03" &&
      receipt.sourceRecordId
    ) {
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
      const parts = resolveM03ReceiptGstAmounts(receipt, inv ? invoiceGstSnapshot(inv) : null);
      rentBase = parts.amount;
      cgst = parts.cgst;
      sgst = parts.sgst;
    }

    if (rentBase > 0.005) rows.push({ label: "Rent", amount: rentBase });
    if (cgst > 0.005) rows.push({ label: "CGST", amount: cgst });
    if (sgst > 0.005) rows.push({ label: "SGST", amount: sgst });
    const tds = Number(receipt.tdsAmount ?? 0);
    if (tds > 0.005) rows.push({ label: "TDS", amount: -tds });
    const interest = m03Br?.interestAmount != null ? Number(m03Br.interestAmount) : 0;
    if (interest > 0.005) rows.push({ label: "Interest on Rent", amount: interest });
  }

  if (rows.length === 0) {
    rows.push({ label: rh || "Amount", amount: Number(receipt.totalAmount ?? receipt.amount ?? 0) });
  }

  return rows.map((r, i) => ({ sn: i + 1, ...r }));
}

function receiptTitle(receipt: ReceiptRow, yardCode: string | null, yardName: string | null): string {
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

  const showLicenceNo = isReceiptTrackAForPdf(receipt);
  const licenceNo = showLicenceNo ? await resolveReceiptLicenceNo(receipt) : null;

  let newPartyAddressLine: string | null = null;
  let newPartyContactLine: string | null = null;
  if (String(receipt.payerPartyType ?? "").trim() === "NewParty") {
    const addr = String(receipt.payerAddress ?? "").trim();
    const contact = String(receipt.payerContact ?? "").trim();
    if (addr) newPartyAddressLine = `Address : ${addr}`;
    if (contact) newPartyContactLine = `Contact No. : ${contact}`;
  }

  const remarks = await buildRemarks(receipt);
  const totalAmount = Number(receipt.totalAmount ?? 0);
  const branding = getReceiptPdfBranding(yard?.address ?? null, yard?.name ?? null);

  let allotmentReferenceLine: string | null = null;
  if (String(receipt.sourceModule ?? "").trim() === "M-03" && receipt.sourceRecordId) {
    const rh = String(receipt.revenueHead ?? "").trim();
    if (rh === "Rent" || rh === "GSTInvoice" || rh === "RentArrearsInterest") {
      const [inv] = await db
        .select({
          allotmentId: rentInvoices.allotmentId,
          allotmentKind: rentInvoices.allotmentKind,
          assetId: rentInvoices.assetId,
        })
        .from(rentInvoices)
        .where(eq(rentInvoices.id, receipt.sourceRecordId))
        .limit(1);
      if (inv) {
        const premises = await resolveRentReceiptPremisesPrint(inv);
        allotmentReferenceLine = `Allotment Ref. No. : ${premises.allotmentReferenceNo}`;
      }
    }
  }

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

  return {
    payerDisplayName,
    receivedFromLine,
    allotmentReferenceLine,
    licenceNo,
    showLicenceNo: showLicenceNo && Boolean(licenceNo?.trim()),
    newPartyAddressLine,
    newPartyContactLine,
    branding,
    receiptTitle: receiptTitle(receipt, yard?.code ?? null, yard?.name ?? null),
    receiptNo: receipt.receiptNo,
    dateLabel: formatReceiptDateDmYyyy(receipt.createdAt),
    paymentDetailLine: formatReceiptPaymentDetailLine(receipt),
    remarks,
    amountWords: formatInrAmountWordsReceiptFace(totalAmount),
    rows: await buildParticularRows(receipt),
    totalAmount,
    isGracePeriod: Boolean((receipt as { isGracePeriod?: boolean | null }).isGracePeriod),
    revenueHead: isManualReceipt(receipt)
      ? (await resolveManualLedgerLabel(receipt)) ?? String(receipt.revenueHead ?? "")
      : String(receipt.revenueHead ?? ""),
    generatedByUsername,
  };
}
