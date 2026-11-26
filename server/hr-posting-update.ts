/**
 * M-01 Posting & Reporting Officer Update — apply-on-DA-approve + request numbering.
 */
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  employees,
  employeeDocuments,
  hrPostingUpdateRequests,
  hrPostingUpdateSequence,
  serviceBookEntries,
  users,
  yards,
} from "@shared/db-schema";
import {
  parseAdditionalChargeHoldings,
  serializeAdditionalChargeHoldings,
  type AdditionalChargeHolding,
} from "@shared/hr-additional-charge-locations";
import {
  postingServiceBookTypeLabel,
  type PostingChangeType,
} from "@shared/hr-posting-update";
import { db } from "./db";
import {
  employeeDocumentBlobKey,
  writeEmployeeDocumentBuffer,
} from "./employee-document-storage";
import { resolveUserIdForEmployee, syncUserYardsFromEmployeeLocations } from "./hr-employee-login";

export function isHeadOfficeYardRow(y: {
  type?: string | null;
  name?: string | null;
  code?: string | null;
} | null | undefined): boolean {
  if (!y) return false;
  if (String(y.type ?? "").toUpperCase() === "HO") return true;
  const name = String(y.name ?? "").toLowerCase();
  if (name.includes("head office")) return true;
  const code = String(y.code ?? "").trim().toLowerCase();
  return code === "ho" || code.startsWith("ho-") || code.startsWith("ho_");
}

function formatYmdDisplay(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || "—";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function empDisplayName(e: {
  firstName?: string | null;
  middleName?: string | null;
  surname?: string | null;
  empId?: string | null;
}): string {
  const name = [e.firstName, e.middleName, e.surname].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  const id = String(e.empId ?? "").trim();
  return id ? `${id} — ${name}` : name || "—";
}

async function yardNameById(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
  if (uniq.length === 0) return {};
  const rows = await db
    .select({ id: yards.id, name: yards.name, code: yards.code })
    .from(yards)
    .where(inArray(yards.id, uniq));
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.id] = String(r.name ?? "").trim() || String(r.code ?? "").trim() || r.id;
  }
  return map;
}

async function userDisplayName(userId: string | null | undefined): Promise<string | null> {
  const id = String(userId ?? "").trim();
  if (!id) return null;
  const [u] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!u) return id;
  return String(u.name ?? "").trim() || String(u.email ?? "").trim() || id;
}

export async function allocatePostingUpdateRequestNo(tx: typeof db = db): Promise<string> {
  const year = new Date().getFullYear();
  const [existing] = await tx
    .select()
    .from(hrPostingUpdateSequence)
    .where(eq(hrPostingUpdateSequence.year, year))
    .limit(1);
  if (!existing) {
    const id = nanoid();
    await tx.insert(hrPostingUpdateSequence).values({ id, year, lastSeq: 1 });
    return `PU-${year}-${String(1).padStart(4, "0")}`;
  }
  const next = Number(existing.lastSeq ?? 0) + 1;
  await tx
    .update(hrPostingUpdateSequence)
    .set({ lastSeq: next })
    .where(eq(hrPostingUpdateSequence.id, existing.id));
  return `PU-${year}-${String(next).padStart(4, "0")}`;
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  const t = String(raw ?? "").trim();
  if (!t) return [];
  try {
    const p = JSON.parse(t) as unknown;
    if (!Array.isArray(p)) return [];
    return p.map((x) => String(x ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonStringMap(raw: string | null | undefined): Record<string, string> {
  const t = String(raw ?? "").trim();
  if (!t) return {};
  try {
    const p = JSON.parse(t) as unknown;
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const key = String(k).trim();
      const val = String(v ?? "").trim();
      if (key && val) out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export function buildPostingParticulars(opts: {
  changeType: PostingChangeType;
  oldYardName: string;
  newYardName?: string;
  assignLabels: string[];
  withdrawLabels: string[];
  primaryYardName: string;
}): string {
  switch (opts.changeType) {
    case "Transfer":
      return `Primary place of posting changed from ${opts.oldYardName} to ${opts.newYardName ?? "—"}.`;
    case "AssignAdditionalCharge": {
      const list =
        opts.assignLabels.length > 1
          ? `${opts.assignLabels.slice(0, -1).join(", ")} and ${opts.assignLabels.slice(-1)[0]}`
          : opts.assignLabels[0] ?? "—";
      return `Additional charge of ${list} assigned, in addition to ${opts.primaryYardName}.`;
    }
    case "WithdrawAdditionalCharge": {
      const list =
        opts.withdrawLabels.length > 1
          ? `${opts.withdrawLabels.slice(0, -1).join(", ")} and ${opts.withdrawLabels.slice(-1)[0]}`
          : opts.withdrawLabels[0] ?? "—";
      return `Additional charge of ${list} withdrawn.`;
    }
    case "ChangeReportingOfficer":
      return `Reporting officer changed. Primary location (${opts.primaryYardName}) and additional charge unchanged.`;
    default:
      return "Posting update.";
  }
}

export type PostingRequestRow = typeof hrPostingUpdateRequests.$inferSelect;

/** Apply approved request: employee + yards + service book + optional document. All-or-nothing. */
export async function applyPostingUpdateOnApproval(
  requestId: string,
  approvedByUserId: string,
): Promise<PostingRequestRow> {
  return await db.transaction(async (tx) => {
    const [reqRow] = await tx
      .select()
      .from(hrPostingUpdateRequests)
      .where(eq(hrPostingUpdateRequests.id, requestId))
      .limit(1);
    if (!reqRow) throw new Error("Posting update request not found");
    if (reqRow.status !== "PendingApproval") {
      throw new Error("Request is not pending DA approval");
    }

    const [emp] = await tx.select().from(employees).where(eq(employees.id, reqRow.employeeId)).limit(1);
    if (!emp) throw new Error("Employee not found");

    const changeType = reqRow.changeType as PostingChangeType;
    const effectiveFrom = String(reqRow.effectiveFrom).trim();
    const hoMap = parseJsonStringMap(reqRow.hoSectionByYardId);
    const assignIds = parseJsonStringArray(reqRow.additionalYardIds);
    const withdrawIds = parseJsonStringArray(reqRow.withdrawYardIds);

    let nextYardId = emp.yardId;
    let nextSection = emp.section;
    let nextRo = emp.reportingOfficerEmployeeId;
    let nextHoldings = parseAdditionalChargeHoldings(emp.locationPosted, emp.yardId);

    if (changeType === "Transfer") {
      const newYardId = String(reqRow.newYardId ?? "").trim();
      if (!newYardId) throw new Error("New primary location is required");
      nextYardId = newYardId;
      nextSection = String(reqRow.newSection ?? "").trim() || null;
      nextRo = String(reqRow.newReportingOfficerEmployeeId ?? "").trim() || null;
      // Drop additional charges that collide with the new primary.
      nextHoldings = nextHoldings.filter((h) => h.yardId !== newYardId);
    } else if (changeType === "AssignAdditionalCharge") {
      if (assignIds.length === 0) throw new Error("No locations to assign");
      const existing = new Set(nextHoldings.map((h) => h.yardId));
      for (const id of assignIds) {
        if (id === nextYardId) continue;
        if (existing.has(id)) continue;
        const holding: AdditionalChargeHolding = {
          yardId: id,
          from: effectiveFrom,
          section: hoMap[id] ?? null,
        };
        nextHoldings.push(holding);
        existing.add(id);
      }
    } else if (changeType === "WithdrawAdditionalCharge") {
      if (withdrawIds.length === 0) throw new Error("No locations to withdraw");
      const drop = new Set(withdrawIds);
      nextHoldings = nextHoldings.filter((h) => !drop.has(h.yardId));
    } else if (changeType === "ChangeReportingOfficer") {
      nextRo = String(reqRow.newReportingOfficerEmployeeId ?? "").trim() || null;
    } else {
      throw new Error(`Unknown change type: ${changeType}`);
    }

    const locationPosted = serializeAdditionalChargeHoldings(nextHoldings, nextYardId);
    const nowIso = new Date().toISOString();

    await tx
      .update(employees)
      .set({
        yardId: nextYardId,
        section: nextSection,
        locationPosted,
        reportingOfficerEmployeeId: nextRo,
        updatedAt: nowIso,
      })
      .where(eq(employees.id, emp.id));

    const loginUid = emp.userId ?? (await resolveUserIdForEmployee(emp.id));
    if (loginUid) {
      await syncUserYardsFromEmployeeLocations(tx, loginUid, nextYardId, locationPosted);
    }

    const nameIds = [
      emp.yardId,
      nextYardId,
      ...assignIds,
      ...withdrawIds,
      ...nextHoldings.map((h) => h.yardId),
    ];
    const yardNames = await yardNameById(nameIds);
    const yardRows =
      nameIds.length > 0
        ? await tx
            .select({ id: yards.id, name: yards.name, code: yards.code, type: yards.type })
            .from(yards)
            .where(inArray(yards.id, [...new Set(nameIds)]))
        : [];
    const yardRowById = Object.fromEntries(yardRows.map((y) => [y.id, y]));

    const assignLabels = assignIds.map((id) => {
      const sec = hoMap[id] ?? null;
      const base = yardNames[id] ?? id;
      if (sec && isHeadOfficeYardRow(yardRowById[id])) return `${base} (${sec})`;
      return sec ? `${base} (${sec})` : base;
    });
    const withdrawLabels = withdrawIds.map((id) => yardNames[id] ?? id);

    const [oldRo, newRo] = await Promise.all([
      emp.reportingOfficerEmployeeId
        ? tx.select().from(employees).where(eq(employees.id, emp.reportingOfficerEmployeeId)).limit(1)
        : Promise.resolve([] as (typeof emp)[]),
      nextRo
        ? tx.select().from(employees).where(eq(employees.id, nextRo)).limit(1)
        : Promise.resolve([] as (typeof emp)[]),
    ]);

    const oldRoLabel = oldRo[0] ? empDisplayName(oldRo[0]) : "—";
    const newRoLabel = newRo[0] ? empDisplayName(newRo[0]) : "—";

    const particulars = buildPostingParticulars({
      changeType,
      oldYardName: yardNames[emp.yardId] ?? emp.yardId,
      newYardName: yardNames[nextYardId] ?? nextYardId,
      assignLabels,
      withdrawLabels,
      primaryYardName: yardNames[nextYardId] ?? nextYardId,
    });

    const [doName, dvName, daName] = await Promise.all([
      userDisplayName(reqRow.doUser),
      userDisplayName(reqRow.dvUser),
      userDisplayName(approvedByUserId),
    ]);

    let documentId: string | null = null;
    if (reqRow.orderCopyBlobKey && reqRow.orderCopyFileName && reqRow.orderCopyMimeType) {
      documentId = nanoid();
      await tx.insert(employeeDocuments).values({
        id: documentId,
        employeeId: emp.id,
        docType: "OrderCopy",
        fileName: reqRow.orderCopyFileName,
        mimeType: reqRow.orderCopyMimeType,
        sizeBytes: reqRow.orderCopySizeBytes ?? 0,
        blobKey: reqRow.orderCopyBlobKey,
        status: "Approved",
        uploadedBy: reqRow.doUser ?? approvedByUserId,
        createdAt: nowIso,
      });
    }

    const sbId = nanoid();
    const contentType =
      changeType === "Transfer"
        ? "posting_transfer"
        : changeType === "AssignAdditionalCharge"
          ? "posting_additional_charge"
          : changeType === "WithdrawAdditionalCharge"
            ? "posting_charge_withdrawn"
            : "posting_reporting_officer_changed";

    const reportingOfficerColumn =
      changeType === "Transfer" || changeType === "ChangeReportingOfficer"
        ? { old: oldRoLabel, new: newRoLabel, text: `${oldRoLabel} → ${newRoLabel}` }
        : { old: oldRoLabel, new: oldRoLabel, text: `No change — ${oldRoLabel}` };

    await tx.insert(serviceBookEntries).values({
      id: sbId,
      employeeId: emp.id,
      section: "History",
      content: {
        type: contentType,
        postingUpdateRequestId: reqRow.id,
        requestNo: reqRow.requestNo,
        changeType,
        changeTypeLabel: postingServiceBookTypeLabel(changeType),
        effectiveFrom,
        effectiveFromDisplay: formatYmdDisplay(effectiveFrom),
        orderNo: reqRow.orderNo ?? null,
        orderDate: reqRow.orderDate ?? null,
        orderDateDisplay: reqRow.orderDate ? formatYmdDisplay(reqRow.orderDate) : null,
        remarks: reqRow.remarks ?? null,
        particulars,
        text: particulars,
        reportingOfficer: reportingOfficerColumn,
        oldYardId: emp.yardId,
        newYardId: nextYardId,
        assignYardIds: assignIds,
        withdrawYardIds: withdrawIds,
        orderCopyDocumentId: documentId,
        enteredBy: { userId: reqRow.doUser, name: doName, at: reqRow.submittedAt },
        verifiedBy: { userId: reqRow.dvUser, name: dvName, at: reqRow.verifiedAt },
        approvedBy: { userId: approvedByUserId, name: daName, at: nowIso },
      },
      isImmutable: true,
      status: "Approved",
      doUser: reqRow.doUser ?? null,
      dvUser: reqRow.dvUser ?? null,
      approvedBy: approvedByUserId,
      approvedAt: nowIso,
      rejectionReasonCode: null,
      rejectionRemarks: null,
      workflowRevisionCount: 0,
      dvReturnRemarks: null,
    });

    const [updated] = await tx
      .update(hrPostingUpdateRequests)
      .set({
        status: "Approved",
        approvedBy: approvedByUserId,
        approvedAt: nowIso,
        updatedAt: nowIso,
        serviceBookEntryId: sbId,
        documentId,
        returnOrRejectRemarks: null,
      })
      .where(eq(hrPostingUpdateRequests.id, requestId))
      .returning();

    if (!updated) throw new Error("Failed to mark request approved");
    return updated;
  });
}

/** Used when uploading order copy before/after submit — stores under employee blob path. */
export async function storePostingOrderCopy(opts: {
  employeeId: string;
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
}): Promise<{ blobKey: string; fileName: string; mimeType: string; sizeBytes: number }> {
  const ext =
    opts.mimeType === "application/pdf"
      ? ".pdf"
      : opts.mimeType === "image/png"
        ? ".png"
        : opts.mimeType === "image/webp"
          ? ".webp"
          : opts.mimeType === "image/jpeg"
            ? ".jpg"
            : null;
  if (!ext) throw new Error("Only PDF/JPG/PNG/WebP are allowed for order copy");
  const fileName = `${nanoid(16)}${ext}`;
  await writeEmployeeDocumentBuffer(opts.employeeId, fileName, opts.buffer);
  return {
    blobKey: employeeDocumentBlobKey(opts.employeeId, fileName),
    fileName,
    mimeType: opts.mimeType,
    sizeBytes: opts.buffer.length,
  };
}

export { parseJsonStringArray, parseJsonStringMap };
