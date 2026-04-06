/**
 * M-07 / M-08: daily digest of fleet + AMC renewal alerts (stub notify + optional audit).
 */
import { db } from "./db";
import { vehicles, amcContracts } from "@shared/db-schema";
import { computeFleetRenewalAlerts, computeAmcRenewalAlerts } from "./operational-alerts";
import { sendNotificationStub } from "./notify";
import { writeAuditLogSystem } from "./audit";

export async function runOperationalRemindersDigest(): Promise<{
  fleetAlerts: number;
  amcAlerts: number;
}> {
  const vList = await db.select().from(vehicles);
  const aList = await db.select().from(amcContracts);
  const fleetAlerts = computeFleetRenewalAlerts(vList).length;
  const amcAlerts = computeAmcRenewalAlerts(aList).length;
  sendNotificationStub({
    kind: "operational_digest",
    fleetAlertCount: fleetAlerts,
    amcAlertCount: amcAlerts,
  });
  writeAuditLogSystem({
    module: "Cron",
    action: "OperationalDigest",
    recordId: new Date().toISOString().slice(0, 10),
    afterValue: { fleetAlerts, amcAlerts },
  }).catch((e) => console.error("Audit log failed:", e));
  return { fleetAlerts, amcAlerts };
}
