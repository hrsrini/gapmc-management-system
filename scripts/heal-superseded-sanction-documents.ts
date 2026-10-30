/**
 * Ensure every Superseded leave Sanction Order is present under employee Documents
 * (and that Approved revisions also keep their parent order linked).
 *
 * Usage: npm run heal:superseded-sanction-docs
 */
import "dotenv/config";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { db } from "../server/db";
import { leaveRequests, employeeDocuments } from "@shared/db-schema";
import { getUploadBlobStore, assertSafeUploadRelativeKey } from "../server/object-storage";
import {
  isAllowedEmployeeDocumentFileName,
  writeEmployeeDocumentBuffer,
} from "../server/employee-document-storage";
import { nanoid } from "nanoid";

function sanctionOrderBlobKey(leaveRequestId: string): string {
  return assertSafeUploadRelativeKey(`leaves/sanction-orders/${leaveRequestId}.pdf`);
}

async function linkDoc(
  employeeId: string,
  leaveId: string,
  fileNo: string,
  buffer: Buffer,
  superseded: boolean,
): Promise<"inserted" | "updated" | "skipped"> {
  const stored = `lsn-${leaveId}.pdf`;
  if (!isAllowedEmployeeDocumentFileName(stored)) return "skipped";
  await writeEmployeeDocumentBuffer(employeeId, stored, buffer);
  const blobKey = `employees/${employeeId}/${stored}`;
  const displayName = superseded
    ? `Leave Sanction Order — Superseded (${fileNo}).pdf`
    : `Leave Sanction Order (${fileNo}).pdf`;
  const docType = superseded ? "Leave Sanction Order (Superseded)" : "Leave Sanction Order";
  const [existing] = await db
    .select()
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.employeeId, employeeId), eq(employeeDocuments.blobKey, blobKey)))
    .limit(1);
  if (existing) {
    await db
      .update(employeeDocuments)
      .set({
        docType,
        fileName: displayName,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        status: "Approved",
      })
      .where(eq(employeeDocuments.id, existing.id));
    return "updated";
  }
  await db.insert(employeeDocuments).values({
    id: nanoid(),
    employeeId,
    docType,
    fileName: displayName,
    mimeType: "application/pdf",
    sizeBytes: buffer.length,
    blobKey,
    status: "Approved",
    uploadedBy: null,
    createdAt: new Date().toISOString(),
  });
  return "inserted";
}

async function ensureOne(leaveId: string, forceSuperseded: boolean): Promise<string> {
  const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveId)).limit(1);
  if (!lr) return `missing:${leaveId}`;
  if (lr.status !== "Approved" && lr.status !== "Superseded") return `skip-status:${leaveId}`;

  const store = getUploadBlobStore();
  const blobKey = sanctionOrderBlobKey(leaveId);
  let buffer = await store.get(blobKey);
  let fileNo = String(lr.fileNo ?? "").trim();

  if (!buffer || !fileNo) {
    const { generateSanctionOrderPdf } = await import("../server/hr-leave-sanction-order-pdf");
    const gen = await generateSanctionOrderPdf(leaveId);
    buffer = gen.buffer;
    fileNo = gen.fileNo;
    await store.put(blobKey, buffer, "application/pdf");
  }

  const superseded = forceSuperseded || lr.status === "Superseded";
  const result = await linkDoc(lr.employeeId, leaveId, fileNo, buffer, superseded);
  return `${result}:${fileNo || leaveId}`;
}

async function main() {
  const rows = await db
    .select({
      id: leaveRequests.id,
      status: leaveRequests.status,
      revisedFromLeaveId: leaveRequests.revisedFromLeaveId,
      fileNo: leaveRequests.fileNo,
      employeeId: leaveRequests.employeeId,
    })
    .from(leaveRequests)
    .where(
      or(
        eq(leaveRequests.status, "Superseded"),
        and(eq(leaveRequests.status, "Approved"), isNotNull(leaveRequests.revisedFromLeaveId)),
      )!,
    );

  console.log(`Found ${rows.length} leave row(s) to heal (superseded and/or approved revisions).`);
  let ok = 0;
  let fail = 0;
  const seen = new Set<string>();

  for (const r of rows) {
    if (r.status === "Superseded" && !seen.has(r.id)) {
      seen.add(r.id);
      try {
        const msg = await ensureOne(r.id, true);
        console.log("  superseded", r.fileNo ?? r.id, msg);
        ok++;
      } catch (e) {
        fail++;
        console.error("  FAILED superseded", r.id, e);
      }
    }
    const parent = r.revisedFromLeaveId ? String(r.revisedFromLeaveId).trim() : "";
    if (parent && !seen.has(parent)) {
      seen.add(parent);
      try {
        const msg = await ensureOne(parent, true);
        console.log("  parent-of-revision", parent, msg);
        ok++;
      } catch (e) {
        fail++;
        console.error("  FAILED parent", parent, e);
      }
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
