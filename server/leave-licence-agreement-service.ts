import { createHash } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  entities,
  iomsReceipts,
  leaveLicenceAgreements,
  leaveLicenceAgreementVersions,
  premisesAgreements,
  traderLicences,
  yards,
} from "@shared/db-schema";
import {
  applyDerivedFields,
  calcAgreementEndDate,
  DEFAULT_DAMAGES_MULTIPLIER,
  DEFAULT_GST_NOTE_PCT,
  DEFAULT_INTEREST_RATE_TEXT,
  DEFAULT_NOTICE_DAYS,
  DEFAULT_PLACE_OF_EXECUTION,
  DEFAULT_RENT_DUE_DAY,
  DEFAULT_TERMINATION_MONTHS,
  defaultLicenseeClause,
  defaultLicensorClause,
  type LeaveLicenceSnapshot,
  roundMoney2,
  validateLeaveLicenceSnapshot,
} from "@shared/leave-licence-agreement";
import { addDaysYmd } from "@shared/premises-agreement";
import { db } from "./db";
import { buildLeaveLicenceAgreementPdf } from "./leave-licence-agreement-pdf";
import {
  writeLeaveLicencePdfBuffer,
} from "./leave-licence-agreement-storage";
import { getAgreementDetail } from "./premises-agreement-service";

function nowIso(): string {
  return new Date().toISOString();
}

function ageFromDob(dob: string | null | undefined): string | null {
  const s = String(dob ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const birth = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const md = today.getUTCMonth() - birth.getUTCMonth();
  if (md < 0 || (md === 0 && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age > 0 ? String(age) : null;
}

async function loadSecurityDepositReceipts(premisesAgreementId: string, legacyIds: string[]) {
  const ids = [premisesAgreementId, ...legacyIds].filter(Boolean);
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(iomsReceipts)
    .where(
      and(
        eq(iomsReceipts.revenueHead, "SecurityDeposit"),
        inArray(iomsReceipts.sourceRecordId, ids),
      ),
    )
    .orderBy(iomsReceipts.createdAt);
  return rows.map((r, i) => ({
    kind: (i === 0 ? "Original" : "Differential") as "Original" | "Differential",
    receiptNo: r.receiptNo,
    receiptDate: String(r.createdAt ?? "").slice(0, 10),
    amount: roundMoney2(Number(r.totalAmount ?? r.amount ?? 0)),
    particulars: i === 0 ? "Original security deposit" : "Differential security deposit",
  }));
}

export async function buildPrefillSnapshot(premisesAgreementId: string): Promise<LeaveLicenceSnapshot> {
  const detail = await getAgreementDetail(premisesAgreementId);
  if (!detail) throw new Error("Premises agreement not found.");

  const [yard] = await db.select().from(yards).where(eq(yards.id, detail.yardId)).limit(1);
  let licenceOrEntityNo = "";
  let holderName = String(detail.allotteeName ?? "");
  let address = "";
  let parentage = "";
  let ageYears: string | null = null;

  if (detail.traderLicenceId) {
    const [tl] = await db
      .select()
      .from(traderLicences)
      .where(eq(traderLicences.id, detail.traderLicenceId))
      .limit(1);
    if (tl) {
      licenceOrEntityNo = tl.licenceNo || tl.entityPublicCode || tl.provisionalLicenceNo || "";
      holderName = tl.firmName || tl.contactName || holderName;
      address = tl.address || "";
      parentage = tl.fatherSpouseName ? `son/daughter of ${tl.fatherSpouseName}` : "";
      ageYears = ageFromDob(tl.dateOfBirth);
    }
  } else if (detail.entityId) {
    const [ent] = await db.select().from(entities).where(eq(entities.id, detail.entityId)).limit(1);
    if (ent) {
      licenceOrEntityNo = ent.entityCode || "";
      holderName = ent.name || holderName;
      address = ent.address || "";
    }
  }

  const premises = ((detail.premises as Array<Record<string, unknown>>) ?? []).map((p) => ({
    assetId: String(p.assetId ?? ""),
    premisesId: String(p.premisesId ?? ""),
    assetType: String(p.assetType ?? "Stall"),
    location: String(p.location ?? ""),
    areaSqm: roundMoney2(Number(p.areaSqm ?? 0)),
    monthlyRent: roundMoney2(Number(p.monthlyRent ?? 0)),
    depositShare: roundMoney2(Number(p.depositShare ?? 0)),
  }));

  const totalRent = roundMoney2(premises.reduce((s, p) => s + p.monthlyRent, 0));
  const totalArea = roundMoney2(premises.reduce((s, p) => s + p.areaSqm, 0));
  const periodNo = Number(detail.agreementPeriodNumber ?? 1) || 1;
  const basis: "New" | "Renewal" = periodNo > 1 ? "Renewal" : "New";

  const legacyIds = ((detail.premises as Array<Record<string, unknown>>) ?? []).flatMap((p) =>
    [p.legacyAssetAllotmentId, p.legacyEntityAllotmentId].filter(Boolean).map(String),
  );

  const depositReceipts = await loadSecurityDepositReceipts(premisesAgreementId, legacyIds);
  const originalHeld =
    depositReceipts.find((r) => r.kind === "Original")?.amount ??
    roundMoney2(Number(detail.totalSecurityDeposit ?? 0));
  const differential =
    depositReceipts.filter((r) => r.kind === "Differential").reduce((s, r) => s + r.amount, 0) || 0;

  const depositMonths =
    totalRent > 0 && Number(detail.totalSecurityDeposit) > 0
      ? Math.max(1, Math.round(Number(detail.totalSecurityDeposit) / totalRent))
      : 3;

  const startDate = String(detail.fromDate ?? "").slice(0, 10);
  const endDate = String(detail.toDate ?? "").slice(0, 10);
  let termMonths = Number(detail.renewalTenureMonths ?? 0) || 0;
  if (!termMonths && startDate && endDate) {
    const s = new Date(startDate + "T00:00:00Z");
    const e = new Date(endDate + "T00:00:00Z");
    const months =
      (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
    termMonths = Math.max(1, Math.min(120, months));
  }
  if (!termMonths) termMonths = 11;

  const previousTo = basis === "Renewal" ? addDaysYmd(startDate, -1) : null;

  const licensorArgs = {
    signingOfficer: "SHRI SATYAVAN DESSAI",
    meetingNo: "33/2021-22",
    meetingDate: "26.10.2021",
    resolutionNo: "3",
    officeAddress: "Margao Main-Yard, Arlem, Raia, Salcete-Goa",
  };

  const snap: LeaveLicenceSnapshot = {
    basis,
    allotmentRef: String(detail.agreementNo ?? premisesAgreementId),
    licenceOrEntityNo,
    renewalNo: periodNo,
    traderOrEntityName: holderName,
    yardName: yard?.name ?? "",
    yardId: detail.yardId,
    premises,
    totalAreaSqm: totalArea,
    totalRent,
    previousAgreementDate: basis === "Renewal" ? previousTo : null,
    previousFromDate: null,
    previousToDate: previousTo,
    previousMonthlyRent: null,
    agreementDate: new Date().toISOString().slice(0, 10),
    placeOfExecution: DEFAULT_PLACE_OF_EXECUTION,
    startDate,
    termMonths,
    endDate: calcAgreementEndDate(startDate, termMonths) ?? endDate,
    depositMonths,
    requiredDeposit: 0,
    originalDepositHeld: originalHeld,
    differentialDeposit: roundMoney2(differential),
    totalDeposit: 0,
    depositReceipts:
      depositReceipts.length > 0
        ? depositReceipts
        : originalHeld > 0
          ? [
              {
                kind: "Original",
                receiptNo: "",
                receiptDate: "",
                amount: originalHeld,
                particulars: "Original security deposit",
              },
            ]
          : [],
    continuousMonthsForTermination: DEFAULT_TERMINATION_MONTHS,
    noticeDays: DEFAULT_NOTICE_DAYS,
    rentDueDay: DEFAULT_RENT_DUE_DAY,
    interestRateText: DEFAULT_INTEREST_RATE_TEXT,
    damagesMultiplier: DEFAULT_DAMAGES_MULTIPLIER,
    damagesPerDay: 0,
    gstNotePct: DEFAULT_GST_NOTE_PCT,
    purposeOfUse: "",
    licensorSigningOfficer: licensorArgs.signingOfficer,
    licensorMeetingNo: licensorArgs.meetingNo,
    licensorMeetingDate: licensorArgs.meetingDate,
    licensorResolutionNo: licensorArgs.resolutionNo,
    licensorOfficeAddress: licensorArgs.officeAddress,
    licensorClause: defaultLicensorClause(licensorArgs),
    licenseeSignsInPerson: true,
    representativeName: "",
    representativeParentage: "",
    representativeAge: "",
    representativeAddress: "",
    representativeAuthority: "",
    licenseeClause: defaultLicenseeClause({
      name: holderName,
      parentage,
      ageYears,
      address,
    }),
    stampSerialNo: "",
    stampValue: null,
    stampPurchaseDate: "",
    stampVendor: "",
    stampPlaceOfPurchase: "",
    stampPurchasedInNameOf: holderName,
    witness1Name: "",
    witness1Address: "",
    witness2Name: "",
    witness2Address: "",
    startDateOverrideReason: "",
  };

  return applyDerivedFields(snap);
}

export async function getLeaveLicenceByPremisesAgreement(premisesAgreementId: string) {
  const rows = await db
    .select()
    .from(leaveLicenceAgreements)
    .where(eq(leaveLicenceAgreements.premisesAgreementId, premisesAgreementId))
    .orderBy(desc(leaveLicenceAgreements.createdAt));
  const active = rows.find((r) => r.status === "Draft" || r.status === "Final" || r.status === "Executed");
  return active ?? rows[0] ?? null;
}

export async function getLeaveLicenceDetail(id: string) {
  const [row] = await db
    .select()
    .from(leaveLicenceAgreements)
    .where(eq(leaveLicenceAgreements.id, id))
    .limit(1);
  if (!row) return null;
  const versions = await db
    .select()
    .from(leaveLicenceAgreementVersions)
    .where(eq(leaveLicenceAgreementVersions.leaveLicenceAgreementId, id))
    .orderBy(desc(leaveLicenceAgreementVersions.versionNo));
  const current = versions.find((v) => v.versionNo === row.currentVersionNo) ?? versions[0] ?? null;
  let snapshot: LeaveLicenceSnapshot | null = null;
  if (current?.snapshotJson) {
    try {
      snapshot = applyDerivedFields(JSON.parse(current.snapshotJson) as LeaveLicenceSnapshot);
    } catch {
      snapshot = null;
    }
  }
  return { ...row, versions, currentVersion: current, snapshot };
}

export async function openOrCreateLeaveLicence(opts: {
  premisesAgreementId: string;
  createdBy?: string;
}) {
  const existing = await getLeaveLicenceByPremisesAgreement(opts.premisesAgreementId);
  if (existing && (existing.status === "Draft" || existing.status === "Final" || existing.status === "Executed")) {
    return getLeaveLicenceDetail(existing.id);
  }

  const detail = await getAgreementDetail(opts.premisesAgreementId);
  if (!detail) throw new Error("Premises agreement not found.");
  if (String(detail.approvalStatus) !== "Approved") {
    throw new Error("Allotment must be Approved before generating a Leave and Licence agreement.");
  }

  const snapshot = await buildPrefillSnapshot(opts.premisesAgreementId);
  const id = nanoid();
  const ts = nowIso();
  await db.insert(leaveLicenceAgreements).values({
    id,
    premisesAgreementId: opts.premisesAgreementId,
    allotmentRef: snapshot.allotmentRef,
    basis: snapshot.basis,
    licenceOrEntityNo: snapshot.licenceOrEntityNo,
    renewalNo: snapshot.renewalNo,
    status: "Draft",
    currentVersionNo: 1,
    cancelledFromId: existing?.status === "Cancelled" ? existing.id : null,
    createdBy: opts.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(leaveLicenceAgreementVersions).values({
    id: nanoid(),
    leaveLicenceAgreementId: id,
    versionNo: 1,
    kind: "Draft",
    snapshotJson: JSON.stringify(snapshot),
    generatedBy: opts.createdBy ?? null,
    generatedAt: ts,
  });

  return getLeaveLicenceDetail(id);
}

function parseSnapshot(raw: unknown): LeaveLicenceSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("Invalid snapshot payload.");
  return applyDerivedFields(raw as LeaveLicenceSnapshot);
}

export async function saveLeaveLicenceDraft(opts: {
  id: string;
  snapshot: unknown;
  userId?: string;
}) {
  const detail = await getLeaveLicenceDetail(opts.id);
  if (!detail) throw new Error("Agreement not found.");
  if (detail.status !== "Draft" && detail.status !== "Final") {
    throw new Error("Only Draft or Final agreements can be edited (Final regenerates a new version).");
  }

  const snap = parseSnapshot(opts.snapshot);
  // Refresh read-only allotment fields from source on every save
  const pref = await buildPrefillSnapshot(detail.premisesAgreementId);
  const merged = applyDerivedFields({
    ...snap,
    basis: pref.basis,
    allotmentRef: pref.allotmentRef,
    licenceOrEntityNo: pref.licenceOrEntityNo,
    renewalNo: pref.renewalNo,
    traderOrEntityName: pref.traderOrEntityName,
    yardName: pref.yardName,
    yardId: pref.yardId,
    premises: pref.premises,
    totalAreaSqm: pref.totalAreaSqm,
    totalRent: pref.totalRent,
    previousAgreementDate: snap.previousAgreementDate ?? pref.previousAgreementDate,
    previousFromDate: snap.previousFromDate ?? pref.previousFromDate,
    previousToDate: snap.previousToDate ?? pref.previousToDate,
    previousMonthlyRent: snap.previousMonthlyRent ?? pref.previousMonthlyRent,
    originalDepositHeld: pref.originalDepositHeld || snap.originalDepositHeld,
    differentialDeposit:
      pref.differentialDeposit > 0 ? pref.differentialDeposit : snap.differentialDeposit,
    depositReceipts:
      pref.depositReceipts.length > 0 ? pref.depositReceipts : snap.depositReceipts,
  });

  const issues = validateLeaveLicenceSnapshot(merged, { forFinal: false });
  const blockers = issues.filter((i) => i.severity === "Block");
  if (blockers.length) {
    const err = new Error(blockers.map((b) => b.message).join(" "));
    (err as Error & { issues?: typeof issues }).issues = issues;
    throw err;
  }

  const ts = nowIso();
  // Final versions are immutable. Edits stay client-side until Generate creates vN+1.
  if (detail.status === "Draft" && detail.currentVersion) {
    await db
      .update(leaveLicenceAgreementVersions)
      .set({
        snapshotJson: JSON.stringify(merged),
        generatedBy: opts.userId ?? detail.currentVersion.generatedBy,
        generatedAt: ts,
      })
      .where(eq(leaveLicenceAgreementVersions.id, detail.currentVersion.id));
    await db
      .update(leaveLicenceAgreements)
      .set({
        allotmentRef: merged.allotmentRef,
        basis: merged.basis,
        licenceOrEntityNo: merged.licenceOrEntityNo,
        renewalNo: merged.renewalNo,
        updatedAt: ts,
      })
      .where(eq(leaveLicenceAgreements.id, opts.id));
  }

  const out = await getLeaveLicenceDetail(opts.id);
  return {
    ...(out ?? detail),
    snapshot: merged,
    validation: issues,
  };
}

export async function previewLeaveLicencePdf(opts: { id: string; snapshot?: unknown }) {
  const detail = await getLeaveLicenceDetail(opts.id);
  if (!detail) throw new Error("Agreement not found.");
  const snap = opts.snapshot
    ? parseSnapshot(opts.snapshot)
    : detail.snapshot ?? (await buildPrefillSnapshot(detail.premisesAgreementId));
  const issues = validateLeaveLicenceSnapshot(snap, { forFinal: false });
  const { buffer, pageCount } = await buildLeaveLicenceAgreementPdf({
    snapshot: snap,
    versionNo: detail.currentVersionNo || 1,
    mode: "Draft",
  });
  return { buffer, pageCount, issues, snapshot: snap };
}

export async function generateLeaveLicenceFinal(opts: { id: string; snapshot?: unknown; userId?: string }) {
  const detail = await getLeaveLicenceDetail(opts.id);
  if (!detail) throw new Error("Agreement not found.");
  if (detail.status === "Executed" || detail.status === "Cancelled") {
    throw new Error("Cannot generate Final for an Executed or Cancelled agreement.");
  }

  // Persist Draft inputs (or merge client payload) without mutating a locked Final version.
  const saved = await saveLeaveLicenceDraft({ id: opts.id, snapshot: opts.snapshot ?? detail.snapshot, userId: opts.userId });
  const snap = saved.snapshot!;

  const issues = validateLeaveLicenceSnapshot(snap, { forFinal: true });
  const blockers = issues.filter((i) => i.severity === "Block");
  if (blockers.length) {
    const err = new Error(blockers.map((b) => b.message).join(" "));
    (err as Error & { issues?: typeof issues }).issues = issues;
    throw err;
  }

  const nextVersion =
    detail.status === "Final" ? detail.currentVersionNo + 1 : Math.max(1, detail.currentVersionNo);
  const ts = nowIso();

  if (detail.status === "Final" && detail.currentVersion) {
    await db
      .update(leaveLicenceAgreementVersions)
      .set({ kind: "Voided", voidedAt: ts })
      .where(eq(leaveLicenceAgreementVersions.id, detail.currentVersion.id));
  }

  const { buffer, pageCount } = await buildLeaveLicenceAgreementPdf({
    snapshot: snap,
    versionNo: nextVersion,
    mode: "Final",
  });
  const sha = createHash("sha256").update(buffer).digest("hex");
  const fileName = `final-${Date.now()}-${nanoid(8)}.pdf`;
  await writeLeaveLicencePdfBuffer(opts.id, fileName, buffer);

  const versionId = nanoid();
  if (detail.status === "Draft" && detail.currentVersion && detail.currentVersionNo === nextVersion) {
    await db
      .update(leaveLicenceAgreementVersions)
      .set({
        kind: "Final",
        snapshotJson: JSON.stringify(snap),
        contentSha256: sha,
        pdfFile: fileName,
        pdfPageCount: pageCount,
        generatedBy: opts.userId ?? null,
        generatedAt: ts,
      })
      .where(eq(leaveLicenceAgreementVersions.id, detail.currentVersion.id));
  } else {
    await db.insert(leaveLicenceAgreementVersions).values({
      id: versionId,
      leaveLicenceAgreementId: opts.id,
      versionNo: nextVersion,
      kind: "Final",
      snapshotJson: JSON.stringify(snap),
      contentSha256: sha,
      pdfFile: fileName,
      pdfPageCount: pageCount,
      generatedBy: opts.userId ?? null,
      generatedAt: ts,
    });
  }

  await db
    .update(leaveLicenceAgreements)
    .set({
      status: "Final",
      currentVersionNo: nextVersion,
      updatedAt: ts,
    })
    .where(eq(leaveLicenceAgreements.id, opts.id));

  return {
    ...(await getLeaveLicenceDetail(opts.id)),
    validation: issues,
    pdfFile: fileName,
    contentSha256: sha,
    pageCount,
  };
}

export async function uploadSignedLeaveLicence(opts: {
  id: string;
  buffer: Buffer;
  fileName: string;
  userId?: string;
}) {
  const detail = await getLeaveLicenceDetail(opts.id);
  if (!detail) throw new Error("Agreement not found.");
  if (detail.status !== "Final") throw new Error("Signed scan can only be uploaded for a Final agreement.");
  if (!detail.currentVersion?.pdfFile) throw new Error("Final PDF must exist before uploading signed scan.");

  if (opts.buffer.length < 1000) throw new Error("Uploaded scan looks empty or corrupt.");
  if (opts.buffer.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw new Error("Signed copy must be a PDF file.");
  }

  const ts = nowIso();
  const stored = opts.fileName;
  await writeLeaveLicencePdfBuffer(opts.id, stored, opts.buffer);

  await db
    .update(leaveLicenceAgreements)
    .set({
      status: "Executed",
      signedScanFile: stored,
      signedScanUploadedAt: ts,
      executedAt: ts,
      executedBy: opts.userId ?? null,
      updatedAt: ts,
    })
    .where(eq(leaveLicenceAgreements.id, opts.id));

  if (detail.currentVersion) {
    await db
      .update(leaveLicenceAgreementVersions)
      .set({ kind: "Executed" })
      .where(eq(leaveLicenceAgreementVersions.id, detail.currentVersion.id));
  }

  // Write agreement reference back onto premises allotment (hand-off: ref + status only)
  const snap = detail.snapshot;
  if (snap) {
    await db
      .update(premisesAgreements)
      .set({
        agreementType: "LeaveAndLicence",
        agreementRef: `${snap.allotmentRef}/LL-v${detail.currentVersionNo}`,
        agreementDocFile: stored,
        agreementDocUploadedAt: ts,
        fromDate: snap.startDate,
        toDate: snap.endDate,
        totalSecurityDeposit: snap.totalDeposit || snap.requiredDeposit,
        updatedAt: ts,
      })
      .where(eq(premisesAgreements.id, detail.premisesAgreementId));
  }

  return getLeaveLicenceDetail(opts.id);
}

export async function cancelLeaveLicenceAndCreateFresh(opts: {
  id: string;
  reason: string;
  effectiveDate: string;
  orderRef: string;
  orderFileName?: string;
  orderBuffer?: Buffer;
  userId?: string;
}) {
  const detail = await getLeaveLicenceDetail(opts.id);
  if (!detail) throw new Error("Agreement not found.");
  if (detail.status !== "Executed" && detail.status !== "Final") {
    throw new Error("Only Final or Executed agreements can be cancelled.");
  }
  if (!opts.reason?.trim() || !opts.effectiveDate?.trim() || !opts.orderRef?.trim()) {
    throw new Error("Cancellation reason, effective date and Secretary's order reference are required.");
  }

  const ts = nowIso();
  let cancelOrderFile: string | null = null;
  if (opts.orderBuffer && opts.orderFileName) {
    cancelOrderFile = opts.orderFileName;
    await writeLeaveLicencePdfBuffer(opts.id, cancelOrderFile, opts.orderBuffer);
  }

  await db
    .update(leaveLicenceAgreements)
    .set({
      status: "Cancelled",
      cancelReason: opts.reason.trim(),
      cancelEffectiveDate: opts.effectiveDate.slice(0, 10),
      cancelOrderRef: opts.orderRef.trim(),
      cancelOrderFile,
      cancelledAt: ts,
      cancelledBy: opts.userId ?? null,
      updatedAt: ts,
    })
    .where(eq(leaveLicenceAgreements.id, opts.id));

  const freshSnap = detail.snapshot
    ? applyDerivedFields({ ...detail.snapshot, stampSerialNo: "", stampPurchaseDate: "", stampVendor: "" })
    : await buildPrefillSnapshot(detail.premisesAgreementId);

  const freshId = nanoid();
  await db.insert(leaveLicenceAgreements).values({
    id: freshId,
    premisesAgreementId: detail.premisesAgreementId,
    allotmentRef: freshSnap.allotmentRef,
    basis: freshSnap.basis,
    licenceOrEntityNo: freshSnap.licenceOrEntityNo,
    renewalNo: freshSnap.renewalNo,
    status: "Draft",
    currentVersionNo: 1,
    cancelledFromId: opts.id,
    createdBy: opts.userId ?? null,
    createdAt: ts,
    updatedAt: ts,
  });

  await db
    .update(leaveLicenceAgreements)
    .set({ supersededById: freshId, updatedAt: ts })
    .where(eq(leaveLicenceAgreements.id, opts.id));

  await db.insert(leaveLicenceAgreementVersions).values({
    id: nanoid(),
    leaveLicenceAgreementId: freshId,
    versionNo: 1,
    kind: "Draft",
    snapshotJson: JSON.stringify(freshSnap),
    generatedBy: opts.userId ?? null,
    generatedAt: ts,
  });

  return getLeaveLicenceDetail(freshId);
}

export async function getVersionPdfBuffer(agreementId: string, versionId: string) {
  const [ver] = await db
    .select()
    .from(leaveLicenceAgreementVersions)
    .where(
      and(
        eq(leaveLicenceAgreementVersions.id, versionId),
        eq(leaveLicenceAgreementVersions.leaveLicenceAgreementId, agreementId),
      ),
    )
    .limit(1);
  if (!ver?.pdfFile) return null;
  const { readLeaveLicencePdfBuffer } = await import("./leave-licence-agreement-storage");
  return { fileName: ver.pdfFile, buffer: await readLeaveLicencePdfBuffer(agreementId, ver.pdfFile), kind: ver.kind };
}
