import type { InferSelectModel } from "drizzle-orm";
import { marketMonthlyReturns, marketMonthlyReturnLines } from "@shared/db-schema";
import { formatInrPdf } from "@shared/format-inr";
import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { pdfSafeText } from "./pdf-safe-text";

type PdfDoc = InstanceType<Awaited<ReturnType<typeof loadPdfDocumentConstructor>>>;

type ReturnRow = InferSelectModel<typeof marketMonthlyReturns>;
type LineRow = InferSelectModel<typeof marketMonthlyReturnLines>;

export type MarketReturnCommodityMeta = {
  name: string;
  unit?: string | null;
};

type TableCol = { label: string; width: number; align: "left" | "right" | "center" };

function formatWholeQtyPdf(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function tableColumns(contentWidth: number): TableCol[] {
  const commodityW = Math.round(contentWidth * 0.34);
  const unitW = Math.round(contentWidth * 0.1);
  const numW = Math.round((contentWidth - commodityW - unitW) / 5);
  return [
    { label: "Commodity", width: commodityW, align: "left" },
    { label: "Unit", width: unitW, align: "left" },
    { label: "Open", width: numW, align: "right" },
    { label: "Buy", width: numW, align: "right" },
    { label: "Value", width: numW, align: "right" },
    { label: "Sales", width: numW, align: "right" },
    { label: "Close", width: numW, align: "right" },
  ];
}

function drawTableRow(
  doc: PdfDoc,
  left: number,
  y: number,
  cols: TableCol[],
  cells: string[],
  opts?: { bold?: boolean },
): number {
  if (opts?.bold) doc.font("Helvetica-Bold");
  else doc.font("Helvetica");
  const heights = cells.map((text, i) =>
    doc.heightOfString(pdfSafeText(text), { width: cols[i]!.width, align: cols[i]!.align }),
  );
  const rowH = Math.max(...heights, 11) + 4;
  let x = left;
  cells.forEach((text, i) => {
    const col = cols[i]!;
    doc.text(pdfSafeText(text), x, y, { width: col.width, align: col.align });
    x += col.width;
  });
  if (opts?.bold) doc.font("Helvetica");
  return y + rowH;
}

export async function buildMarketReturnPdf(params: {
  ret: ReturnRow;
  lines: LineRow[];
  yardLabel: string;
  traderLabel: string;
  commodityById?: Record<string, MarketReturnCommodityMeta>;
}): Promise<Buffer> {
  const { ret, lines, yardLabel, traderLabel, commodityById = {} } = params;
  const PDFDocument = await loadPdfDocumentConstructor();

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const contentLeft = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = tableColumns(contentWidth);

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).text("GAPLMB — Market Fee Monthly Return", { align: "center" });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#555").text("Integrated Online Management System (IOMS)", {
      align: "center",
    });
    doc.fillColor("#000");
    doc.moveDown(1);

    doc.fontSize(11).text(`Location: ${pdfSafeText(yardLabel)}`);
    doc.text(`Trader: ${pdfSafeText(traderLabel)}`);
    doc.text(`Period: ${ret.period}`);
    if (ret.acknowledgementRef) doc.text(`Acknowledgement ref: ${ret.acknowledgementRef}`);
    doc.text(`Status: ${ret.status}`);
    if (ret.submittedAt) doc.text(`Submitted at: ${String(ret.submittedAt).slice(0, 19).replace("T", " ")}`);
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(11).text("Summary");
    doc.font("Helvetica").fontSize(10);
    doc.text(pdfSafeText(`Total purchase value: ${formatInrPdf(ret.totalPurchaseValueInr ?? 0)}`));
    doc.text(pdfSafeText(`Market fee (computed): ${formatInrPdf(ret.totalMarketFeeInr ?? 0)}`));
    if (ret.deadlineDate) doc.text(`Deadline: ${ret.deadlineDate}`);
    if (Number(ret.daysLate ?? 0) > 0) {
      doc.fillColor("#b45309").text(`Late submission: Yes (${Number(ret.daysLate)} day(s))`);
      doc.fillColor("#000");
      doc.text(pdfSafeText(`Interest on market fee: ${formatInrPdf(ret.interestAmountInr ?? 0)}`));
    } else {
      doc.text("Late submission: No");
    }
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(11).text("Commodity lines");
    doc.moveDown(0.4);

    let tableY = doc.y;
    tableY = drawTableRow(
      doc,
      contentLeft,
      tableY,
      cols,
      cols.map((c) => c.label),
      { bold: true },
    );
    doc
      .moveTo(contentLeft, tableY - 2)
      .lineTo(contentLeft + contentWidth, tableY - 2)
      .strokeColor("#cccccc")
      .stroke();
    doc.strokeColor("#000");

    for (const l of lines) {
      const meta = commodityById[String(l.commodityId ?? "")];
      const label = meta?.name ?? String(l.commodityId ?? "");
      const unit = meta?.unit?.trim() || "—";
      tableY = drawTableRow(doc, contentLeft, tableY, cols, [
        label,
        unit,
        formatWholeQtyPdf(l.openingQty),
        formatWholeQtyPdf(l.purchaseQty),
        formatInrPdf(l.purchaseValueInr ?? 0),
        formatWholeQtyPdf(l.salesQty),
        formatWholeQtyPdf(l.closingQty),
      ]);
      if (tableY > doc.page.height - doc.page.margins.bottom - 72) {
        doc.addPage();
        tableY = doc.page.margins.top;
        tableY = drawTableRow(
          doc,
          contentLeft,
          tableY,
          cols,
          cols.map((c) => c.label),
          { bold: true },
        );
        doc
          .moveTo(contentLeft, tableY - 2)
          .lineTo(contentLeft + contentWidth, tableY - 2)
          .strokeColor("#cccccc")
          .stroke();
        doc.strokeColor("#000");
      }
    }

    doc.moveDown(1.2);
    const footerText =
      "Generated by IOMS. This PDF is a system-generated acknowledgement for record purposes.";
    const footerY = Math.min(doc.y, doc.page.height - doc.page.margins.bottom - 36);
    doc.fontSize(8).fillColor("#666");
    doc.text(pdfSafeText(footerText), contentLeft, footerY, {
      width: contentWidth,
      align: "center",
      lineGap: 2,
    });
    doc.end();
  });

  return Buffer.concat(chunks);
}
