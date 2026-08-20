/**
 * Leave Management SIT (automated, no browser).
 * Covers debit math, EL set-off examples from client response, file/route presence, DB readiness.
 *
 * Usage: npm run sit:leave-workflow
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { balanceLeaveTypeFor } from "../server/hr-leave-balance-debit";
import { calculateDebitDays } from "../server/hr-leave-prefix-suffix";
import { proRataFactorForPeriod } from "../server/hr-leave-validation";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

type Check = { ok: boolean; label: string; detail: string };

function assert(cond: boolean, label: string, detail: string): Check {
  return { ok: cond, label, detail };
}

/** Pure EL debit simulation matching debitLeaveBalanceOnApproval (set-off first). */
function simulateElDebit(balanceDays: number, setOffDays: number, debitDays: number): {
  balanceDays: number;
  setOffDays: number;
} {
  let remaining = debitDays;
  let so = setOffDays;
  let bal = balanceDays;
  if (so > 0) {
    const fromSetOff = Math.min(so, remaining);
    so -= fromSetOff;
    remaining -= fromSetOff;
  }
  if (remaining > 0) {
    if (bal + 1e-9 < remaining) throw new Error("INSUFFICIENT");
    bal -= remaining;
  }
  return { balanceDays: bal, setOffDays: so };
}

/** Half-year settle: credit min(setOff, 300 - balance) then clear set-off. */
function settleSetOff(balanceDays: number, setOffDays: number, cap = 300): {
  balanceDays: number;
  setOffDays: number;
  credited: number;
  notAdded: number;
} {
  const room = Math.max(0, cap - balanceDays);
  const toCredit = Math.min(setOffDays, room);
  return {
    balanceDays: balanceDays + toCredit,
    setOffDays: 0,
    credited: toCredit,
    notAdded: setOffDays - toCredit,
  };
}

async function main() {
  const checks: Check[] = [];

  const files = [
    "server/hr-leave-balance-debit.ts",
    "server/hr-leave-validation.ts",
    "server/hr-leave-prefix-suffix.ts",
    "server/hr-leave-application-pdf.ts",
    "server/hr-leave-sanction-order-pdf.ts",
    "server/hr-leave-joining-report-pdf.ts",
    "server/hr-leave-sanction-email.ts",
    "server/cron-hr-leave-accrual.ts",
    "client/src/pages/hr/LeaveRequests.tsx",
    "client/src/pages/hr/HrLeaveBalances.tsx",
    "client/src/pages/hr/HrLeaveBalanceImport.tsx",
    "client/src/pages/hr/HrHolidayCalendar.tsx",
    "scripts/migrations/062-leave-rejoining-revised.sql",
    "scripts/migrations/063-leave-joining-ack.sql",
  ];
  for (const rel of files) {
    const ok = fs.existsSync(path.join(root, rel));
    checks.push(assert(ok, `file ${rel}`, ok ? "present" : "missing"));
  }

  const routesHr = fs.readFileSync(path.join(root, "server/routes-hr.ts"), "utf8");
  for (const needle of [
    "/api/hr/leaves/:id/rejoin",
    "/api/hr/leaves/:id/joining-report-ack",
    "/api/hr/leaves/:id/joining-report",
    "/api/hr/leaves/:id/application-form",
    "revisedFromLeaveId",
    "emailSanctionOrderPdf",
  ]) {
    checks.push(assert(routesHr.includes(needle), `route/code ${needle}`, routesHr.includes(needle) ? "wired" : "missing"));
  }

  // Debit day math
  checks.push(
    assert(calculateDebitDays({ leaveType: "CL", fromDate: "2026-03-02", toDate: "2026-03-02" }) === 1, "CL 1 day", "1"),
  );
  checks.push(
    assert(
      calculateDebitDays({ leaveType: "CL", fromDate: "2026-03-02", toDate: "2026-03-02", halfDay: "FN" }) === 0.5,
      "CL half-day",
      "0.5",
    ),
  );
  checks.push(
    assert(
      calculateDebitDays({ leaveType: "COMMUTED", fromDate: "2026-03-02", toDate: "2026-03-03" }) === 4,
      "Commuted 2×",
      "2 calendar → 4 HPL",
    ),
  );
  checks.push(assert(calculateDebitDays({ leaveType: "ML", fromDate: "2026-01-01", toDate: "2026-06-30" }) === 0, "ML no debit", "0"));
  checks.push(assert(balanceLeaveTypeFor("COMMUTED") === "HPL", "Commuted→HPL account", "HPL"));
  checks.push(assert(balanceLeaveTypeFor("EL") === "EL", "EL account", "EL"));

  // Client EL set-off examples (debit during half-year)
  {
    const r = simulateElDebit(290, 15, 5);
    checks.push(assert(r.balanceDays === 290 && r.setOffDays === 10, "EL set-off debit 290+15 avail 5", `bal=${r.balanceDays} so=${r.setOffDays}`));
  }
  {
    const r = simulateElDebit(290, 15, 15);
    checks.push(assert(r.balanceDays === 290 && r.setOffDays === 0, "EL set-off debit full 15", `bal=${r.balanceDays} so=${r.setOffDays}`));
  }
  {
    const r = settleSetOff(295, 10);
    checks.push(
      assert(r.balanceDays === 300 && r.notAdded === 5, "EL settle near ceiling", `bal=${r.balanceDays} notAdded=${r.notAdded}`),
    );
  }
  {
    const r = settleSetOff(300, 15);
    checks.push(
      assert(r.balanceDays === 300 && r.notAdded === 15, "EL settle at ceiling", `bal=${r.balanceDays} notAdded=${r.notAdded}`),
    );
  }

  const proRata = proRataFactorForPeriod("2026-04-01", "2026-01-01", "2026-06-30");
  checks.push(assert(proRata > 0 && proRata <= 1, "pro-rata factor", String(proRata)));

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    checks.push(assert(false, "DATABASE_URL", "missing"));
  } else {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const cols = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema='gapmc' and table_name='leave_requests'
           and column_name in ('rejoining_date','revised_from_leave_id','joining_report_ack_at','debit_days','file_no')`,
      );
      checks.push(
        assert(cols.rowCount === 5, "DB leave_requests columns", `${cols.rowCount}/5 critical columns`),
      );
      const yards = await client.query<{ c: number }>(
        `select count(*)::int as c from gapmc.yards where email is not null and btrim(email) <> ''`,
      );
      checks.push(assert((yards.rows[0]?.c ?? 0) > 0, "DB yard emails", `${yards.rows[0]?.c ?? 0} locations`));
      const ho = await client.query<{ value: string }>(
        `select value from gapmc.system_config where key='leave_ho_section_emails_json' limit 1`,
      );
      let hoOk = false;
      try {
        const parsed = JSON.parse(ho.rows[0]?.value || "{}");
        hoOk = Object.values(parsed).some((v) => String(v).includes("@"));
      } catch {
        hoOk = false;
      }
      checks.push(assert(hoOk, "DB HO section emails", hoOk ? "configured" : "empty"));
    } finally {
      await client.end();
    }
  }

  console.log("\n=== Leave SIT (automated) ===\n");
  let fail = 0;
  for (const c of checks) {
    const mark = c.ok ? "PASS" : "FAIL";
    if (!c.ok) fail += 1;
    console.log(`[${mark}] ${c.label}: ${c.detail}`);
  }
  console.log(`\n${checks.length - fail}/${checks.length} passed.${fail ? ` ${fail} failed.` : ""}`);
  console.log("\nBrowser UAT remains with testing team (apply → verify → approve → email → rejoin → ack → revision).");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
