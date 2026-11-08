/**
 * Persist invoice nearest-rupee rounding audit (one Active row per invoice).
 */
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { invoiceRoundingDetails } from "@shared/db-schema";
import type { InvoiceRoundingResult } from "@shared/invoice-rounding";
import { applyInvoiceNearestRupeeRounding } from "@shared/invoice-rounding";
import { db } from "./db";

export type InvoiceRoundingModule = "M-03-Rent" | "M-03-Combined";

type TxLike = Pick<typeof db, "update" | "insert">;

let ensurePromise: Promise<void> | null = null;

export function ensureInvoiceRoundingTable(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gapmc.invoice_rounding_details (
        id text PRIMARY KEY,
        invoice_id text NOT NULL,
        invoice_module text NOT NULL,
        invoice_no text,
        original_invoice_amount double precision NOT NULL,
        rounding_amount double precision NOT NULL,
        rounding_type text NOT NULL,
        final_invoice_amount double precision NOT NULL,
        rounding_date text NOT NULL,
        created_by text,
        created_on text NOT NULL,
        record_status text NOT NULL DEFAULT 'Active'
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS invoice_rounding_details_active_uidx
      ON gapmc.invoice_rounding_details (invoice_id, invoice_module)
      WHERE record_status = 'Active'
    `);
  })();
  return ensurePromise;
}

/** Supersede prior Active row and insert the current rounding snapshot. */
export async function upsertActiveInvoiceRounding(args: {
  invoiceId: string;
  invoiceModule: InvoiceRoundingModule;
  invoiceNo?: string | null;
  rounding: InvoiceRoundingResult;
  createdBy?: string | null;
  tx?: TxLike;
}): Promise<void> {
  await ensureInvoiceRoundingTable();
  const runner = args.tx ?? db;
  const now = new Date().toISOString();
  await runner
    .update(invoiceRoundingDetails)
    .set({ recordStatus: "Superseded" })
    .where(
      and(
        eq(invoiceRoundingDetails.invoiceId, args.invoiceId),
        eq(invoiceRoundingDetails.invoiceModule, args.invoiceModule),
        eq(invoiceRoundingDetails.recordStatus, "Active"),
      ),
    );
  await runner.insert(invoiceRoundingDetails).values({
    id: nanoid(),
    invoiceId: args.invoiceId,
    invoiceModule: args.invoiceModule,
    invoiceNo: args.invoiceNo ?? null,
    originalInvoiceAmount: args.rounding.originalAmount,
    roundingAmount: args.rounding.roundingAmount,
    roundingType: args.rounding.roundingType,
    finalInvoiceAmount: args.rounding.finalAmount,
    roundingDate: now.slice(0, 10),
    createdBy: args.createdBy ?? null,
    createdOn: now,
    recordStatus: "Active",
  });
}

export async function markInvoiceRoundingCancelled(args: {
  invoiceId: string;
  invoiceModule: InvoiceRoundingModule;
  tx?: TxLike;
}): Promise<void> {
  await ensureInvoiceRoundingTable();
  const runner = args.tx ?? db;
  await runner
    .update(invoiceRoundingDetails)
    .set({ recordStatus: "Cancelled" })
    .where(
      and(
        eq(invoiceRoundingDetails.invoiceId, args.invoiceId),
        eq(invoiceRoundingDetails.invoiceModule, args.invoiceModule),
        eq(invoiceRoundingDetails.recordStatus, "Active"),
      ),
    );
}

export function roundingFromComponentTotal(originalComponentTotal: number): InvoiceRoundingResult {
  return applyInvoiceNearestRupeeRounding(originalComponentTotal);
}
