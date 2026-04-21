/**
 * M-07 / M-08: daily digest of fleet + AMC renewal alerts (stub notify + optional audit).
 */
import { inArray } from "drizzle-orm";
import { db } from "./db";
import { vehicles, amcContracts, vehicleMaintenance } from "@shared/db-schema";
import {
  computeFleetRenewalAlerts,
  computeAmcRenewalAlerts,
  listFleetMaintenanceDueEnriched,
} from "./operational-alerts";
import { sendNotificationStub } from "./notify";
import { writeAuditLogSystem } from "./audit";

export async function runOperationalRemindersDigest(): Promise<{
  fleetAlerts: number;
  amcAlerts: number;
  maintenanceDue: number;
}> {
  const vList = await db.select().from(vehicles);
  const aList = await db.select().from(amcContracts);
  const fleetAlerts = computeFleetRenewalAlerts(vList).length;
  const amcAlerts = computeAmcRenewalAlerts(aList).length;
  const vehicleIds = vList.map((v) => v.id);
  let maintenanceDue = 0;
  if (vehicleIds.length > 0) {
    const maint = await db.select().from(vehicleMaintenance).where(inArray(vehicleMaintenance.vehicleId, vehicleIds));
    maintenanceDue = listFleetMaintenanceDueEnriched(vList, maint, 60).length;
  }
  sendNotificationStub({
    kind: "operational_digest",
    fleetAlertCount: fleetAlerts,
    amcAlertCount: amcAlerts,
    maintenanceDueCount: maintenanceDue,
  });
  writeAuditLogSystem({
    module: "Cron",
    action: "OperationalDigest",
    recordId: new Date().toISOString().slice(0, 10),
    afterValue: { fleetAlerts, amcAlerts, maintenanceDue },
  }).catch((e) => console.error("Audit log failed:", e));
  return { fleetAlerts, amcAlerts, maintenanceDue };
}
