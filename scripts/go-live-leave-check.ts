/**
 * Go-live readiness check for Leave Management (M-01).
 * Usage: npm run go-live:leave-check
 */
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

type Check = { ok: boolean; name: string; detail: string };

async function columnExists(client: pg.Client, table: string, column: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'gapmc' AND table_name = $1 AND column_name = $2
     LIMIT 1`,
    [table, column],
  );
  return r.rowCount != null && r.rowCount > 0;
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'gapmc' AND table_name = $1 LIMIT 1`,
    [table],
  );
  return r.rowCount != null && r.rowCount > 0;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const checks: Check[] = [];

  try {
    const requiredLeaveCols = [
      "prefix_days",
      "debit_days",
      "file_no",
      "rejoining_date",
      "revised_from_leave_id",
      "superseded_by_leave_id",
      "joining_report_pdf_url",
      "fitness_cert_url",
      "joining_report_ack_at",
    ];
    for (const col of requiredLeaveCols) {
      const ok = await columnExists(client, "leave_requests", col);
      checks.push({
        ok,
        name: `leave_requests.${col}`,
        detail: ok ? "present" : "MISSING — run db:apply-leave-redevelopment-phase-a and/or db:apply-leave-rejoining-revised",
      });
    }

    checks.push({
      ok: await columnExists(client, "yards", "email"),
      name: "yards.email",
      detail: "Location notification email for sanction-order copies",
    });
    checks.push({
      ok: await columnExists(client, "employee_leave_balances", "set_off_days"),
      name: "employee_leave_balances.set_off_days",
      detail: "EL set-off bucket",
    });
    checks.push({
      ok: await tableExists(client, "hr_holidays"),
      name: "hr_holidays",
      detail: "Holiday master",
    });
    checks.push({
      ok: await tableExists(client, "leave_order_sequence"),
      name: "leave_order_sequence",
      detail: "Sanction order file numbering",
    });

    const cfg = await client.query(
      `SELECT key, value FROM gapmc.system_config
       WHERE key IN (
         'leave_order_signatory_designation',
         'leave_order_signatory_name',
         'leave_ho_section_emails_json',
         'leave_el_cap_days',
         'leave_el_setoff_threshold_days',
         'smtp_enabled',
         'notify_email_to'
       )`,
    );
    const map = Object.fromEntries(cfg.rows.map((r: { key: string; value: string }) => [r.key, r.value]));

    const desig = (map.leave_order_signatory_designation || "Secretary").trim();
    checks.push({
      ok: desig.length > 0,
      name: "config leave_order_signatory_designation",
      detail: desig || "empty (default Secretary in code)",
    });

    const hoJson = (map.leave_ho_section_emails_json || "{}").trim();
    let hoOk = false;
    let hoDetail = "empty — set HO section→email map in Admin → Config for HO sanction copies";
    try {
      const parsed = JSON.parse(hoJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed as Record<string, unknown>).filter(
          ([k, v]) => String(k).trim() && String(v ?? "").includes("@"),
        );
        hoOk = entries.length > 0;
        hoDetail = hoOk ? `${entries.length} section email(s)` : hoDetail;
      }
    } catch {
      hoOk = false;
      hoDetail = "invalid JSON — fix in Admin → Config";
    }
    checks.push({
      ok: hoOk,
      name: "config leave_ho_section_emails_json",
      detail: hoDetail,
    });

    const yardsWithEmail = await client.query(
      `SELECT COUNT(*)::int AS c FROM gapmc.yards WHERE email IS NOT NULL AND TRIM(email) <> ''`,
    );
    const yc = yardsWithEmail.rows[0]?.c ?? 0;
    checks.push({
      ok: yc > 0,
      name: "yards with email",
      detail: yc > 0 ? `${yc} location(s) have email` : "none — set Admin → Locations → Notification email",
    });

    const balCount = await client.query(`SELECT COUNT(*)::int AS c FROM gapmc.employee_leave_balances`);
    const bc = balCount.rows[0]?.c ?? 0;
    checks.push({
      ok: bc > 0,
      name: "opening leave balances",
      detail: bc > 0 ? `${bc} balance row(s)` : "none — import via /hr/leave-balances/import before go-live",
    });

    const holidayCount = await client.query(`SELECT COUNT(*)::int AS c FROM gapmc.hr_holidays`);
    const hc = holidayCount.rows[0]?.c ?? 0;
    checks.push({
      ok: hc > 0,
      name: "holiday master rows",
      detail: hc > 0 ? `${hc} holiday(s)` : "none — seed 2026 holidays (scripts/seed-hr-holidays-2026.ts)",
    });

    const smtpOn = String(map.smtp_enabled || "").toLowerCase() === "true";
    checks.push({
      ok: smtpOn,
      name: "SMTP enabled",
      detail: smtpOn ? "on" : "off — sanction order email needs Admin → Config → Gmail SMTP",
    });
  } finally {
    await client.end();
  }

  console.log("\n=== Leave Management go-live check ===\n");
  let fail = 0;
  for (const c of checks) {
    const mark = c.ok ? "OK  " : "TODO";
    if (!c.ok) fail += 1;
    console.log(`[${mark}] ${c.name}: ${c.detail}`);
  }
  console.log(`\n${checks.length - fail}/${checks.length} ready. ${fail} item(s) still TODO.\n`);
  console.log("UAT smoke path:");
  console.log("  1) DO: New leave → Print form");
  console.log("  2) DV: Verify (reporting officer)");
  console.log("  3) DA: Approve → check sanction PDF email + View order");
  console.log("  4) Employee: Report rejoining → Joining report PDF");
  console.log("  5) DO: Apply revision on approved leave → approve → original Superseded");
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
