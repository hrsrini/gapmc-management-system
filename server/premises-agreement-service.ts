import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import {
  agreementPremisesLines,
  agreementRenewals,
  assetAllotments,
  assets,
  delayPenalties,
  entityAllotments,
  finalDemandNotices,
  finalDemandNoticeSeq,
  fullFinalSettlements,
  premisesAgreements,
  premisesAgreementSeq,
  renewalNotices,
  renewalNoticeSeq,
  rentRevisionBatches,
  rentRevisionLines,
  vacationEvictionEvents,
} from "@shared/db-schema";
import {
  calculateDelayPenalty,
  daysBetweenYmd,
  deriveComputedRenewalStatus,
  isRentRevisionDueForPeriod,
  isRenewalWindowOpen,
  noticeDisabledByRenewal,
  proposedRenewalToDate,
  RENEWAL_WINDOW_DAYS,
  splitDepositByArea,
} from "@shared/premises-agreement";
import { inferAgreementTypeFromDates } from "@shared/premises-allocation";
import { assertPremisesNotAlreadyAllocatedActive } from "./premises-allocation-guard";
import { syncPremisesStatusFromTenancy } from "./premises-status-sync";

function nowIso(): string {
  return new Date().toISOString();
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

async function nextSeq(table: "agreement" | "notice" | "demand"): Promise<string> {
  const yearKey = String(new Date().getFullYear());
  const seqTable =
    table === "agreement" ? premisesAgreementSeq : table === "notice" ? renewalNoticeSeq : finalDemandNoticeSeq;
  const prefix = table === "agreement" ? "AGR" : table === "notice" ? "RN" : "FDN";
  const [existing] = await db.select().from(seqTable).where(eq(seqTable.yearKey, yearKey)).limit(1);
  const next = (existing?.lastSeq ?? 0) + 1;
  if (existing) {
    await db.update(seqTable).set({ lastSeq: next }).where(eq(seqTable.yearKey, yearKey));
  } else {
    await db.insert(seqTable).values({ yearKey, lastSeq: next });
  }
  return `${prefix}-${yearKey}-${String(next).padStart(5, "0")}`;
}

function assetArea(asset: { plinthAreaSqft: number | null; area: string | null }): number {
  if (asset.plinthAreaSqft != null && Number(asset.plinthAreaSqft) > 0) return Number(asset.plinthAreaSqft);
  const n = Number(String(asset.area ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function listPremisesAgreements(opts?: {
  yardId?: string;
  renewalStatus?: string;
  search?: string;
  traderLicenceId?: string;
  entityId?: string;
}) {
  const rows = await db.select().from(premisesAgreements).orderBy(desc(premisesAgreements.updatedAt));
  const asOf = todayYmd();
  let filtered = rows.map((r) => {
    const renewalStatus = deriveComputedRenewalStatus({
      agreementTo: r.toDate,
      asOfYmd: asOf,
      storedStatus: r.renewalStatus,
      approvalStatus: r.approvalStatus,
    });
    // Flag when the *next* period (this renewal) requires mandatory rent revision (FRD §6 / frequency rule).
    return {
      ...r,
      renewalStatus,
      revisionDue: isRentRevisionDueForPeriod(r.agreementPeriodNumber + 1, r.rentRevisionFrequency),
    };
  });
  if (opts?.yardId && opts.yardId !== "all") filtered = filtered.filter((r) => r.yardId === opts.yardId);
  if (opts?.renewalStatus && opts.renewalStatus !== "all") {
    filtered = filtered.filter((r) => r.renewalStatus === opts.renewalStatus);
  }
  if (opts?.traderLicenceId) filtered = filtered.filter((r) => r.traderLicenceId === opts.traderLicenceId);
  if (opts?.entityId) filtered = filtered.filter((r) => r.entityId === opts.entityId);
  if (opts?.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.agreementNo.toLowerCase().includes(q) ||
        r.allotteeName.toLowerCase().includes(q) ||
        String(r.agreementRef ?? "").toLowerCase().includes(q),
    );
  }
  const ids = filtered.map((r) => r.id);
  const lines =
    ids.length === 0
      ? []
      : await db.select().from(agreementPremisesLines).where(inArray(agreementPremisesLines.agreementId, ids));
  const assetIds = [...new Set(lines.map((l) => l.assetId))];
  const assetRows =
    assetIds.length === 0 ? [] : await db.select().from(assets).where(inArray(assets.id, assetIds));
  const assetById = Object.fromEntries(assetRows.map((a) => [a.id, a]));

  return filtered.map((agr) => {
    const agrLines = lines.filter((l) => l.agreementId === agr.id);
    const premises = agrLines.map((l) => ({
      ...l,
      premisesId: assetById[l.assetId]?.assetId ?? l.assetId,
      assetType: assetById[l.assetId]?.assetType ?? "",
      location: assetById[l.assetId]?.premisesLocation ?? "",
    }));
    const totalRent = premises.reduce((s, p) => s + Number(p.monthlyRent ?? 0), 0);
    return {
      ...agr,
      premisesCount: premises.length,
      premises,
      totalMonthlyRent: Math.round(totalRent * 100) / 100,
      daysToExpiry: (() => {
        const a = asOf;
        const b = agr.toDate;
        const d0 = Date.parse(a);
        const d1 = Date.parse(b);
        if (!Number.isFinite(d0) || !Number.isFinite(d1)) return null;
        return Math.round((d1 - d0) / 86_400_000);
      })(),
    };
  });
}

export async function getAgreementDetail(id: string) {
  const [agr] = await db.select().from(premisesAgreements).where(eq(premisesAgreements.id, id)).limit(1);
  if (!agr) return null;
  const list = await listPremisesAgreements({});
  return list.find((x) => x.id === id) ?? { ...agr, premises: [], premisesCount: 0, totalMonthlyRent: 0 };
}

export async function createAgreementDraft(input: {
  track: "TrackA" | "TrackB";
  traderLicenceId?: string;
  entityId?: string;
  yardId: string;
  allotteeName: string;
  allotmentDate?: string;
  fromDate: string;
  toDate: string;
  agreementType?: string;
  agreementRef?: string;
  rentRevisionMode?: string;
  agreementPeriodNumber?: number;
  rentRevisionFrequency?: number;
  renewalTenureMonths?: number;
  penaltyClauseRef?: string;
  penaltyMethod?: string;
  penaltyRate?: number;
  totalSecurityDeposit: number;
  gstApplicable?: boolean;
  premises: Array<{ assetId: string; monthlyRent: number; areaSqm?: number }>;
  createdBy?: string;
}) {
  if (!input.premises?.length) throw new Error("Select at least one premises.");
  if (!input.fromDate || !input.toDate) throw new Error("Agreement from and to dates are required.");
  if (input.track === "TrackA" && !input.traderLicenceId) throw new Error("traderLicenceId required for Track A.");
  if (input.track === "TrackB" && !input.entityId) throw new Error("entityId required for Track B.");

  const assetIds = input.premises.map((p) => p.assetId);
  const assetRows = await db.select().from(assets).where(inArray(assets.id, assetIds));
  if (assetRows.length !== assetIds.length) throw new Error("One or more premises were not found.");
  for (const a of assetRows) {
    if (a.yardId !== input.yardId) throw new Error("All premises must belong to the selected yard.");
    const st = String(a.premisesStatus ?? "");
    if (st !== "Vacant" && st !== "Active") throw new Error(`Premises ${a.assetId} is not vacant (${st}).`);
    const check = await assertPremisesNotAlreadyAllocatedActive({ assetId: a.id });
    if (!check.ok) {
      throw new Error(`Premises ${a.assetId} already has an active allotment.`);
    }
  }

  const areas = input.premises.map((p) => {
    const asset = assetRows.find((a) => a.id === p.assetId)!;
    return p.areaSqm != null && p.areaSqm > 0 ? p.areaSqm : assetArea(asset);
  });
  const deposits = splitDepositByArea(input.totalSecurityDeposit, areas);
  const ts = nowIso();
  const agreementId = nanoid();
  const agreementNo = await nextSeq("agreement");
  const agreementType = input.agreementType || inferAgreementTypeFromDates(input.fromDate, input.toDate);

  await db.insert(premisesAgreements).values({
    id: agreementId,
    agreementNo,
    track: input.track,
    traderLicenceId: input.traderLicenceId ?? null,
    entityId: input.entityId ?? null,
    yardId: input.yardId,
    allotteeName: input.allotteeName,
    allotmentDate: input.allotmentDate ?? todayYmd(),
    fromDate: input.fromDate,
    toDate: input.toDate,
    agreementType,
    agreementRef: input.agreementRef ?? null,
    rentRevisionMode: input.rentRevisionMode ?? "StandardConsecutiveRenewal",
    agreementPeriodNumber: Math.max(1, Math.floor(input.agreementPeriodNumber ?? 1)),
    rentRevisionFrequency: Math.max(1, Math.floor(input.rentRevisionFrequency ?? 3)),
    renewalTenureMonths: input.renewalTenureMonths ?? null,
    penaltyClauseRef: input.penaltyClauseRef ?? null,
    penaltyMethod: input.penaltyMethod ?? null,
    penaltyRate: input.penaltyRate ?? null,
    totalSecurityDeposit: Number(input.totalSecurityDeposit) || 0,
    approvalStatus: "Draft",
    renewalStatus: "Active",
    doUser: input.createdBy ?? null,
    gstApplicable: input.gstApplicable !== false,
    createdBy: input.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  });

  for (let i = 0; i < input.premises.length; i++) {
    const p = input.premises[i]!;
    const lineId = nanoid();
    let legacyAssetAllotmentId: string | null = null;
    let legacyEntityAllotmentId: string | null = null;

    if (input.track === "TrackA") {
      const legacyId = nanoid();
      await db.insert(assetAllotments).values({
        id: legacyId,
        assetId: p.assetId,
        traderLicenceId: input.traderLicenceId!,
        allotteeName: input.allotteeName,
        fromDate: input.fromDate,
        toDate: input.toDate,
        status: "Pending",
        securityDeposit: deposits[i] ?? 0,
        approvalStatus: "Draft",
        allotmentDate: input.allotmentDate ?? todayYmd(),
        monthlyRent: Number(p.monthlyRent) || 0,
        gstApplicable: input.gstApplicable !== false,
        agreementType,
        rentRevisionMode: input.rentRevisionMode ?? "StandardConsecutiveRenewal",
        consecutiveRenewalCount: Math.max(0, Math.floor(input.agreementPeriodNumber ?? 1) - 1),
        doUser: input.createdBy ?? null,
      });
      legacyAssetAllotmentId = legacyId;
    } else {
      const legacyId = nanoid();
      await db.insert(entityAllotments).values({
        id: legacyId,
        assetId: p.assetId,
        entityId: input.entityId!,
        allotteeName: input.allotteeName,
        fromDate: input.fromDate,
        toDate: input.toDate,
        status: "Pending",
        securityDeposit: deposits[i] ?? 0,
        approvalStatus: "Draft",
        allotmentDate: input.allotmentDate ?? todayYmd(),
        monthlyRent: Number(p.monthlyRent) || 0,
        gstApplicable: input.gstApplicable !== false,
        agreementType,
        rentRevisionMode: input.rentRevisionMode ?? "StandardConsecutiveRenewal",
        consecutiveRenewalCount: Math.max(0, Math.floor(input.agreementPeriodNumber ?? 1) - 1),
        doUser: input.createdBy ?? null,
      });
      legacyEntityAllotmentId = legacyId;
    }

    await db.insert(agreementPremisesLines).values({
      id: lineId,
      agreementId,
      assetId: p.assetId,
      monthlyRent: Number(p.monthlyRent) || 0,
      depositShare: deposits[i] ?? 0,
      areaSqm: areas[i] ?? null,
      tenancyStatus: "Pending",
      legacyAssetAllotmentId,
      legacyEntityAllotmentId,
      createdAt: ts,
      updatedAt: ts,
    });
  }

  return getAgreementDetail(agreementId);
}

export async function transitionAgreementApproval(args: {
  id: string;
  newStatus: "Verified" | "Approved" | "Draft" | "Rejected";
  userId?: string;
  remarks?: string;
}) {
  const [agr] = await db.select().from(premisesAgreements).where(eq(premisesAgreements.id, args.id)).limit(1);
  if (!agr) throw new Error("Agreement not found");
  const ts = nowIso();
  const patch: Record<string, unknown> = { approvalStatus: args.newStatus, updatedAt: ts };
  if (args.newStatus === "Verified") {
    patch.dvUser = args.userId ?? null;
    patch.verifiedAt = ts;
    patch.dvReturnRemarks = null;
  }
  if (args.newStatus === "Approved") {
    patch.daUser = args.userId ?? null;
    patch.approvedAt = ts;
  }
  if (args.newStatus === "Draft") {
    patch.dvReturnRemarks = args.remarks ?? null;
  }
  if (args.newStatus === "Rejected") {
    patch.rejectionRemarks = args.remarks ?? null;
    patch.daUser = args.userId ?? null;
  }
  await db.update(premisesAgreements).set(patch as never).where(eq(premisesAgreements.id, args.id));

  const lines = await db
    .select()
    .from(agreementPremisesLines)
    .where(eq(agreementPremisesLines.agreementId, args.id));

  if (args.newStatus === "Approved") {
    await db
      .update(agreementPremisesLines)
      .set({ tenancyStatus: "Active", updatedAt: ts })
      .where(eq(agreementPremisesLines.agreementId, args.id));
    for (const line of lines) {
      if (line.legacyAssetAllotmentId) {
        await db
          .update(assetAllotments)
          .set({ approvalStatus: "Approved", status: "Active", approvedAt: ts, daUser: args.userId ?? null })
          .where(eq(assetAllotments.id, line.legacyAssetAllotmentId));
      }
      if (line.legacyEntityAllotmentId) {
        await db
          .update(entityAllotments)
          .set({ approvalStatus: "Approved", status: "Active", approvedAt: ts, daUser: args.userId ?? null })
          .where(eq(entityAllotments.id, line.legacyEntityAllotmentId));
      }
      await syncPremisesStatusFromTenancy(line.assetId);
    }
  } else {
    for (const line of lines) {
      if (line.legacyAssetAllotmentId) {
        await db
          .update(assetAllotments)
          .set({
            approvalStatus: args.newStatus === "Draft" ? "Draft" : args.newStatus,
            ...(args.newStatus === "Verified" ? { verifiedAt: ts, dvUser: args.userId ?? null } : {}),
          })
          .where(eq(assetAllotments.id, line.legacyAssetAllotmentId));
      }
      if (line.legacyEntityAllotmentId) {
        await db
          .update(entityAllotments)
          .set({
            approvalStatus: args.newStatus === "Draft" ? "Draft" : args.newStatus,
            ...(args.newStatus === "Verified" ? { verifiedAt: ts, dvUser: args.userId ?? null } : {}),
          })
          .where(eq(entityAllotments.id, line.legacyEntityAllotmentId));
      }
    }
  }
  return getAgreementDetail(args.id);
}

export async function updateAgreementDraft(
  id: string,
  patch: Partial<{
    fromDate: string;
    toDate: string;
    agreementRef: string;
    allotmentDate: string;
    rentRevisionMode: string;
    agreementPeriodNumber: number;
    rentRevisionFrequency: number;
    renewalTenureMonths: number;
    penaltyClauseRef: string;
    penaltyMethod: string;
    penaltyRate: number;
    totalSecurityDeposit: number;
    agreementDocFile: string;
    agreementDocUploadedAt: string;
    renewalStatus: string;
  }>,
) {
  const [agr] = await db.select().from(premisesAgreements).where(eq(premisesAgreements.id, id)).limit(1);
  if (!agr) throw new Error("Agreement not found");
  await db
    .update(premisesAgreements)
    .set({ ...patch, updatedAt: nowIso() } as never)
    .where(eq(premisesAgreements.id, id));
  return getAgreementDetail(id);
}

export async function startRenewal(args: {
  agreementId: string;
  renewalDate?: string;
  renewalFromDate?: string;
  renewalToDate?: string;
  createdBy?: string;
}) {
  const detail = await getAgreementDetail(args.agreementId);
  if (!detail) throw new Error("Agreement not found");
  if (detail.approvalStatus !== "Approved") throw new Error("Only approved agreements can be renewed.");
  const daysLeft = daysBetweenYmd(todayYmd(), detail.toDate);
  if (!isRenewalWindowOpen(daysLeft)) {
    throw new Error("Renewal can be started only from two months before agreement expiry (or after expiry).");
  }

  // Reuse an open renewal so refresh / repeated "Save draft" does not create duplicates.
  const [open] = await db
    .select()
    .from(agreementRenewals)
    .where(and(eq(agreementRenewals.agreementId, args.agreementId), ne(agreementRenewals.status, "Completed")))
    .orderBy(desc(agreementRenewals.createdAt))
    .limit(1);
  if (open) {
    const revisionStillDue = open.status === "PendingRevision";
    return {
      renewalId: open.id,
      revisionDue: revisionStillDue,
      renewalFrom: open.renewalFromDate,
      renewalTo: open.renewalToDate,
      reused: true as const,
    };
  }

  const renewalDate = args.renewalDate ?? todayYmd();
  const renewalFrom = args.renewalFromDate ?? addOneDay(detail.toDate) ?? detail.toDate;
  const renewalTo =
    args.renewalToDate ??
    proposedRenewalToDate(renewalFrom, detail.fromDate, detail.toDate) ??
    renewalFrom;
  const revisionDue = isRentRevisionDueForPeriod(detail.agreementPeriodNumber + 1, detail.rentRevisionFrequency);
  const ts = nowIso();
  const id = nanoid();
  await db.insert(agreementRenewals).values({
    id,
    agreementId: args.agreementId,
    renewalDate,
    priorFromDate: detail.fromDate,
    priorToDate: detail.toDate,
    renewalFromDate: renewalFrom,
    renewalToDate: renewalTo,
    priorPeriodNumber: detail.agreementPeriodNumber,
    newPeriodNumber: detail.agreementPeriodNumber + 1,
    status: revisionDue ? "PendingRevision" : "Initiated",
    createdBy: args.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  });
  await db
    .update(premisesAgreements)
    .set({
      renewalStatus: revisionDue ? "RentRevisionPending" : "RenewalInitiated",
      updatedAt: ts,
    })
    .where(eq(premisesAgreements.id, args.agreementId));
  return { renewalId: id, revisionDue, renewalFrom, renewalTo, reused: false as const };
}

function addOneDay(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export async function completeRenewal(args: { renewalId: string; userId?: string }) {
  const [ren] = await db.select().from(agreementRenewals).where(eq(agreementRenewals.id, args.renewalId)).limit(1);
  if (!ren) throw new Error("Renewal not found");
  if (ren.status === "Completed") throw new Error("Renewal already completed");

  if (isRentRevisionDueForPeriod(ren.newPeriodNumber, (await getFreq(ren.agreementId)))) {
    if (!ren.revisionBatchId) throw new Error("Rent revision is required before completing this renewal.");
    const [batch] = await db
      .select()
      .from(rentRevisionBatches)
      .where(eq(rentRevisionBatches.id, ren.revisionBatchId))
      .limit(1);
    if (!batch || batch.status !== "Approved") {
      throw new Error("Rent revision must be approved before completing this renewal.");
    }
  }

  const [agr] = await db.select().from(premisesAgreements).where(eq(premisesAgreements.id, ren.agreementId)).limit(1);
  if (!agr) throw new Error("Agreement not found");

  // Delay penalty if expired before regularisation
  const daysLate = Math.max(
    0,
    Math.round((Date.parse(ren.renewalDate) - Date.parse(ren.priorToDate)) / 86_400_000),
  );
  if (daysLate > 0 && agr.penaltyMethod && agr.penaltyRate != null) {
    const lines = await db
      .select()
      .from(agreementPremisesLines)
      .where(eq(agreementPremisesLines.agreementId, ren.agreementId));
    const rentTotal = lines.reduce((s, l) => s + Number(l.monthlyRent ?? 0), 0);
    const amount = calculateDelayPenalty({
      method: String(agr.penaltyMethod),
      rate: Number(agr.penaltyRate),
      daysOfDelay: daysLate,
      monthlyRentTotal: rentTotal,
    });
    if (!ren.penaltyId) {
      const penaltyId = nanoid();
      const ts = nowIso();
      await db.insert(delayPenalties).values({
        id: penaltyId,
        agreementId: ren.agreementId,
        renewalId: ren.id,
        expiryDate: ren.priorToDate,
        regularisationDate: ren.renewalDate,
        daysOfDelay: daysLate,
        method: String(agr.penaltyMethod),
        rate: Number(agr.penaltyRate),
        calculatedAmount: amount,
        status: "Draft",
        createdBy: args.userId ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
      await db
        .update(agreementRenewals)
        .set({ penaltyId, status: "PendingPenalty", updatedAt: ts })
        .where(eq(agreementRenewals.id, ren.id));
      await db
        .update(premisesAgreements)
        .set({ renewalStatus: "PenaltyApplicable", updatedAt: ts })
        .where(eq(premisesAgreements.id, ren.agreementId));
      throw new Error("Delay penalty drafted — verify and approve the penalty, then complete renewal again.");
    }
    const [pen] = await db.select().from(delayPenalties).where(eq(delayPenalties.id, ren.penaltyId)).limit(1);
    if (!pen || pen.status !== "Approved") {
      throw new Error("Delay penalty must be approved before completing this renewal.");
    }
  }

  const ts = nowIso();
  await db
    .update(agreementRenewals)
    .set({ status: "Completed", completedAt: ts, updatedAt: ts })
    .where(eq(agreementRenewals.id, ren.id));
  await db
    .update(premisesAgreements)
    .set({
      fromDate: ren.renewalFromDate,
      toDate: ren.renewalToDate,
      agreementPeriodNumber: ren.newPeriodNumber,
      renewalStatus: "Renewed",
      updatedAt: ts,
    })
    .where(eq(premisesAgreements.id, ren.agreementId));

  const lines = await db
    .select()
    .from(agreementPremisesLines)
    .where(eq(agreementPremisesLines.agreementId, ren.agreementId));
  for (const line of lines) {
    if (line.legacyAssetAllotmentId) {
      await db
        .update(assetAllotments)
        .set({
          fromDate: ren.renewalFromDate,
          toDate: ren.renewalToDate,
          consecutiveRenewalCount: ren.newPeriodNumber - 1,
        })
        .where(eq(assetAllotments.id, line.legacyAssetAllotmentId));
    }
    if (line.legacyEntityAllotmentId) {
      await db
        .update(entityAllotments)
        .set({
          fromDate: ren.renewalFromDate,
          toDate: ren.renewalToDate,
          consecutiveRenewalCount: ren.newPeriodNumber - 1,
        })
        .where(eq(entityAllotments.id, line.legacyEntityAllotmentId));
    }
  }
  return getAgreementDetail(ren.agreementId);
}

async function getFreq(agreementId: string): Promise<number> {
  const [agr] = await db.select().from(premisesAgreements).where(eq(premisesAgreements.id, agreementId)).limit(1);
  return Math.max(1, agr?.rentRevisionFrequency ?? 3);
}

export async function createRenewalNotice(args: {
  agreementId: string;
  lastDateToRenew?: string;
  generatedBy?: string;
  isReprint?: boolean;
}) {
  const detail = await getAgreementDetail(args.agreementId);
  if (!detail) throw new Error("Agreement not found");
  const asOf = todayYmd();
  const daysLeft = daysBetweenYmd(asOf, detail.toDate);
  const status = deriveComputedRenewalStatus({
    agreementTo: detail.toDate,
    asOfYmd: asOf,
    storedStatus: detail.renewalStatus,
    approvalStatus: detail.approvalStatus,
  });
  if (noticeDisabledByRenewal(status)) {
    throw new Error("Renewal notice is closed once renewal is initiated or completed.");
  }
  if (daysLeft == null || daysLeft > RENEWAL_WINDOW_DAYS) {
    throw new Error("Renewal notice is available only from two months before agreement expiry.");
  }
  const existing = await db
    .select()
    .from(renewalNotices)
    .where(eq(renewalNotices.agreementId, args.agreementId))
    .orderBy(desc(renewalNotices.versionNo));
  const versionNo = (existing[0]?.versionNo ?? 0) + 1;
  const noticeNo = await nextSeq("notice");
  const id = nanoid();
  const noticeDate = todayYmd();
  await db.insert(renewalNotices).values({
    id,
    agreementId: args.agreementId,
    noticeNo,
    versionNo,
    noticeDate,
    lastDateToRenew: args.lastDateToRenew ?? detail.toDate,
    generatedBy: args.generatedBy ?? null,
    generatedAt: nowIso(),
    isReprint: Boolean(args.isReprint) || versionNo > 1,
  });
  if (!args.isReprint && detail.renewalStatus !== "RenewalInitiated") {
    await db
      .update(premisesAgreements)
      .set({ renewalStatus: "NoticeGenerated", updatedAt: nowIso() })
      .where(eq(premisesAgreements.id, args.agreementId));
  }
  return { id, noticeNo, versionNo, noticeDate, agreement: detail };
}

export async function createRevisionBatch(args: {
  agreementId: string;
  effectiveDate: string;
  revisionBasis?: string;
  renewalId?: string;
  remarks?: string;
  createdBy?: string;
  lines: Array<{ agreementLineId: string; revisedRent: number }>;
}) {
  if (!args.lines.length) throw new Error("Select at least one premises.");
  const detail = await getAgreementDetail(args.agreementId);
  if (!detail) throw new Error("Agreement not found");
  const ts = nowIso();
  const batchId = nanoid();
  await db.insert(rentRevisionBatches).values({
    id: batchId,
    agreementId: args.agreementId,
    renewalId: args.renewalId ?? null,
    effectiveDate: args.effectiveDate,
    revisionBasis: args.revisionBasis ?? "FixedMonthlyRent",
    status: "Draft",
    remarks: args.remarks ?? null,
    doUser: args.createdBy ?? null,
    createdBy: args.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  });
  for (const line of args.lines) {
    const existing = detail.premises.find((p: { id: string }) => p.id === line.agreementLineId);
    if (!existing) throw new Error("Invalid agreement line");
    await db.insert(rentRevisionLines).values({
      id: nanoid(),
      batchId,
      agreementLineId: line.agreementLineId,
      assetId: existing.assetId,
      existingRent: Number(existing.monthlyRent) || 0,
      revisedRent: Number(line.revisedRent) || 0,
      createdAt: ts,
    });
  }
  if (args.renewalId) {
    await db
      .update(agreementRenewals)
      .set({ revisionBatchId: batchId, status: "PendingRevision", updatedAt: ts })
      .where(eq(agreementRenewals.id, args.renewalId));
    await db
      .update(premisesAgreements)
      .set({ renewalStatus: "RentRevisionPending", updatedAt: ts })
      .where(eq(premisesAgreements.id, args.agreementId));
  }
  return getRevisionBatch(batchId);
}

export async function getRevisionBatch(batchId: string) {
  const [batch] = await db.select().from(rentRevisionBatches).where(eq(rentRevisionBatches.id, batchId)).limit(1);
  if (!batch) return null;
  const lines = await db.select().from(rentRevisionLines).where(eq(rentRevisionLines.batchId, batchId));
  return { ...batch, lines };
}

export async function transitionRevisionBatch(args: {
  batchId: string;
  newStatus: "Verified" | "Approved" | "Returned" | "Rejected";
  userId?: string;
  remarks?: string;
}) {
  const batch = await getRevisionBatch(args.batchId);
  if (!batch) throw new Error("Revision batch not found");
  const ts = nowIso();
  const patch: Record<string, unknown> = { status: args.newStatus, updatedAt: ts };
  if (args.newStatus === "Verified") {
    patch.dvUser = args.userId ?? null;
    patch.verifiedAt = ts;
  }
  if (args.newStatus === "Approved") {
    patch.daUser = args.userId ?? null;
    patch.approvedAt = ts;
  }
  if (args.newStatus === "Returned") patch.returnRemarks = args.remarks ?? null;
  if (args.newStatus === "Rejected") patch.rejectionRemarks = args.remarks ?? null;
  await db.update(rentRevisionBatches).set(patch as never).where(eq(rentRevisionBatches.id, args.batchId));

  if (args.newStatus === "Approved") {
    for (const line of batch.lines) {
      await db
        .update(agreementPremisesLines)
        .set({ monthlyRent: line.revisedRent, updatedAt: ts })
        .where(eq(agreementPremisesLines.id, line.agreementLineId));
      const [agrLine] = await db
        .select()
        .from(agreementPremisesLines)
        .where(eq(agreementPremisesLines.id, line.agreementLineId))
        .limit(1);
      if (agrLine?.legacyAssetAllotmentId) {
        await db
          .update(assetAllotments)
          .set({ monthlyRent: line.revisedRent })
          .where(eq(assetAllotments.id, agrLine.legacyAssetAllotmentId));
      }
      if (agrLine?.legacyEntityAllotmentId) {
        await db
          .update(entityAllotments)
          .set({ monthlyRent: line.revisedRent })
          .where(eq(entityAllotments.id, agrLine.legacyEntityAllotmentId));
      }
    }
    if (batch.renewalId) {
      await db
        .update(agreementRenewals)
        .set({ status: "Initiated", updatedAt: ts })
        .where(eq(agreementRenewals.id, batch.renewalId));
      await db
        .update(premisesAgreements)
        .set({ renewalStatus: "RenewalPending", updatedAt: ts })
        .where(eq(premisesAgreements.id, batch.agreementId));
    }
  }
  return getRevisionBatch(args.batchId);
}

export async function transitionPenalty(args: {
  penaltyId: string;
  newStatus: "Verified" | "Approved" | "Returned" | "Rejected";
  userId?: string;
  remarks?: string;
}) {
  const [pen] = await db.select().from(delayPenalties).where(eq(delayPenalties.id, args.penaltyId)).limit(1);
  if (!pen) throw new Error("Penalty not found");
  const ts = nowIso();
  const patch: Record<string, unknown> = { status: args.newStatus, updatedAt: ts };
  if (args.newStatus === "Verified") {
    patch.dvUser = args.userId ?? null;
    patch.verifiedAt = ts;
  }
  if (args.newStatus === "Approved") {
    patch.daUser = args.userId ?? null;
    patch.approvedAt = ts;
  }
  if (args.newStatus === "Returned") patch.returnRemarks = args.remarks ?? null;
  if (args.newStatus === "Rejected") patch.rejectionRemarks = args.remarks ?? null;
  await db.update(delayPenalties).set(patch as never).where(eq(delayPenalties.id, args.penaltyId));
  if (args.newStatus === "Approved" && pen.renewalId) {
    await db
      .update(agreementRenewals)
      .set({ status: "Initiated", updatedAt: ts })
      .where(eq(agreementRenewals.id, pen.renewalId));
    await db
      .update(premisesAgreements)
      .set({ renewalStatus: "RenewalPending", updatedAt: ts })
      .where(eq(premisesAgreements.id, pen.agreementId));
  }
  const [row] = await db.select().from(delayPenalties).where(eq(delayPenalties.id, args.penaltyId)).limit(1);
  return row;
}

export async function getAgreementHistory(agreementId: string) {
  const detail = await getAgreementDetail(agreementId);
  if (!detail) return null;
  const renewals = await db
    .select()
    .from(agreementRenewals)
    .where(eq(agreementRenewals.agreementId, agreementId))
    .orderBy(desc(agreementRenewals.createdAt));
  const notices = await db
    .select()
    .from(renewalNotices)
    .where(eq(renewalNotices.agreementId, agreementId))
    .orderBy(desc(renewalNotices.versionNo));
  const batches = await db
    .select()
    .from(rentRevisionBatches)
    .where(eq(rentRevisionBatches.agreementId, agreementId))
    .orderBy(desc(rentRevisionBatches.createdAt));
  const batchIds = batches.map((b) => b.id);
  const revLines =
    batchIds.length === 0
      ? []
      : await db.select().from(rentRevisionLines).where(inArray(rentRevisionLines.batchId, batchIds));
  const penalties = await db
    .select()
    .from(delayPenalties)
    .where(eq(delayPenalties.agreementId, agreementId))
    .orderBy(desc(delayPenalties.createdAt));
  const vacations = await db
    .select()
    .from(vacationEvictionEvents)
    .where(eq(vacationEvictionEvents.agreementId, agreementId))
    .orderBy(desc(vacationEvictionEvents.createdAt));
  const settlements = await db
    .select()
    .from(fullFinalSettlements)
    .where(eq(fullFinalSettlements.agreementId, agreementId))
    .orderBy(desc(fullFinalSettlements.createdAt));
  const demands = await db
    .select()
    .from(finalDemandNotices)
    .where(eq(finalDemandNotices.agreementId, agreementId))
    .orderBy(desc(finalDemandNotices.generatedAt));
  return {
    agreement: detail,
    renewals,
    notices,
    revisions: batches.map((b) => ({ ...b, lines: revLines.filter((l) => l.batchId === b.id) })),
    penalties,
    vacations,
    settlements,
    demands,
  };
}

export async function recordVacation(args: {
  agreementId: string;
  agreementLineId: string;
  caseType: string;
  intimationDate?: string;
  proposedVacationDate?: string;
  actualVacationDate?: string;
  orderType?: string;
  orderRefNo?: string;
  orderDate?: string;
  remarks?: string;
  createdBy?: string;
}) {
  const [line] = await db
    .select()
    .from(agreementPremisesLines)
    .where(eq(agreementPremisesLines.id, args.agreementLineId))
    .limit(1);
  if (!line || line.agreementId !== args.agreementId) throw new Error("Agreement line not found");
  const ts = nowIso();
  const eventId = nanoid();
  const actual = args.actualVacationDate ?? todayYmd();
  await db.insert(vacationEvictionEvents).values({
    id: eventId,
    agreementId: args.agreementId,
    agreementLineId: args.agreementLineId,
    caseType: args.caseType,
    intimationDate: args.intimationDate ?? null,
    proposedVacationDate: args.proposedVacationDate ?? null,
    actualVacationDate: actual,
    orderType: args.orderType ?? null,
    orderRefNo: args.orderRefNo ?? null,
    orderDate: args.orderDate ?? null,
    remarks: args.remarks ?? null,
    createdBy: args.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  });

  if (args.caseType === "PrematureIntimation" && !args.actualVacationDate) {
    await db
      .update(agreementPremisesLines)
      .set({ tenancyStatus: "Vacating", updatedAt: ts })
      .where(eq(agreementPremisesLines.id, args.agreementLineId));
    if (line.legacyAssetAllotmentId) {
      await db.update(assetAllotments).set({ status: "Vacating" }).where(eq(assetAllotments.id, line.legacyAssetAllotmentId));
    }
    if (line.legacyEntityAllotmentId) {
      await db.update(entityAllotments).set({ status: "Vacating" }).where(eq(entityAllotments.id, line.legacyEntityAllotmentId));
    }
  } else {
    await db
      .update(agreementPremisesLines)
      .set({ tenancyStatus: "Vacated", vacatedOn: actual, updatedAt: ts })
      .where(eq(agreementPremisesLines.id, args.agreementLineId));
    if (line.legacyAssetAllotmentId) {
      await db.update(assetAllotments).set({ status: "Vacated" }).where(eq(assetAllotments.id, line.legacyAssetAllotmentId));
    }
    if (line.legacyEntityAllotmentId) {
      await db.update(entityAllotments).set({ status: "Vacated" }).where(eq(entityAllotments.id, line.legacyEntityAllotmentId));
    }
  }
  await syncPremisesStatusFromTenancy(line.assetId);

  const settlement = await createSettlementDraft({
    agreementId: args.agreementId,
    agreementLineId: args.agreementLineId,
    vacationEventId: eventId,
    createdBy: args.createdBy,
  });
  return { eventId, settlement };
}

export async function createSettlementDraft(args: {
  agreementId: string;
  agreementLineId: string;
  vacationEventId: string;
  createdBy?: string;
  outstandingRent?: number;
  interestAmount?: number;
  otherDues?: number;
  additionalReceivable?: number;
  deductions?: number;
}) {
  const [line] = await db
    .select()
    .from(agreementPremisesLines)
    .where(eq(agreementPremisesLines.id, args.agreementLineId))
    .limit(1);
  if (!line) throw new Error("Line not found");
  const depositHeld = Number(line.depositShare ?? 0);
  const outstandingRent = Number(args.outstandingRent ?? 0);
  const interestAmount = Number(args.interestAmount ?? 0);
  const otherDues = Number(args.otherDues ?? 0);
  const additionalReceivable = Number(args.additionalReceivable ?? 0);
  const deductions = Number(args.deductions ?? 0);
  const totalOutstanding = outstandingRent + interestAmount + otherDues + additionalReceivable;
  const netDepositRefundable = depositHeld - deductions;
  // Positive = recoverable from lessee; negative = refundable
  const systemCalculatedNet = Math.round((totalOutstanding - netDepositRefundable) * 100) / 100;
  const ts = nowIso();
  const id = nanoid();
  await db.insert(fullFinalSettlements).values({
    id,
    agreementId: args.agreementId,
    agreementLineId: args.agreementLineId,
    vacationEventId: args.vacationEventId,
    revisionNo: 1,
    outstandingRent,
    interestAmount,
    otherDues,
    additionalReceivable,
    depositHeld,
    deductions,
    systemCalculatedNet,
    status: "Draft",
    createdBy: args.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  });
  const [row] = await db.select().from(fullFinalSettlements).where(eq(fullFinalSettlements.id, id)).limit(1);
  return row;
}

export async function approveSettlement(args: {
  settlementId: string;
  userId?: string;
  approvedAdjustments?: unknown[];
  finalApprovedNet?: number;
}) {
  const [row] = await db
    .select()
    .from(fullFinalSettlements)
    .where(eq(fullFinalSettlements.id, args.settlementId))
    .limit(1);
  if (!row) throw new Error("Settlement not found");
  const ts = nowIso();
  const finalNet =
    args.finalApprovedNet != null ? Number(args.finalApprovedNet) : Number(row.systemCalculatedNet);
  await db
    .update(fullFinalSettlements)
    .set({
      status: "Approved",
      daUser: args.userId ?? null,
      approvedAt: ts,
      approvedAdjustmentsJson: args.approvedAdjustments ? JSON.stringify(args.approvedAdjustments) : row.approvedAdjustmentsJson,
      finalApprovedNet: finalNet,
      updatedAt: ts,
    })
    .where(eq(fullFinalSettlements.id, args.settlementId));
  const [updated] = await db
    .select()
    .from(fullFinalSettlements)
    .where(eq(fullFinalSettlements.id, args.settlementId))
    .limit(1);
  return updated;
}

export async function createFinalDemandNotice(args: {
  settlementId: string;
  paymentDueDate?: string;
  generatedBy?: string;
}) {
  const [setl] = await db
    .select()
    .from(fullFinalSettlements)
    .where(eq(fullFinalSettlements.id, args.settlementId))
    .limit(1);
  if (!setl) throw new Error("Settlement not found");
  if (setl.status !== "Approved") throw new Error("Settlement must be approved.");
  const payable = Number(setl.finalApprovedNet ?? setl.systemCalculatedNet ?? 0);
  if (payable <= 0.005) throw new Error("Final demand notice requires a recoverable balance.");
  const existing = await db
    .select()
    .from(finalDemandNotices)
    .where(eq(finalDemandNotices.settlementId, args.settlementId))
    .orderBy(desc(finalDemandNotices.versionNo));
  const versionNo = (existing[0]?.versionNo ?? 0) + 1;
  const noticeNo = await nextSeq("demand");
  const id = nanoid();
  await db.insert(finalDemandNotices).values({
    id,
    settlementId: args.settlementId,
    agreementId: setl.agreementId,
    noticeNo,
    versionNo,
    noticeDate: todayYmd(),
    paymentDueDate: args.paymentDueDate ?? null,
    totalPayable: payable,
    generatedBy: args.generatedBy ?? null,
    generatedAt: nowIso(),
  });
  const [row] = await db.select().from(finalDemandNotices).where(eq(finalDemandNotices.id, id)).limit(1);
  return row;
}

export async function listApprovalsQueue() {
  const revisions = await db
    .select()
    .from(rentRevisionBatches)
    .where(inArray(rentRevisionBatches.status, ["Draft", "Verified", "Returned"]))
    .orderBy(desc(rentRevisionBatches.createdAt));
  const penalties = await db
    .select()
    .from(delayPenalties)
    .where(inArray(delayPenalties.status, ["Draft", "Verified", "Returned"]))
    .orderBy(desc(delayPenalties.createdAt));
  return { revisions, penalties };
}

export async function misReport(reportKey: string) {
  const list = await listPremisesAgreements({});
  const asOf = todayYmd();
  switch (reportKey) {
    case "due-2-months":
      return list.filter((a) => a.renewalStatus === "RenewalDue" || (a.daysToExpiry != null && a.daysToExpiry >= 0 && a.daysToExpiry <= 60));
    case "expired-not-renewed":
      return list.filter((a) => a.renewalStatus === "Expired" || a.renewalStatus === "PenaltyApplicable");
    case "notices":
      return db.select().from(renewalNotices).orderBy(desc(renewalNotices.generatedAt));
    case "notice-dispatch":
      return db.select().from(renewalNotices).orderBy(desc(renewalNotices.generatedAt));
    case "renewed":
      return list.filter((a) => a.renewalStatus === "Renewed");
    case "pending-renewal":
      return list.filter((a) =>
        ["RenewalInitiated", "RenewalPending", "NoticeGenerated", "RentRevisionPending"].includes(a.renewalStatus),
      );
    case "revision-due":
      return list.filter((a) => a.revisionDue);
    case "revision-history":
      return db.select().from(rentRevisionBatches).orderBy(desc(rentRevisionBatches.createdAt));
    case "premises-renewal-history":
      return db.select().from(agreementRenewals).orderBy(desc(agreementRenewals.createdAt));
    case "penalties":
    case "delay-penalty":
      return db.select().from(delayPenalties).orderBy(desc(delayPenalties.createdAt));
    case "penalties-pending":
      return db
        .select()
        .from(delayPenalties)
        .where(inArray(delayPenalties.status, ["Draft", "Verified", "Returned"]))
        .orderBy(desc(delayPenalties.createdAt));
    case "penalties-approved":
      return db
        .select()
        .from(delayPenalties)
        .where(inArray(delayPenalties.status, ["Approved"]))
        .orderBy(desc(delayPenalties.createdAt));
    case "security-deposit":
      return list.map((a) => ({
        agreementNo: a.agreementNo,
        allotteeName: a.allotteeName,
        totalSecurityDeposit: a.totalSecurityDeposit,
        premises: a.premises,
        renewalStatus: a.renewalStatus,
      }));
    case "audit-trail":
      return db.select().from(agreementRenewals).orderBy(desc(agreementRenewals.createdAt));
    case "current-status":
      return list;
    default:
      return list;
  }
}

export async function summaryCards() {
  const list = await listPremisesAgreements({});
  return {
    dueForRenewal: list.filter((a) => a.renewalStatus === "RenewalDue").length,
    expiredNotRenewed: list.filter((a) => a.renewalStatus === "Expired" || a.renewalStatus === "PenaltyApplicable").length,
    revisionDueAtNextRenewal: list.filter((a) =>
      isRentRevisionDueForPeriod(a.agreementPeriodNumber + 1, a.rentRevisionFrequency),
    ).length,
    penaltiesAwaiting: (
      await db
        .select({ c: sql<number>`count(*)::int` })
        .from(delayPenalties)
        .where(inArray(delayPenalties.status, ["Draft", "Verified", "Returned"]))
    )[0]?.c ?? 0,
  };
}
