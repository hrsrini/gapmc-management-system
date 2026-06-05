/**
 * Backfill M-03 rent invoices missing CGST/SGST on taxable (non-exempt) rent.
 *
 * Usage: dotenv -e .env -- tsx scripts/backfill-m03-rent-invoice-gst.ts [--dry-run]
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { rentInvoices } from "@shared/db-schema";
import { computeRentInvoiceGstInr, rentInvoiceTotalInr } from "@shared/rent-invoice-gst";
import { getMergedSystemConfig, parseSystemConfigNumber } from "../server/system-config";

const dryRun = process.argv.includes("--dry-run");

function parseNonGstSum(json: string | null | undefined): number {
  if (json == null || String(json).trim() === "") return 0;
  try {
    const arr = JSON.parse(String(json)) as unknown;
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((s, o) => {
      const amt = Number((o as { amount?: unknown }).amount);
      return s + (Number.isFinite(amt) && amt > 0 ? amt : 0);
    }, 0);
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const cfg = await getMergedSystemConfig();
  const cgstPct = parseSystemConfigNumber(cfg, "rent_invoice_cgst_percent");
  const sgstPct = parseSystemConfigNumber(cfg, "rent_invoice_sgst_percent");

  const rows = await db.select().from(rentInvoices);
  let updated = 0;

  for (const inv of rows) {
    if (Boolean(inv.isGovtEntity)) continue;
    const rent = Number(inv.rentAmount ?? 0);
    if (rent < 0.005) continue;
    const cgst = Number(inv.cgst ?? 0);
    const sgst = Number(inv.sgst ?? 0);
    if (cgst >= 0.005 || sgst >= 0.005) continue;

    const nonGst = parseNonGstSum(inv.nonGstChargesJson);
    const g = computeRentInvoiceGstInr(rent, false, cgstPct, sgstPct);
    if (g.cgst < 0.005 && g.sgst < 0.005) continue;
    const total = rentInvoiceTotalInr(rent, nonGst, g.cgst, g.sgst);

    console.log(
      `${dryRun ? "[dry-run] " : ""}${inv.invoiceNo ?? inv.id} (${inv.periodMonth}): cgst 0 -> ${g.cgst}, sgst 0 -> ${g.sgst}, total -> ${total}`,
    );
    if (!dryRun) {
      await db
        .update(rentInvoices)
        .set({ cgst: g.cgst, sgst: g.sgst, totalAmount: total })
        .where(eq(rentInvoices.id, inv.id));
    }
    updated += 1;
  }

  console.log(`${dryRun ? "Would update" : "Updated"} ${updated} invoice(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
