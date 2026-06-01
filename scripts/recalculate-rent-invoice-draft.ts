/**
 * Recalculate billing on a Draft M-03 rent invoice (CLI).
 *
 * Usage:
 *   dotenv -e .env -- tsx scripts/recalculate-rent-invoice-draft.ts --asset MAR/GODOWN-G2 --period 2026-06 --billing FullMonth
 *   dotenv -e .env -- tsx scripts/recalculate-rent-invoice-draft.ts --id <invoice-uuid> --billing FullMonth
 */
import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import { rentInvoices, assets } from "@shared/db-schema";
import type { RentBillingType } from "@shared/rent-invoice-billing";
import { recalculateDraftRentInvoiceBilling } from "../server/rent-invoice-recalculate-draft";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1]?.trim() || undefined;
}

async function main(): Promise<void> {
  const invoiceId = arg("--id");
  const assetCode = arg("--asset");
  const period = arg("--period");
  const billingRaw = arg("--billing") ?? "FullMonth";
  if (!["FullMonth", "Prorated", "Overstay"].includes(billingRaw)) {
    console.error("billing must be FullMonth, Prorated, or Overstay");
    process.exit(1);
  }
  const billingType = billingRaw as RentBillingType;

  let targetId = invoiceId;
  if (!targetId) {
    if (!assetCode || !period) {
      console.error("Provide --id <uuid> OR --asset <code> and --period YYYY-MM");
      process.exit(1);
    }
    const [match] = await db
      .select({ id: rentInvoices.id, invoiceNo: rentInvoices.invoiceNo, status: rentInvoices.status })
      .from(rentInvoices)
      .innerJoin(assets, eq(rentInvoices.assetId, assets.id))
      .where(and(eq(assets.assetId, assetCode), eq(rentInvoices.periodMonth, period)))
      .limit(1);
    if (!match) {
      console.error(`No rent invoice for asset ${assetCode} period ${period}`);
      process.exit(1);
    }
    console.log(`Found invoice ${match.invoiceNo ?? match.id} (${match.status})`);
    targetId = match.id;
  }

  const result = await recalculateDraftRentInvoiceBilling({
    invoiceId: targetId,
    billingType,
  });
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  const inv = result.invoice;
  console.log(
    `OK: ${inv.invoiceNo ?? inv.id} · ${inv.billingType} · rent ${inv.rentAmount} · total ${inv.totalAmount}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
