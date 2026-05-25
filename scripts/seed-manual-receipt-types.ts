/**
 * Seed manual_receipt_types from requirements/Manual_Receipt_Scenarios.xlsx
 * Run: npm run db:seed-manual-receipt-types
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, pool } from "../server/db";
import { manualReceiptTypes, tallyLedgers } from "../shared/db-schema";
import {
  inferPayeeRuleFromLinkText,
  normalizeLedgerName,
  revenueHeadForLedgerName,
} from "../shared/manual-receipt-types";

const XLSX_PATH = join(process.cwd(), "requirements", "Manual_Receipt_Scenarios.xlsx");

function slugId(ledgerName: string): string {
  const base = ledgerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return `mrt_${base || nanoid(8)}`;
}

async function main(): Promise<void> {
  if (!existsSync(XLSX_PATH)) {
    console.error(`Missing ${XLSX_PATH}. Copy Tally ledgers.xlsx to requirements/Manual_Receipt_Scenarios.xlsx`);
    process.exitCode = 1;
    return;
  }

  const wb = XLSX.read(readFileSync(XLSX_PATH));
  const dropdownSheet = wb.Sheets["Dropdown_Reciets_Form"];
  const dropdownRows = dropdownSheet
    ? (XLSX.utils.sheet_to_json(dropdownSheet, { header: 1, defval: "" }) as string[][])
    : [];
  const dropdownNames = new Set<string>();
  for (const row of dropdownRows.slice(1)) {
    const name = normalizeLedgerName(String(row[1] ?? ""));
    if (name) dropdownNames.add(name);
  }
  dropdownNames.add(normalizeLedgerName("Miscallaneous Income"));

  const receiptRows = XLSX.utils.sheet_to_json(wb.Sheets["Receipts"], {
    header: 1,
    defval: "",
  }) as string[][];

  const ledgers = await db.select().from(tallyLedgers);
  const ledgerByName = new Map<string, (typeof ledgers)[0]>();
  for (const l of ledgers) {
    ledgerByName.set(normalizeLedgerName(l.ledgerName).toLowerCase(), l);
    ledgerByName.set(String(l.ledgerName).trim().toLowerCase(), l);
  }

  let upserted = 0;
  for (const row of receiptRows) {
    const sr = row[0];
    const linkText = String(row[2] ?? "");
    const requiresPremises = String(row[3] ?? "").trim().toUpperCase() === "YES";
    const ledgerName = normalizeLedgerName(String(row[4] ?? ""));
    const primaryGroup = String(row[5] ?? "").trim() || null;
    const statementClass = String(row[6] ?? "").trim() || null;
    if (!ledgerName || ledgerName === "Name" || typeof sr !== "number") continue;

    const payeeRule = inferPayeeRuleFromLinkText(linkText);
    const revenueHead = revenueHeadForLedgerName(ledgerName);
    const tl = ledgerByName.get(ledgerName.toLowerCase());

    const id = slugId(ledgerName);
    const showInDropdown = [...dropdownNames].some((d) => d.toLowerCase() === ledgerName.toLowerCase());

    const [existing] = await db
      .select({ id: manualReceiptTypes.id })
      .from(manualReceiptTypes)
      .where(eq(manualReceiptTypes.ledgerName, ledgerName))
      .limit(1);

    const payload = {
      sortOrder: Number(sr) || upserted + 1,
      ledgerName,
      tallyLedgerId: tl?.id ?? null,
      primaryGroup,
      statementClass,
      revenueHead,
      payeeRule,
      requiresPremises,
      showInDropdown,
      linkingNotes: linkText.trim() || null,
      isActive: true,
    };

    if (existing) {
      await db.update(manualReceiptTypes).set(payload).where(eq(manualReceiptTypes.id, existing.id));
    } else {
      await db.insert(manualReceiptTypes).values({ id, ...payload });
    }
    upserted += 1;
  }

  console.log(`Seeded ${upserted} manual receipt types (${dropdownNames.size} dropdown labels in workbook).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
