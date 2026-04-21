/**
 * Read-only reference data for finance: govt GST exempt categories, Tally ledger catalogue.
 * Paths under /api/ioms/reference — no module permission (any authenticated user).
 */
import type { Express } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { govtGstExemptCategories, iomsRevenueHeadLedgerMap, tallyLedgers } from "@shared/db-schema";
import { sendApiError } from "./api-errors";

export function registerFinanceReferenceRoutes(app: Express) {
  app.get("/api/ioms/reference/govt-gst-exempt-categories", async (_req, res) => {
    try {
      const list = await db.select().from(govtGstExemptCategories).orderBy(asc(govtGstExemptCategories.sortOrder));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch govt GST exempt categories");
    }
  });

  app.get("/api/ioms/reference/tally-ledgers", async (_req, res) => {
    try {
      const list = await db.select().from(tallyLedgers).orderBy(asc(tallyLedgers.sortOrder), asc(tallyLedgers.ledgerName));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch Tally ledger catalogue");
    }
  });

  /** Read-only counts for SRS / finance reconciliation (e.g. “38 heads” policy). */
  app.get("/api/ioms/reference/tally-ledgers/stats", async (_req, res) => {
    try {
      const [activeRow] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(tallyLedgers)
        .where(eq(tallyLedgers.isActive, true));
      const [totalRow] = await db.select({ c: sql<number>`count(*)::int` }).from(tallyLedgers);
      const [mapRow] = await db.select({ c: sql<number>`count(*)::int` }).from(iomsRevenueHeadLedgerMap);
      const active = Number(activeRow?.c ?? 0);
      const mapped = Number(mapRow?.c ?? 0);
      const expectedSrsTallyHeads = 38;
      res.json({
        tallyLedgerActiveCount: active,
        tallyLedgerTotalCount: Number(totalRow?.c ?? 0),
        iomsRevenueHeadMapEntryCount: mapped,
        expectedSrsTallyHeads,
        activeHeadCountMatchesSrs: active === expectedSrsTallyHeads,
        mapEntryCountMatchesActiveLedgers: mapped === active,
        srsNote:
          "SRS references 38 locked Tally heads for M-05 mapping — compare active ledger rows and revenue_head map entries with your signed-off chart; DA governs changes.",
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch Tally ledger stats");
    }
  });
}
