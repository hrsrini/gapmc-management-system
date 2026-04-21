/**
 * M-07 / M-08: insurance, fitness, and AMC contract end dates within 60 days (or overdue).
 */
import type { InferSelectModel } from "drizzle-orm";
import { vehicles, amcContracts, vehicleMaintenance } from "@shared/db-schema";

type VehicleRow = InferSelectModel<typeof vehicles>;
type AmcRow = InferSelectModel<typeof amcContracts>;
type MaintRow = InferSelectModel<typeof vehicleMaintenance>;

export function isoDatePart(s: string | null | undefined): string | null {
  if (s == null || String(s).trim() === "") return null;
  return String(s).trim().slice(0, 10);
}

/** Whole days from UTC today to isoDate (YYYY-MM-DD). Negative = already expired. */
export function daysUntilIsoDate(isoDate: string): number {
  const [Y, M, D] = isoDate.split("-").map(Number);
  const target = Date.UTC(Y, M - 1, D);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

export type FleetRenewalAlert = {
  vehicleId: string;
  registrationNo: string;
  yardId: string;
  kind: "insurance" | "fitness";
  expiryDate: string;
  daysRemaining: number;
  urgency: "overdue" | "30d" | "60d";
};

export function computeFleetRenewalAlerts(rows: VehicleRow[]): FleetRenewalAlert[] {
  const out: FleetRenewalAlert[] = [];
  for (const v of rows) {
    if (v.status === "Decommissioned") continue;
    for (const kind of ["insurance", "fitness"] as const) {
      const raw = kind === "insurance" ? v.insuranceExpiry : v.fitnessExpiry;
      const iso = isoDatePart(raw);
      if (!iso) continue;
      const d = daysUntilIsoDate(iso);
      if (d > 60) continue;
      const urgency = d < 0 ? "overdue" : d <= 30 ? "30d" : "60d";
      out.push({
        vehicleId: v.id,
        registrationNo: v.registrationNo,
        yardId: v.yardId,
        kind,
        expiryDate: iso,
        daysRemaining: d,
        urgency,
      });
    }
  }
  out.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return out;
}

export type AmcRenewalAlert = {
  contractId: string;
  yardId: string;
  contractorName: string;
  contractEnd: string;
  daysRemaining: number;
  urgency: "overdue" | "30d" | "60d";
};

export function computeAmcRenewalAlerts(rows: AmcRow[]): AmcRenewalAlert[] {
  const out: AmcRenewalAlert[] = [];
  for (const a of rows) {
    if (a.status !== "Active") continue;
    const iso = isoDatePart(a.contractEnd);
    if (!iso) continue;
    const d = daysUntilIsoDate(iso);
    if (d > 60) continue;
    const urgency = d < 0 ? "overdue" : d <= 30 ? "30d" : "60d";
    out.push({
      contractId: a.id,
      yardId: a.yardId,
      contractorName: a.contractorName,
      contractEnd: iso,
      daysRemaining: d,
      urgency,
    });
  }
  out.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return out;
}

/** Rows with `next_service_date` within `withinDays` of today (UTC), joined to vehicle registration / yard. */
export function listFleetMaintenanceDueEnriched(
  vehiclesList: VehicleRow[],
  maintRows: MaintRow[],
  withinDays: number,
): Array<MaintRow & { registrationNo: string; yardId: string; overdue: boolean }> {
  const byId = Object.fromEntries(vehiclesList.map((v) => [v.id, v]));
  const ids = new Set(vehiclesList.map((v) => v.id));

  const today = new Date();
  const limit = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + withinDays));
  const limitIso = limit.toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);

  const out: Array<MaintRow & { registrationNo: string; yardId: string; overdue: boolean }> = [];
  for (const m of maintRows) {
    if (!ids.has(m.vehicleId)) continue;
    const nd = m.nextServiceDate?.trim().slice(0, 10);
    if (!nd || nd > limitIso) continue;
    const v = byId[m.vehicleId];
    if (!v) continue;
    const overdue = nd < todayIso;
    out.push({
      ...m,
      registrationNo: v.registrationNo,
      yardId: v.yardId,
      overdue,
    });
  }
  out.sort((a, b) => String(a.nextServiceDate ?? "").localeCompare(String(b.nextServiceDate ?? "")));
  return out;
}
