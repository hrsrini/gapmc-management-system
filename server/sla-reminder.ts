/**
 * CC-07: periodic SLA check using gapmc.sla_config + overdue workflow rows (stub notify).
 * Set SLA_REMINDER=false to disable. Wire sendNotificationStub → provider for production.
 */
import { and, desc, eq, isNotNull, lte, ne, or } from "drizzle-orm";
import { db } from "./db";
import { slaConfig, rentInvoices, paymentVouchers, dakInward, dakEscalations, employees } from "@shared/db-schema";
import { sendNotificationStub } from "./notify";
import { isEmployeeDraftStale } from "./hr-employee-rules";
import { nanoid } from "nanoid";

const INTERVAL_MS = 60 * 60 * 1000; // hourly

/** BR-EMP-05: avoid repeating the same stale-draft alert every hour (once per UTC day is enough). */
let lastHrEmployeeDraftNotifyUtcDay: string | null = null;

function cutoffIso(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

async function runSlaTick(): Promise<void> {
  const rules = await db.select().from(slaConfig);
  if (rules.length === 0) return;

  for (const rule of rules) {
    const w = (rule.workflow ?? "").toUpperCase();
    const hours = Number(rule.hours) || 24;
    const cut = cutoffIso(hours);
    let overdueCount = 0;
    let detail = "No matching overdue rows for this rule.";

    try {
      if (w.includes("M-03") || w.includes("RENT")) {
        const rows = await db
          .select({ id: rentInvoices.id })
          .from(rentInvoices)
          .where(
            and(eq(rentInvoices.status, "Draft"), isNotNull(rentInvoices.generatedAt), lte(rentInvoices.generatedAt, cut))
          );
        overdueCount = rows.length;
        detail =
          overdueCount > 0
            ? `${overdueCount} rent invoice(s) still Draft older than ${hours}h (by generatedAt).`
            : detail;
      } else if (w.includes("M-06") || w.includes("VOUCHER")) {
        const rows = await db
          .select({ id: paymentVouchers.id })
          .from(paymentVouchers)
          .where(
            and(
              or(eq(paymentVouchers.status, "Submitted"), eq(paymentVouchers.status, "Draft")),
              isNotNull(paymentVouchers.createdAt),
              lte(paymentVouchers.createdAt, cut)
            )
          );
        overdueCount = rows.length;
        detail =
          overdueCount > 0
            ? `${overdueCount} voucher(s) Draft/Submitted older than ${hours}h (by createdAt).`
            : detail;
      } else if (w.includes("M-09") || w.includes("DAK")) {
        const today = new Date().toISOString().slice(0, 10);
        const rows = await db
          .select({
            id: dakInward.id,
            deadline: dakInward.deadline,
            status: dakInward.status,
            subject: dakInward.subject,
            assignedTo: dakInward.assignedTo,
          })
          .from(dakInward)
          .where(
            and(isNotNull(dakInward.deadline), lte(dakInward.deadline, today), ne(dakInward.status, "Closed")),
          );
        overdueCount = rows.length;
        let escalated = 0;
        for (const r of rows) {
          const [lastEsc] = await db
            .select()
            .from(dakEscalations)
            .where(eq(dakEscalations.inwardId, r.id))
            .orderBy(desc(dakEscalations.escalatedAt))
            .limit(1);
          if (lastEsc?.escalatedAt?.startsWith(today)) continue;
          const eid = nanoid();
          const assignee = r.assignedTo?.trim();
          await db.insert(dakEscalations).values({
            id: eid,
            inwardId: r.id,
            escalatedTo: assignee || rule.alertRole?.trim() || "DA",
            escalatedAt: new Date().toISOString(),
            escalationReason: `SLA overdue (deadline ${r.deadline}, status ${r.status}): ${(r.subject ?? "").slice(0, 200)}`,
            resolvedAt: null,
          });
          escalated += 1;
        }
        detail =
          overdueCount > 0
            ? `${overdueCount} inward dak item(s) past deadline (not Closed) as of ${today}; ${escalated} new escalation record(s).`
            : detail;
      }

      sendNotificationStub({
        kind: "sla_reminder",
        workflow: rule.workflow,
        hours,
        alertRole: rule.alertRole ?? null,
        message: detail,
        overdueCount,
      });
    } catch (e) {
      console.error("[SLA] rule check failed:", rule.workflow, e);
    }
  }

  // BR-EMP-05: Draft/Submitted employee registrations stale > 15 working days (admin/DA alert stub)
  try {
    const empRows = await db
      .select({
        id: employees.id,
        createdAt: employees.createdAt,
        status: employees.status,
      })
      .from(employees)
      .where(or(eq(employees.status, "Draft"), eq(employees.status, "Submitted")));
    const stale = empRows.filter((r) => isEmployeeDraftStale(r.createdAt, r.status));
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (stale.length > 0 && lastHrEmployeeDraftNotifyUtcDay !== todayUtc) {
      lastHrEmployeeDraftNotifyUtcDay = todayUtc;
      const ids = stale.map((s) => s.id).slice(0, 25);
      const suffix = stale.length > 25 ? " …" : "";
      sendNotificationStub({
        kind: "sla_reminder",
        workflow: "M-01-EMPLOYEE-DRAFT",
        hours: 0,
        alertRole: "DA",
        message: `M-01: ${stale.length} employee registration(s) in Draft or Submitted for more than 15 working days (IDs: ${ids.join(", ")}${suffix}).`,
        overdueCount: stale.length,
      });
    }
  } catch (e) {
    console.error("[SLA] HR employee draft check failed:", e);
  }
}

export function startSlaReminderLoop(): void {
  const tick = () => {
    runSlaTick().catch((e) => console.error("[SLA] tick failed:", e));
  };
  tick();
  setInterval(tick, INTERVAL_MS);
}
