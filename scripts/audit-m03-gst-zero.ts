import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { iomsReceipts, rentInvoices } from "@shared/db-schema";
import { resolveM03ReceiptGstAmounts } from "@shared/m03-receipt-breakdown";
import { invoiceGstSnapshot, withResolvedM03ReceiptGst } from "../server/m03-receipt-gst-display";
import { withResolvedRentInvoiceGst } from "../server/rent-invoice-gst-display";
import { getMergedSystemConfig, parseSystemConfigNumber } from "../server/system-config";

async function main(): Promise<void> {
  const cfg = await getMergedSystemConfig();
  const cgstPct = parseSystemConfigNumber(cfg, "rent_invoice_cgst_percent");
  const sgstPct = parseSystemConfigNumber(cfg, "rent_invoice_sgst_percent");

  const receipts = await db.select().from(iomsReceipts);
  const invoices = await db.select().from(rentInvoices);
  const invById = new Map(invoices.map((i) => [i.id, i]));

  const zeroGstReceipts = receipts.filter((r) => {
    const rh = String(r.revenueHead ?? "");
    if (rh !== "Rent" && rh !== "GSTInvoice") return false;
    return Number(r.cgst ?? 0) < 0.005 && Number(r.sgst ?? 0) < 0.005 && Number(r.amount ?? 0) > 0.005;
  });

  const taxableZeroGst = zeroGstReceipts.filter((r) => {
    const inv = r.sourceRecordId ? invById.get(r.sourceRecordId) : null;
    if (String(r.sourceModule ?? "") === "M-03" && inv && !inv.isGovtEntity) {
      const invTax = Number(inv.cgst ?? 0) + Number(inv.sgst ?? 0);
      return invTax > 0.005;
    }
    return false;
  });

  console.log("=== M-03 taxable receipts STILL zero GST (BUG) ===", taxableZeroGst.length);
  for (const r of taxableZeroGst) {
    const inv = r.sourceRecordId ? invById.get(r.sourceRecordId) : null;
    const invSnap = inv ? invoiceGstSnapshot(inv) : null;
    const resolved = resolveM03ReceiptGstAmounts(r, invSnap);
    console.log({
      receiptNo: r.receiptNo,
      status: r.status,
      amount: r.amount,
      total: r.totalAmount,
      invoiceNo: inv?.invoiceNo,
      invCgst: inv?.cgst,
      invSgst: inv?.sgst,
      resolved,
    });
  }

  console.log("\n=== All Rent/GSTInvoice receipts with zero CGST/SGST ===", zeroGstReceipts.length);
  for (const r of zeroGstReceipts) {
    const inv = r.sourceRecordId ? invById.get(r.sourceRecordId) : null;
    const invSnap = inv ? invoiceGstSnapshot(inv) : null;
    const resolved = resolveM03ReceiptGstAmounts(r, invSnap);
    const enriched = withResolvedM03ReceiptGst(r, invSnap);
    console.log({
      receiptNo: r.receiptNo,
      status: r.status,
      module: r.sourceModule,
      amount: r.amount,
      total: r.totalAmount,
      invoiceNo: inv?.invoiceNo ?? null,
      invCgst: inv?.cgst ?? null,
      invSgst: inv?.sgst ?? null,
      invGovt: inv?.isGovtEntity ?? null,
      resolvedCgst: resolved.cgst,
      resolvedSgst: resolved.sgst,
      enrichedCgst: enriched.cgst,
      enrichedSgst: enriched.sgst,
    });
  }

  const badInvoices = invoices.filter(
    (i) =>
      !i.isGovtEntity &&
      Number(i.rentAmount ?? 0) > 0.005 &&
      Number(i.cgst ?? 0) < 0.005 &&
      Number(i.sgst ?? 0) < 0.005,
  );
  console.log("\n=== Non-govt invoices with zero GST in DB ===", badInvoices.length);
  for (const i of badInvoices) {
    const enriched = withResolvedRentInvoiceGst(i, cgstPct, sgstPct);
    console.log({
      invoiceNo: i.invoiceNo,
      period: i.periodMonth,
      status: i.status,
      rent: i.rentAmount,
      cgst: i.cgst,
      enrichedCgst: enriched.cgst,
      enrichedSgst: enriched.sgst,
    });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
