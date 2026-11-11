import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { pdfSafeText } from "./pdf-safe-text";

function dmy(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s || "—";
}

function inr(n: number): string {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export async function buildFinalDemandNoticePdf(args: {
  notice: {
    noticeNo: string;
    noticeDate: string;
    paymentDueDate: string | null;
    totalPayable: number;
    versionNo: number;
  };
  settlement: {
    outstandingRent: number;
    interestAmount: number;
    otherDues: number;
    additionalReceivable: number;
    depositHeld: number;
    deductions: number;
    approvedAdjustmentsJson?: string | null;
  } | null | undefined;
  agreement: {
    agreementNo: string;
    allotteeName: string;
    fromDate?: string;
    toDate?: string;
    premises?: Array<{ premisesId?: string; location?: string }>;
  } | null;
  evictionDate?: string | null;
  paymentHistory?: Array<{
    date?: string;
    receiptNo?: string;
    particulars?: string;
    principal?: number;
    interest?: number;
    total?: number;
  }>;
}): Promise<Buffer> {
  const PDFDocument = await loadPdfDocumentConstructor();
  const doc = new PDFDocument({ size: "A4", margin: 54 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const premises =
    (args.agreement?.premises ?? []).map((p) => p.premisesId).filter(Boolean).join(", ") || "—";
  const s = args.settlement;
  const depositAdj = Number(s?.depositHeld ?? 0) - Number(s?.deductions ?? 0);
  const additional = Number(s?.additionalReceivable ?? 0);
  const total =
    Number(s?.outstandingRent ?? 0) +
    Number(s?.interestAmount ?? 0) +
    Number(s?.otherDues ?? 0) +
    additional -
    depositAdj;

  doc.fontSize(12).text(pdfSafeText("[ORGANISATION NAME AND LETTERHEAD]"), { align: "center" });
  doc.fontSize(9).text(pdfSafeText("[Office address]"), { align: "center" });
  doc.moveDown();

  const y0 = doc.y;
  doc.fontSize(10).text(pdfSafeText(`No. ${args.notice.noticeNo}`));
  doc.text(pdfSafeText(`Date: ${dmy(args.notice.noticeDate)}`), 350, y0, { width: 200, align: "right" });
  doc.moveDown(1.2);

  doc.text(pdfSafeText("To,"));
  doc.text(pdfSafeText(args.agreement?.allotteeName ?? "—"));
  doc.text(pdfSafeText("[Lessee address]"));
  doc.moveDown();
  doc
    .font("Helvetica-Bold")
    .text(pdfSafeText(`Subject: Final Demand Notice for premises ${premises} after eviction`));
  doc.font("Helvetica").moveDown();
  doc.text(
    pdfSafeText(
      `Premises ${premises} under agreement ${args.agreement?.agreementNo ?? "—"} was vacated on ${dmy(
        args.evictionDate ?? args.notice.noticeDate,
      )} by order of the Estate Officer / competent authority. A Full and Final Settlement was calculated up to that date. Please pay the amount below by ${dmy(
        args.notice.paymentDueDate,
      ) || "[payment due date]"}.`,
    ),
    { align: "justify" },
  );
  doc.moveDown();

  const info: Array<[string, string]> = [
    ["Premises and location", `${premises}, [location]`],
    [
      "Agreement period",
      `${dmy(args.agreement?.fromDate)} to ${dmy(args.agreement?.toDate)}`,
    ],
    ["Actual date of eviction", dmy(args.evictionDate ?? args.notice.noticeDate)],
  ];
  let ty = doc.y;
  info.forEach(([k, v], i) => {
    const y = ty + i * 20;
    doc.rect(54, y, 486, 20).stroke();
    doc.fontSize(9).text(pdfSafeText(k), 60, y + 5, { width: 180 });
    doc.text(pdfSafeText(v), 250, y + 5, { width: 280 });
  });
  doc.y = ty + info.length * 20 + 16;

  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("Settlement summary"));
  doc.moveDown(0.4);
  const money: Array<[string, string, boolean?]> = [
    [`Outstanding rent up to ${dmy(args.evictionDate ?? args.notice.noticeDate)}`, inr(Number(s?.outstandingRent ?? 0))],
    ["Interest on outstanding rent", inr(Number(s?.interestAmount ?? 0))],
    ["Other outstanding dues", inr(Number(s?.otherDues ?? 0))],
    ["Additional receivable", inr(additional)],
    ["Less: security deposit adjusted", `(${inr(depositAdj)})`],
    ["Total final amount payable by you", inr(args.notice.totalPayable || total), true],
  ];
  ty = doc.y;
  money.forEach(([k, v, bold], i) => {
    const y = ty + i * 20;
    if (bold) doc.rect(54, y, 486, 20).fillAndStroke("#f5e6d3", "#000");
    else doc.rect(54, y, 486, 20).stroke();
    doc.fillColor("#000").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    doc.text(pdfSafeText(k), 60, y + 5, { width: 320 });
    doc.text(pdfSafeText(v), 400, y + 5, { width: 130, align: "right" });
  });
  doc.y = ty + money.length * 20 + 18;

  doc.font("Helvetica-Bold").fontSize(10).text(
    pdfSafeText(
      `Annexure: payment history, latest agreement (${dmy(args.agreement?.fromDate)} to ${dmy(args.agreement?.toDate)})`,
    ),
  );
  doc.moveDown(0.4);
  const hist = args.paymentHistory ?? [];
  const headers = ["Date", "Receipt no.", "Particulars", "Principal", "Interest", "Total"];
  const colX = [54, 110, 190, 340, 410, 470];
  const hy = doc.y;
  doc.rect(54, hy, 486, 18).stroke();
  headers.forEach((h, i) => doc.font("Helvetica-Bold").fontSize(8).text(pdfSafeText(h), colX[i]! + 2, hy + 4));
  doc.y = hy + 18;
  if (hist.length === 0) {
    doc.font("Helvetica").fontSize(8).text(pdfSafeText("[No payment history attached]"), 60, doc.y + 4);
    doc.moveDown();
  } else {
    hist.slice(0, 12).forEach((row) => {
      const y = doc.y;
      doc.rect(54, y, 486, 16).stroke();
      const vals = [
        dmy(row.date),
        row.receiptNo ?? "",
        row.particulars ?? "",
        inr(Number(row.principal ?? 0)),
        inr(Number(row.interest ?? 0)),
        inr(Number(row.total ?? 0)),
      ];
      vals.forEach((v, i) => doc.font("Helvetica").fontSize(8).text(pdfSafeText(v), colX[i]! + 2, y + 3, { width: 60 }));
      doc.y = y + 16;
    });
  }

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor("#555").text(pdfSafeText(`Generated from the approved settlement, version ${args.notice.versionNo}.`));
  doc.fillColor("#000").fontSize(10).text(pdfSafeText("[Signature]"), 380, doc.y, { width: 160, align: "right" });
  doc.text(pdfSafeText("[Designation], GAPLMB"), 380, doc.y, { width: 160, align: "right" });

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", () => resolve()));
  return Buffer.concat(chunks);
}
