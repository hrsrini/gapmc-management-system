/**
 * M-02 Premises Register — unified asset + occupancy view (replaces separate Asset Register / Shop Vacant lists).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { assets, assetAllotments, entityAllotments, yards } from "@shared/db-schema";
import {
  normalizePremisesStatus,
  todayYmdUtc,
  type PremisesStatus,
} from "@shared/premises-allocation";
import {
  addDaysYmd,
  daysBetweenYmd,
  normalizeAgreementExpiryFilter,
  type AgreementExpiryFilter,
  type PremisesRegisterAlert,
  type PremisesRegisterResponse,
  type PremisesRegisterRow,
} from "@shared/premises-register";

const OCCUPANCY_STATUSES = new Set(["Active", "Vacating"]);

type OccupancyCandidate = {
  source: "trader" | "entity";
  id: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  monthlyRent: number;
  consecutiveRenewalCount: number;
  status: string;
};

function pickCurrentOccupancy(
  traderRows: Array<typeof assetAllotments.$inferSelect>,
  entityRows: Array<typeof entityAllotments.$inferSelect>,
): OccupancyCandidate | null {
  const candidates: OccupancyCandidate[] = [];
  for (const row of traderRows) {
    if (!OCCUPANCY_STATUSES.has(String(row.status ?? ""))) continue;
    candidates.push({
      source: "trader",
      id: row.id,
      allotteeName: row.allotteeName,
      fromDate: row.fromDate,
      toDate: row.toDate,
      monthlyRent: row.monthlyRent ?? 0,
      consecutiveRenewalCount: row.consecutiveRenewalCount ?? 0,
      status: String(row.status ?? ""),
    });
  }
  for (const row of entityRows) {
    if (!OCCUPANCY_STATUSES.has(String(row.status ?? ""))) continue;
    candidates.push({
      source: "entity",
      id: row.id,
      allotteeName: row.allotteeName,
      fromDate: row.fromDate,
      toDate: row.toDate,
      monthlyRent: row.monthlyRent ?? 0,
      consecutiveRenewalCount: row.consecutiveRenewalCount ?? 0,
      status: String(row.status ?? ""),
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.status === "Active" && b.status !== "Active") return -1;
    if (b.status === "Active" && a.status !== "Active") return 1;
    return b.toDate.localeCompare(a.toDate);
  });
  return candidates[0] ?? null;
}

function matchesAgreementExpiry(
  agreementTo: string | null,
  filter: AgreementExpiryFilter,
  todayYmd: string,
): boolean {
  if (filter === "all") return true;
  if (!agreementTo) return false;
  const to = agreementTo.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return false;
  if (filter === "expired") return to < todayYmd;
  const horizon =
    filter === "next30" ? addDaysYmd(todayYmd, 30) : addDaysYmd(todayYmd, 60);
  if (!horizon) return false;
  return to >= todayYmd && to <= horizon;
}

export interface PremisesRegisterQuery {
  yardId?: string;
  premisesType?: string;
  premisesStatus?: string;
  allottee?: string;
  assetId?: string;
  agreementExpiry?: string;
  scopedLocationIds?: string[];
}

export async function fetchPremisesRegister(query: PremisesRegisterQuery): Promise<PremisesRegisterResponse> {
  const todayYmd = todayYmdUtc();
  const agreementExpiry = normalizeAgreementExpiryFilter(query.agreementExpiry);
  const assetIdQ = String(query.assetId ?? "").trim().toLowerCase();
  const allotteeQ = String(query.allottee ?? "").trim().toLowerCase();
  const premisesTypeQ = String(query.premisesType ?? "").trim();
  const premisesStatusQ = String(query.premisesStatus ?? "").trim();
  const yardIdQ = String(query.yardId ?? "").trim();

  const assetConditions = [];
  if (query.scopedLocationIds && query.scopedLocationIds.length > 0) {
    assetConditions.push(inArray(assets.yardId, query.scopedLocationIds));
  }
  if (yardIdQ) assetConditions.push(eq(assets.yardId, yardIdQ));

  const assetBase = db.select().from(assets).orderBy(assets.assetId);
  const allAssets =
    assetConditions.length > 0 ? await assetBase.where(and(...assetConditions)) : await assetBase;

  const yardRows = await db.select({ id: yards.id, name: yards.name }).from(yards);
  const yardNameById = Object.fromEntries(yardRows.map((y) => [y.id, y.name ?? y.id]));

  const traderAllotments = await db.select().from(assetAllotments).orderBy(desc(assetAllotments.toDate));
  const entityAllotRows = await db.select().from(entityAllotments).orderBy(desc(entityAllotments.toDate));

  const traderByAsset = new Map<string, typeof traderAllotments>();
  for (const row of traderAllotments) {
    const list = traderByAsset.get(row.assetId) ?? [];
    list.push(row);
    traderByAsset.set(row.assetId, list);
  }
  const entityByAsset = new Map<string, typeof entityAllotRows>();
  for (const row of entityAllotRows) {
    const list = entityByAsset.get(row.assetId) ?? [];
    list.push(row);
    entityByAsset.set(row.assetId, list);
  }

  const allotteeNames = new Set<string>();
  const allRows: PremisesRegisterRow[] = [];

  for (const asset of allAssets) {
    const premisesStatus = (normalizePremisesStatus(asset.premisesStatus) ?? "Vacant") as PremisesStatus;
    const occupancy = pickCurrentOccupancy(
      traderByAsset.get(asset.id) ?? traderByAsset.get(asset.assetId) ?? [],
      entityByAsset.get(asset.id) ?? entityByAsset.get(asset.assetId) ?? [],
    );

    if (occupancy?.allotteeName) allotteeNames.add(occupancy.allotteeName);

    allRows.push({
      id: asset.id,
      assetId: asset.assetId,
      yardId: asset.yardId,
      yardName: yardNameById[asset.yardId] ?? asset.yardId,
      assetType: asset.assetType,
      area: asset.area ?? null,
      premisesStatus,
      currentAllottee: occupancy?.allotteeName ?? null,
      agreementFrom: occupancy?.fromDate?.slice(0, 10) ?? null,
      agreementTo: occupancy?.toDate?.slice(0, 10) ?? null,
      monthlyRent: occupancy != null ? occupancy.monthlyRent : null,
      renewalCount: occupancy != null ? occupancy.consecutiveRenewalCount : null,
      allotmentId: occupancy?.id ?? null,
      allotmentSource: occupancy?.source ?? null,
    });
  }

  const builtRows = allRows.filter((row) => {
    if (premisesTypeQ && premisesTypeQ !== "all" && row.assetType !== premisesTypeQ) return false;
    if (premisesStatusQ && premisesStatusQ !== "all" && row.premisesStatus !== premisesStatusQ) return false;
    if (allotteeQ && allotteeQ !== "all") {
      const name = (row.currentAllottee ?? "").toLowerCase();
      if (name !== allotteeQ) return false;
    }
    if (assetIdQ && !row.assetId.toLowerCase().includes(assetIdQ)) return false;
    if (!matchesAgreementExpiry(row.agreementTo, agreementExpiry, todayYmd)) return false;
    return true;
  });

  const alerts: PremisesRegisterAlert[] = [];
  const alertHorizon = addDaysYmd(todayYmd, 60);
  for (const row of allRows) {
    if (!row.agreementTo || !row.currentAllottee) continue;
    const to = row.agreementTo.slice(0, 10);
    if (!alertHorizon || to < todayYmd || to > alertHorizon) continue;
    const daysLeft = daysBetweenYmd(todayYmd, to);
    if (daysLeft == null) continue;
    alerts.push({
      id: row.id,
      assetId: row.assetId,
      yardId: row.yardId,
      yardName: row.yardName,
      assetType: row.assetType,
      currentAllottee: row.currentAllottee,
      agreementTo: to,
      daysLeft,
      monthlyRent: row.monthlyRent,
      allotmentId: row.allotmentId,
    });
  }
  alerts.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    rows: builtRows,
    alerts,
    allotteeOptions: Array.from(allotteeNames).sort((a, b) => a.localeCompare(b)),
  };
}
