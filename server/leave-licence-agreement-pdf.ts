/**
 * Leave and Licence Agreement PDF — APMC Format 1 (Stall & Godowns) / Format 2 (Office).
 * Page 1: A4 (stamp paper). Remaining pages: Legal size.
 */
import type { LeaveLicenceSnapshot } from "@shared/leave-licence-agreement";
import {
  formatRsFigure,
  ymdToDmy,
  ymdToLongForm,
  ymdToLongShort,
} from "@shared/leave-licence-agreement";
import { formatInrAmountWordsLine } from "./inr-amount-words";
import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { pdfSafeText } from "./pdf-safe-text";

/** PDFKit LEGAL = 8.5 x 14 in (US Legal). */
const PAGE1_SIZE = "A4" as const;
const CONT_SIZE = "LEGAL" as const;
const MARGIN = { top: 54, bottom: 78, left: 54, right: 54 };
/** ~11.5 cm blank for stamp / franking on page 1 (A4). 11.5 cm ≈ 326 pt. */
const STAMP_CONTENT_TOP = 326;

function wordsOnly(amount: number): string {
  return formatInrAmountWordsLine(amount);
}

function yardShort(name: string): string {
  return String(name ?? "").replace(/\s*Market Yard\s*$/i, "").trim() || name || "________";
}

function floorLabel(location: string): string {
  const loc = String(location ?? "").trim();
  if (!loc) return "________ floor";
  if (/floor|storey|storeyed/i.test(loc)) return loc;
  // "Ground" / "First" / "Basement" → "Ground floor" (template: "on the ___ floor of the building")
  return `${loc} floor`;
}

/** Single-premises recital phrase (Format 1 / Format 2 office templates). */
function premisesPhrase(snap: LeaveLicenceSnapshot): string {
  const isFormat1 = snap.agreementFormat !== "Format2";
  if (snap.premises.length !== 1) {
    return `the Licensor's premises ('the Premises'), being the ${snap.premises.length} premises described below, situated in the Market Yard`;
  }
  const p = snap.premises[0];
  const area = p.areaSqm > 0 ? `${p.areaSqm.toFixed(2)} sq. meters` : "____ sq. meters";
  const no = p.premisesId || "____";
  const floor = floorLabel(p.location);
  if (isFormat1) {
    return (
      `the Licensor's premises ('the Premises') admeasuring ${area}, bearing number ${no}, ` +
      `on the ${floor} of the building, situated in the Market Yard`
    );
  }
  const kind = p.assetType || "office";
  return (
    `the Licensor's premises ('the Premises') admeasuring ${area}, consisting of ${kind}, ` +
    `bearing number ${no}, on the ${floor} of the building, situated in the Market Yard`
  );
}

const gstExclusiveSentence =
  "The compensation is exclusive of GST, which shall be payable in addition at the rate then in force.";

const depositMaintenanceTail = (depositMonths: number) =>
  `The security deposit shall be maintained at ${depositMonths} months' compensation. If the ` +
  `compensation is revised during the currency of this Agreement, the security deposit shall stand revised ` +
  `accordingly, the Licensee shall pay the additional (differential) security deposit to the Licensor on a ` +
  `separate receipt, and the original deposit and the additional deposit, each with its receipt reference, ` +
  `shall be recorded in an addendum to this Agreement and together form the security deposit for all purposes ` +
  `of this clause. The security deposit shall be liable to be adjusted or forfeited against any dues of the ` +
  `Licensee, including arrears of compensation, damages and costs, on the Licensee vacating the Premises or on ` +
  `eviction, including for non-payment of compensation as provided in the clause on default above. The security ` +
  `deposit shall, after adjusting all the dues of the Licensee under this Agreement, and all costs incurred, be ` +
  `returned to the Licensee only after the Licensee peacefully vacates the Premises and removes all his goods etc therefrom.`;

function depositClause(snap: LeaveLicenceSnapshot): string {
  const total = snap.totalDeposit || snap.requiredDeposit;
  const months = snap.depositMonths || 3;
  const receipts = snap.depositReceipts ?? [];
  const original = receipts.find((r) => r.kind === "Original");
  const differential = receipts.find((r) => r.kind === "Differential");
  const receiptBit = (r: { receiptNo?: string; receiptDate?: string } | undefined) =>
    r?.receiptNo
      ? ` vide Receipt No. ${r.receiptNo}${r.receiptDate ? ` dated ${ymdToDmy(r.receiptDate)}` : ""}`
      : "";

  if (differential && differential.amount > 0 && original) {
    const priorRent =
      snap.previousMonthlyRent != null ? formatRsFigure(snap.previousMonthlyRent) : "the previous rate";
    return (
      `The Licensee has deposited with the Licensor, a sum of ${formatRsFigure(total)} (${wordsOnly(total)}), ` +
      `being ${months} months' compensation, as security deposit for compliance with the terms of this Agreement, ` +
      `made up of (i) ${formatRsFigure(original.amount)} (${wordsOnly(original.amount)})` +
      `${receiptBit(original)}, being the original security deposit, and (ii) ` +
      `${formatRsFigure(differential.amount)} (${wordsOnly(differential.amount)})` +
      `${receiptBit(differential)}, being the differential on revision of monthly compensation from ${priorRent} ` +
      `to ${formatRsFigure(snap.totalRent)}. This security deposit shall be interest free. ` +
      depositMaintenanceTail(months)
    );
  }
  return (
    `The Licensee has deposited with the Licensor, a sum of ${formatRsFigure(total)} (${wordsOnly(total)}), ` +
    `being ${months} months' compensation, as security deposit for compliance with the terms of this Agreement` +
    `${receiptBit(original)}. This security deposit shall be interest free. ` +
    depositMaintenanceTail(months)
  );
}

/** Official APMC damages formula (Format 1 cl.9 / Format 2 cl.8). */
function damagesClauseBody(args: {
  vacateClauseNo: number;
  rentClauseNo: number;
  multi: boolean;
}): string {
  const perPremises = args.multi
    ? `for each of the Premises not so vacated, a sum per day equal to twice the monthly compensation payable for that premises (as set out in clause ${args.rentClauseNo}), `
    : `a sum per day equal to twice the monthly compensation payable for the Premises, `;
  return (
    `In the event, the Licensee fails to comply with clause ${args.vacateClauseNo} above, the Licensee shall pay to the Licensor, ` +
    `${perPremises}` +
    `divided by the number of days in the calendar month in which that day falls, rounded off to the next rupee, ` +
    `for every day that he fails to vacate the Premises or remove his goods therefrom. This amount is agreed upon as ` +
    `a reasonable sum of damages for the unauthorised use of the Premises beyond its expiry/termination. ` +
    `This daily quantum of damages shall, if not paid on day to day basis, shall be recovered by the Licensor from the ` +
    `Licensee with interest thereon at 15% per annum (simple interest).`
  );
}

export async function buildLeaveLicenceAgreementPdf(args: {
  snapshot: LeaveLicenceSnapshot;
  versionNo: number;
  mode: "Draft" | "Final";
}): Promise<{ buffer: Buffer; pageCount: number }> {
  const snap = args.snapshot;
  const isFormat1 = snap.agreementFormat !== "Format2";
  const PDFDocument = await loadPdfDocumentConstructor();
  // Default size LEGAL so any automatic overflow continues on Legal, not A4.
  const doc = new PDFDocument({
    size: CONT_SIZE,
    margins: MARGIN,
    autoFirstPage: false,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  let pageNo = 0;
  let contentBottom = 0;
  let onStampPage = false;
  let ignorePageAdded = false;

  const drawFooter = () => {
    // Paint in the bottom margin band without LineWrapper spawning pages
    // (absolute y below margins.bottom otherwise inherits A4 and adds blank pages).
    const bottom = doc.page.height - 52;
    const savedX = doc.x;
    const savedY = doc.y;
    const prevBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    doc.font("Helvetica").fontSize(8).fillColor("#333333");
    const fmt = isFormat1 ? "Format 1" : "Format 2";
    const fw = doc.page.width - MARGIN.left - MARGIN.right;
    doc.text(
      pdfSafeText(
        `${fmt}  |  Allotment Ref. ${snap.allotmentRef}  |  Version ${args.versionNo}  |  Page ${pageNo}`,
      ),
      MARGIN.left,
      bottom,
      { width: fw, align: "left", lineBreak: false },
    );
    doc.text(pdfSafeText("Initials:  Licensor ________   Licensee ________"), MARGIN.left, bottom + 12, {
      width: fw,
      align: "left",
      lineBreak: false,
    });
    if (args.mode === "Draft") {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#cc0000");
      doc.text(pdfSafeText("DRAFT - NOT FOR EXECUTION"), MARGIN.left, bottom + 24, {
        width: fw,
        align: "left",
        lineBreak: false,
      });
    }
    doc.restore();
    doc.page.margins.bottom = prevBottomMargin;
    doc.x = savedX;
    doc.y = savedY;
  };

  const watermark = () => {
    if (args.mode !== "Draft") return;
    doc.save();
    doc.fillOpacity(0.16);
    doc.fillColor("#999999");
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("Helvetica-Bold").fontSize(64);
    doc.text("DRAFT", 80, doc.page.height / 2 - 40, {
      width: doc.page.width - 160,
      align: "center",
    });
    doc.restore();
  };

  const addPage1 = () => {
    ignorePageAdded = true;
    doc.addPage({ size: PAGE1_SIZE, margins: MARGIN });
    ignorePageAdded = false;
    pageNo = 1;
    onStampPage = true;
    contentBottom = doc.page.height - MARGIN.bottom - 44;
    watermark();
    doc.font("Helvetica").fontSize(8).fillColor("#666666");
    doc.text(
      pdfSafeText("Space above this line is left for the stamp paper / franking (A4 stamp paper)."),
      MARGIN.left,
      STAMP_CONTENT_TOP - 28,
      { width: doc.page.width - MARGIN.left - MARGIN.right, align: "center" },
    );
    doc.fillColor("#000000");
    doc.y = STAMP_CONTENT_TOP;
  };

  const addLegalPage = () => {
    ignorePageAdded = true;
    doc.addPage({ size: CONT_SIZE, margins: MARGIN });
    ignorePageAdded = false;
    pageNo += 1;
    onStampPage = false;
    contentBottom = doc.page.height - MARGIN.bottom - 44;
    watermark();
    doc.y = MARGIN.top;
  };

  // Auto-continued pages inherit last addPage size. If overflow still lands on A4
  // (stamp page), immediately open a Legal page for following content.
  doc.on("pageAdded", () => {
    if (ignorePageAdded) return;
    const spilledFromStamp = onStampPage;
    pageNo += 1;
    onStampPage = false;
    contentBottom = doc.page.height - MARGIN.bottom - 44;
    watermark();
    if (spilledFromStamp && Math.abs(doc.page.width - 595.28) < 2) {
      drawFooter();
      addLegalPage();
    }
  });

  const ensureSpace = (needed: number) => {
    if (doc.y + needed <= contentBottom) return;
    drawFooter();
    addLegalPage();
  };

  const contentWidth = () => doc.page.width - MARGIN.left - MARGIN.right;

  const body = (text: string, opts?: { bold?: boolean; indent?: number; gap?: number }) => {
    const fontSize = 10;
    const indent = opts?.indent ?? 0;
    const width = contentWidth() - indent;
    doc.font(opts?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const h = doc.heightOfString(pdfSafeText(text), { width, align: "justify", lineGap: 2 });
    ensureSpace(h + 10);
    doc
      .font(opts?.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(fontSize)
      .fillColor("#000000")
      .text(pdfSafeText(text), MARGIN.left + indent, doc.y, {
        width,
        align: "justify",
        lineGap: 2,
      });
    doc.moveDown(opts?.gap ?? 0.45);
  };

  const centred = (text: string, opts?: { bold?: boolean; size?: number }) => {
    ensureSpace(20);
    doc
      .font(opts?.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(opts?.size ?? 10)
      .fillColor("#000000")
      .text(pdfSafeText(text), MARGIN.left, doc.y, { width: contentWidth(), align: "center" });
    doc.moveDown(0.4);
  };

  /** Simple bordered table for multi-premises blocks. */
  const simpleTable = (headers: string[], rows: string[][], colWeights: number[]) => {
    const width = contentWidth();
    const weights = colWeights.length ? colWeights : headers.map(() => 1);
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const colWs = weights.map((w) => (w / sum) * width);
    const rowH = 18;
    const headerH = 20;
    ensureSpace(headerH + rows.length * rowH + 12);
    let x0 = MARGIN.left;
    let y0 = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
    let x = x0;
    for (let i = 0; i < headers.length; i++) {
      doc.rect(x, y0, colWs[i], headerH).stroke("#333333");
      doc.text(pdfSafeText(headers[i]), x + 3, y0 + 5, {
        width: colWs[i] - 6,
        align: "left",
        lineBreak: false,
      });
      x += colWs[i];
    }
    y0 += headerH;
    doc.font("Helvetica").fontSize(8);
    for (const row of rows) {
      x = x0;
      for (let i = 0; i < headers.length; i++) {
        doc.rect(x, y0, colWs[i], rowH).stroke("#333333");
        doc.text(pdfSafeText(row[i] ?? ""), x + 3, y0 + 4, {
          width: colWs[i] - 6,
          align: "left",
          lineBreak: false,
        });
        x += colWs[i];
      }
      y0 += rowH;
    }
    doc.x = MARGIN.left;
    doc.y = y0 + 8;
  };

  const purpose = snap.purposeOfUse?.trim() || (isFormat1 ? "notified commodities/Agricultural input" : "office/Commercial purpose");
  const place = snap.placeOfExecution?.trim() || "Margao";
  const yard = yardShort(snap.yardName);
  const term = snap.termMonths;
  const startLong = ymdToLongShort(snap.startDate);
  const endLong = ymdToLongShort(snap.endDate);
  const rentFig = formatRsFigure(snap.totalRent);
  const rentWords = wordsOnly(snap.totalRent);
  const interest = snap.interestRateText || "15% p.a.";
  const dueDay = snap.rentDueDay || 10;
  const defaultMonths = snap.continuousMonthsForTermination || 3;
  const noticeDays = snap.noticeDays || 10;
  const regNo = snap.licenceOrEntityNo?.trim() || "________";

  // Page 1 A4 stamp paper: fill below stamp blank; ensureSpace switches to Legal when full.
  addPage1();
  centred("LEAVE AND LICENCE AGREEMENT", { bold: true, size: 13 });
  body(`THIS LICENCE AGREEMENT is entered into at ${place}, on the ${ymdToLongForm(snap.agreementDate)}.`);
  centred("BETWEEN: -", { bold: true });
  body(snap.licensorClause || "[Licensor clause]");
  centred("AND", { bold: true });
  body(snap.licenseeClause || "[Licensee clause]");
  body("WHEREAS", { bold: true, gap: 0.3 });
  body(
    `The Licensor has constructed a market yard at ${yard}, (hereinafter referred to as "the Market Yard") ` +
      `with the view to implement the provisions of the said Act in consonance with the objectives for which ` +
      `the Licensor has been established;`,
  );
  if (isFormat1) {
    body(
      `The Licensee holds valid registration No. ${regNo} issued under section 53 of the said Act, ` +
        `to operate in the Market Yard as a Trader ('the Registration');`,
    );
    body(
      `The Licensee has approached the Licensor, for permission to use ${premisesPhrase(snap)}, ` +
        `for the purpose of such operation as a Trader;`,
    );
  } else {
    body(
      `The Licensee has approached the Licensor, for permission to use ${premisesPhrase(snap)}, ` +
        `for the purpose of such operation as a office/Commercial purpose viz ${purpose};`,
    );
  }
  if (snap.premises.length > 1) {
    simpleTable(
      ["No.", "Premises", "Floor", "Area (sq. m)"],
      snap.premises.map((p, i) => [
        String(i + 1),
        p.premisesId || p.assetType || "____",
        p.location || "____",
        p.areaSqm > 0 ? p.areaSqm.toFixed(2) : "____",
      ]),
      [0.8, 2.2, 2, 1.5],
    );
  }
  if (snap.basis === "Renewal" && (snap.previousToDate || snap.previousFromDate || snap.previousAgreementDate)) {
    const priorDated = snap.previousAgreementDate
      ? `dated ${ymdToLongShort(snap.previousAgreementDate)} `
      : "";
    body(
      `The Licensee was earlier permitted to use the Premises under a Leave and Licence Agreement ${priorDated}` +
        `for the period ${ymdToLongShort(snap.previousFromDate)} ` +
        `to ${ymdToLongShort(snap.previousToDate)} ("the Previous Agreement"), and the Licensee has requested ` +
        `that the permission be renewed;`,
    );
  }
  body(
    `The Licensor has agreed to grant such permission on leave and license basis, personally to the Licensee ` +
      `for the user mentioned above, for the period and on the terms and conditions set out below, which the ` +
      `Licensee has expressly agreed to.`,
  );
  body("NOW THEREFORE THIS AGREEMENT WITNESSES AS FOLLOWS: -", { bold: true });

  if (isFormat1) {
    body(
      `1. That the Licensor does hereby grants permission to the Licensee on leave and license basis ` +
        `('the Permission'), to conduct in the Premises, his operations as a trader under the Registration, ` +
        `solely for the purpose of ${purpose} only.`,
    );
    body(
      `2. Subject to earlier determination as provided in this Agreement, the period of the permission is for ` +
        `an initial period of ${term} months i.e. commencing from ${startLong} and ending on ${endLong}. ` +
        `The licensee should vacate the premises: -`,
    );
    body(
      `(a) Within seven days on ceasing the Registration holder as required under Section 53 of the said Act.`,
      { indent: 16 },
    );
    body(
      `(b) Within 7 days after expiry period of this leave and licence agreement i.e. ${endLong}, if not renewed for further period.`,
      { indent: 16 },
    );
    body(
      `(c) By giving one month's advance notice or one month's rent in lieu thereof, if licensee intends to vacate the premises during the currency of this agreement.`,
      { indent: 16 },
    );
    body(
      `(d) The license may be granted afresh by the Licensor after expiry of the aforesaid period at the option of the Licensor on such terms and conditions as licensor may deem fit by increasing the rent as deem fit.`,
      { indent: 16 },
    );
    body(
      `3. That the Permission granted is specifically and exclusively for carrying on the operations under the Registration as trader, for the purpose of ${purpose} only and the Licensee agrees not to use the Premises otherwise than for the aforesaid purpose.`,
    );
    body(
      `4. In the event however, the Licensee desires to use the Premises for any other purpose within the scope of the Registration, the Licensee has to apply in writing to the Licensor for such changed purpose, and the Licensee shall not change the purpose, unless he obtains a written permission from the Licensor for such change.`,
    );
    body(
      `5. It is also made clear that in the event, the Registration is cancelled/suspended, then the Permission shall automatically lapse/come to an end or stand determined, notwithstanding that the period of the permission set out in clause 1 above, has not expired.`,
    );
    if (snap.premises.length > 1) {
      body(
        `6. That the Licensee shall pay to the Licensor, compensation for the Premises, premises-wise, as set out below, ` +
          `which shall be payable on or before the ${dueDay}th of every succeeding month, failing which the interest @ ${interest} ` +
          `shall be charged on the defaulted amount for the defaulted period. ${gstExclusiveSentence}`,
      );
      simpleTable(
        ["No.", "Premises", "Compensation per month (Rs.)"],
        [
          ...snap.premises.map((p, i) => [
            String(i + 1),
            p.premisesId || p.assetType || "____",
            formatRsFigure(p.monthlyRent),
          ]),
          ["", "Total per month", rentFig],
        ],
        [0.8, 2.5, 2.2],
      );
    } else {
      body(
        `6. That the Licensee shall pay to the Licensor, compensation of ${rentFig} (${rentWords}) per month, ` +
          `which shall be payable on or before the ${dueDay}th of every succeeding month, failing which the interest @ ${interest} ` +
          `shall be charged on the defaulted amount for the defaulted period. ${gstExclusiveSentence}`,
      );
    }
    body(
      `7. In the event however, the Licensee defaults in making payment of monthly compensation as set out in clause 6 above, ` +
        `for more than ${defaultMonths} months, the permission shall stand terminated upon expiry of ${noticeDays} days notice, ` +
        `unless the arrears are paid before expiry of the notice period. Provided that the benefit of such ${noticeDays} days notice ` +
        `shall be availed of by the Licensee only for the first default during the period of the permission. Any further default ` +
        `shall result in automatic termination of the license/permission i.e. without notice.`,
    );
    body(
      `8. The Licensee shall, on expiry of the license/permission, or its earlier termination or lapsing or determination, ` +
        `forthwith vacate the Premises, stop conducting any operations in the Market Yard and remove all his goods etc from the Premises.`,
    );
    body(`9. ${damagesClauseBody({ vacateClauseNo: 8, rentClauseNo: 6, multi: snap.premises.length > 1 })}`);
    body(
      `10. Notwithstanding the liability of the Licensee to pay the daily quantum of agreed damages under clause 9 above, ` +
        `the Licensor, shall be entitled to open the Premises, and remove all the goods etc of the licensee therefrom, and ` +
        `to prevent the Licensee from entering the Premises or the Market Yard.`,
    );
    body(
      `11. Further, the Licensor shall be entitled to sell and dispose off the goods so removed from the Premises, if the ` +
        `Licensee does not claim such goods from the Licensor, within 15 days of such removal. The amount received on such sale, ` +
        `shall after deducting all expenses for storage and sale of the goods, and also after deducting any amount payable by ` +
        `the Licensee to the Licensor under this Agreement, shall be returned to the Licensee, without interest.`,
    );
    if (snap.premises.length > 1) {
      const total = snap.totalDeposit || snap.requiredDeposit;
      body(
        `12. The Licensee has deposited with the Licensor, a total sum of ${formatRsFigure(total)} (${wordsOnly(total)}) ` +
          `as security deposit for compliance with the terms of this Agreement, being ${snap.depositMonths} months' compensation ` +
          `of each of the Premises, as set out below. This security deposit shall be interest free.`,
      );
      simpleTable(
        ["No.", "Premises", "Compensation / month", "Months", "Security deposit"],
        [
          ...snap.premises.map((p, i) => [
            String(i + 1),
            p.premisesId || p.assetType || "____",
            formatRsFigure(p.monthlyRent),
            String(snap.depositMonths),
            formatRsFigure(p.depositShare || p.monthlyRent * snap.depositMonths),
          ]),
          ["", "Total", rentFig, "", formatRsFigure(total)],
        ],
        [0.6, 1.6, 1.6, 0.8, 1.6],
      );
      body(depositMaintenanceTail(snap.depositMonths || 3));
    } else {
      body(`12. ${depositClause(snap)}`);
    }
    body(
      `13. In addition to the compensation for the license/permission, the Licensee shall also pay the electricity & water ` +
        `charges for user of the Premises as also the municipal house tax and any other tax, rate, cess or charge that may be ` +
        `imposed by any authority. The payments of the electricity, water charges, house tax or any other tax, rate, cess or ` +
        `charge, shall be paid by the Licensee to the Licensor, within 7 days of receipt of the Licensor presenting to the ` +
        `Licensee, with the respective bills from the concerned authorities. Any delayed payment of such bills, will result in ` +
        `the Licensee having to pay interest thereon at 15% per annum (simple interest). Non-payment of any two bills ` +
        `within the said period after presentation, shall result in termination of the permission/license.`,
    );
    body(`14. In addition to the above, the Licensee covenants with the Licensor: -`);
  } else {
    body(
      `1. That the Licensor does hereby grants permission to the Licensee on leave and license basis ('the Permission'), ` +
        `to conduct in the Premises, solely for the purpose of office/Commercial purpose viz ${purpose}.`,
    );
    body(
      `2. Subject to earlier determination as provided in this Agreement, the period of the permission is for an initial ` +
        `period of ${term} months i.e. commencing from ${startLong} and ending on ${endLong}. The Licensee should vacate the premises: -`,
    );
    body(
      `(a) Within 7 days after expiry period of this Leave and Licence Agreement i.e. ${endLong}, if not renewed for further period.`,
      { indent: 16 },
    );
    body(
      `(b) By giving one month's advance notice or one month's rent in lieu thereof, if Licensee intends to vacate the premises during the currency of this agreement.`,
      { indent: 16 },
    );
    body(
      `(c) The License may be granted afresh by the Licensor after expiry of the aforesaid period at the option of the Licensor on such terms and conditions as licensor may deem fit by increasing the rent as deem fit.`,
      { indent: 16 },
    );
    body(
      `3. That the Permission granted is specifically and exclusively for the purpose of office/Commercial purpose viz ${purpose} only and the Licensee agrees not to use the Premises otherwise than for the aforesaid purpose.`,
    );
    body(
      `4. In the event however, the Licensee desires to use the Premises for any other purpose the licensee has to apply in writing to the Licensor for such changed purpose, and the Licensee shall not change the purpose, unless he obtains a written permission from the Licensor for such change.`,
    );
    if (snap.premises.length > 1) {
      body(
        `5. That the Licensee shall pay to the Licensor, compensation for the Premises, premises-wise, as set out below, which shall be ` +
          `payable on or before the ${dueDay}th of every succeeding month, failing which the interest @ ${interest} shall be charged ` +
          `on the defaulted amount for the defaulted period. ${gstExclusiveSentence}`,
      );
      simpleTable(
        ["No.", "Premises", "Compensation per month (Rs.)"],
        [
          ...snap.premises.map((p, i) => [
            String(i + 1),
            p.premisesId || p.assetType || "____",
            formatRsFigure(p.monthlyRent),
          ]),
          ["", "Total per month", rentFig],
        ],
        [0.8, 2.5, 2.2],
      );
    } else {
      body(
        `5. That the Licensee shall pay to the Licensor, compensation of ${rentFig} (${rentWords}) per month, which shall be ` +
          `payable on or before the ${dueDay}th of every succeeding month, failing which the interest @ ${interest} shall be charged ` +
          `on the defaulted amount for the defaulted period. ${gstExclusiveSentence}`,
      );
    }
    body(
      `6. In the event however, the Licensee defaults in making payment of monthly compensation as set out in clause 5 above, ` +
        `for more than ${defaultMonths} months, the permission shall stand terminated upon expiry of ${noticeDays} days notice, unless ` +
        `the arrears are paid before expiry of the notice period. Provided that the benefit of such ${noticeDays} days notice shall be ` +
        `availed of by the Licensee only for the first default during the period of the permission. Any further default shall ` +
        `result in automatic termination of the license/permission i.e. without notice.`,
    );
    body(
      `7. The Licensee shall, on expiry of the license/permission, or its earlier termination or lapsing or determination, ` +
        `forthwith vacate the Premises, stop conducting any operations in the premises and remove all his goods etc from the Premises.`,
    );
    body(`8. ${damagesClauseBody({ vacateClauseNo: 7, rentClauseNo: 5, multi: snap.premises.length > 1 })}`);
    body(
      `9. Notwithstanding the liability of the Licensee to pay the daily quantum of agreed damages under clause 8 above, ` +
        `the Licensor, shall be entitled to open the Premises, and remove all the goods etc of the licensee therefrom, and ` +
        `to prevent the Licensee from entering the Premises or the Market Yard.`,
    );
    body(
      `10. Further, the Licensor shall be entitled to sell and dispose off the goods so removed from the Premises, if the ` +
        `Licensee does not claim such goods from the Licensor, within 15 days of such removal. The amount received on such sale, ` +
        `shall after deducting all expenses for storage and sale of the goods, and also after deducting any amount payable by ` +
        `the Licensee to the Licensor under this Agreement, shall be returned to the Licensee, without interest.`,
    );
    if (snap.premises.length > 1) {
      const total = snap.totalDeposit || snap.requiredDeposit;
      body(
        `11. The Licensee has deposited with the Licensor, a total sum of ${formatRsFigure(total)} (${wordsOnly(total)}) ` +
          `as security deposit for compliance with the terms of this Agreement, being ${snap.depositMonths} months' compensation ` +
          `of each of the Premises, as set out below. This security deposit shall be interest free.`,
      );
      simpleTable(
        ["No.", "Premises", "Compensation / month", "Months", "Security deposit"],
        [
          ...snap.premises.map((p, i) => [
            String(i + 1),
            p.premisesId || p.assetType || "____",
            formatRsFigure(p.monthlyRent),
            String(snap.depositMonths),
            formatRsFigure(p.depositShare || p.monthlyRent * snap.depositMonths),
          ]),
          ["", "Total", rentFig, "", formatRsFigure(total)],
        ],
        [0.6, 1.6, 1.6, 0.8, 1.6],
      );
      body(depositMaintenanceTail(snap.depositMonths || 3));
    } else {
      body(`11. ${depositClause(snap)}`);
    }
    body(
      `12. In addition to the compensation for the license/permission, the Licensee shall also pay the electricity & water ` +
        `charges for user of the Premises as also the municipal/panchayat house tax and any other tax, rate, cess or charge that ` +
        `may be imposed by any authority. The payments of the electricity, water charges, house tax or any other tax, rate, cess ` +
        `or charge, shall be paid by the Licensee to the Licensor, within 7 days of receipt of the Licensor presenting to the ` +
        `Licensee, with the respective bills from the concerned authorities. Any delayed payment of such bills, will result in ` +
        `the Licensee having to pay interest thereon at 15% per annum (simple interest). Non-payment of any two bills ` +
        `within the said period after presentation, shall result in termination of the permission/license.`,
    );
    body(`13. In addition to the above, the Licensee covenants with the Licensor: -`);
  }

  const covenants = [
    "(a) To keep and maintain the Premises in clean, proper and decent condition and not to cause any damage to the Premises or any part or fittings thereof.",
    "(b) Not to make any alteration in/to the Premises or any part thereof, except with the prior written permission of the Licensor. No major alteration shall be permitted, and any minor alteration, if permitted, shall ensure, free of cost, for the benefit of the Premises.",
    "(c) To keep the Premises in good repair, duly painted or white washed every year.",
    "(d) Not to place sign boards otherwise than in accordance with and after obtaining prior written approval of its specifications.",
    "(e) To comply with the provisions of the said Act, the rules and bye-laws made thereunder as may be amended from time to time.",
    "(f) Not to allow any third person to use or occupy the Premises or any part thereof.",
    "(g) To comply with the terms of this license and all or any directions or instructions that may be issued by the Licensor from time to time.",
    "(h) Not to keep the Premises closed or vacant for a continuous period of seven days without proper justification. In case, the Licensee desires to do so, he shall issue a prior written intimation to the Licensor of the same with the justification thereof.",
    "(i) Not to cause any nuisance or health hazard, not to dirty the surroundings, and not to keep in or anywhere around the Premises, any contraband articles, narcotics, petroleum products or inflammable or hazardous or illegal products etc.",
  ];
  for (const c of covenants) body(c, { indent: 12 });

  if (isFormat1) {
    body(
      `15. The Licensee shall be responsible or accountable for the safety and security of his goods etc in the Premises, ` +
        `and the Licensor, shall not in any manner be responsible for the same. The removal of the goods etc of the Licensee ` +
        `from the Premises under clause 10 above shall also be at the risk and cost of the licensee.`,
    );
    body(
      `16. Possession of the Premises shall always remain with the Licensor, and the Licensee shall not claim any right ` +
        `whatsoever thereto and the user of the Premises under the permission/license, shall not derogate from this essential ` +
        `condition of this Agreement. Pursuant to this, the Licensor, its officers, agents or servants are entitled to enter ` +
        `into or remain in the Premises, without any notice to the Licensee and are further entitled to ensure that the terms ` +
        `of this Agreement are strictly adhered to by the Licensee.`,
    );
    body(
      `17. Breach of any of the conditions or covenants stipulated herein, shall result in termination of this Agreement ` +
        `on expiry of ${noticeDays} days notice from the Licensor to this effect. Upon such termination, the consequences set out ` +
        `in clauses 8 to 12 above shall follow.`,
    );
    body(
      `18. The Licensee shall indemnify the Licensor against any third party claims that may arise from the Licensee's user of the Premises.`,
    );
    body(
      `19. Either party may terminate this Agreement, by giving one month notice to the other side. On expiry of such notice, ` +
        `the Agreement along with the license shall terminate, and the consequences set out in clauses 8 to 12 above shall follow.`,
    );
  } else {
    body(
      `14. The Licensee shall be responsible or accountable for the safety and security of his goods etc in the Premises, ` +
        `and the Licensor, shall not in any manner be responsible for the same. The removal of the goods etc of the Licensee ` +
        `from the Premises under clause 9 above shall also be at the risk and cost of the licensee.`,
    );
    body(
      `15. Possession of the Premises shall always remain with the Licensor, and the Licensee shall not claim any right ` +
        `whatsoever thereto and the user of the Premises under the permission/license, shall not derogate from this essential ` +
        `condition of this Agreement. Pursuant to this, the Licensor, its officers, agents or servants are entitled to enter ` +
        `into or remain in the Premises, without any notice to the Licensee and are further entitled to ensure that the terms ` +
        `of this Agreement are strictly adhered to by the Licensee.`,
    );
    body(
      `16. Breach of any of the conditions or covenants stipulated herein, shall result in termination of this Agreement ` +
        `on expiry of ${noticeDays} days' notice from the Licensor to this effect. Upon such termination, the consequences set out ` +
        `in clauses 7 to 11 above shall follow.`,
    );
    body(
      `17. The Licensee shall indemnify the Licensor against any third party claims that may arise from the Licensee's user of the Premises.`,
    );
    body(
      `18. Either party may terminate this Agreement, by giving one month notice to the other side. On expiry of such notice, ` +
        `the Agreement along with the license shall terminate, and the consequences set out in clauses 7 to 11 above shall follow.`,
    );
  }

  body(
    `IN WITNESS WHEREOF the Licensor and the Licensee have signed this Agreement on the date and at the place ` +
      `herein above first mentioned in the presence of two attesting witnesses.`,
  );
  doc.moveDown(1);
  ensureSpace(120);
  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("LICENSOR"));
  doc.font("Helvetica").fontSize(10);
  doc.text(
    pdfSafeText(
      `Represented by Secretary, ${snap.licensorSigningOfficer || "Shri. Kirtiraj K. Naik Gaonkar"} for Self and for and on behalf of Chairman`,
    ),
  );
  doc.moveDown(1.5);
  doc.text(pdfSafeText("______________________________"));
  doc.moveDown(1.2);
  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("LICENSEE"));
  doc.font("Helvetica").fontSize(9).text(pdfSafeText("Affix passport size photograph of Licensee"));
  doc.moveDown(0.3);
  doc.fontSize(10).text(pdfSafeText(snap.traderOrEntityName || "[Licensee]"));
  if (!snap.licenseeSignsInPerson && snap.representativeName) {
    doc.text(pdfSafeText(`represented by ${snap.representativeName}`));
  }
  doc.moveDown(1.5);
  doc.text(pdfSafeText("______________________________"));
  doc.moveDown(1.2);
  ensureSpace(100);
  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("WITNESSES:-"));
  doc.moveDown(0.6);
  const w1Name = snap.witness1Name?.trim() || "______________________";
  const w1Addr = snap.witness1Address?.trim() || "_______________________";
  const w2Name = snap.witness2Name?.trim() || "______________________";
  const w2Addr = snap.witness2Address?.trim() || "_______________________";
  doc.font("Helvetica").fontSize(10);
  doc.text(pdfSafeText(`1. Shri. ${w1Name}`));
  doc.text(pdfSafeText(`R/o. ${w1Addr}`));
  doc.moveDown(0.4);
  doc.text(pdfSafeText("Sign: ______________________________"));
  doc.moveDown(1);
  doc.text(pdfSafeText(`2. Shri. ${w2Name}`));
  doc.text(pdfSafeText(`R/o. ${w2Addr}`));
  doc.moveDown(0.4);
  doc.text(pdfSafeText("Sign: ______________________________"));
  drawFooter();

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  return { buffer: Buffer.concat(chunks), pageCount: pageNo };
}
