/**
 * Seeds one Track A rent invoice with full outstanding for testing Outstanding dues → Pay (payment mode).
 *
 * Usage:
 *   npm run db:seed-outstanding-dues-sample
 *   npm run db:seed-outstanding-dues-sample -- --firm="AJIT ENTERPRISES"
 *   npm run db:seed-outstanding-dues-sample -- --reset   (re-open a paid SAMPLE-DUES invoice)
 */
import "dotenv/config";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, pool } from "../server/db";
import {
  assetAllotments,
  assets,
  iomsReceipts,
  rentInvoices,
  traderLicences,
  yards,
} from "../shared/db-schema";
import { allocateRentInvoiceNoInTx } from "../server/rent-invoice-number";
import { m03ReceiptPrincipalTowardInvoice } from "../shared/m03-receipt-breakdown";
import { unifiedEntityIdFromTrackA } from "../shared/unified-entity-id";

const SAMPLE_FIRM = "AJIT ENTERPRISES (Dues test)";
const SAMPLE_PERIOD = "2025-02";
const SAMPLE_INVOICE_PREFIX = "SAMPLE-DUES/";

function parseArgs(): { firm?: string; reset: boolean } {
  let firm: string | undefined;
  let reset = false;
  for (const a of process.argv.slice(2)) {
    if (a === "--reset") reset = true;
    else if (a.startsWith("--firm=")) firm = a.slice(7).trim();
  }
  return { firm, reset };
}

function periodBounds(ym: string): { from: string; to: string; daysInMonth: number } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(last).padStart(2, "0")}`,
    daysInMonth: last,
  };
}

async function invoiceOutstanding(invId: string, total: number): Promise<number> {
  const recs = await db
    .select()
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invId)));
  const paid = recs
    .filter((r) => String(r.status) === "Paid" || String(r.status) === "Reconciled")
    .reduce((s, r) => s + m03ReceiptPrincipalTowardInvoice(r), 0);
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

async function main(): Promise<void> {
  const { firm: firmArg, reset } = parseArgs();
  const firmName = firmArg?.trim() || SAMPLE_FIRM;
  const now = new Date().toISOString();

  const yardRows = await db.select().from(yards);
  const yard =
    yardRows.find((y) => String(y.code ?? "").toUpperCase() === "VAL") ??
    yardRows.find((y) => String(y.name ?? "").toLowerCase().includes("valpoi")) ??
    yardRows.find((y) => String(y.type ?? "").toLowerCase() === "yard") ??
    yardRows[0];
  if (!yard) {
    console.error("No yards in database. Run: npm run db:seed-ioms-m10");
    process.exitCode = 1;
    return;
  }

  const [licByFirm] = await db
    .select()
    .from(traderLicences)
    .where(
      or(
        ilike(traderLicences.firmName, `%AJIT%ENTERPRISES%`),
        ilike(traderLicences.firmName, `%${firmName.replace(/\(Dues test\)/i, "").trim()}%`),
      ),
    )
    .limit(1);

  if (licByFirm) {
    const invs = await db
      .select()
      .from(rentInvoices)
      .where(
        and(
          eq(rentInvoices.tenantLicenceId, licByFirm.id),
          inArray(rentInvoices.status, ["Approved", "Paid", "Overdue"]),
        ),
      );
    for (const inv of invs) {
      let out = await invoiceOutstanding(inv.id, Number(inv.totalAmount ?? 0));
      if (out > 0.001 && !reset) {
        printTestInstructions(inv, licByFirm.firmName, out);
        return;
      }
      if (reset || out <= 0.001) {
        await db.delete(iomsReceipts).where(
          and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, inv.id)),
        );
        await db
          .update(rentInvoices)
          .set({ status: "Approved", approvedAt: now })
          .where(eq(rentInvoices.id, inv.id));
        out = Number(inv.totalAmount ?? 0);
        console.log(`Reopened ${inv.invoiceNo ?? inv.id} for ${licByFirm.firmName}.`);
        printTestInstructions(inv, licByFirm.firmName, out);
        return;
      }
    }
  }

  const existingSample = await db
    .select()
    .from(rentInvoices)
    .where(ilike(rentInvoices.invoiceNo, `${SAMPLE_INVOICE_PREFIX}%`))
    .limit(5);

  if (existingSample.length > 0 && !reset) {
    const inv = existingSample[0]!;
    const out = await invoiceOutstanding(inv.id, Number(inv.totalAmount ?? 0));
    if (out > 0.001 && (inv.status === "Approved" || inv.status === "Paid")) {
      const [lic] = await db
        .select()
        .from(traderLicences)
        .where(eq(traderLicences.id, inv.tenantLicenceId))
        .limit(1);
      printTestInstructions(inv, lic?.firmName ?? firmName, out);
      return;
    }
  }

  if (existingSample.length > 0 && reset) {
    for (const inv of existingSample) {
      await db.delete(iomsReceipts).where(
        and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, inv.id)),
      );
      await db
        .update(rentInvoices)
        .set({ status: "Approved", approvedAt: now })
        .where(eq(rentInvoices.id, inv.id));
      const out = await invoiceOutstanding(inv.id, Number(inv.totalAmount ?? 0));
      const [lic] = await db
        .select()
        .from(traderLicences)
        .where(eq(traderLicences.id, inv.tenantLicenceId))
        .limit(1);
      console.log(`Reset sample invoice ${inv.invoiceNo} — outstanding ₹${out}`);
      printTestInstructions(inv, lic?.firmName ?? firmName, out);
      return;
    }
  }

  let [lic] = await db
    .select()
    .from(traderLicences)
    .where(
      or(
        ilike(traderLicences.firmName, `%${firmName.replace(/\(Dues test\)/i, "").trim()}%`),
        ilike(traderLicences.firmName, `%${firmName}%`),
      ),
    )
    .limit(1);

  if (!lic) {
    const licenceId = nanoid();
    await db.insert(traderLicences).values({
      id: licenceId,
      licenceNo: `GAPMC/SAMPLE/${nanoid(6)}`,
      firmName,
      firmType: "Proprietorship",
      yardId: yard.id,
      contactName: "Sample Trader",
      mobile: "9876543210",
      licenceType: "Associated",
      feeAmount: 0,
      validFrom: "2025-01-01",
      validTo: "2027-12-31",
      status: "Active",
      isBlocked: false,
      bmUndertakingAccepted: true,
      renewalNoArrearsDeclared: false,
      createdAt: now,
      updatedAt: now,
    });
    [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, licenceId)).limit(1);
    console.log(`Created trader licence: ${licenceId}`);
  } else if (lic.status !== "Active") {
    await db
      .update(traderLicences)
      .set({ status: "Active", isBlocked: false, updatedAt: now })
      .where(eq(traderLicences.id, lic.id));
    console.log(`Activated licence: ${lic.id}`);
  }

  if (!lic) {
    console.error("Could not create trader licence.");
    process.exitCode = 1;
    return;
  }

  let allotment = await db
    .select()
    .from(assetAllotments)
    .where(
      and(
        eq(assetAllotments.traderLicenceId, lic.id),
        eq(assetAllotments.status, "Active"),
        eq(assetAllotments.approvalStatus, "Approved"),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  let assetPk: string;
  if (allotment) {
    assetPk = allotment.assetId;
  } else {
    const yardCode = String(yard.code ?? "YRD").toUpperCase().slice(0, 3);
    const assetCode = `${yardCode}/SHOP-SAMPLE`;
    let [assetRow] = await db.select().from(assets).where(eq(assets.assetId, assetCode)).limit(1);
    if (!assetRow) {
      const assetId = nanoid();
      await db.insert(assets).values({
        id: assetId,
        assetId: assetCode,
        yardId: yard.id,
        assetType: "Shop",
        isActive: true,
      });
      [assetRow] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    }
    if (!assetRow) {
      console.error("Could not create sample asset.");
      process.exitCode = 1;
      return;
    }
    assetPk = assetRow.id;
    const allotmentId = nanoid();
    await db.insert(assetAllotments).values({
      id: allotmentId,
      assetId: assetPk,
      traderLicenceId: lic.id,
      allotteeName: lic.firmName,
      fromDate: "2025-01-01",
      toDate: "2027-12-31",
      status: "Active",
      approvalStatus: "Approved",
      monthlyRent: 10000,
      gstApplicable: true,
      premisesRefNo: `SAMPLE-${nanoid(6)}`,
      approvedAt: now,
    });
    allotment = await db
      .select()
      .from(assetAllotments)
      .where(eq(assetAllotments.id, allotmentId))
      .limit(1)
      .then((r) => r[0]);
    console.log(`Created asset ${assetCode} and allotment ${allotmentId}`);
  }

  if (!allotment) {
    console.error("No allotment available.");
    process.exitCode = 1;
    return;
  }

  const rentAmount = 10000;
  const cgst = 900;
  const sgst = 900;
  const totalAmount = 11800;
  const bounds = periodBounds(SAMPLE_PERIOD);

  const [existingPeriodInv] = await db
    .select()
    .from(rentInvoices)
    .where(
      and(
        eq(rentInvoices.assetId, assetPk),
        eq(rentInvoices.periodMonth, SAMPLE_PERIOD),
        inArray(rentInvoices.status, ["Draft", "Verified", "Approved", "Paid", "Overdue"]),
      ),
    )
    .limit(1);

  if (existingPeriodInv) {
    let out = await invoiceOutstanding(existingPeriodInv.id, Number(existingPeriodInv.totalAmount ?? 0));
    if (out <= 0.001 || reset) {
      await db.delete(iomsReceipts).where(
        and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, existingPeriodInv.id)),
      );
      await db
        .update(rentInvoices)
        .set({ status: "Approved", approvedAt: now })
        .where(eq(rentInvoices.id, existingPeriodInv.id));
      out = Number(existingPeriodInv.totalAmount ?? 0);
      console.log(`Reopened invoice ${existingPeriodInv.invoiceNo ?? existingPeriodInv.id} for counter pay testing.`);
    }
    if (existingPeriodInv.status !== "Approved" && existingPeriodInv.status !== "Paid") {
      await db
        .update(rentInvoices)
        .set({ status: "Approved", approvedAt: now })
        .where(eq(rentInvoices.id, existingPeriodInv.id));
    }
    printTestInstructions(existingPeriodInv, lic.firmName, out);
    return;
  }

  const invoiceId = nanoid();
  await db.transaction(async (tx) => {
    const invoiceNo = `${SAMPLE_INVOICE_PREFIX}${await allocateRentInvoiceNoInTx(tx, {
      yardId: yard.id,
      periodMonth: SAMPLE_PERIOD,
      yardCode: yard.code,
    })}`;
    await tx.insert(rentInvoices).values({
      id: invoiceId,
      invoiceNo,
      allotmentId: allotment!.id,
      allotmentKind: "TraderLicence",
      tenantLicenceId: lic.id,
      entityId: null,
      assetId: assetPk,
      yardId: yard.id,
      periodMonth: SAMPLE_PERIOD,
      billingType: "FullMonth",
      occupancyFrom: bounds.from,
      occupancyTo: bounds.to,
      daysInMonth: bounds.daysInMonth,
      billableDays: bounds.daysInMonth,
      billingFactor: 1,
      baseMonthlyRent: rentAmount,
      rentAmount,
      cgst,
      sgst,
      totalAmount,
      tdsApplicable: false,
      tdsAmount: 0,
      isGovtEntity: false,
      status: "Approved",
      doUser: "seed:outstanding-dues",
      dvUser: "seed:outstanding-dues",
      daUser: "seed:outstanding-dues",
      generatedAt: now,
      approvedAt: now,
    });
  });

  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
  if (!inv) {
    console.error("Invoice insert failed.");
    process.exitCode = 1;
    return;
  }

  console.log(`Created sample rent invoice: ${inv.invoiceNo} (₹${totalAmount}, Approved, no payments).`);
  printTestInstructions(inv, lic.firmName, totalAmount);
}

function printTestInstructions(
  inv: { id: string; invoiceNo: string | null; tenantLicenceId: string },
  firmName: string,
  outstanding: number,
): void {
  const unifiedId = unifiedEntityIdFromTrackA(inv.tenantLicenceId);
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:5000";
  console.log("\n--- Test Outstanding dues payment mode ---");
  console.log(`Trader: ${firmName}`);
  console.log(`Unified entity: ${unifiedId}`);
  console.log(`Invoice: ${inv.invoiceNo ?? inv.id}`);
  console.log(`Outstanding: ₹${outstanding}`);
  console.log(`\n1. Sign in → Traders → Outstanding dues`);
  console.log(`2. Select: ${firmName} (${unifiedId})`);
  console.log(`   Or open: ${base}/traders/outstanding-dues?unifiedId=${encodeURIComponent(unifiedId)}`);
  console.log(`3. Click Pay on the rent invoice row → Pay → choose Cash/Cheque/NEFT → Confirm payment`);
  console.log("\nRe-run with --reset to clear payments and test again.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
