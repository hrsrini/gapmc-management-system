/**
 * Smoke test for M-04 market transaction wizard (cases A–G calculate + optional draft/finalize).
 * Usage: dotenv -e .env -- tsx scripts/smoke-market-transaction-wizard.ts
 */
import pg from "pg";

const { Client } = pg;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const yard = (
      await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM gapmc.yards LIMIT 1`,
      )
    ).rows[0];
    if (!yard) throw new Error("No yard in DB");

    const commodity = (
      await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM gapmc.commodities ORDER BY name LIMIT 1`,
      )
    ).rows[0];
    if (!commodity) throw new Error("No commodity in DB");

    const licence = (
      await client.query<{ id: string; firm_name: string; valid_to: string | null; status: string }>(
        `SELECT id, firm_name, valid_to, status FROM gapmc.trader_licences
         WHERE yard_id = $1 LIMIT 1`,
        [yard.id],
      )
    ).rows[0];

    const today = new Date().toISOString().slice(0, 10);

    const { computeMarketTransactionTotals } = await import("../shared/market-transaction-cases");
    const calcA = computeMarketTransactionTotals(
      "A",
      [
        {
          commodityId: commodity.id,
          quantity: 100,
          unit: "Kg",
          ratePerUnit: 50,
          commodityValue: 5000,
          marketFeePercent: 1,
          marketFeeAmount: 50,
        },
      ],
      {},
    );
    console.log("Case A calc OK:", calcA.totalPayable);

    const calcE = computeMarketTransactionTotals("E", [], {
      securityDepositAmount: 1000,
      adminChargesAmount: 50,
    });
    console.log("Case E calc OK:", calcE.totalPayable, calcE.receiptRevenueHead);

    const {
      validateMarketTransactionWizard,
      calculateMarketTransactionWizard,
      createMarketTransactionDraft,
      finalizeMarketTransaction,
      submitMarketTransactionWizard,
    } = await import("../server/market-transaction-wizard");

    // Case C — unregistered trader (no licence required)
    const inputC = {
      caseType: "C" as const,
      entryLocationId: yard.id,
      transactionDate: today,
      traderManualName: "Smoke Unregistered Trader",
      sellerType: "Farmer" as const,
      farmerType: "Local" as const,
      farmerName: "Test Farmer",
      commoditySource: "OutsideState" as const,
      fineAmount: 100,
      collectFine: true,
      commodities: [{ commodityId: commodity.id, quantity: 10, unit: "Kg", ratePerUnit: 100 }],
    };

    const vC = await validateMarketTransactionWizard(inputC);
    if (!vC.ok) throw new Error(`Case C validation failed: ${vC.code} ${vC.message}`);
    console.log("Case C validation OK");

    const calculatedC = await calculateMarketTransactionWizard(inputC);
    console.log("Case C calculate OK:", calculatedC.totalPayable);

    const draftC = await createMarketTransactionDraft({ input: inputC, createdBy: "smoke-test" });
    console.log("Case C draft OK:", draftC.transactionNo);

    const submittedC = await submitMarketTransactionWizard({
      input: inputC,
      paymentMode: "Cash",
      createdBy: "smoke-test",
    });
    console.log("Case C submit OK:", submittedC.receiptNo);

    const inputE = {
      caseType: "E" as const,
      entryLocationId: yard.id,
      transactionDate: today,
      originatingState: "Maharashtra",
      destinationState: "Karnataka",
      securityDepositAmount: 1000,
      adminChargesAmount: 50,
      commodities: [{ commodityId: commodity.id, quantity: 1, unit: "Kg", ratePerUnit: 1 }],
    };
    const draftE = await createMarketTransactionDraft({ input: inputE, createdBy: "smoke-test" });
    const submittedE = await submitMarketTransactionWizard({
      input: inputE,
      paymentMode: "Online",
      paymentDetail: { utrNo: "SMOKEUTR123" },
      createdBy: "smoke-test",
    });
    console.log("Case E submit OK:", submittedE.receiptNo);

    await client.query(`DELETE FROM gapmc.market_transaction_commodities WHERE transaction_id = $1`, [submittedE.id]);
    await client.query(`DELETE FROM gapmc.market_transactions WHERE id = $1`, [submittedE.id]);
    await client.query(`DELETE FROM gapmc.ioms_receipts WHERE id = $1`, [submittedE.receiptId]);
    await client.query(`DELETE FROM gapmc.market_transaction_commodities WHERE transaction_id = $1`, [draftE.id]);
    await client.query(`DELETE FROM gapmc.market_transactions WHERE id = $1`, [draftE.id]);

    if (licence) {
      const inputA = {
        caseType: "A" as const,
        entryLocationId: yard.id,
        transactionDate: today,
        traderLicenceId: licence.id,
        sellerType: "Farmer" as const,
        farmerType: "Local" as const,
        farmerName: "Test Farmer",
        commoditySource: "Local" as const,
        commodities: [{ commodityId: commodity.id, quantity: 10, unit: "Kg", ratePerUnit: 100 }],
      };
      const vA = await validateMarketTransactionWizard(inputA);
      if (vA.ok) {
        const draftA = await createMarketTransactionDraft({ input: inputA, createdBy: "smoke-test" });
        try {
          await finalizeMarketTransaction({
            transactionId: draftA.id,
            paymentMode: "AdvanceDeposit",
            createdBy: "smoke-test",
          });
          console.log("Advance deposit finalize OK");
        } catch (e) {
          const code = (e as { code?: string }).code;
          const msg = e instanceof Error ? e.message : String(e);
          console.log("Advance deposit finalize:", code ?? "error", msg);
        }
        await client.query(`DELETE FROM gapmc.market_fee_ledger WHERE source_record_id = $1`, [draftA.id]);
        await client.query(`DELETE FROM gapmc.ioms_receipts WHERE source_record_id = $1`, [draftA.id]);
        await client.query(`DELETE FROM gapmc.market_transaction_commodities WHERE transaction_id = $1`, [draftA.id]);
        await client.query(`DELETE FROM gapmc.market_transactions WHERE id = $1`, [draftA.id]);
      } else {
        console.log("Case A skipped (licence status):", vA.code, vA.message);
      }
    }

    await client.query(`DELETE FROM gapmc.market_transaction_commodities WHERE transaction_id = $1`, [submittedC.id]);
    await client.query(`DELETE FROM gapmc.market_transactions WHERE id = $1`, [submittedC.id]);
    await client.query(`DELETE FROM gapmc.ioms_receipts WHERE id = $1`, [submittedC.receiptId]);
    await client.query(`DELETE FROM gapmc.market_transaction_commodities WHERE transaction_id = $1`, [draftC.id]);
    await client.query(`DELETE FROM gapmc.market_transactions WHERE id = $1`, [draftC.id]);
    console.log("Cleanup OK");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
