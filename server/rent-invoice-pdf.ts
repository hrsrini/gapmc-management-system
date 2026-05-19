/**
 * M-03 rent / GST tax invoice PDF with billing breakdown.
 */
import type { InferSelectModel } from "drizzle-orm";
import type PDFDocument from "pdfkit";
import { rentInvoices } from "@shared/db-schema";
import { buildRentInvoiceBillingBreakdown } from "@shared/rent-invoice-billing-display";
import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { pdfSafeText } from "./pdf-safe-text";
import { formatInrPdf } from "@shared/format-inr";
import { readUploadedReceiptLogoBuffer } from "./receipt-logo-storage";
import fs from "fs";
import path from "path";

type RentInvoiceRow = InferSelectModel<typeof rentInvoices>;
type PdfDoc = InstanceType<typeof PDFDocument>;

async function loadOptionalLogo(): Promise<Buffer | null> {
  const uploaded = await readUploadedReceiptLogoBuffer();
  if (uploaded) return uploaded;
  const filePath = process.env.RECEIPT_PDF_LOGO_PATH?.trim();
  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    try {
      if (fs.existsSync(abs)) return fs.readFileSync(abs);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function formatYmdDdMmYyyy(ymd: string | null | undefined): string {
  const d = String(ymd ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  return d || "—";
}

export type RentInvoicePdfInput = {
  invoice: RentInvoiceRow;
  yardName: string;
  counterpartyName: string;
  assetCode: string;
  allotmentLabel: string;
};

export async function buildRentInvoicePdfA4(input: RentInvoicePdfInput): Promise<Buffer> {
  const { invoice, yardName, counterpartyName, assetCode, allotmentLabel } = input;
  const breakdown = buildRentInvoiceBillingBreakdown(invoice);
  const PDFDocument = await loadPdfDocumentConstructor();
  const logoBuf = await loadOptionalLogo();

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);

    if (logoBuf) {
      try {
        const logoW = 120;
        doc.image(logoBuf, (doc.page.width - logoW) / 2, doc.y, { width: logoW });
        doc.moveDown(2);
      } catch {
        /* skip */
      }
    }

    doc.fontSize(16).text(pdfSafeText("Rent / GST tax invoice (M-03)"), { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).text(pdfSafeText(`Invoice no.: ${invoice.invoiceNo ?? invoice.id}`), { align: "center" });
    doc.moveDown(1);

    const leftX = doc.page.margins.left;
    const colW = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;

    doc.fontSize(10);
    const meta: [string, string][] = [
      ["Yard", yardName],
      ["Billing month", breakdown.periodMonthLabel],
      ["Billing type", breakdown.billingTypeLabel],
      ["Premises", assetCode],
      ["Allotment", allotmentLabel],
      ["Tenant / entity", counterpartyName],
      ["Status", String(invoice.status ?? "")],
    ];
    if (breakdown.occupancyFrom && breakdown.occupancyTo) {
      meta.push(["Occupancy", `${formatYmdDdMmYyyy(breakdown.occupancyFrom)} to ${formatYmdDdMmYyyy(breakdown.occupancyTo)}`]);
    }
    let y = doc.y;
    for (let i = 0; i < meta.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = leftX + col * colW;
      const lineY = y + row * 28;
      doc.text(pdfSafeText(`${meta[i][0]}:`), x, lineY, { width: colW - 8, continued: false });
      doc.font("Helvetica-Bold").text(pdfSafeText(meta[i][1]), x, lineY + 12, { width: colW - 8 });
      doc.font("Helvetica");
      if (col === 1) y = lineY + 28;
    }
    doc.y = y + 36;
    doc.moveDown(0.5);

    doc.fontSize(11).font("Helvetica-Bold").text(pdfSafeText("Rent calculation summary"));
    doc.font("Helvetica").fontSize(10);
    doc.moveDown(0.3);

    const tableLeft = leftX;
    const labelW = 200;
    const valueW = doc.page.width - doc.page.margins.right - tableLeft - labelW;

    for (const line of breakdown.summaryLines) {
      const isMoney =
        /rent|gst|total|fine/i.test(line.label) && !/factor|days/i.test(line.label);
      const val = isMoney ? formatInrPdf(Number(line.value)) : pdfSafeText(line.value);
      const rowY = doc.y;
      doc.text(pdfSafeText(line.label), tableLeft, rowY, { width: labelW });
      doc.text(val, tableLeft + labelW, rowY, { width: valueW, align: "right" });
      doc.moveDown(0.55);
    }

    if (invoice.isGovtEntity) {
      doc.moveDown(0.5);
      doc.text(pdfSafeText("Govt entity — GST exempt on rent component."));
    }

    if (invoice.tdsApplicable && Number(invoice.tdsAmount ?? 0) > 0) {
      doc.moveDown(0.3);
      doc.text(
        pdfSafeText(
          `TDS u/s 194-I (on rent): ${formatInrPdf(Number(invoice.tdsAmount))} — disclosed for statutory reference.`,
        ),
      );
    }

    doc.moveDown(2);
    doc.fontSize(9).fillColor("#444444").text(pdfSafeText("Generated by Goa APMC IOMS — M-03 rent invoice."), {
      align: "center",
    });

    doc.end();
  });

  return Buffer.concat(chunks);
}
