import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { pdfSafeText } from "./pdf-safe-text";

function dmy(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s || "—";
}

export async function buildRenewalNoticePdf(args: {
  notice: {
    noticeNo: string;
    noticeDate: string;
    lastDateToRenew: string | null;
    versionNo: number;
  };
  agreement: {
    agreementNo: string;
    allotteeName: string;
    fromDate: string;
    toDate: string;
    penaltyClauseRef?: string | null;
    penaltyMethod?: string | null;
    premises?: Array<{ premisesId?: string; assetType?: string; monthlyRent?: number }>;
  };
}): Promise<Buffer> {
  const PDFDocument = await loadPdfDocumentConstructor();
  const doc = new PDFDocument({ size: "A4", margin: 54 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const premisesList = (args.agreement.premises ?? [])
    .map((p) => p.premisesId)
    .filter(Boolean)
    .join(", ");

  doc.fontSize(12).text(pdfSafeText("[ORGANISATION NAME]"), { align: "center" });
  doc.fontSize(9).text(pdfSafeText("[Office address]"), { align: "center" });
  doc.fontSize(9).text(pdfSafeText("[Contact details]"), { align: "center" });
  doc.moveDown(1.2);

  const topY = doc.y;
  doc.fontSize(10).text(pdfSafeText(`Notice ref: ${args.notice.noticeNo}`), { continued: false });
  doc.text(pdfSafeText(`Date: ${dmy(args.notice.noticeDate)}`), 350, topY, { width: 200, align: "right" });
  doc.moveDown(1.5);

  doc.fontSize(10).text(pdfSafeText("To,"));
  doc.text(pdfSafeText(args.agreement.allotteeName));
  doc.text(pdfSafeText("[Lessee address]"));
  doc.moveDown();

  doc
    .font("Helvetica-Bold")
    .text(
      pdfSafeText(
        `Subject: Renewal of agreement for premises ${premisesList || "—"} (Agreement no. ${args.agreement.agreementNo})`,
      ),
    );
  doc.font("Helvetica").moveDown();
  doc.text(pdfSafeText("Sir / Madam,"));
  doc.moveDown(0.5);
  doc.text(
    pdfSafeText(
      "The agreement for the premises below is due for renewal. Please confirm in writing your willingness to continue the tenancy and complete the renewal formalities by the last date shown.",
    ),
    { align: "justify" },
  );
  doc.moveDown();

  const rows: Array<[string, string]> = [
    ["Premises", premisesList || "—"],
    ["Existing agreement no.", args.agreement.agreementNo],
    ["Agreement validity", `${dmy(args.agreement.fromDate)} to ${dmy(args.agreement.toDate)}`],
    ["Agreement expiry date", dmy(args.agreement.toDate)],
    ["Last date to complete renewal", dmy(args.notice.lastDateToRenew ?? args.agreement.toDate)],
  ];
  const tableTop = doc.y;
  const col1 = 54;
  const col2 = 240;
  const rowH = 22;
  rows.forEach(([k, v], i) => {
    const y = tableTop + i * rowH;
    doc.rect(col1, y, 486, rowH).stroke();
    doc.fontSize(9).text(pdfSafeText(k), col1 + 6, y + 6, { width: 170 });
    doc.text(pdfSafeText(v), col2, y + 6, { width: 290 });
  });
  doc.y = tableTop + rows.length * rowH + 14;

  doc
    .fontSize(10)
    .text(
      pdfSafeText(
        `Please complete the renewal formalities on or before ${dmy(args.notice.lastDateToRenew ?? args.agreement.toDate)}.`,
      ),
    );
  doc.moveDown();
  doc.font("Helvetica-Bold").text(pdfSafeText("Penalty clause:"));
  doc
    .font("Helvetica")
    .text(
      pdfSafeText(
        `Clause ${args.agreement.penaltyClauseRef || "[NO.]"} will be invoked for delay or non-renewal${
          args.agreement.penaltyMethod ? ` (${args.agreement.penaltyMethod})` : ""
        }.`,
      ),
    );
  doc.moveDown(2);
  doc.text(pdfSafeText("Yours faithfully,"), { align: "right" });
  doc.moveDown(2);
  doc.text(pdfSafeText("[Name and designation of the official]"), { align: "right" });
  doc.moveDown(2);
  doc
    .fontSize(8)
    .fillColor("#555")
    .text(
      pdfSafeText(
        "Notice date is filled in automatically when the notice is generated. Each print or reprint is stored as a separate dated record with a PDF copy; dispatch is recorded separately.",
      ),
      { align: "left" },
    );

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", () => resolve()));
  return Buffer.concat(chunks);
}
