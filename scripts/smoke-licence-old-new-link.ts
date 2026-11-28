/**
 * Smoke: Pradeep Mali old/new licence link + list exclusion + dues brackets.
 * LM applications for 10282 currently lack original_license_number; bootstrap the
 * Intra link for the fixture, then verify operational hide + bracket label.
 */
import "dotenv/config";
import { eq, isNull, and, or, ilike, sql } from "drizzle-orm";
import { traderLicences } from "@shared/db-schema";
import { db, pool } from "../server/db";
import {
  formatLicenceWithLinkedOldBracket,
  getLinkedOldLicenceSummary,
  linkOldAndNewLicences,
} from "../server/licence-old-new-link";
import { assertLmLicenceAllowsOperation, LmLicenceGuardError } from "@shared/lm-licence-guard";

async function main() {
  const r = await pool.query<{
    id: string;
    licence_no: string | null;
    status: string | null;
    linked_old_licence_id: string | null;
    superseded_by_licence_id: string | null;
    firm_name: string | null;
  }>(
    `
    SELECT id, licence_no, status, linked_old_licence_id, superseded_by_licence_id, firm_name
    FROM gapmc.trader_licences
    WHERE licence_no ILIKE '%10282%'
       OR licence_no ILIKE '%9871%'
       OR firm_name ILIKE '%Pradeep%Mali%'
    ORDER BY licence_no NULLS LAST
    `,
  );
  console.log("Pradeep / 10282 / 9871 rows:", r.rows.length);

  const neu = r.rows.find((x) => String(x.licence_no ?? "").includes("10282"));
  const old = r.rows.find((x) =>
    String(x.licence_no ?? "")
      .replace(/\s/g, "")
      .toUpperCase()
      .startsWith("9871"),
  );
  if (!neu || !old) {
    console.error("FAIL: expected both 10282 and 9871 rows");
    process.exitCode = 1;
    return;
  }

  // Fixture bootstrap when LM apps row has no original_license_number yet.
  if (neu.linked_old_licence_id !== old.id || old.superseded_by_licence_id !== neu.id) {
    const changed = await linkOldAndNewLicences({ newLicenceId: neu.id, oldLicenceId: old.id });
    console.log("bootstrap linkOldAndNewLicences:", changed);
  }

  const [neu2] = await db.select().from(traderLicences).where(eq(traderLicences.id, neu.id)).limit(1);
  const [old2] = await db.select().from(traderLicences).where(eq(traderLicences.id, old.id)).limit(1);
  if (!neu2 || !old2) {
    console.error("FAIL: reload");
    process.exitCode = 1;
    return;
  }
  if (neu2.linkedOldLicenceId !== old.id) {
    console.error("FAIL: 10282.linked_old_licence_id !== 9871.id");
    process.exitCode = 1;
  } else {
    console.log("OK: 10282 linked_old → 9871");
  }
  if (old2.supersededByLicenceId !== neu.id) {
    console.error("FAIL: 9871.superseded_by_licence_id !== 10282.id");
    process.exitCode = 1;
  } else {
    console.log("OK: 9871 superseded_by → 10282");
  }

  const summary = await getLinkedOldLicenceSummary(neu.id);
  console.log("linkedOldLicence summary:", summary);
  if (!summary || summary.id !== old.id) {
    console.error("FAIL: getLinkedOldLicenceSummary");
    process.exitCode = 1;
  } else {
    console.log("OK: linked old summary");
  }

  const label = formatLicenceWithLinkedOldBracket(neu2.licenceNo, old2.licenceNo);
  console.log("bracket label:", label);
  if (!label.includes("(") || !/9871/i.test(label)) {
    console.error("FAIL: bracket label");
    process.exitCode = 1;
  } else {
    console.log("OK: bracket label");
  }

  // Operational list filter: superseded olds excluded by default.
  const visible = await db
    .select({ id: traderLicences.id, licenceNo: traderLicences.licenceNo })
    .from(traderLicences)
    .where(
      and(
        isNull(traderLicences.supersededByLicenceId),
        or(
          ilike(traderLicences.licenceNo, "%9871%"),
          sql`upper(replace(coalesce(${traderLicences.licenceNo}, ''), ' ', '')) LIKE '9871%'`,
        ),
      ),
    );
  if (visible.some((v) => v.id === old.id)) {
    console.error("FAIL: superseded 9871 still visible under default list filter");
    process.exitCode = 1;
  } else {
    console.log("OK: superseded 9871 hidden from default list filter");
  }

  try {
    assertLmLicenceAllowsOperation(old2, undefined, { allowExpiredHolder: true });
    console.error("FAIL: guard should reject superseded old even with allowExpiredHolder");
    process.exitCode = 1;
  } catch (e) {
    if (e instanceof LmLicenceGuardError && e.code === "LICENCE_SUPERSEDED") {
      console.log("OK: LICENCE_SUPERSEDED guard");
    } else {
      console.error("FAIL: unexpected guard error", e);
      process.exitCode = 1;
    }
  }

  try {
    assertLmLicenceAllowsOperation(neu2);
    console.log("OK: new licence passes guard");
  } catch (e) {
    console.error("FAIL: new licence should allow ops", e);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
