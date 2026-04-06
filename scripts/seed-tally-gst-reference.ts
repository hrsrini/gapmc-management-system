/**
 * Seed Tally ledger catalogue (tally_ledgers.pdf), govt GST exempt categories (List of Exemption from GST.pdf),
 * revenue_head → tally map, and backfill expenditure_heads.tally_ledger_id where possible.
 * Run after db:push: npm run db:seed-tally-gst
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import {
  tallyLedgers,
  govtGstExemptCategories,
  iomsRevenueHeadLedgerMap,
  expenditureHeads,
} from "../shared/db-schema";

const LEDGERS: { id: string; ledgerName: string; primaryGroup: string; statementClass: string; sortOrder: number }[] = [
  { id: "tl_mf", ledgerName: "Market Fee", primaryGroup: "Fees", statementClass: "PL_Income", sortOrder: 10 },
  { id: "tl_int_mf", ledgerName: "Interest on Market Fee", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 11 },
  { id: "tl_ind_mf", ledgerName: "Individual Deposit (Market Fee)", primaryGroup: "Current Liabilities", statementClass: "BS_Liability", sortOrder: 12 },
  { id: "tl_lic", ledgerName: "License Fee", primaryGroup: "Fees", statementClass: "PL_Income", sortOrder: 20 },
  { id: "tl_god_reg", ledgerName: "Godown Registration Fee", primaryGroup: "Fees", statementClass: "PL_Income", sortOrder: 21 },
  { id: "tl_stat", ledgerName: "Supply of Stationery", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 22 },
  { id: "tl_sec_lic", ledgerName: "Cash Security Deposit for license", primaryGroup: "Current Liabilities", statementClass: "BS_Liability", sortOrder: 23 },
  { id: "tl_lic_ren", ledgerName: "License Renewal Fee", primaryGroup: "Fees", statementClass: "PL_Income", sortOrder: 24 },
  { id: "tl_late_lic", ledgerName: "Late Fee (License Renewal)", primaryGroup: "Fees", statementClass: "PL_Income", sortOrder: 25 },
  { id: "tl_lic_up", ledgerName: "License Upgradation Fee", primaryGroup: "Fees", statementClass: "PL_Income", sortOrder: 26 },
  { id: "tl_rent", ledgerName: "Rent", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 30 },
  { id: "tl_cgst", ledgerName: "CGST", primaryGroup: "Duties & Taxes", statementClass: "BS_Liability", sortOrder: 31 },
  { id: "tl_sgst", ledgerName: "SGST", primaryGroup: "Duties & Taxes", statementClass: "BS_Liability", sortOrder: 32 },
  { id: "tl_int_rent", ledgerName: "Interest on Rent", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 33 },
  { id: "tl_tds", ledgerName: "TDS", primaryGroup: "Duties & Taxes", statementClass: "BS_Liability", sortOrder: 34 },
  { id: "tl_sec_god", ledgerName: "Cash Security Deposit for Godown", primaryGroup: "Current Liabilities", statementClass: "BS_Liability", sortOrder: 35 },
  { id: "tl_ind_rent", ledgerName: "Individual Deposit (Rent)", primaryGroup: "Current Liabilities", statementClass: "BS_Liability", sortOrder: 36 },
  { id: "tl_god_tr", ledgerName: "Godown Transfer Fee", primaryGroup: "Fees", statementClass: "PL_Income", sortOrder: 37 },
  { id: "tl_ree", ledgerName: "Reimbursement of Electricity Charges", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 40 },
  { id: "tl_rew", ledgerName: "Reimbursement of Water Charges", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 41 },
  { id: "tl_ret", ledgerName: "Reimbursement of Telephone Charges", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 42 },
  { id: "tl_bhc", ledgerName: "Banana Hand Cart Fee (BHC)", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 43 },
  { id: "tl_bmf", ledgerName: "Bamboo Material Fee (BMF)", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 44 },
  { id: "tl_gc", ledgerName: "Garbage Charges", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 45 },
  { id: "tl_ht", ledgerName: "House Tax", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 46 },
  { id: "tl_gtax", ledgerName: "Garbage Tax", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 47 },
  { id: "tl_grad", ledgerName: "Grading Charges", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 48 },
  { id: "tl_tend", ledgerName: "Tender Form Fee", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 49 },
  { id: "tl_rti", ledgerName: "Application Fee under RTI", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 50 },
  { id: "tl_admin", ledgerName: "Administrative Charges", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 51 },
  { id: "tl_fine", ledgerName: "Fines/Penalty", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 52 },
  { id: "tl_park", ledgerName: "Parking Charges", primaryGroup: "Indirect Income", statementClass: "PL_Income", sortOrder: 53 },
  { id: "tl_bk_int", ledgerName: "Bank Interest", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 54 },
  { id: "tl_hire_g", ledgerName: "Hiring Charges for Godown/Stall", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 55 },
  { id: "tl_hire_o", ledgerName: "Hiring Charges for Open Space", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 56 },
  { id: "tl_misc", ledgerName: "Miscallaneous Income", primaryGroup: "Income from investments", statementClass: "PL_Income", sortOrder: 57 },
  { id: "tl_chq", ledgerName: "Dishonour of Cheque", primaryGroup: "Other Assets Receivable", statementClass: "BS_Asset", sortOrder: 58 },
  { id: "tl_bk_ch", ledgerName: "Bank Charges & Commission", primaryGroup: "Administrative Expenses", statementClass: "PL_Expense", sortOrder: 59 },
  { id: "tl_cash", ledgerName: "Cash", primaryGroup: "Current Assets", statementClass: "BS_Asset", sortOrder: 100 },
  { id: "tl_bank", ledgerName: "Bank Account", primaryGroup: "Current Assets", statementClass: "BS_Asset", sortOrder: 101 },
  { id: "tl_wages", ledgerName: "Daily Wages Acoount", primaryGroup: "Establishment Expenditure", statementClass: "PL_Expense", sortOrder: 200 },
  { id: "tl_gen_ch", ledgerName: "General Charges", primaryGroup: "Administrative Expenses", statementClass: "PL_Expense", sortOrder: 201 },
  { id: "tl_rm_yard", ledgerName: "Repairs & Maintenance", primaryGroup: "Principal & Submarket Yard", statementClass: "PL_Expense", sortOrder: 202 },
];

const GOVT_CATEGORIES = [
  { id: "gec_01", code: "GOVT-ADT", name: "Assistant Director of Transport.", sortOrder: 1 },
  { id: "gec_02", code: "GOVT-CDPO", name: "Child Development Project Officer.", sortOrder: 2 },
  { id: "gec_03", code: "GOVT-DMI", name: "Directorate of Marketing & Inspection (DMI).", sortOrder: 3 },
  { id: "gec_04", code: "GOVT-LM", name: "The Inspector of Legal Metrology (Weights & Measures).", sortOrder: 4 },
  { id: "gec_05", code: "GOVT-DAC", name: "The Director of Arts & Culture (Central Library).", sortOrder: 5 },
  { id: "gec_06", code: "GOVT-AEE", name: "The Assistant Engineer Electricity.", sortOrder: 6 },
  { id: "gec_07", code: "GOVT-GSHCL", name: "Goa State Horticultural Corporation Ltd.", sortOrder: 7 },
];

const REVENUE_HEAD_MAP: { revenueHead: string; tallyLedgerId: string }[] = [
  { revenueHead: "Rent", tallyLedgerId: "tl_rent" },
  { revenueHead: "GSTInvoice", tallyLedgerId: "tl_rent" },
  { revenueHead: "MarketFee", tallyLedgerId: "tl_mf" },
  { revenueHead: "LicenceFee", tallyLedgerId: "tl_lic" },
  { revenueHead: "SecurityDeposit", tallyLedgerId: "tl_sec_god" },
  { revenueHead: "Miscellaneous", tallyLedgerId: "tl_misc" },
];

async function main() {
  console.log("Seeding tally_ledgers...");
  for (const row of LEDGERS) {
    await db
      .insert(tallyLedgers)
      .values({ ...row, isActive: true })
      .onConflictDoUpdate({
        target: tallyLedgers.id,
        set: {
          ledgerName: row.ledgerName,
          primaryGroup: row.primaryGroup,
          statementClass: row.statementClass,
          sortOrder: row.sortOrder,
          isActive: true,
        },
      });
  }

  console.log("Seeding govt_gst_exempt_categories...");
  for (const row of GOVT_CATEGORIES) {
    await db
      .insert(govtGstExemptCategories)
      .values(row)
      .onConflictDoUpdate({
        target: govtGstExemptCategories.id,
        set: { code: row.code, name: row.name, sortOrder: row.sortOrder },
      });
  }

  console.log("Seeding ioms_revenue_head_ledger_map...");
  for (const m of REVENUE_HEAD_MAP) {
    await db
      .insert(iomsRevenueHeadLedgerMap)
      .values(m)
      .onConflictDoUpdate({
        target: iomsRevenueHeadLedgerMap.revenueHead,
        set: { tallyLedgerId: m.tallyLedgerId },
      });
  }

  console.log("Backfilling expenditure_heads.tally_ledger_id (by code)...");
  const headToLedger: Record<string, string> = {
    SAL: "tl_wages",
    OPS: "tl_gen_ch",
    MNT: "tl_rm_yard",
  };
  const heads = await db.select().from(expenditureHeads);
  for (const h of heads) {
    const tl = headToLedger[h.code];
    if (tl && !h.tallyLedgerId) {
      await db.update(expenditureHeads).set({ tallyLedgerId: tl }).where(eq(expenditureHeads.id, h.id));
    }
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
