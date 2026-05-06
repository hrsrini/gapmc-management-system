/**
 * Ops script: issue licence number (if missing), validity dates (if missing), set status Active,
 * unblock, and link LicenceFee receipt when feeAmount > 0 (mirrors M-02 PUT behaviour).
 *
 * Usage:
 *   npm run db:activate-trader-licence -- --firm="Microfarmer Enterprises"
 *   npm run db:activate-trader-licence -- --id=3TG7EKuTGHwvWA0RcPjMi
 */
import "dotenv/config";
import { and, eq, ilike, type InferSelectModel } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, pool } from "../server/db";
import { iomsReceipts, traderLicences } from "../shared/db-schema";
import { createIomsReceipt } from "../server/routes-receipts-ioms";
import { tenantLicenceIsGstExempt } from "../server/gst-exempt";
import { unifiedEntityIdFromTrackA } from "../shared/unified-entity-id";

function parseArgs(): { id?: string; firm?: string } {
  const out: { id?: string; firm?: string } = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--id=")) out.id = a.slice(5).trim();
    else if (a.startsWith("--firm=")) out.firm = a.slice(7).trim();
  }
  return out;
}

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
      createdBy: "script:activate-trader-licence",
    });
    const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
    receiptToLink = createdRow ?? null;
  }

  if (receiptToLink?.id) {
    await db
      .update(traderLicences)
      .set({ receiptId: receiptToLink.id, updatedAt: new Date().toISOString() })
      .where(eq(traderLicences.id, row.id));
    console.log(`Linked LicenceFee receipt ${receiptToLink.receiptNo} (${receiptToLink.id}).`);
  }
}

async function main(): Promise<void> {
  const { id: argId, firm: argFirm } = parseArgs();
  const now = new Date().toISOString();

  let rows: TraderLicenceRow[];
  if (argId) {
    rows = await db.select().from(traderLicences).where(eq(traderLicences.id, argId));
  } else {
    const firmPat = (argFirm ?? "Microfarmer Enterprises").trim();
    if (!firmPat) {
      console.error("Provide --id=… or --firm=… (non-empty).");
      process.exitCode = 1;
      return;
    }
    rows = await db.select().from(traderLicences).where(ilike(traderLicences.firmName, `%${firmPat}%`));
  }

  if (rows.length === 0) {
    console.error("No trader licence matched.");
    process.exitCode = 1;
    return;
  }
  if (rows.length > 1) {
    console.error("Multiple licences matched; pass --id=… to pick one:\n" + rows.map((r) => `  ${r.id}\t${r.firmName}\t${r.status}`).join("\n"));
    process.exitCode = 1;
    return;
  }

  const existing = rows[0]!;
  console.log(`Found: ${existing.id} — ${existing.firmName} (status=${existing.status}, blocked=${existing.isBlocked})`);

  if (existing.status === "Active" && !existing.isBlocked) {
    console.log("Already Active and not blocked. Ensuring receipt linkage only if needed.");
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
    existing.validTo != null && String(existing.validTo).trim() !== "" ? String(existing.validTo).trim() : "2027-12-31";

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
  if (!updated) {
    console.error("Update failed — row missing after patch.");
    process.exitCode = 1;
    return;
  }

  console.log(`Activated: licence_no=${updated.licenceNo}, valid ${updated.validFrom} → ${updated.validTo}, status=${updated.status}`);

  await ensureLicenceFeeReceipt(updated);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
