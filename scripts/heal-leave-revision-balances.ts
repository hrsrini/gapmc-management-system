/**
 * Heal EL/HPL balances stuck after revision chains where credits never applied
 * (classic: still at opening − root debit while tip Approved debit is smaller).
 *
 * Heuristic: only adjust when "opening = current + rootDebit" looks more plausible
 * than "opening = current + tipDebit" (e.g. round 5/0 ending).
 *
 * Dry-run by default. Commit: npm run db:heal-leave-revision-balances-commit
 */
import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const COMMIT = process.env.COMMIT === "1" || process.env.COMMIT === "true";

type LeaveRow = {
  id: string;
  employee_id: string;
  leave_type: string;
  status: string;
  debit_days: number | null;
  debit_from_set_off_days: number | null;
  debit_from_balance_days: number | null;
  revised_from_leave_id: string | null;
  superseded_by_leave_id: string | null;
};

type BalRow = {
  id: string;
  employee_id: string;
  leave_type: string;
  balance_days: number;
  set_off_days: number | null;
};

function looksLikeOpening(n: number): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  // Prefer round openings (…0 / …5) typical of imported EL caps / set-off totals.
  const x = Math.round(n * 100) / 100;
  return Math.abs(x % 5) < 1e-6;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tips = await client.query<LeaveRow>(
      `SELECT id, employee_id, leave_type, status, debit_days,
              debit_from_set_off_days, debit_from_balance_days,
              revised_from_leave_id, superseded_by_leave_id
       FROM gapmc.leave_requests
       WHERE status = 'Approved'
         AND revised_from_leave_id IS NOT NULL
         AND (superseded_by_leave_id IS NULL OR superseded_by_leave_id = '')`,
    );

    let fixed = 0;
    let skipped = 0;
    for (const tip of tips.rows) {
      let cursor: LeaveRow | null = tip;
      const chain: LeaveRow[] = [tip];
      const seen = new Set<string>([tip.id]);
      while (cursor?.revised_from_leave_id) {
        const r = await client.query<LeaveRow>(
          `SELECT id, employee_id, leave_type, status, debit_days,
                  debit_from_set_off_days, debit_from_balance_days,
                  revised_from_leave_id, superseded_by_leave_id
           FROM gapmc.leave_requests WHERE id = $1`,
          [cursor.revised_from_leave_id],
        );
        const prev = r.rows[0];
        if (!prev || seen.has(prev.id)) break;
        seen.add(prev.id);
        chain.push(prev);
        cursor = prev;
      }
      if (chain.length < 2) continue;

      const root = chain[chain.length - 1]!;
      const tipDebit = Number(tip.debit_days ?? 0);
      const rootDebit = Number(root.debit_days ?? 0);
      if (!(rootDebit > tipDebit + 1e-9)) {
        skipped++;
        continue;
      }

      // If any row in the chain recorded a debit split, new revision accounting already ran — skip.
      const anySplit = chain.some(
        (l) => l.debit_from_set_off_days != null || l.debit_from_balance_days != null,
      );
      if (anySplit) {
        skipped++;
        continue;
      }

      const balLeaveType = tip.leave_type === "COMMUTED" ? "HPL" : tip.leave_type;
      const balRes = await client.query<BalRow>(
        `SELECT id, employee_id, leave_type, balance_days, set_off_days
         FROM gapmc.employee_leave_balances
         WHERE employee_id = $1 AND leave_type = $2
         LIMIT 1`,
        [tip.employee_id, balLeaveType],
      );
      const bal = balRes.rows[0];
      if (!bal) continue;

      const currentTotal = Number(bal.balance_days ?? 0) + Number(bal.set_off_days ?? 0);
      const openingIfStuck = currentTotal + rootDebit;
      const openingIfOk = currentTotal + tipDebit;
      // Only heal when "stuck" opening looks more plausible than "already ok".
      if (!(looksLikeOpening(openingIfStuck) && !looksLikeOpening(openingIfOk))) {
        console.log(
          `SKIP emp=${tip.employee_id} tip=${tip.id} current=${currentTotal} openingIfStuck=${openingIfStuck} openingIfOk=${openingIfOk}`,
        );
        skipped++;
        continue;
      }

      const delta = rootDebit - tipDebit;
      const proposedTotal = currentTotal + delta;
      console.log(
        `${COMMIT ? "FIX" : "DRY"} emp=${tip.employee_id} type=${balLeaveType} tip=${tip.id} rootDebit=${rootDebit} tipDebit=${tipDebit} currentTotal=${currentTotal} → ${proposedTotal} (add ${delta} to balance_days)`,
      );

      if (COMMIT) {
        await client.query(
          `UPDATE gapmc.employee_leave_balances
           SET balance_days = balance_days + $1, updated_at = $2
           WHERE id = $3`,
          [delta, new Date().toISOString(), bal.id],
        );
        fixed++;
      }
    }
    console.log(
      COMMIT
        ? `Updated ${fixed} balance row(s); skipped ${skipped}.`
        : `Dry-run only (skipped ${skipped}). Re-run with COMMIT=1 to apply.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
