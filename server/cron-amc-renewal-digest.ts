/**
 * M-08: AMC renewal alert count only (daily digest). Uses same compute as operational-alerts.
 */
import { db } from "./db";
import { amcContracts } from "@shared/db-schema";
import { computeAmcRenewalAlerts } from "./operational-alerts";
import { sendNotificationStub } from "./notify";
import { writeAuditLogSystem } from "./audit";

export async function runAmcRenewalDigest(): Promise<{ amcAlerts: number }> {
  const aList = await db.select().from(amcContracts);
  const amcAlerts = computeAmcRenewalAlerts(aList).length;
  sendNotificationStub({
    kind: "operational_digest",
    fleetAlertCount: 0,
    amcAlertCount: amcAlerts,
  });
  writeAuditLogSystem({
    module: "Cron",
    action: "AmcRenewalDigest",
    recordId: new Date().toISOString().slice(0, 10),
    afterValue: { amcAlerts },
  }).catch((e) => console.error("Audit log failed:", e));
  return { amcAlerts };
}
