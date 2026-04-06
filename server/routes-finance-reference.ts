/**
 * Read-only reference data for finance: govt GST exempt categories, Tally ledger catalogue.
 * Paths under /api/ioms/reference — no module permission (any authenticated user).
 */
import type { Express } from "express";
import { asc } from "drizzle-orm";
import { db } from "./db";
import { govtGstExemptCategories, tallyLedgers } from "@shared/db-schema";
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
}
