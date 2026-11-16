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

function wordsOnly(amount: number): string {
  return formatInrAmountWordsLine(amount);
}

function premisesDescription(snap: LeaveLicenceSnapshot): string {
  const parts = snap.premises.map((p) => {
    const bits = [
      p.assetType || "premises",
      p.areaSqm > 0 ? `admeasuring ${p.areaSqm.toFixed(2)} Sq. Metres` : null,
      p.premisesId ? `bearing number ${p.premisesId}` : null,
      p.location || null,
    ].filter(Boolean);
    return bits.join(", ");
  });
  if (parts.length === 1) return `a ${parts[0]} of the building situated in the Market Yard`;
  return `premises comprising ${parts.join("; ")} situated in the Market Yard`;
}

function depositClause(snap: LeaveLicenceSnapshot): string {
  const months = snap.depositMonths;
  const total = snap.totalDeposit || snap.requiredDeposit;
  const rent = snap.totalRent;
  const receipts = snap.depositReceipts ?? [];
  const original = receipts.find((r) => r.kind === "Original") ?? {
    kind: "Original" as const,
    receiptNo: "[receipt no.]",
    receiptDate: "",
    amount: snap.originalDepositHeld,
    particulars: "original security deposit",
  };
  const differential = receipts.find((r) => r.kind === "Differential");

  let madeUp = "";
  if (differential && differential.amount > 0) {
    const priorRent = snap.previousMonthlyRent != null ? formatRsFigure(snap.previousMonthlyRent) : "the previous rate";
    madeUp =
      ` made up of (i) ${formatRsFigure(original.amount)} (${wordsOnly(original.amount)}) ` +
      `vide Receipt No. ${original.receiptNo || "[receipt]"}` +
      `${original.receiptDate ? ` dated ${ymdToDmy(original.receiptDate)}` : ""}, being the original security deposit, ` +
      `and (ii) ${formatRsFigure(differential.amount)} (${wordsOnly(differential.amount)}) ` +
      `vide Receipt No. ${differential.receiptNo || "[receipt]"}` +
      `${differential.receiptDate ? ` dated ${ymdToDmy(differential.receiptDate)}` : ""}, being the differential ` +
      `amount collected on revision of the monthly compensation from ${priorRent} to ${formatRsFigure(rent)}. ` +
      `Both these receipts together constitute the security deposit under this Agreement.`;
  } else {
    madeUp =
      ` vide Receipt No. ${original.receiptNo || "[receipt]"}` +
      `${original.receiptDate ? ` dated ${ymdToDmy(original.receiptDate)}` : ""}.`;
  }

  return (
    `The Licensee has deposited with the Licensor, as security deposit, an aggregate ` +
    `sum of ${formatRsFigure(total)} (${wordsOnly(total)}), being ${months} months' compensation ` +
    `at ${formatRsFigure(rent)} per month,${madeUp} This security deposit shall be interest free and shall be ` +
    `held by the Licensor for compliance with the terms of this Agreement. If the monthly ` +
    `compensation is revised, whether on renewal or otherwise, the security deposit shall ` +
    `stand revised to ${months} months' compensation at the revised rate, and the Licensee shall pay ` +
    `the differential amount to the Licensor on demand against a separate receipt, which ` +
    `shall be read with the receipts mentioned above as part of the security deposit. On the ` +
    `Licensee vacating the Premises, or on termination of this Agreement or eviction of the ` +
    `Licensee under clause 6 or clause 16, the Licensor shall be entitled to adjust against, ` +
    `or forfeit from, the security deposit, comprising the original deposit and every ` +
    `differential amount paid, the compensation, Goods and Services Tax, interest, ` +
    `damages, charges and costs outstanding from the Licensee, and the Licensee shall pay ` +
    `any shortfall. The balance, if any, shall be returned to the Licensee, without interest, ` +
    `only after the Licensee peacefully vacates the Premises and removes all his goods etc. therefrom.`
  );
}

export async function buildLeaveLicenceAgreementPdf(args: {
  snapshot: LeaveLicenceSnapshot;
  versionNo: number;
  mode: "Draft" | "Final";
}): Promise<{ buffer: Buffer; pageCount: number }> {
  const snap = args.snapshot;
  const PDFDocument = await loadPdfDocumentConstructor();
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 72, bottom: 72, left: 54, right: 54 },
    autoFirstPage: false,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const totalPages = 8;
  let pageNo = 0;

  const drawFooter = () => {
    const bottom = doc.page.height - 48;
    doc.save();
    doc.font("Helvetica").fontSize(8).fillColor("#333333");
    doc.text(
      pdfSafeText(
        `Allotment Ref. ${snap.allotmentRef}  |  Version ${args.versionNo}  |  Page ${pageNo} of ${totalPages}`,
      ),
      54,
      bottom,
      { width: doc.page.width - 108, align: "left" },
    );
    doc.text(pdfSafeText("Initials:  Licensor ________   Licensee ________"), 54, bottom + 12, {
      width: doc.page.width - 108,
      align: "left",
    });
    if (args.mode === "Draft") {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#cc0000");
      doc.text(pdfSafeText("DRAFT - NOT FOR EXECUTION"), 54, bottom + 26, {
        width: doc.page.width - 108,
        align: "left",
      });
    }
    doc.restore();
  };

  const watermark = () => {
    if (args.mode !== "Draft") return;
    doc.save();
    doc.fillOpacity(0.18);
    doc.fillColor("#999999");
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("Helvetica-Bold").fontSize(64);
    doc.text("DRAFT", 80, doc.page.height / 2 - 40, {
      width: doc.page.width - 160,
      align: "center",
    });
    doc.restore();
  };

  const newPage = (opts?: { stampBlank?: boolean }) => {
    doc.addPage();
    pageNo += 1;
    watermark();
    if (opts?.stampBlank) {
      doc.y = 280;
      doc.font("Helvetica").fontSize(8).fillColor("#666666");
      doc.text(
        pdfSafeText("STAMP PAPER AREA: leave blank. Stamp and vendor details are on the paper."),
        54,
        250,
        { width: doc.page.width - 108, align: "center" },
      );
      doc.fillColor("#000000");
      doc.y = 290;
    } else {
      doc.y = 72;
    }
  };

  const body = (text: string, opts?: { bold?: boolean; indent?: number }) => {
    doc
      .font(opts?.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10)
      .fillColor("#000000")
      .text(pdfSafeText(text), {
        align: "justify",
        indent: opts?.indent ?? 0,
        lineGap: 2,
      });
    doc.moveDown(0.55);
  };

  const purpose = snap.purposeOfUse?.trim() || "[purpose of use]";
  const place = snap.placeOfExecution?.trim() || "Margao";
  const yard = snap.yardName?.trim() || "the Market Yard";
  const term = snap.termMonths;
  const startLong = ymdToLongShort(snap.startDate);
  const endLong = ymdToLongShort(snap.endDate);
  const rentFig = formatRsFigure(snap.totalRent);
  const rentWords = wordsOnly(snap.totalRent);
  const damagesFig = formatRsFigure(snap.damagesPerDay);
  const interest = snap.interestRateText || "15% per annum compounded on monthly basis";
  const dueDay = snap.rentDueDay || 10;
  const termMonths = snap.continuousMonthsForTermination || 3;
  const noticeDays = snap.noticeDays || 10;

  // Page 1 — title + parties (stamp blank top)
  newPage({ stampBlank: true });
  doc.font("Helvetica-Bold").fontSize(14).text(pdfSafeText("LEAVE AND LICENCE AGREEMENT"), {
    align: "center",
  });
  doc.moveDown(0.8);
  body(
    `THIS LICENCE AGREEMENT is entered into at ${place}, on the ${ymdToLongForm(snap.agreementDate)}.`,
  );
  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("BETWEEN"), { align: "center" });
  doc.moveDown(0.4);
  body(snap.licensorClause || "[Licensor clause]");
  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("AND"), { align: "center" });
  doc.moveDown(0.4);
  body(snap.licenseeClause || "[Licensee clause]");
  drawFooter();

  // Page 2 — WHEREAS + clauses 1-2
  newPage();
  body(
    `WHEREAS (A) the Licensor has constructed a market yard at ${yard.replace(/ Market Yard$/i, "")} (hereinafter ` +
      `referred to as "the Market Yard") with a view to implement the provisions of the said ` +
      `Act in consonance with the objectives for which the Licensor has been established;`,
  );
  body(
    `(B) the Licensee has approached the Licensor for permission to use the Licensor's ` +
      `premises ("the Premises"), ${premisesDescription(snap)}, for the purpose ` +
      `of such operation as a ${purpose};`,
  );
  if (snap.basis === "Renewal" && snap.previousAgreementDate) {
    body(
      `(C) the Licensee was earlier permitted to use the Premises under a Leave and Licence ` +
        `Agreement dated ${ymdToLongShort(snap.previousAgreementDate)} for the period ` +
        `${ymdToLongShort(snap.previousFromDate)} to ${ymdToLongShort(snap.previousToDate)} ` +
        `("the Previous Agreement"), and the Licensee has requested that the permission be renewed;`,
    );
    body(
      `(D) the Licensor has agreed to grant such permission on leave and licence basis, ` +
        `personally to the Licensee for the user mentioned above, for the period and on the ` +
        `terms and conditions set out below, which the Licensee has expressly agreed to.`,
    );
  } else {
    body(
      `(C) the Licensor has agreed to grant such permission on leave and licence basis, ` +
        `personally to the Licensee for the user mentioned above, for the period and on the ` +
        `terms and conditions set out below, which the Licensee has expressly agreed to.`,
    );
  }
  body("NOW THEREFORE THIS AGREEMENT WITNESSES AS FOLLOWS:-", { bold: true });
  body(
    `1. That the Licensor hereby grants permission to the Licensee on leave and licence ` +
      `basis ("the Permission"), to conduct in the Premises, solely for the purpose of ${purpose}.`,
  );
  body(
    `2. Subject to earlier determination as provided in this Agreement, the period of the ` +
      `permission is for an initial period of ${term} months, i.e. commencing from ${startLong} ` +
      `to ${endLong}. The Licensee shall vacate the Premises:`,
  );
  body(
    `(a) within 7 days after expiry of the period of this Leave and Licence Agreement, ` +
      `i.e. if not renewed for a further period;`,
    { indent: 18 },
  );
  body(
    `(b) by giving one month's advance notice or one month's rent in lieu thereof, if ` +
      `the Licensee intends to vacate the Premises during the currency of this Agreement.`,
    { indent: 18 },
  );
  body(
    `(c) The licence may be granted afresh by the Licensor after expiry of the ` +
      `aforesaid period, at the option of the Licensor, on such terms and conditions as ` +
      `the Licensor may deem fit, including an increase in the rent as the Licensor may deem fit.`,
    { indent: 18 },
  );
  drawFooter();

  // Page 3 — clauses 3-8 start
  newPage();
  body(
    `3. That the Permission granted is specifically and exclusively for the purpose of ` +
      `${purpose} only and the Licensee agrees not to use the Premises otherwise than for the aforesaid purpose.`,
  );
  body(
    `4. In the event however, the Licensee desires to use the Premises for any other ` +
      `purpose, the Licensee has to apply in writing to the Licensor for such changed ` +
      `purpose, and the Licensee shall not change the purpose, unless he obtains a written ` +
      `permission from the Licensor for such change.`,
  );
  body(
    `5. That the Licensee shall pay to the Licensor, compensation of ${rentFig} (${rentWords}) ` +
      `per month, exclusive of Goods and Services Tax, which shall be payable by the Licensee ` +
      `in addition at the rate applicable from time to time. The compensation shall be payable ` +
      `on or before the ${dueDay}th of every succeeding month, failing which interest @ ${interest} ` +
      `shall be charged on the defaulted amount for the defaulted period.`,
  );
  body(
    `6. In the event however, the Licensee defaults in making payment of monthly ` +
      `compensation as set out in clause 5 above, for a continuous period of ${termMonths} months, the ` +
      `permission shall stand terminated upon expiry of ${noticeDays} days notice from the Licensor to ` +
      `pay the outstanding compensation, unless the arrears are paid before expiry of the ` +
      `notice period. Provided that the benefit of such ${noticeDays} days notice shall be availed of by ` +
      `the Licensee only for the first default during the period of the permission. Any further ` +
      `default shall result in automatic termination of the licence/permission i.e. without ` +
      `notice. On such termination the Licensor shall be entitled to evict the Licensee from ` +
      `the Premises, and the consequences set out in clauses 7 to 11 shall follow, including ` +
      `the adjustment or forfeiture of the security deposit as provided in clause 11.`,
  );
  body(
    `7. The Licensee shall, on expiry of the licence/permission, or its earlier termination or ` +
      `lapsing or determination, forthwith vacate the Premises, stop conducting any ` +
      `operations in the Premises and remove all his goods etc. from the Premises.`,
  );
  body(
    `8. In the event the Licensee fails to comply with clause 7 above, the Licensee shall ` +
      `pay to the Licensor, a sum of ${damagesFig} per day for every day that he fails to vacate ` +
      `the Premises or remove his goods therefrom. This amount is agreed upon as a ` +
      `reasonable sum of damages for the unauthorised use of the Premises beyond its ` +
      `expiry/termination. This daily quantum of damages shall, if not paid on day to day ` +
      `basis, be recovered by the Licensor from the Licensee with interest thereon at ${interest}.`,
  );
  drawFooter();

  // Page 4 — clauses 9-11 start
  newPage();
  body(
    `9. Notwithstanding the liability of the Licensee to pay the daily quantum of agreed ` +
      `damages under clause 8 above, the Licensor shall be entitled to open the Premises, ` +
      `and remove all the goods etc. of the Licensee therefrom, and to prevent the Licensee ` +
      `from entering the Premises or the Market Yard.`,
  );
  body(
    `10. Further, the Licensor shall be entitled to sell and dispose of the goods so removed ` +
      `from the Premises, if the Licensee does not claim such goods from the Licensor, ` +
      `within 15 days of such removal. The amount received on such sale, shall after ` +
      `deducting all expenses for storage and sale of the goods, and also after deducting any ` +
      `amount payable by the Licensee to the Licensor, under this Agreement, be returned to ` +
      `the Licensee, without interest.`,
  );
  body(`11. ${depositClause(snap)}`);
  drawFooter();

  // Page 5 — rest of 11 + 12-13
  newPage();
  body(
    `12. In addition to the compensation for the licence/permission, the Licensee shall also ` +
      `pay the electricity & water charges for user of the Premises as also the ` +
      `municipal/panchayat house tax and any other tax, rate, cess or charge that may be ` +
      `imposed by any authority. The payments of the electricity, water charges, house tax or ` +
      `any other tax, rate, cess or charge, shall be paid by the Licensee to the Licensor, ` +
      `within 7 days of receipt of the Licensor presenting to the Licensee, the respective bills ` +
      `from the concerned authorities. Any delayed payment of such bills, will result in the ` +
      `Licensee having to pay interest thereon at ${interest}. Non-payment of any two bills within ` +
      `the said period after presentation, shall result in termination of the permission/licence.`,
  );
  body(`13. In addition to the above, the Licensee covenants with the Licensor:-`);
  const covenants = [
    "(a) To keep and maintain the Premises in clean, proper and decent condition and not to cause any damage to the Premises or any part or fittings thereof.",
    "(b) Not to make any alteration in/to the Premises or any part thereof, except with the prior written permission of the Licensor. No major alteration shall be permitted, and any minor alteration, if permitted, shall ensure, free of cost, for the benefit of the Premises.",
    "(c) To keep the Premises in good repair, duly painted or white washed every year.",
    "(d) Not to place sign boards otherwise than in accordance with and after obtaining prior written approval of its specifications.",
    "(e) To comply with the provisions of the said Act, the rules and bye-laws made thereunder as may be amended from time to time.",
    "(f) Not to allow any third person to use or occupy the Premises or any part thereof.",
  ];
  for (const c of covenants) body(c, { indent: 12 });
  drawFooter();

  // Page 6 — 13g-i + 14-18
  newPage();
  body(
    "(g) To comply with the terms of this licence and all or any directions or instructions that may be issued by the Licensor from time to time.",
    { indent: 12 },
  );
  body(
    "(h) Not to keep the Premises closed or vacant for a continuous period of seven days without proper justification. In case the Licensee desires to do so, he shall issue a prior written intimation to the Licensor of the same with the justification thereof.",
    { indent: 12 },
  );
  body(
    "(i) Not to cause any nuisance or health hazard, not to dirty the surroundings, and not to keep in or anywhere around the Premises, any contraband articles, narcotics, petroleum products or inflammable or hazardous or illegal products etc.",
    { indent: 12 },
  );
  body(
    `14. The Licensee shall be responsible or accountable for the safety and security of his ` +
      `goods etc. in the Premises, and the Licensor shall not in any manner be responsible for ` +
      `the same. The removal of the goods etc. of the Licensee from the Premises under ` +
      `clause 9 above shall also be at the risk and cost of the Licensee.`,
  );
  body(
    `15. Possession of the Premises shall always remain with the Licensor, and the ` +
      `Licensee shall not claim any right whatsoever thereto and the user of the Premises ` +
      `under the permission/licence, shall not derogate from this essential condition of this ` +
      `Agreement. Pursuant to this, the Licensor, its officers, agents or servants are entitled ` +
      `to enter into or remain in the Premises, without any notice to the Licensee and are ` +
      `further entitled to ensure that the terms of this Agreement are strictly adhered to by the Licensee.`,
  );
  body(
    `16. Breach of any of the conditions or covenants stipulated herein, shall result in ` +
      `termination of this Agreement on expiry of ${noticeDays} days notice from the Licensor to this ` +
      `effect. Upon such termination, the consequences set out in clauses 7 to 11 above shall follow.`,
  );
  body(
    `17. The Licensee shall indemnify the Licensor against any third party claims that may ` +
      `arise from the Licensee's user of the Premises.`,
  );
  body(
    `18. Either party may terminate this Agreement, by giving one month notice to the ` +
      `other side. On expiry of such notice, the Agreement along with the licence shall ` +
      `terminate, and the consequences set out in clauses 7 to 11 above shall follow.`,
  );
  drawFooter();

  // Page 7 — signature blocks
  newPage();
  body(
    `IN WITNESS WHEREOF the Licensor and the Licensee have signed this ` +
      `Agreement on the date and at the place herein above first mentioned in the presence of ` +
      `two attesting witnesses.`,
  );
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("LICENSOR"));
  doc.font("Helvetica").fontSize(10);
  doc.text(
    pdfSafeText(
      `Represented by Secretary, ${snap.licensorSigningOfficer || "Shri Satyavan Dessai"}`,
    ),
  );
  doc.text(pdfSafeText("for Self and for and on behalf of Chairman"));
  doc.moveDown(2);
  doc.text(pdfSafeText("______________________________"));
  doc.text(pdfSafeText("Signature"));
  doc.moveDown(2);
  doc.font("Helvetica-Bold").fontSize(10).text(pdfSafeText("LICENSEE"));
  doc.font("Helvetica").fontSize(9).text(pdfSafeText("Affix passport size photograph of Licensee"));
  doc.moveDown(0.5);
  doc.fontSize(10).text(pdfSafeText(snap.traderOrEntityName || "[Licensee]"));
  if (!snap.licenseeSignsInPerson && snap.representativeName) {
    doc.text(pdfSafeText(`represented by ${snap.representativeName}`));
  }
  doc.moveDown(2);
  doc.text(pdfSafeText("______________________________"));
  doc.text(pdfSafeText("Signature"));
  drawFooter();

  // Page 8 — witnesses
  newPage();
  doc.font("Helvetica-Bold").fontSize(11).text(pdfSafeText("WITNESSES:-"));
  doc.moveDown(1);
  const w1Name = snap.witness1Name?.trim() || "______________________________________";
  const w1Addr = snap.witness1Address?.trim() || "______________________________________";
  const w2Name = snap.witness2Name?.trim() || "______________________________________";
  const w2Addr = snap.witness2Address?.trim() || "______________________________________";
  doc.font("Helvetica").fontSize(10);
  doc.text(pdfSafeText(`1. Shri. ${w1Name}`));
  doc.text(pdfSafeText(`R/o. ${w1Addr}`));
  doc.moveDown(0.5);
  doc.text(pdfSafeText("Sign: ______________________________"));
  doc.moveDown(1.5);
  doc.text(pdfSafeText(`2. Shri. ${w2Name}`));
  doc.text(pdfSafeText(`R/o. ${w2Addr}`));
  doc.moveDown(0.5);
  doc.text(pdfSafeText("Sign: ______________________________"));
  drawFooter();

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  return { buffer: Buffer.concat(chunks), pageCount: pageNo };
}
