/**
 * Batch-activate trader licences by firm name (ops).
 * Usage: npx dotenv -e .env -- tsx scripts/activate-pending-licences-batch.ts
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, pool } from "../server/db";
import { iomsReceipts, traderLicences } from "../shared/db-schema";
import { createIomsReceipt } from "../server/routes-receipts-ioms";
import { tenantLicenceIsGstExempt } from "../server/gst-exempt";
import { unifiedEntityIdFromTrackA } from "../shared/unified-entity-id";
import type { InferSelectModel } from "drizzle-orm";

const FIRMS = [
  "Agrovan Distributors Private Limited",
  "ORGANIC ENTERPRISES",
  "Siddharth Rane",
  "AJIT ENTERPRISES",
  "SUNRISE INDUSTRIES",
];

async function allocateUniqueLicenceNo(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = `GAPMC/AUTO/${nanoid(8)}`;
    const [hit] = await db.select({ id: traderLicences.id }).from(traderLicences).where(eq(traderLicences.licenceNo, candidate)).limit(1);
    if (!hit) return candidate;
  }
  throw new Error("Could not allocate a unique licence_no");
}

type TraderLicenceRow = InferSelectModel<typeof traderLicences>;

async function ensureLicenceFeeReceipt(row: TraderLicenceRow): Promise<void> {
  const fee = Number(row.feeAmount ?? 0);
  const rid = row.receiptId != null ? String(row.receiptId).trim() : "";
  if (fee <= 0 || rid) return;

  const [existingReceipt] = await db
    .select()
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-02"), eq(iomsReceipts.sourceRecordId, row.id)))
    .limit(1);

  let receiptToLink = existingReceipt ?? null;
  if (!receiptToLink) {
    const exempt = await tenantLicenceIsGstExempt(row.id);
    const created = await createIomsReceipt({
      yardId: String(row.yardId),
      revenueHead: "LicenceFee",
      payerName: row.firmName,
      payerType: "TraderLicence",
      payerRefId: row.id,
      amount: fee,
      cgst: exempt ? 0 : undefined,
      sgst: exempt ? 0 : undefined,
      paymentMode: "Cash",
      sourceModule: "M-02",
      sourceRecordId: row.id,
      unifiedEntityId: unifiedEntityIdFromTrackA(row.id),
      createdBy: "script:activate-pending-licences-batch",
    });
    const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
    receiptToLink = createdRow ?? null;
  }

  if (receiptToLink?.id) {
    await db
      .update(traderLicences)
      .set({ receiptId: receiptToLink.id, updatedAt: new Date().toISOString() })
      .where(eq(traderLicences.id, row.id));
    console.log(`  Linked LicenceFee receipt ${receiptToLink.receiptNo}`);
  }
}

async function activateOne(existing: TraderLicenceRow): Promise<void> {
  const now = new Date().toISOString();
  console.log(`\n${existing.firmName} (${existing.id}) — was ${existing.status}`);

  if (existing.status === "Active" && !existing.isBlocked) {
    console.log("  Already Active.");
    await ensureLicenceFeeReceipt(existing);
    return;
  }

  const licenceNo =
    existing.licenceNo != null && String(existing.licenceNo).trim() !== ""
      ? String(existing.licenceNo).trim()
      : await allocateUniqueLicenceNo();

  const validFrom =
    existing.validFrom != null && String(existing.validFrom).trim() !== "" ? String(existing.validFrom).trim() : "2026-01-01";
  const validTo =
    existing.validTo != null && String(existing.validTo).trim() !== "" ? String(existing.validTo).trim() : "2027-03-31";

  await db
    .update(traderLicences)
    .set({
      licenceNo,
      validFrom,
      validTo,
      status: "Active",
      isBlocked: false,
      blockReason: null,
      updatedAt: now,
    })
    .where(eq(traderLicences.id, existing.id));

  const [updated] = await db.select().from(traderLicences).where(eq(traderLicences.id, existing.id)).limit(1);
  if (!updated) throw new Error(`Update failed for ${existing.id}`);
  console.log(`  Activated: ${updated.licenceNo}, valid ${updated.validFrom} → ${updated.validTo}`);
  await ensureLicenceFeeReceipt(updated);
}

async function main(): Promise<void> {
  const all = await db.select().from(traderLicences);
  const matched = all.filter((r) => FIRMS.some((f) => r.firmName?.trim() === f));

  if (matched.length === 0) {
    console.error("No licences matched the firm list.");
    process.exitCode = 1;
    return;
  }

  const foundNames = new Set(matched.map((r) => r.firmName?.trim()));
  for (const f of FIRMS) {
    if (!foundNames.has(f)) console.warn(`Warning: no row for "${f}"`);
  }

  console.log(`Activating ${matched.length} licence(s)...`);
  for (const row of matched) {
    await activateOne(row);
  }
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
