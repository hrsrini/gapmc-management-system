/**
 * IOMS M-01: HRMS & Service Record API routes.
 * Tables: employees, employee_contracts, recruitment, attendances, timesheets,
 * service_book_entries, leave_requests, ltc_claims, ta_da_claims.
 */
import type { Express, Response, Request } from "express";
import path from "path";
import { eq, desc, or, and, gte, lte, isNotNull, asc, sql, ilike, inArray } from "drizzle-orm";
import multer from "multer";
import { db } from "./db";
import {
  employees,
  users,
  designationMaster,
  employeeContracts,
  recruitment,
  attendances,
  timesheets,
  serviceBookEntries,
  leaveRequests,
  employeeLeaveBalances,
  hrHolidays,
  leaveOrderSequence,
  tourProgrammes,
  ltcClaims,
  taDaClaims,
  employeeDocuments,
  yards,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canonicalizeEmployeeStatus,
  employeeStatusDisplayLabel,
  employeeStatusesThatDisableAppLogin,
  isAllowedEmployeeLifecycleTransition,
  isKnownEmployeeLifecycleStatus,
  isTerminalEmployeeLifecycleStatus,
} from "@shared/employee-lifecycle-status";
import {
  employeeStatusRequiresEffectiveDate,
  localCalendarYmdUtc,
  resolveStatusEffectiveDate,
} from "@shared/employee-status-effective-date";
import {
  canCreateLeaveRequest,
  canTransitionLeaveRequest,
  leaveRequestAwaitingMyAction,
  assertSegregationDoDvDa,
  canCreateTourProgramme,
  canTransitionTourProgramme,
  tourProgrammeAwaitingMyAction,
  canCreateTaDaClaim,
  canTransitionTaDaClaim,
  taDaClaimAwaitingMyAction,
  canCreateLtcClaim,
  canTransitionLtcClaim,
  ltcClaimAwaitingMyAction,
  canCreateServiceBookEntry,
  canTransitionServiceBookEntry,
} from "./workflow";
import { validateDaRejection, validateDvReturnToDraft } from "@shared/workflow-rejection";
import { sendApiError } from "./api-errors";
import { reportSearchPattern } from "./report-paging";
import { writeAuditLog } from "./audit";
import { hasPermission } from "./auth";
import { getMergedSystemConfig, resolveAadhaarHmacSecret } from "./system-config";
import { sendNotificationStub } from "./notify";
import {
  contentTypeForEmployeeDocument,
  extFromEmployeeDocumentMime,
  isAllowedEmployeeDocumentFileName,
  readEmployeeDocumentBuffer,
  unlinkEmployeeDocumentIfExists,
  writeEmployeeDocumentBuffer,
} from "./employee-document-storage";
import {
  enrichEmployeesWithAppLogin,
  buildLoginProfileForEmployee,
  handleCreateEmployeeLogin,
  handleUpdateEmployeeLogin,
  resolveUserIdForEmployee,
  syncUserYardsFromEmployeeLocations,
} from "./hr-employee-login";
import {
  HrEmployeeRuleError,
  assertJoiningAndDob,
  normalizePan,
  normalizeAadhaarMasked,
  assertPersonalEmailFormat,
  assertWorkEmailFormat,
  normalizeMobile10,
  assertEmployeeUniqueness,
  allocateNextEmpId,
  allocateNextServiceBookNo,
  parseEmployeeMasterSrs411Fields,
} from "./hr-employee-rules";
import { aadhaarFingerprintHmac, maskAadhaar, readAadhaarRawFromRequestBody } from "./aadhaar-fingerprint";
import { inclusiveCalendarDays } from "./hr-leave-utils";
import {
  formatLeaveOrderDateDisplay,
  leaveSupportingDocRequired,
  leaveTypeSkipsBalanceDebit,
} from "@shared/hr-leave-display";
import { normalizeIsoCalendarYmd } from "@shared/iso-calendar-ymd";
import { calculatePrefixSuffix, calculateDebitDays, validateRhDate } from "./hr-leave-prefix-suffix";
import { debitLeaveBalanceOnApproval, creditLeaveBalanceOnReversal, balanceLeaveTypeFor, assertSufficientBalanceForApprovalTx } from "./hr-leave-balance-debit";
import {
  healLeaveBalanceEmployeeIds,
  healLeaveBalanceTypeAliases,
  resolveElSetOffExpiryDate,
  resolveEmployeePkForLeaveBalance,
} from "./hr-leave-balance-resolve";
import {
  parseLeaveBalanceImportCsv,
  upsertLeaveBalanceImportRows,
} from "./hr-leave-balance-import";
import {
  validateLeaveDurationCaps,
  validateCclLifetimeCap,
  validateLeaveDatesNotPublicHoliday,
  assertSufficientBalanceForApproval,
} from "./hr-leave-validation";
import { emailSanctionOrderPdf } from "./hr-leave-sanction-email";
import { extFromPdfUpload } from "./upload-pdf-mime";
import { assertSafeUploadRelativeKey, getUploadBlobStore } from "./object-storage";
import {
  resolveDesignationForEmployeeUpsert,
  countEmployeesUsingDesignation,
  assertDesignationMasterCode,
} from "./hr-designation-resolve";
import {
  loadLeaveReportingEmployeeIndex,
  resolveLeaveVerifierEmployeeId,
  resolveLeaveApproverEmployeeIdAsync,
  resolveLeaveApproverEmployeeIdsBatch,
  resolveLinkedUserIdsForEmployees,
  leaveEmployeeInOfficerScope,
} from "./hr-leave-reporting-scope";
import {
  parseAdditionalChargeYardIds,
  serializeAdditionalChargeYardIds,
} from "@shared/hr-additional-charge-locations";

/** Weekly-off / prefix-suffix location type from Primary Location (yard), not additional charges. */
async function primaryLocationTypeForEmployee(employeeId: string): Promise<string | undefined> {
  const [emp] = await db
    .select({ yardId: employees.yardId })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!emp?.yardId) return undefined;
  const [yard] = await db
    .select({ type: yards.type, name: yards.name, code: yards.code })
    .from(yards)
    .where(eq(yards.id, emp.yardId))
    .limit(1);
  if (!yard) return undefined;
  return yard.type ?? yard.name ?? yard.code ?? undefined;
}

/** Normalize Additional Charge Locations from body (array or locationPosted JSON) excluding primary yard. */
function resolveAdditionalChargeLocationPosted(
  body: Record<string, unknown>,
  primaryYardId: string,
): string | null {
  const primary = String(primaryYardId ?? "").trim();
  if (Array.isArray(body.additionalChargeYardIds)) {
    return serializeAdditionalChargeYardIds(
      body.additionalChargeYardIds.map((x) => String(x ?? "").trim()).filter(Boolean),
      primary,
    );
  }
  if (body.locationPosted == null || String(body.locationPosted).trim() === "") return null;
  return serializeAdditionalChargeYardIds(
    parseAdditionalChargeYardIds(String(body.locationPosted), primary),
    primary,
  );
}

/** Update path: only when client sent additionalChargeYardIds or locationPosted. */
function maybeResolveAdditionalChargeLocationPosted(
  body: Record<string, unknown>,
  primaryYardId: string,
): string | null | undefined {
  if (body.additionalChargeYardIds === undefined && body.locationPosted === undefined) return undefined;
  return resolveAdditionalChargeLocationPosted(body, primaryYardId);
}

const employeeDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // SRS: <= 5 MB
});

function multerEmployeeDoc(req: Request, res: Response, next: () => void): void {
  employeeDocUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (err && typeof err === "object" && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
      return sendApiError(res, 400, "HR_EMP_DOC_TOO_LARGE", "Document must be 5 MB or smaller.");
    }
    console.error(err);
    return sendApiError(res, 400, "HR_EMP_DOC_UPLOAD_FAILED", msg);
  });
}

function sendHrEmployeeRuleError(res: Response, e: unknown): boolean {
  if (e instanceof HrEmployeeRuleError) {
    sendApiError(res, 400, e.code, e.message);
    return true;
  }
  return false;
}

const OFFICIAL_EMP_ID_RE = /^EMP-\d{3,4}$/i;

function hasOfficialEmpId(empId: string | null | undefined): boolean {
  if (empId == null || String(empId).trim() === "") return false;
  return OFFICIAL_EMP_ID_RE.test(String(empId).trim());
}

function requireLeaveRead(req: Request, res: Response): boolean {
  if (!req.user) {
    sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    return false;
  }
  if (!hasPermission(req.user, "M-01", "Read")) {
    sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Read required", { required: "M-01:Read" });
    return false;
  }
  return true;
}

function sanctionOrderBlobKey(leaveRequestId: string): string {
  return assertSafeUploadRelativeKey(`leaves/sanction-orders/${leaveRequestId}.pdf`);
}

async function notifyLeaveStatusChange(
  leaveRow: { id: string; employeeId: string; leaveType: string; fromDate: string; toDate: string; status: string },
  actorLabel?: string,
): Promise<void> {
  const [emp] = await db.select().from(employees).where(eq(employees.id, leaveRow.employeeId)).limit(1);
  if (!emp) return;
  sendNotificationStub({
    kind: "leave_workflow",
    leaveRequestId: leaveRow.id,
    employeeId: leaveRow.employeeId,
    empId: emp.empId ?? emp.id,
    employeeName: `${emp.firstName} ${emp.surname}`.trim(),
    leaveType: leaveRow.leaveType,
    fromDate: leaveRow.fromDate,
    toDate: leaveRow.toDate,
    status: leaveRow.status,
    actorLabel,
  });
}

const LEAVE_SERVICE_BOOK_TYPE_LABELS: Record<string, string> = {
  EL: "Earned Leave",
  HPL: "Half Pay Leave",
  COMMUTED: "Commuted Leave",
  CL: "Casual Leave",
  RH: "Restricted Holiday",
  SPL_H: "Special Holiday",
  ML: "Maternity Leave",
  PL: "Paternity Leave",
  EOL: "Extraordinary Leave",
  CCL: "Child Care Leave",
};

function formatServiceBookYmd(iso: string | null | undefined): string {
  const raw = String(iso ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : raw || "—";
}

async function appendLeaveServiceBookEntry(
  leaveRow: {
    id: string;
    employeeId: string;
    leaveType: string;
    fromDate: string;
    toDate: string;
    debitDays?: number | null;
    fileNo?: string | null;
    doUser?: string | null;
    dvUser?: string | null;
    rejoiningDate?: string | null;
  },
  approvedByUserId: string | null,
  kind: "leave_sanction" | "leave_rejoining" = "leave_sanction",
): Promise<void> {
  const ts = new Date().toISOString();
  const leaveLabel =
    LEAVE_SERVICE_BOOK_TYPE_LABELS[String(leaveRow.leaveType).trim().toUpperCase()] ?? leaveRow.leaveType;
  const fileNoText = leaveRow.fileNo?.trim() ? ` (File No: ${leaveRow.fileNo.trim()})` : "";
  const fromDisp = formatServiceBookYmd(leaveRow.fromDate);
  const toDisp = formatServiceBookYmd(leaveRow.toDate);
  const text =
    kind === "leave_rejoining"
      ? `Rejoined duty on ${formatServiceBookYmd(leaveRow.rejoiningDate)} after ${leaveLabel} (${fromDisp} to ${toDisp})${fileNoText}`
      : `${leaveLabel} leave sanction for ${fromDisp} to ${toDisp}${fileNoText}`;
  await db.insert(serviceBookEntries).values({
    id: nanoid(),
    employeeId: leaveRow.employeeId,
    section: "History",
    content: {
      type: kind,
      leaveRequestId: leaveRow.id,
      leaveType: leaveRow.leaveType,
      leaveTypeLabel: leaveLabel,
      fromDate: leaveRow.fromDate,
      toDate: leaveRow.toDate,
      debitDays: leaveRow.debitDays ?? null,
      fileNo: leaveRow.fileNo ?? null,
      rejoiningDate: leaveRow.rejoiningDate ?? null,
      text,
    },
    isImmutable: true,
    status: "Approved",
    doUser: leaveRow.doUser ?? null,
    dvUser: leaveRow.dvUser ?? null,
    approvedBy: approvedByUserId,
    approvedAt: ts,
    rejectionReasonCode: null,
    rejectionRemarks: null,
    workflowRevisionCount: 0,
    dvReturnRemarks: null,
  });
}

async function linkSanctionOrderToEmployeeDocuments(
  employeeId: string,
  leaveId: string,
  fileNo: string,
  buffer: Buffer,
): Promise<void> {
  // Stored name must match isAllowedEmployeeDocumentFileName (8–32 chars before ext).
  const stored = `lsn-${leaveId}.pdf`;
  if (!isAllowedEmployeeDocumentFileName(stored)) return;
  await writeEmployeeDocumentBuffer(employeeId, stored, buffer);
  const blobKey = `employees/${employeeId}/${stored}`;
  const displayName = `Leave Sanction Order (${fileNo}).pdf`;
  const ts = new Date().toISOString();
  const [existing] = await db
    .select()
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.employeeId, employeeId), eq(employeeDocuments.blobKey, blobKey)))
    .limit(1);
  if (existing) {
    await db
      .update(employeeDocuments)
      .set({
        fileName: displayName,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        status: "Approved",
        createdAt: ts,
      })
      .where(eq(employeeDocuments.id, existing.id));
    return;
  }
  await db.insert(employeeDocuments).values({
    id: nanoid(),
    employeeId,
    docType: "Leave Sanction Order",
    fileName: displayName,
    mimeType: "application/pdf",
    sizeBytes: buffer.length,
    blobKey,
    status: "Approved",
    uploadedBy: null,
    createdAt: ts,
  });
}

async function generateAndEmailSanctionOrder(leaveId: string, employeeId: string): Promise<void> {
  try {
    const { generateSanctionOrderPdf } = await import("./hr-leave-sanction-order-pdf");
    const { buffer, fileNo } = await generateSanctionOrderPdf(leaveId);
    const store = getUploadBlobStore();
    const blobKey = sanctionOrderBlobKey(leaveId);
    await store.put(blobKey, buffer, "application/pdf");
    await db.update(leaveRequests).set({ orderPdfUrl: `/api/hr/leaves/${leaveId}/sanction-order`, fileNo }).where(eq(leaveRequests.id, leaveId));
    const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveId)).limit(1);
    if (!lr) return;
    await linkSanctionOrderToEmployeeDocuments(employeeId, leaveId, fileNo, buffer).catch((e) =>
      console.error("Link sanction order to employee documents failed:", e),
    );
    await emailSanctionOrderPdf({
      employeeId,
      leaveRequestId: leaveId,
      fileNo,
      leaveType: lr.leaveType,
      fromDate: lr.fromDate,
      toDate: lr.toDate,
      pdfBuffer: buffer,
    });
  } catch (e) {
    console.error("Sanction order generate/email failed:", e);
  }
}

export function registerHrRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Employees -----
  // ----- Employee documents (US-M01-009) -----
  app.get("/api/hr/employees/:employeeId/documents", async (req, res) => {
    try {
      const employeeId = String(req.params.employeeId ?? "").trim();
      const list = await db
        .select()
        .from(employeeDocuments)
        .where(eq(employeeDocuments.employeeId, employeeId))
        .orderBy(desc(employeeDocuments.createdAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch employee documents");
    }
  });

  app.post("/api/hr/employees/:employeeId/documents", multerEmployeeDoc, async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Update") && !hasPermission(req.user, "M-01", "Create")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-01:Create or M-01:Update" });
      }
      const employeeId = String(req.params.employeeId ?? "").trim();
      const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");

      const file = req.file as Express.Multer.File | undefined;
      if (!file) return sendApiError(res, 400, "HR_EMP_DOC_REQUIRED", "Upload file required (field name: file)");

      const ext = extFromEmployeeDocumentMime(file.mimetype);
      if (!ext) {
        return sendApiError(res, 400, "HR_EMP_DOC_TYPE", "Only PDF/JPG/PNG/WebP documents are allowed.");
      }

      const docType = req.body?.docType != null && String(req.body.docType).trim() !== "" ? String(req.body.docType).trim() : "Document";
      const status = req.body?.status != null && String(req.body.status).trim() !== "" ? String(req.body.status).trim() : "Draft";

      const stored = `${nanoid(16)}${ext}`;
      await writeEmployeeDocumentBuffer(employeeId, stored, file.buffer);

      const id = nanoid();
      const ts = now();
      await db.insert(employeeDocuments).values({
        id,
        employeeId,
        docType,
        fileName: file.originalname ? String(file.originalname) : stored,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        blobKey: `employees/${employeeId}/${stored}`,
        status,
        uploadedBy: req.user.id,
        createdAt: ts,
      });
      const [row] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, id)).limit(1);
      writeAuditLog(req, { module: "HR", action: "UploadEmployeeDocument", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to upload employee document");
    }
  });

  app.get("/api/hr/employees/:employeeId/documents/:docId/download", async (req, res) => {
    try {
      const employeeId = String(req.params.employeeId ?? "").trim();
      const docId = String(req.params.docId ?? "").trim();
      const [doc] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, docId)).limit(1);
      if (!doc || doc.employeeId !== employeeId) {
        return sendApiError(res, 404, "HR_EMP_DOC_NOT_FOUND", "Document not found");
      }
      const stored = path.basename(String(doc.blobKey ?? "").replace(/\\/g, "/"));
      if (!isAllowedEmployeeDocumentFileName(stored)) {
        return sendApiError(res, 400, "HR_EMP_DOC_NAME_INVALID", "Invalid stored file name");
      }
      const buf = await readEmployeeDocumentBuffer(employeeId, stored);
      if (!buf?.length) {
        return sendApiError(
          res,
          404,
          "HR_EMP_DOC_MISSING",
          "Document missing on server. Restore the uploads folder that matches this database, or re-upload the file.",
        );
      }
      res.setHeader("Content-Type", contentTypeForEmployeeDocument(stored));
      res.setHeader("Cache-Control", "private, max-age=3600");
      const safeName = (doc.fileName ?? stored).replace(/[\r\n"]/g, "_");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to download document");
    }
  });

  app.delete("/api/hr/employees/:employeeId/documents/:docId", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-01:Update" });
      }
      const employeeId = String(req.params.employeeId ?? "").trim();
      const docId = String(req.params.docId ?? "").trim();
      const [doc] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, docId)).limit(1);
      if (!doc || doc.employeeId !== employeeId) {
        return sendApiError(res, 404, "HR_EMP_DOC_NOT_FOUND", "Document not found");
      }
      const stored = path.basename(String(doc.blobKey ?? "").replace(/\\/g, "/"));
      if (isAllowedEmployeeDocumentFileName(stored)) {
        await unlinkEmployeeDocumentIfExists(employeeId, stored);
      }
      await db.delete(employeeDocuments).where(eq(employeeDocuments.id, docId));
      writeAuditLog(req, { module: "HR", action: "DeleteEmployeeDocument", recordId: docId, beforeValue: doc }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete document");
    }
  });
  /** Active employees with retirement_date in the next `days` (default 90), for dashboard / HR widgets. */
  app.get("/api/hr/retirement-upcoming", async (req, res) => {
    try {
      const days = Math.min(366, Math.max(1, parseInt(String(req.query.days ?? "90"), 10) || 90));
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(`${today}T12:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + days);
      const until = end.toISOString().slice(0, 10);
      const rows = await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.status, "Active"),
            isNotNull(employees.retirementDate),
            gte(employees.retirementDate, today),
            lte(employees.retirementDate, until),
          ),
        );
      res.json({ asOf: today, until, days, count: rows.length });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch retirement upcoming count");
    }
  });

  // ----- Designation master (M-01): hierarchy / routing / validation -----
  app.get("/api/hr/designations", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-01:Read" });
      }
      const includeInactive =
        String(req.query.includeInactive ?? "") === "1" || String(req.query.includeInactive ?? "").toLowerCase() === "true";
      // Lower hierarchy_level = higher authority (GAPMC designation master). Legacy rows may use larger numbers (e.g. ADMIN).
      const rows = includeInactive
        ? await db.select().from(designationMaster).orderBy(asc(designationMaster.hierarchyLevel), asc(designationMaster.code))
        : await db
            .select()
            .from(designationMaster)
            .where(eq(designationMaster.status, "Active"))
            .orderBy(asc(designationMaster.hierarchyLevel), asc(designationMaster.code));
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch designations");
    }
  });

  app.post("/api/hr/designations", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-01:Update" });
      }
      const body = req.body as Record<string, unknown>;
      const code = String(body.code ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      const hl = body.hierarchyLevel != null ? Number(body.hierarchyLevel) : 0;
      const status = String(body.status ?? "Active").trim() === "Inactive" ? "Inactive" : "Active";
      const remarks = body.remarks != null && String(body.remarks).trim() !== "" ? String(body.remarks).trim() : null;
      if (!code || !name) {
        return sendApiError(res, 400, "HR_DESIGNATION_FIELDS", "code and name are required");
      }
      try {
        assertDesignationMasterCode(code);
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }
      if (!Number.isFinite(hl) || hl < 0 || hl > 9999) {
        return sendApiError(res, 400, "HR_DESIGNATION_LEVEL", "hierarchyLevel must be a number between 0 and 9999");
      }
      const id = nanoid();
      const ts = now();
      await db.insert(designationMaster).values({
        id,
        code,
        name,
        hierarchyLevel: Math.round(hl),
        status,
        remarks,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(designationMaster).where(eq(designationMaster.id, id)).limit(1);
      writeAuditLog(req, { module: "HR", action: "CreateDesignation", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e: unknown) {
      console.error(e);
      const pg = e as { code?: string };
      if (pg?.code === "23505") {
        return sendApiError(res, 400, "HR_DESIGNATION_CODE_DUPLICATE", "A designation with this code already exists.");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create designation");
    }
  });

  app.put("/api/hr/designations/:id", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-01:Update" });
      }
      const id = String(req.params.id ?? "").trim();
      const [beforeRow] = await db.select().from(designationMaster).where(eq(designationMaster.id, id)).limit(1);
      if (!beforeRow) return sendApiError(res, 404, "HR_DESIGNATION_NOT_FOUND", "Designation not found");
      const body = req.body as Record<string, unknown>;

      let nextStatus = String(beforeRow.status ?? "Active");
      if (body.status !== undefined) {
        const st = String(body.status ?? "").trim();
        if (st !== "Active" && st !== "Inactive") {
          return sendApiError(res, 400, "HR_DESIGNATION_STATUS", "status must be Active or Inactive");
        }
        nextStatus = st;
      }
      if (nextStatus === "Inactive" && String(beforeRow.status ?? "") === "Active") {
        const n = await countEmployeesUsingDesignation(id);
        if (n > 0) {
          return sendApiError(res, 400, "HR_DESIGNATION_IN_USE", `Cannot deactivate: ${n} employee(s) still reference this designation.`, {
            employeeCount: n,
          });
        }
      }

      const setValues: {
        updatedAt: string;
        code?: string;
        name?: string;
        hierarchyLevel?: number;
        status?: string;
        remarks?: string | null;
      } = { updatedAt: now() };
      if (body.code !== undefined) {
        const code = String(body.code ?? "").trim().toUpperCase();
        if (!code) return sendApiError(res, 400, "HR_DESIGNATION_CODE", "code cannot be empty");
        try {
          assertDesignationMasterCode(code);
        } catch (e) {
          if (sendHrEmployeeRuleError(res, e)) return;
          throw e;
        }
        setValues.code = code;
      }
      if (body.name !== undefined) {
        const name = String(body.name ?? "").trim();
        if (!name) return sendApiError(res, 400, "HR_DESIGNATION_NAME", "name cannot be empty");
        setValues.name = name;
      }
      if (body.hierarchyLevel !== undefined) {
        const hl = Number(body.hierarchyLevel);
        if (!Number.isFinite(hl) || hl < 0 || hl > 9999) {
          return sendApiError(res, 400, "HR_DESIGNATION_LEVEL", "hierarchyLevel must be between 0 and 9999");
        }
        setValues.hierarchyLevel = Math.round(hl);
      }
      if (body.status !== undefined) {
        setValues.status = nextStatus;
      }
      if (body.remarks !== undefined) {
        setValues.remarks = body.remarks === null ? null : String(body.remarks).trim() || null;
      }

      await db.update(designationMaster).set(setValues).where(eq(designationMaster.id, id));
      const [afterRow] = await db.select().from(designationMaster).where(eq(designationMaster.id, id)).limit(1);
      writeAuditLog(req, {
        module: "HR",
        action: "UpdateDesignation",
        recordId: id,
        beforeValue: beforeRow,
        afterValue: afterRow,
      }).catch((e) => console.error("Audit log failed:", e));
      if (setValues.name != null && String(setValues.name) !== String(beforeRow.name)) {
        await db.update(employees).set({ designation: String(setValues.name), updatedAt: now() }).where(eq(employees.designationId, id));
      }
      res.json(afterRow);
    } catch (e: unknown) {
      console.error(e);
      const pg = e as { code?: string };
      if (pg?.code === "23505") {
        return sendApiError(res, 400, "HR_DESIGNATION_CODE_DUPLICATE", "A designation with this code already exists.");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update designation");
    }
  });

  app.get("/api/hr/employees", async (req, res) => {
    try {
      if (!req.user) {
        return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      }
      const includeApp = req.query.includeApp === "1";
      if (includeApp && !hasPermission(req.user, "M-10", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-10 Read required for includeApp=1", {
          required: "M-10:Read",
        });
      }
      const yardId = req.query.yardId as string | undefined;
      const id = String(req.query.id ?? "").trim();
      const q = String(req.query.q ?? "").trim();
      const limitRaw = parseInt(String(req.query.limit ?? "0"), 10);
      const conditions = [];
      if (yardId) conditions.push(eq(employees.yardId, yardId));
      if (id) conditions.push(eq(employees.id, id));

      const pattern = reportSearchPattern(q);
      if (pattern && !id) {
        conditions.push(
          or(
            ilike(employees.empId, pattern),
            ilike(employees.firstName, pattern),
            ilike(employees.middleName, pattern),
            ilike(employees.surname, pattern),
            ilike(employees.serviceBookNo, pattern),
            ilike(employees.mobile, pattern),
            ilike(employees.id, pattern),
            sql`concat(${employees.firstName}, ' ', coalesce(${employees.middleName}, ''), ' ', ${employees.surname}) ilike ${pattern}`,
          )!,
        );
      }

      const whereClause = conditions.length ? and(...conditions) : undefined;
      const orderBy = pattern
        ? [asc(employees.empId), asc(employees.surname), asc(employees.firstName)]
        : [desc(employees.createdAt)];
      const base = whereClause
        ? db.select().from(employees).where(whereClause).orderBy(...orderBy)
        : db.select().from(employees).orderBy(...orderBy);

      const limit = limitRaw > 0 ? Math.min(Math.max(limitRaw, 1), 100) : undefined;
      let list = limit ? await base.limit(limit) : await base;

      if (id && !list.some((row) => row.id === id)) {
        const [extra] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
        if (extra) list = [extra, ...list];
      }

      if (!includeApp) {
        res.json(list);
        return;
      }
      const enriched = await enrichEmployeesWithAppLogin(list);
      res.json(enriched);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch employees");
    }
  });

  app.get("/api/hr/employees/:id/login-profile", async (req, res) => {
    try {
      if (!req.user) {
        return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      }
      if (!req.user.roles.some((r) => r.tier === "ADMIN") && !hasPermission(req.user, "M-10", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-10:Read" });
      }
      const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, req.params.id)).limit(1);
      if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      const profile = await buildLoginProfileForEmployee(req.params.id);
      res.json(profile);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch login profile");
    }
  });

  app.post("/api/hr/employees/:id/login", async (req, res) => {
    if (!req.user) {
      return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    }
    if (!req.user.roles.some((r) => r.tier === "ADMIN") && !hasPermission(req.user, "M-10", "Create")) {
      return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-10:Create" });
    }
    await handleCreateEmployeeLogin(req, res, req.params.id);
  });

  app.put("/api/hr/employees/:id/login", async (req, res) => {
    if (!req.user) {
      return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    }
    if (!req.user.roles.some((r) => r.tier === "ADMIN") && !hasPermission(req.user, "M-10", "Update")) {
      return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-10:Update" });
    }
    await handleUpdateEmployeeLogin(req, res, req.params.id);
  });

  app.get("/api/hr/employees/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
      if (!row) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch employee");
    }
  });

  app.post("/api/hr/employees", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      const statusCanon = canonicalizeEmployeeStatus(String(body.status ?? "Draft"));
      if (statusCanon !== "Draft" && statusCanon !== "Submitted") {
        return sendApiError(
          res,
          400,
          "HR_EMP_CREATE_STATUS",
          "New employees must be created as Draft or Submitted. Active status and EMP-ID are set only after DA approval.",
        );
      }
      if (body.empId !== undefined && body.empId !== null && String(body.empId).trim() !== "") {
        return sendApiError(res, 400, "HR_EMP_EMPID_CREATE", "Employee ID cannot be set at registration; it is assigned at DA approval.");
      }

      const aadhaarHmacSecret = await resolveAadhaarHmacSecret();

      let panNorm: string | null;
      let aadhaarMasked: string | null;
      let aadhaarFp: string | null;
      let personalEmailNorm: string | null;
      let mobileNorm: string | null;
      let workEmailNorm: string | null;
      try {
        personalEmailNorm =
          body.personalEmail != null && String(body.personalEmail).trim() !== ""
            ? String(body.personalEmail).trim().toLowerCase()
            : null;
        assertPersonalEmailFormat(personalEmailNorm);
        workEmailNorm =
          body.workEmail != null && String(body.workEmail).trim() !== ""
            ? String(body.workEmail).trim().toLowerCase()
            : null;
        assertWorkEmailFormat(workEmailNorm);
        mobileNorm = normalizeMobile10(body.mobile ?? null);
        panNorm = normalizePan(body.pan);
        const rawAadhaar = readAadhaarRawFromRequestBody(body as Record<string, unknown>);
        if (rawAadhaar) {
          if (!aadhaarHmacSecret) {
            return sendApiError(
              res,
              500,
              "HR_EMP_AADHAAR_SECRET",
              "Aadhaar HMAC secret is not configured. Set it under Admin → Config & PDF logo (Aadhaar HMAC secret), or set AADHAAR_HMAC_SECRET for legacy bootstrap.",
            );
          }
          aadhaarMasked = maskAadhaar(rawAadhaar);
          aadhaarFp = aadhaarFingerprintHmac(rawAadhaar, aadhaarHmacSecret);
        } else {
          aadhaarMasked = normalizeAadhaarMasked(body.aadhaarToken ?? body.aadhaar ?? null);
          aadhaarFp = null;
        }
        assertJoiningAndDob(String(body.joiningDate ?? ""), body.dob != null ? String(body.dob) : null);
        await assertEmployeeUniqueness({
          pan: panNorm,
          aadhaarMasked,
          aadhaarFingerprint: aadhaarFp,
          personalEmail: personalEmailNorm,
          excludeEmployeeId: null,
        });
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }
      let srs411: ReturnType<typeof parseEmployeeMasterSrs411Fields>;
      try {
        const yardIdForCharges = String(body.yardId ?? "");
        srs411 = parseEmployeeMasterSrs411Fields({
          locationPosted: resolveAdditionalChargeLocationPosted(body as Record<string, unknown>, yardIdForCharges),
          payLevel: body.payLevel as string | number | null | undefined,
          bankAccountNumber: body.bankAccountNumber as string | null | undefined,
          ifscCode: body.ifscCode as string | null | undefined,
          category: body.category as string | null | undefined,
          fatherOrSpouseName: body.fatherOrSpouseName as string | null | undefined,
        });
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }

      const roId =
        body.reportingOfficerEmployeeId != null && String(body.reportingOfficerEmployeeId).trim() !== ""
          ? String(body.reportingOfficerEmployeeId).trim()
          : null;
      if (roId === id) {
        return sendApiError(res, 400, "HR_EMP_REPORTING_SELF", "Reporting officer cannot be the same as the employee being created.");
      }
      if (roId) {
        const [roEmp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, roId)).limit(1);
        if (!roEmp) {
          return sendApiError(res, 400, "HR_EMP_REPORTING_NOT_FOUND", "Reporting officer employee id was not found.");
        }
      }

      let resolvedDesig: { designation: string; designationId: string | null };
      try {
        resolvedDesig = await resolveDesignationForEmployeeUpsert(body as Record<string, unknown>);
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }

      const payload = {
        id,
        empId: null as string | null,
        firstName: String(body.firstName ?? ""),
        surname: String(body.surname ?? ""),
        designation: resolvedDesig.designation,
        designationId: resolvedDesig.designationId,
        yardId: String(body.yardId ?? ""),
        employeeType: String(body.employeeType ?? "Regular"),
        joiningDate: String(body.joiningDate ?? ""),
        status: statusCanon,
        middleName: body.middleName ? String(body.middleName) : null,
        photoUrl: body.photoUrl ? String(body.photoUrl) : null,
        aadhaarToken: aadhaarMasked,
        aadhaarFingerprint: aadhaarFp,
        pan: panNorm,
        dob: body.dob ? String(body.dob) : null,
        retirementDate: body.retirementDate ? String(body.retirementDate) : null,
        mobile: mobileNorm,
        workEmail: workEmailNorm,
        personalEmail: personalEmailNorm,
        gender: body.gender != null && String(body.gender).trim() !== "" ? String(body.gender).trim() : null,
        maritalStatus:
          body.maritalStatus != null && String(body.maritalStatus).trim() !== "" ? String(body.maritalStatus).trim() : null,
        bloodGroup: body.bloodGroup != null && String(body.bloodGroup).trim() !== "" ? String(body.bloodGroup).trim() : null,
        permanentAddress:
          body.permanentAddress != null && String(body.permanentAddress).trim() !== ""
            ? String(body.permanentAddress).trim()
            : null,
        correspondenceAddress:
          body.correspondenceAddress != null && String(body.correspondenceAddress).trim() !== ""
            ? String(body.correspondenceAddress).trim()
            : null,
        emergencyContactName:
          body.emergencyContactName != null && String(body.emergencyContactName).trim() !== ""
            ? String(body.emergencyContactName).trim()
            : null,
        emergencyContactMobile: normalizeMobile10(body.emergencyContactMobile ?? null),
        reportingOfficerEmployeeId: roId,
        serviceBookNo: body.serviceBookNo != null ? String(body.serviceBookNo).trim() || null : null,
        section: body.section != null ? String(body.section).trim() || null : null,
        locationPosted: srs411.locationPosted,
        payLevel: srs411.payLevel,
        basicPayInr: (() => {
          if (body.basicPayInr === undefined || body.basicPayInr === null || String(body.basicPayInr).trim() === "") {
            return null;
          }
          const n = Number(body.basicPayInr);
          return Number.isFinite(n) && n >= 0 ? n : null;
        })(),
        bankAccountNumber: srs411.bankAccountNumber,
        ifscCode: srs411.ifscCode,
        category: srs411.category,
        fatherOrSpouseName: srs411.fatherOrSpouseName,
        userId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      if (!payload.yardId || !payload.joiningDate) {
        return sendApiError(res, 400, "HR_EMPLOYEE_FIELDS_REQUIRED", "yardId and joiningDate required");
      }
      await db.insert(employees).values(payload);
      const [row] = await db.select().from(employees).where(eq(employees.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      if (row?.status === "Submitted") {
        sendNotificationStub({
          kind: "employee_registration",
          employeeId: row.id,
          status: "Submitted",
          name: `${row.firstName} ${row.surname}`.trim(),
          yardId: row.yardId ?? null,
          empId: row.empId ?? null,
        });
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create employee");
    }
  });

  /** US-M01-001: DV recommends Submitted → Recommended (before DA approval). */
  app.post("/api/hr/employees/:id/recommend-registration", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const id = req.params.id;
      const [emp] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      if (canonicalizeEmployeeStatus(emp.status) !== "Submitted") {
        return sendApiError(res, 400, "HR_EMP_RECOMMEND_STATE", "Only Submitted employees can be recommended to DA.");
      }
      try {
        assertJoiningAndDob(emp.joiningDate, emp.dob);
        const panNorm = normalizePan(emp.pan);
        const aadhaarMasked = normalizeAadhaarMasked(emp.aadhaarToken);
        const pe = emp.personalEmail != null && String(emp.personalEmail).trim() !== "" ? String(emp.personalEmail).trim().toLowerCase() : null;
        assertPersonalEmailFormat(pe);
        await assertEmployeeUniqueness({
          pan: panNorm,
          aadhaarMasked,
          aadhaarFingerprint: emp.aadhaarFingerprint ?? null,
          personalEmail: pe,
          excludeEmployeeId: id,
        });
        parseEmployeeMasterSrs411Fields({
          locationPosted: emp.locationPosted,
          payLevel: emp.payLevel,
          bankAccountNumber: emp.bankAccountNumber,
          ifscCode: emp.ifscCode,
          category: emp.category,
          fatherOrSpouseName: emp.fatherOrSpouseName,
        });
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }
      await db.update(employees).set({ status: "Recommended", updatedAt: now() }).where(eq(employees.id, id));
      const [row] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (row) {
        writeAuditLog(req, { module: "HR", action: "RecommendRegistration", recordId: id, beforeValue: emp, afterValue: row }).catch((e) =>
          console.error("Audit log failed:", e),
        );
        sendNotificationStub({
          kind: "employee_registration",
          employeeId: row.id,
          status: "Recommended",
          name: `${row.firstName} ${row.surname}`.trim(),
          yardId: row.yardId ?? null,
          empId: row.empId ?? null,
        });
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to recommend registration");
    }
  });

  /** BR-EMP-06: assign EMP-NNN and set Active (DA or M-01:Approve). */
  app.post("/api/hr/employees/:id/approve-registration", async (req, res) => {
    try {
      if (!req.user) {
        return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      }
      const id = req.params.id;
      const [emp] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      if (hasOfficialEmpId(emp.empId)) {
        return sendApiError(res, 400, "HR_EMP_ALREADY_APPROVED", "This employee already has an official EMP-ID.");
      }
      const approvable =
        emp.status === "Recommended" || (emp.status === "Active" && !hasOfficialEmpId(emp.empId));
      if (!approvable) {
        return sendApiError(
          res,
          400,
          "HR_EMP_APPROVE_STATE",
          "Only Recommended employees (after DV recommend), or Active records without an official EMP-ID can be approved.",
        );
      }
      try {
        assertJoiningAndDob(emp.joiningDate, emp.dob);
        const panNorm = normalizePan(emp.pan);
        const aadhaarMasked = normalizeAadhaarMasked(emp.aadhaarToken);
        const pe = emp.personalEmail != null && String(emp.personalEmail).trim() !== "" ? String(emp.personalEmail).trim().toLowerCase() : null;
        assertPersonalEmailFormat(pe);
        await assertEmployeeUniqueness({
          pan: panNorm,
          aadhaarMasked,
          aadhaarFingerprint: emp.aadhaarFingerprint ?? null,
          personalEmail: pe,
          excludeEmployeeId: id,
        });
        parseEmployeeMasterSrs411Fields({
          locationPosted: emp.locationPosted,
          payLevel: emp.payLevel,
          bankAccountNumber: emp.bankAccountNumber,
          ifscCode: emp.ifscCode,
          category: emp.category,
          fatherOrSpouseName: emp.fatherOrSpouseName,
        });
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }
      let newEmpId: string;
      let newServiceBookNo: string | null = emp.serviceBookNo?.trim() || null;
      try {
        newEmpId = await allocateNextEmpId();
        if (!newServiceBookNo) newServiceBookNo = await allocateNextServiceBookNo();
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }
      await db
        .update(employees)
        .set({
          empId: newEmpId,
          serviceBookNo: newServiceBookNo,
          status: "Active",
          statusEffectiveDate: localCalendarYmdUtc(),
          updatedAt: now(),
        })
        .where(eq(employees.id, id));
      const [row] = await db.select().from(employees).where(eq(employees.id, id));
      if (row) {
        writeAuditLog(req, { module: "HR", action: "Approve", recordId: id, beforeValue: emp, afterValue: row }).catch((e) =>
          console.error("Audit log failed:", e),
        );
        sendNotificationStub({
          kind: "employee_registration",
          employeeId: row.id,
          status: "Approved",
          name: `${row.firstName} ${row.surname}`.trim(),
          yardId: row.yardId ?? null,
          empId: row.empId ?? null,
        });
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to approve employee registration");
    }
  });

  app.put("/api/hr/employees/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [beforeEmp] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!beforeEmp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      const body = req.body;
      if (body.empId !== undefined) {
        return sendApiError(res, 400, "HR_EMP_EMPID_READONLY", "Employee ID is assigned only through DA approval (Approve registration).");
      }

      const beforeCanon = canonicalizeEmployeeStatus(beforeEmp.status);
      if (isTerminalEmployeeLifecycleStatus(beforeCanon)) {
        return sendApiError(
          res,
          403,
          "HR_EMP_TERMINAL_READONLY",
          "This employee is in a terminal separation status (retired, resigned, deceased, terminated, or VRS). The record is read-only.",
        );
      }

      if (body.status !== undefined) {
        const nextS = canonicalizeEmployeeStatus(String(body.status));
        if (!isKnownEmployeeLifecycleStatus(nextS)) {
          return sendApiError(res, 400, "HR_EMP_STATUS_UNKNOWN", `Unknown employee status: ${String(body.status)}`);
        }
        if (!isAllowedEmployeeLifecycleTransition(beforeEmp.status, nextS)) {
          return sendApiError(
            res,
            400,
            "HR_EMP_STATUS_TRANSITION",
            `Cannot change employee status from ${employeeStatusDisplayLabel(beforeEmp.status)} to ${employeeStatusDisplayLabel(nextS)}.`,
          );
        }
        (body as Record<string, unknown>).status = nextS;
      }

      const nextStatusCanon =
        body.status !== undefined ? canonicalizeEmployeeStatus(String(body.status)) : beforeCanon;
      const statusTransitionRequested = body.status !== undefined && nextStatusCanon !== beforeCanon;

      const updates: Record<string, unknown> = { updatedAt: now() };
      const allowed = [
        "firstName",
        "middleName",
        "surname",
        "photoUrl",
        "yardId",
        "employeeType",
        "aadhaarToken",
        "pan",
        "dob",
        "joiningDate",
        "retirementDate",
        "mobile",
        "workEmail",
        "personalEmail",
        "status",
        "gender",
        "maritalStatus",
        "bloodGroup",
        "permanentAddress",
        "correspondenceAddress",
        "emergencyContactName",
        "emergencyContactMobile",
        "reportingOfficerEmployeeId",
        "serviceBookNo",
        "section",
        "locationPosted",
        "payLevel",
        "basicPayInr",
        "bankAccountNumber",
        "ifscCode",
        "category",
        "fatherOrSpouseName",
      ];
      if (body.designationId !== undefined) {
        try {
          const rd = await resolveDesignationForEmployeeUpsert({
            designationId: body.designationId,
            designation: body.designation !== undefined ? body.designation : beforeEmp.designation,
          });
          updates.designation = rd.designation;
          updates.designationId = rd.designationId;
        } catch (e) {
          if (sendHrEmployeeRuleError(res, e)) return;
          throw e;
        }
      } else if (body.designation !== undefined) {
        updates.designation = String(body.designation).trim() || beforeEmp.designation;
      }
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        if (key === "locationPosted") continue; // handled via additionalChargeYardIds / normalize below
        if (key === "payLevel") {
          if (body.payLevel === null || (typeof body.payLevel === "string" && String(body.payLevel).trim() === "")) {
            updates.payLevel = null;
          } else {
            updates.payLevel = typeof body.payLevel === "number" ? body.payLevel : String(body.payLevel).trim();
          }
          continue;
        }
        if (key === "basicPayInr") {
          if (body.basicPayInr === null || (typeof body.basicPayInr === "string" && String(body.basicPayInr).trim() === "")) {
            updates.basicPayInr = null;
          } else {
            const n = Number(body.basicPayInr);
            updates.basicPayInr = Number.isFinite(n) && n >= 0 ? n : null;
          }
          continue;
        }
        if (key === "personalEmail") {
          updates.personalEmail =
            body.personalEmail === null || String(body.personalEmail).trim() === ""
              ? null
              : String(body.personalEmail).trim().toLowerCase();
          continue;
        }
        if (key === "emergencyContactMobile") {
          updates.emergencyContactMobile =
            body.emergencyContactMobile === null || String(body.emergencyContactMobile).trim() === ""
              ? null
              : normalizeMobile10(body.emergencyContactMobile);
          continue;
        }
        if (key === "reportingOfficerEmployeeId") {
          updates.reportingOfficerEmployeeId =
            body.reportingOfficerEmployeeId === null || String(body.reportingOfficerEmployeeId).trim() === ""
              ? null
              : String(body.reportingOfficerEmployeeId).trim();
          continue;
        }
        updates[key] = body[key] === null ? null : String(body[key]);
      }

      {
        const effectiveYardId = String(
          updates.yardId !== undefined ? updates.yardId : beforeEmp.yardId ?? "",
        ).trim();
        const chargeUpdate = maybeResolveAdditionalChargeLocationPosted(
          body as Record<string, unknown>,
          effectiveYardId,
        );
        if (chargeUpdate !== undefined) {
          updates.locationPosted = chargeUpdate;
        } else if (updates.yardId !== undefined) {
          // Primary location changed: drop it from any existing additional-charge list.
          updates.locationPosted = serializeAdditionalChargeYardIds(
            parseAdditionalChargeYardIds(beforeEmp.locationPosted, effectiveYardId),
            effectiveYardId,
          );
        }
      }

      const rawAadhaarForSave = readAadhaarRawFromRequestBody(body as Record<string, unknown>);
      if (rawAadhaarForSave) {
        delete updates.aadhaarToken;
      }
      if (
        updates.reportingOfficerEmployeeId !== undefined &&
        updates.reportingOfficerEmployeeId &&
        String(updates.reportingOfficerEmployeeId) === id
      ) {
        return sendApiError(res, 400, "HR_EMP_REPORTING_SELF", "Reporting officer cannot be the same employee.");
      }
      const roUpd =
        updates.reportingOfficerEmployeeId !== undefined
          ? (updates.reportingOfficerEmployeeId as string | null)
          : undefined;
      if (roUpd) {
        const [roEmp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, roUpd)).limit(1);
        if (!roEmp) {
          return sendApiError(res, 400, "HR_EMP_REPORTING_NOT_FOUND", "Reporting officer employee id was not found.");
        }
      }

      if (statusTransitionRequested) {
        if (employeeStatusRequiresEffectiveDate(nextStatusCanon)) {
          const resolved = resolveStatusEffectiveDate({
            nextStatus: nextStatusCanon,
            inputDate:
              body.statusEffectiveDate !== undefined && body.statusEffectiveDate !== null
                ? String(body.statusEffectiveDate)
                : null,
            retirementDate:
              updates.retirementDate !== undefined
                ? (updates.retirementDate as string | null)
                : beforeEmp.retirementDate,
            todayYmd: localCalendarYmdUtc(),
          });
          if (!resolved.ok) {
            return sendApiError(res, 400, resolved.code, resolved.message);
          }
          updates.statusEffectiveDate = resolved.date;
        } else {
          updates.statusEffectiveDate = null;
        }
      }

      const merged: typeof beforeEmp = { ...beforeEmp };
      for (const k of Object.keys(updates)) {
        if (k === "updatedAt") continue;
        (merged as Record<string, unknown>)[k] = updates[k];
      }
      let panNorm: string | null;
      let aadhaarMasked: string | null;
      let aadhaarFingerprintOut: string | null;
      let personalEmailNorm: string | null;
      let workEmailNorm: string | null;
      let mobileNorm: string | null;
      let emergencyMobileNorm: string | null;
      let srs411: ReturnType<typeof parseEmployeeMasterSrs411Fields>;
      try {
        personalEmailNorm =
          merged.personalEmail != null && String(merged.personalEmail).trim() !== ""
            ? String(merged.personalEmail).trim().toLowerCase()
            : null;
        assertPersonalEmailFormat(personalEmailNorm);
        workEmailNorm =
          merged.workEmail != null && String(merged.workEmail).trim() !== ""
            ? String(merged.workEmail).trim().toLowerCase()
            : null;
        assertWorkEmailFormat(workEmailNorm);
        mobileNorm = normalizeMobile10(merged.mobile);
        emergencyMobileNorm = normalizeMobile10((merged as { emergencyContactMobile?: string | null }).emergencyContactMobile);
        panNorm = normalizePan(merged.pan);
        if (rawAadhaarForSave) {
          const aadhaarHmacSecret = await resolveAadhaarHmacSecret();
          if (!aadhaarHmacSecret) {
            return sendApiError(
              res,
              500,
              "HR_EMP_AADHAAR_SECRET",
              "Aadhaar HMAC secret is not configured. Set it under Admin → Config & PDF logo (Aadhaar HMAC secret), or set AADHAAR_HMAC_SECRET for legacy bootstrap.",
            );
          }
          aadhaarMasked = maskAadhaar(rawAadhaarForSave);
          aadhaarFingerprintOut = aadhaarFingerprintHmac(rawAadhaarForSave, aadhaarHmacSecret);
        } else {
          aadhaarMasked = normalizeAadhaarMasked(merged.aadhaarToken);
          aadhaarFingerprintOut = beforeEmp.aadhaarFingerprint ?? null;
        }
        assertJoiningAndDob(merged.joiningDate, merged.dob);
        await assertEmployeeUniqueness({
          pan: panNorm,
          aadhaarMasked,
          aadhaarFingerprint: aadhaarFingerprintOut ?? undefined,
          personalEmail: personalEmailNorm,
          excludeEmployeeId: id,
        });
        srs411 = parseEmployeeMasterSrs411Fields({
          locationPosted: (merged as { locationPosted?: string | null }).locationPosted,
          payLevel: (merged as { payLevel?: number | string | null }).payLevel,
          bankAccountNumber: (merged as { bankAccountNumber?: string | null }).bankAccountNumber,
          ifscCode: (merged as { ifscCode?: string | null }).ifscCode,
          category: (merged as { category?: string | null }).category,
          fatherOrSpouseName: (merged as { fatherOrSpouseName?: string | null }).fatherOrSpouseName,
        });
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }

      const setPayload = {
        ...updates,
        pan: panNorm,
        aadhaarToken: aadhaarMasked,
        ...(rawAadhaarForSave ? { aadhaarFingerprint: aadhaarFingerprintOut } : {}),
        personalEmail: personalEmailNorm,
        workEmail: workEmailNorm,
        mobile: mobileNorm,
        emergencyContactMobile: emergencyMobileNorm,
        locationPosted: srs411.locationPosted,
        payLevel: srs411.payLevel,
        bankAccountNumber: srs411.bankAccountNumber,
        ifscCode: srs411.ifscCode,
        category: srs411.category,
        fatherOrSpouseName: srs411.fatherOrSpouseName,
      } as Record<string, string | number | null | undefined>;

      const loginDisableStatuses = employeeStatusesThatDisableAppLogin();
      await db.transaction(async (tx) => {
        await tx.update(employees).set(setPayload).where(eq(employees.id, id));
        const [after] = await tx
          .select({
            status: employees.status,
            userId: employees.userId,
            yardId: employees.yardId,
            locationPosted: employees.locationPosted,
          })
          .from(employees)
          .where(eq(employees.id, id))
          .limit(1);
        if (after?.status && loginDisableStatuses.includes(after.status)) {
          const t = now();
          if (after.userId) {
            await tx
              .update(users)
              .set({ isActive: false, disabledAt: t, updatedAt: t })
              .where(or(eq(users.employeeId, id), eq(users.id, after.userId)));
          } else {
            await tx.update(users).set({ isActive: false, disabledAt: t, updatedAt: t }).where(eq(users.employeeId, id));
          }
        }
        // Login & roles Locations (user_yards) follow employee primary + additional.
        const loginUid = after?.userId ?? (await resolveUserIdForEmployee(id));
        if (loginUid && after) {
          await syncUserYardsFromEmployeeLocations(tx, loginUid, after.yardId, after.locationPosted);
        }
      });

      const [row] = await db.select().from(employees).where(eq(employees.id, id));
      if (!row) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: beforeEmp, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update employee");
    }
  });

  // ----- Employee contracts -----
  app.get("/api/hr/employees/:employeeId/contracts", async (req, res) => {
    try {
      const list = await db.select().from(employeeContracts).where(eq(employeeContracts.employeeId, req.params.employeeId));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch contracts");
    }
  });

  app.post("/api/hr/employees/:employeeId/contracts", async (req, res) => {
    try {
      const employeeId = req.params.employeeId;
      const body = req.body;
      const id = nanoid();
      await db.insert(employeeContracts).values({
        id,
        employeeId,
        contractType: String(body.contractType ?? ""),
        startDate: String(body.startDate ?? ""),
        payScale: body.payScale ? String(body.payScale) : null,
        endDate: body.endDate ? String(body.endDate) : null,
      });
      const [row] = await db.select().from(employeeContracts).where(eq(employeeContracts.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create contract");
    }
  });

  // ----- Recruitment -----
  app.get("/api/hr/recruitment", async (_req, res) => {
    try {
      const list = await db.select().from(recruitment).orderBy(desc(recruitment.appliedDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch recruitment");
    }
  });

  app.post("/api/hr/recruitment", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(recruitment).values({
        id,
        position: String(body.position ?? ""),
        applicantName: String(body.applicantName ?? ""),
        appliedDate: String(body.appliedDate ?? ""),
        status: String(body.status ?? "Applied"),
        qualification: body.qualification ? String(body.qualification) : null,
        interviewOutcomes: body.interviewOutcomes ?? null,
        decision: body.decision ? String(body.decision) : null,
      });
      const [row] = await db.select().from(recruitment).where(eq(recruitment.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create recruitment entry");
    }
  });

  app.put("/api/hr/recruitment/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(recruitment).where(eq(recruitment.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "HR_RECRUITMENT_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["position", "applicantName", "qualification", "appliedDate", "status", "interviewOutcomes", "decision"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k];
      });
      await db.update(recruitment).set(updates as Record<string, string | null>).where(eq(recruitment.id, id));
      const [row] = await db.select().from(recruitment).where(eq(recruitment.id, id));
      if (!row) return sendApiError(res, 404, "HR_RECRUITMENT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update recruitment");
    }
  });

  // ----- Attendances -----
  app.get("/api/hr/attendances", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const date = req.query.date as string | undefined;
      const list = employeeId
        ? await db.select().from(attendances).where(eq(attendances.employeeId, employeeId)).orderBy(desc(attendances.date))
        : await db.select().from(attendances).orderBy(desc(attendances.date));
      const filtered = date ? list.filter((r) => r.date === date) : list;
      res.json(filtered);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch attendances");
    }
  });

  app.post("/api/hr/attendances", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(attendances).values({
        id,
        employeeId: String(body.employeeId ?? ""),
        date: String(body.date ?? ""),
        action: String(body.action ?? "CheckIn"),
        reason: body.reason ? String(body.reason) : null,
      });
      const [row] = await db.select().from(attendances).where(eq(attendances.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create attendance");
    }
  });

  // ----- Timesheets -----
  app.get("/api/hr/timesheets", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const list = employeeId
        ? await db.select().from(timesheets).where(eq(timesheets.employeeId, employeeId)).orderBy(desc(timesheets.periodEnd))
        : await db.select().from(timesheets).orderBy(desc(timesheets.periodEnd));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch timesheets");
    }
  });

  app.post("/api/hr/timesheets", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(timesheets).values({
        id,
        employeeId: String(body.employeeId ?? ""),
        periodStart: String(body.periodStart ?? ""),
        periodEnd: String(body.periodEnd ?? ""),
        totalAttendance: body.totalAttendance != null ? Number(body.totalAttendance) : null,
        totalTimesheet: body.totalTimesheet != null ? Number(body.totalTimesheet) : null,
        status: String(body.status ?? "Draft"),
        validatedBy: body.validatedBy ? String(body.validatedBy) : null,
      });
      const [row] = await db.select().from(timesheets).where(eq(timesheets.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create timesheet");
    }
  });

  app.put("/api/hr/timesheets/:id", async (req, res) => {
    try {
      const timesheetId = req.params.id;
      const body = req.body;
      const [existing] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).limit(1);
      if (!existing) return sendApiError(res, 404, "HR_TIMESHEET_NOT_FOUND", "Timesheet not found");
      const updates: Record<string, unknown> = { };
      if (body.status !== undefined) {
        const newStatus = String(body.status);
        if (existing.status === "Draft" && newStatus === "Validated") {
          updates.status = newStatus;
          updates.validatedBy = (req as { user?: { id?: string; name?: string } }).user?.id ?? (req as { user?: { name?: string } }).user?.name ?? body.validatedBy ?? null;
        } else if (newStatus === "Draft" || newStatus === "Validated") {
          updates.status = newStatus;
          if (newStatus === "Validated" && existing.status === "Draft")
            updates.validatedBy = (req as { user?: { id?: string; name?: string } }).user?.id ?? (req as { user?: { name?: string } }).user?.name ?? body.validatedBy ?? null;
        }
      }
      if (body.totalAttendance !== undefined) updates.totalAttendance = body.totalAttendance == null ? null : Number(body.totalAttendance);
      if (body.totalTimesheet !== undefined) updates.totalTimesheet = body.totalTimesheet == null ? null : Number(body.totalTimesheet);
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).limit(1);
        return res.json(row!);
      }
      await db.update(timesheets).set(updates as Record<string, string | number | null>).where(eq(timesheets.id, timesheetId));
      const [row] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).limit(1);
      if (row) writeAuditLog(req, { module: "HR", action: "Update", recordId: timesheetId, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row!);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update timesheet");
    }
  });

  // ----- Leave balances (opening / running per leave type) -----
  app.get("/api/hr/leave-balances", async (req, res) => {
    try {
      if (!requireLeaveRead(req, res)) return;
      // Heal rows imported with EMP-NNN instead of employees.id (Select needs PK),
      // and merge legacy aliases such as C.L → CL / E.L → EL.
      await healLeaveBalanceEmployeeIds();
      await healLeaveBalanceTypeAliases();
      const rows = await db.select().from(employeeLeaveBalances).orderBy(desc(employeeLeaveBalances.updatedAt));
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch leave balances");
    }
  });

  /** Admin-only: Employee Leave Balance Report (Excel) — all Active employees. */
  app.get("/api/hr/leave-balances/export.xlsx", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const isAdmin = Boolean(req.user.roles?.some((r) => String(r.tier) === "ADMIN"));
      if (!isAdmin) {
        return sendApiError(res, 403, "AUTH_ADMIN_REQUIRED", "Export to Excel is available only to Admin users.");
      }
      await healLeaveBalanceEmployeeIds();
      await healLeaveBalanceTypeAliases();
      const asOn = req.query.asOn != null ? String(req.query.asOn).trim().slice(0, 10) : "";
      const { buildLeaveBalanceExportAoa } = await import("./hr-leave-balance-export");
      const { aoa, asOnDisplay } = await buildLeaveBalanceExportAoa(asOn || undefined);
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Widen Emp ID - Name column a bit for readability.
      ws["!cols"] = [
        { wch: 8 },
        { wch: 36 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 12 },
        { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Leave Balances");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const stamp = asOnDisplay.replace(/\//g, "-");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="Employee_Leave_Balance_Report_${stamp}.xlsx"`,
      );
      writeAuditLog(req, {
        module: "HR",
        action: "Export",
        recordId: "leave_balances_excel",
        afterValue: { asOn: asOnDisplay },
      }).catch((e) => console.warn("[audit] leave balance export", e));
      res.send(Buffer.from(buf));
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to export leave balance Excel report");
    }
  });

  /** Admin-only: Employee Posting Report (Primary Location + Additional Charges) — JSON / Excel / PDF. */
  app.get("/api/hr/reports/employee-posting", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const isAdmin = Boolean(req.user.roles?.some((r) => String(r.tier) === "ADMIN"));
      if (!isAdmin) {
        return sendApiError(res, 403, "AUTH_ADMIN_REQUIRED", "Employee Posting Report is available only to Admin users.");
      }
      const format = String(req.query.format ?? "json").trim().toLowerCase();
      const {
        buildEmployeePostingReportData,
        postingReportToAoa,
        generateEmployeePostingReportPdf,
      } = await import("./hr-employee-posting-report");
      const data = await buildEmployeePostingReportData();

      if (format === "xlsx" || format === "excel") {
        const XLSX = await import("xlsx");
        const aoa = postingReportToAoa(data);
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 10 }, { wch: 48 }, { wch: 36 }];
        XLSX.utils.book_append_sheet(wb, ws, "Employee Posting");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
        const stamp = data.updatedOnDisplay.replace(/\./g, "-");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Employee_Posting_Report_${stamp}.xlsx"`,
        );
        writeAuditLog(req, {
          module: "HR",
          action: "Export",
          recordId: "employee_posting_excel",
          afterValue: { updatedOn: data.updatedOnDisplay },
        }).catch((e) => console.warn("[audit] employee posting export", e));
        res.send(Buffer.from(buf));
        return;
      }

      if (format === "pdf") {
        const buf = await generateEmployeePostingReportPdf(data);
        const stamp = data.updatedOnDisplay.replace(/\./g, "-");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Employee_Posting_Report_${stamp}.pdf"`,
        );
        writeAuditLog(req, {
          module: "HR",
          action: "Export",
          recordId: "employee_posting_pdf",
          afterValue: { updatedOn: data.updatedOnDisplay },
        }).catch((e) => console.warn("[audit] employee posting pdf", e));
        res.send(buf);
        return;
      }

      res.json(data);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate employee posting report");
    }
  });

  /** US-M01-005: leave encashment calculator (retirement). */
  app.get("/api/hr/employees/:employeeId/leave-encashment", async (req, res) => {
    try {
      const employeeId = req.params.employeeId;
      const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      const [bal] = await db
        .select()
        .from(employeeLeaveBalances)
        .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, "EL")))
        .limit(1);
      const elDays = bal ? Number(bal.balanceDays ?? 0) : 0;
      const basic = emp.basicPayInr != null ? Number(emp.basicPayInr) : NaN;
      const da = emp.daAmountInr != null ? Number(emp.daAmountInr) : NaN;
      if (!Number.isFinite(basic) || !Number.isFinite(da)) {
        return sendApiError(
          res,
          400,
          "HR_LEAVE_ENCASH_PAY_REQUIRED",
          "Employee basicPayInr and daAmountInr must be set to compute encashment.",
        );
      }
      const perDay = (basic + da) / 30;
      const encashment = perDay * elDays;
      res.json({
        employeeId,
        empId: emp.empId ?? emp.id,
        elDays,
        basicPayInr: basic,
        daAmountInr: da,
        perDayRate: perDay,
        encashmentInr: encashment,
        formula: "(Basic Pay + DA) / 30 × EL days",
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to compute leave encashment");
    }
  });

  app.put("/api/hr/leave-balances", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Update required to edit leave balances", {
          required: "M-01:Update",
        });
      }
      const body = req.body as { rows?: unknown };
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const allowedTypes = new Set(["EL", "HPL", "COMMUTED", "CL", "RH", "SPL_H", "ML", "PL", "EOL", "CCL"]);
      const leaveTypeAliases: Record<string, string> = {
        "CASUAL LEAVE": "CL",
        "RESTRICTED HOLIDAY": "RH",
        "RISTRICTED HOLIDAY": "RH",
        "SPECIAL HOLIDAY": "SPL_H",
        SH: "SPL_H",
        "HALF PAY LEAVE": "HPL",
        "EARNED LEAVE": "EL",
        "COMMUTED LEAVE": "COMMUTED",
        "MATERNITY LEAVE": "ML",
        "PATERNITY LEAVE": "PL",
        "EXTRAORDINARY LEAVE": "EOL",
        "CHILD CARE LEAVE": "CCL",
      };

      const normalized: {
        employeeId: string;
        leaveType: string;
        balanceDays: number;
        setOffDays: number;
        setOffExpiryDate: string | null;
      }[] = [];
      const seen = new Set<string>();

      for (const r of rows) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        const rawEmployeeId = String(o.employeeId ?? "").trim();
        let leaveType = String(o.leaveType ?? "")
          .trim()
          .toUpperCase()
          .replace(/\s+/g, " ");
        leaveType = leaveTypeAliases[leaveType] ?? leaveType;
        const balanceDays = Number(o.balanceDays);
        const setOffDays = o.setOffDays !== undefined ? Number(o.setOffDays) : 0;
        const setOffExpiryRaw = o.setOffExpiryDate;
        const setOffExpiryDate =
          setOffExpiryRaw === null || setOffExpiryRaw === undefined || String(setOffExpiryRaw).trim() === ""
            ? null
            : String(setOffExpiryRaw).trim().slice(0, 10);

        if (!rawEmployeeId || !leaveType || !Number.isFinite(balanceDays) || balanceDays < 0) {
          return sendApiError(res, 400, "HR_LEAVE_BALANCE_ROW_INVALID", "Each row needs employeeId, leaveType, and balanceDays >= 0.");
        }
        if (!allowedTypes.has(leaveType)) {
          return sendApiError(
            res,
            400,
            "HR_LEAVE_BALANCE_TYPE_INVALID",
            `leaveType must be one of: ${Array.from(allowedTypes).join(", ")}`,
          );
        }
        if (!Number.isFinite(setOffDays) || setOffDays < 0) {
          return sendApiError(res, 400, "HR_LEAVE_BALANCE_ROW_INVALID", "setOffDays must be >= 0 when provided.");
        }
        if (setOffExpiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(setOffExpiryDate)) {
          return sendApiError(res, 400, "HR_LEAVE_BALANCE_EXPIRY_INVALID", "setOffExpiryDate must be YYYY-MM-DD or empty.");
        }

        const employeeId = await resolveEmployeePkForLeaveBalance(rawEmployeeId);
        if (!employeeId) {
          return sendApiError(res, 400, "HR_LEAVE_BALANCE_EMP_NOT_FOUND", `Unknown employeeId ${rawEmployeeId}`);
        }

        const dupKey = `${employeeId}::${leaveType}`;
        if (seen.has(dupKey)) {
          return sendApiError(
            res,
            400,
            "HR_LEAVE_BALANCE_DUPLICATE",
            `Duplicate opening balance for the same employee and leave type (${leaveType}).`,
          );
        }
        seen.add(dupKey);

        const resolvedExpiry =
          leaveType === "EL" ? resolveElSetOffExpiryDate(setOffDays, setOffExpiryDate) : setOffExpiryDate;
        normalized.push({
          employeeId,
          leaveType,
          balanceDays,
          setOffDays,
          setOffExpiryDate: resolvedExpiry,
        });
      }

      // Replace-all: remove rows deleted in the UI, then upsert the submitted set.
      const existing = await db.select().from(employeeLeaveBalances);
      const keep = new Set(normalized.map((r) => `${r.employeeId}::${r.leaveType}`));
      for (const ex of existing) {
        if (!keep.has(`${ex.employeeId}::${ex.leaveType}`)) {
          await db.delete(employeeLeaveBalances).where(eq(employeeLeaveBalances.id, ex.id));
        }
      }

      const ts = now();
      for (const r of normalized) {
        const [row] = await db
          .select()
          .from(employeeLeaveBalances)
          .where(and(eq(employeeLeaveBalances.employeeId, r.employeeId), eq(employeeLeaveBalances.leaveType, r.leaveType)))
          .limit(1);
        if (row) {
          await db
            .update(employeeLeaveBalances)
            .set({
              balanceDays: r.balanceDays,
              setOffDays: r.setOffDays,
              setOffExpiryDate: r.setOffExpiryDate,
              updatedAt: ts,
            })
            .where(eq(employeeLeaveBalances.id, row.id));
        } else {
          await db.insert(employeeLeaveBalances).values({
            id: nanoid(),
            employeeId: r.employeeId,
            leaveType: r.leaveType,
            balanceDays: r.balanceDays,
            setOffDays: r.setOffDays,
            setOffExpiryDate: r.setOffExpiryDate,
            updatedAt: ts,
          });
        }
      }

      const list = await db.select().from(employeeLeaveBalances).orderBy(desc(employeeLeaveBalances.updatedAt));
      writeAuditLog(req, { module: "HR", action: "Update", recordId: "leave_balances", afterValue: { count: normalized.length } }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to save leave balances");
    }
  });

  // ----- Leave supporting document upload/download (M-01) -----
  // Upload is used before POST /api/hr/leaves so supportingDocumentUrl can be stored.
  const leaveSupportingDocUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // SRS: <= 5 MB
  });

  function multerLeaveSupportingDoc(req: Request, res: Response, next: () => void): void {
    leaveSupportingDocUpload.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      const msg = err instanceof Error ? err.message : "Upload failed";
      if (typeof err === "object" && err != null && "code" in err && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
        sendApiError(res, 400, "LEAVE_DOC_TOO_LARGE", "Document must be 5 MB or smaller.");
        return;
      }
      console.error(err);
      sendApiError(res, 400, "LEAVE_DOC_UPLOAD_FAILED", msg);
    });
  }

  app.post("/api/hr/leaves/supporting-document-upload", multerLeaveSupportingDoc, async (req, res) => {
    try {
      // Applicants (DO) plus verifying/approving officers may attach or correct supporting docs.
      if (
        !req.user ||
        !(
          canCreateLeaveRequest(req.user) ||
          (req.user.roles ?? []).some((r) => ["DV", "DA", "ADMIN"].includes(String(r.tier)))
        )
      ) {
        return sendApiError(
          res,
          403,
          "LEAVE_DOC_UPLOAD_DENIED",
          "Only DO/DV/DA/Admin can upload leave supporting documents",
        );
      }

      const file = req.file as Express.Multer.File | undefined;
      if (!file) return sendApiError(res, 400, "LEAVE_DOC_REQUIRED", "Upload file required (field name: file)");

      const ext = extFromPdfUpload(file.mimetype, file.originalname);
      if (ext !== ".pdf") return sendApiError(res, 400, "LEAVE_DOC_TYPE", "Only PDF documents are allowed.");

      const key = assertSafeUploadRelativeKey(`leaves/supporting-docs/${nanoid(16)}.pdf`);
      const store = getUploadBlobStore();
      await store.put(key, file.buffer, "application/pdf");

      return res.status(201).json({
        url: `/api/hr/leaves/supporting-document-download?key=${encodeURIComponent(key)}`,
        key,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to store leave document");
    }
  });

  app.get("/api/hr/leaves/supporting-document-download", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-01", "Read")) {
        // Keep it simple: viewing is permission-gated like the rest of the M-01 UI.
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Read required to download documents", { required: "M-01:Read" });
      }

      const keyRaw = String(req.query.key ?? "").trim();
      if (!keyRaw) return sendApiError(res, 400, "LEAVE_DOC_KEY_REQUIRED", "key query param is required");

      const safeKey = assertSafeUploadRelativeKey(keyRaw);
      if (!safeKey.startsWith("leaves/supporting-docs/")) {
        return sendApiError(res, 404, "LEAVE_DOC_NOT_FOUND", "Document not found");
      }

      const store = getUploadBlobStore();
      const buf = await store.get(safeKey);
      if (!buf) return sendApiError(res, 404, "LEAVE_DOC_MISSING", "Document missing");

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Leave_Supporting_Document.pdf"`);
      return res.send(buf);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to download leave document");
    }
  });

  // ----- Leave requests -----
  app.get("/api/hr/leaves", async (req, res) => {
    try {
      if (!requireLeaveRead(req, res)) return;
      const employeeId = req.query.employeeId as string | undefined;
      const pendingMyAction =
        req.query.pendingMyAction === "1" || String(req.query.pendingMyAction ?? "").toLowerCase() === "true";
      const mineOnly = req.query.mine === "1" || String(req.query.mine ?? "").toLowerCase() === "true";
      const isAdmin = Boolean(req.user?.roles?.some((r) => String(r.tier) === "ADMIN"));
      const isDv = Boolean(req.user?.roles?.some((r) => String(r.tier) === "DV"));
      const isDa = Boolean(req.user?.roles?.some((r) => String(r.tier) === "DA"));
      const selfEmployeeId = req.user?.employeeId ? String(req.user.employeeId).trim() : "";

      let list = employeeId
        ? await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(desc(leaveRequests.fromDate))
        : await db.select().from(leaveRequests).orderBy(desc(leaveRequests.fromDate));

      // Role = functional permission; Reporting Officer mapping = whose leave is visible.
      // Admin may see all when mine is off. DV/DA see reportees / hierarchy scope. Others see own leaves.
      // Location / Additional Charge never grants leave access by itself.
      if (pendingMyAction) {
        list = list.filter((row) => leaveRequestAwaitingMyAction(req.user, row));
        if (!isAdmin) {
          if (!selfEmployeeId) {
            list = [];
          } else {
            const index = await loadLeaveReportingEmployeeIndex();
            const approverByEmp = isDa
              ? await resolveLeaveApproverEmployeeIdsBatch(
                  list.map((row) => row.employeeId),
                  index,
                )
              : null;
            list = list.filter((row) => {
              const st = String(row.status);
              if (st === "Pending" && isDv) {
                return resolveLeaveVerifierEmployeeId(row.employeeId, index) === selfEmployeeId;
              }
              if (st === "Verified" && isDa) {
                return (approverByEmp?.get(row.employeeId) ?? null) === selfEmployeeId;
              }
              return false;
            });
          }
        }
      } else if (mineOnly) {
        if (!selfEmployeeId) list = [];
        else list = list.filter((row) => row.employeeId === selfEmployeeId);
      } else if (isAdmin) {
        // full list
      } else if ((isDv || isDa) && selfEmployeeId) {
        const index = await loadLeaveReportingEmployeeIndex();
        const approverByEmp = await resolveLeaveApproverEmployeeIdsBatch(
          [...new Set(list.map((row) => row.employeeId))],
          index,
        );
        list = list.filter((row) => {
          if (resolveLeaveVerifierEmployeeId(row.employeeId, index) === selfEmployeeId) return true;
          return (approverByEmp.get(row.employeeId) ?? null) === selfEmployeeId;
        });
      } else {
        if (!selfEmployeeId) list = [];
        else list = list.filter((row) => row.employeeId === selfEmployeeId);
      }

      if (employeeId && employeeId !== selfEmployeeId && !isAdmin) {
        const index = await loadLeaveReportingEmployeeIndex();
        const allowed =
          Boolean(selfEmployeeId) &&
          (leaveEmployeeInOfficerScope(employeeId, selfEmployeeId, index) ||
            (await resolveLeaveApproverEmployeeIdAsync(employeeId, index)) === selfEmployeeId);
        if (!allowed) list = [];
      }

      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch leave requests");
    }
  });

  // ----- Tour programmes -----
  app.get("/api/hr/tours", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const pendingMyAction =
        req.query.pendingMyAction === "1" || String(req.query.pendingMyAction ?? "").toLowerCase() === "true";
      let list = employeeId
        ? await db.select().from(tourProgrammes).where(eq(tourProgrammes.employeeId, employeeId)).orderBy(desc(tourProgrammes.createdAt))
        : await db.select().from(tourProgrammes).orderBy(desc(tourProgrammes.createdAt));
      if (pendingMyAction) {
        list = list.filter((row) => tourProgrammeAwaitingMyAction(req.user, row));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch tour programmes");
    }
  });

  function nextTourNo(existing: string[]): string {
    const y = new Date().toISOString().slice(0, 4);
    let max = 0;
    for (const t of existing) {
      const m = /^TOUR-(\d{4})-(\d{4})$/i.exec(String(t).trim());
      if (m && m[1] === y) max = Math.max(max, parseInt(m[2]!, 10));
    }
    return `TOUR-${y}-${String(max + 1).padStart(4, "0")}`;
  }

  app.post("/api/hr/tours", async (req, res) => {
    try {
      if (!canCreateTourProgramme(req.user)) {
        return sendApiError(res, 403, "TOUR_CREATE_DENIED", "Only Data Originator or Admin can create tour programmes");
      }
      const body = req.body as Record<string, unknown>;
      const employeeId = String(body.employeeId ?? "").trim();
      const destination = String(body.destination ?? "").trim();
      const purpose = String(body.purpose ?? "").trim();
      const fromDate = String(body.fromDate ?? "").trim();
      const toDate = String(body.toDate ?? "").trim();
      if (!employeeId || !destination || !purpose || !fromDate || !toDate) {
        return sendApiError(res, 400, "TOUR_FIELDS_REQUIRED", "employeeId, destination, purpose, fromDate, toDate are required");
      }
      if (fromDate > toDate) return sendApiError(res, 400, "TOUR_DATES_INVALID", "fromDate must be <= toDate");
      const id = nanoid();
      const existing = await db.select({ tourNo: tourProgrammes.tourNo }).from(tourProgrammes);
      const tourNo = nextTourNo(existing.map((x) => x.tourNo));
      await db.insert(tourProgrammes).values({
        id,
        tourNo,
        employeeId,
        destination,
        purpose,
        fromDate,
        toDate,
        status: "Pending",
        doUser: req.user?.id ?? null,
        dvUser: null,
        approvedBy: null,
        rejectionReasonCode: null,
        rejectionRemarks: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
        createdAt: now(),
        updatedAt: now(),
      });
      const [row] = await db.select().from(tourProgrammes).where(eq(tourProgrammes.id, id)).limit(1);
      if (row) writeAuditLog(req, { module: "HR", action: "CreateTourProgramme", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create tour programme");
    }
  });

  app.put("/api/hr/tours/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(tourProgrammes).where(eq(tourProgrammes.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "TOUR_NOT_FOUND", "Tour programme not found");
      const body = req.body as Record<string, unknown>;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionTourProgramme(req.user, existing.status, newStatus) : null;

      let rejection: { code: string; remarks: string } | null = null;
      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(res, 403, "TOUR_STATUS_TRANSITION_DENIED", `You cannot change status from ${existing.status} to ${newStatus}.`);
        }
        const segRec = { doUser: existing.doUser, dvUser: existing.dvUser, daUser: null as string | null };
        if (transition.setDvUser) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDvUser: true });
          if (!seg.ok) return sendApiError(res, 403, "TOUR_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (transition.setApprovedBy) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDaUser: true });
          if (!seg.ok) return sendApiError(res, 403, "TOUR_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (newStatus === "Rejected") {
          const rej = validateDaRejection(body);
          if (!rej.ok) return sendApiError(res, 400, "TOUR_DA_REJECTION_INVALID", rej.error);
          rejection = { code: rej.code, remarks: rej.remarks };
        }
        if (existing.status === "Verified" && newStatus === "Pending") {
          const ret = validateDvReturnToDraft(body);
          if (!ret.ok) return sendApiError(res, 400, "TOUR_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
      } else {
        if (["Approved", "Rejected"].includes(existing.status)) return sendApiError(res, 403, "TOUR_TERMINAL_NO_EDIT", "Approved/rejected tours cannot be edited");
        if (existing.status !== "Pending") return sendApiError(res, 403, "TOUR_EDIT_DENIED", "Only pending tours can be edited");
        if (!canCreateTourProgramme(req.user)) return sendApiError(res, 403, "TOUR_EDIT_DENIED", "Only DO/Admin can edit pending tours");
      }

      const updates: Record<string, unknown> = {};
      if (body.status !== undefined) updates.status = body.status;
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setApprovedBy) updates.approvedBy = req.user?.id ?? null;
      if (dvReturnRemarks !== null) {
        updates.dvReturnRemarks = dvReturnRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
        updates.dvUser = null;
        updates.approvedBy = null;
      }
      if (rejection) {
        updates.rejectionReasonCode = rejection.code;
        updates.rejectionRemarks = rejection.remarks;
      }
      if (statusChange && newStatus === "Approved") {
        updates.rejectionReasonCode = null;
        updates.rejectionRemarks = null;
      }
      ["destination", "purpose", "fromDate", "toDate"].forEach((k) => {
        if ((body as Record<string, unknown>)[k] !== undefined) {
          updates[k] = String((body as Record<string, unknown>)[k] ?? "").trim();
        }
      });
      updates.updatedAt = now();
      await db.update(tourProgrammes).set(updates as Record<string, string | number | null>).where(eq(tourProgrammes.id, id));
      const [row] = await db.select().from(tourProgrammes).where(eq(tourProgrammes.id, id)).limit(1);
      if (row) writeAuditLog(req, { module: "HR", action: "UpdateTourProgramme", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update tour programme");
    }
  });

  app.post("/api/hr/leaves", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!canCreateLeaveRequest(req.user)) {
        return sendApiError(res, 403, "LEAVE_CREATE_DENIED", "Only Data Originator or Admin can create leave requests");
      }
      if (!hasPermission(req.user, "M-01", "Create")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Create required", { required: "M-01:Create" });
      }
      const body = req.body;
      const leaveType = String(body.leaveType ?? "").trim().toUpperCase();
      const employeeId = String(body.employeeId ?? "").trim();
      const fromDate = normalizeIsoCalendarYmd(body.fromDate);
      const toDate = normalizeIsoCalendarYmd(body.toDate);
      const isRetrospective = Boolean((body as Record<string, unknown>).isRetrospective);
      const isExPostFacto = Boolean((body as Record<string, unknown>).isExPostFacto);
      const halfDay = body.halfDay ? String(body.halfDay).trim() : null;

      if (!employeeId) return sendApiError(res, 400, "LEAVE_EMPLOYEE_REQUIRED", "employeeId is required");
      if (!fromDate || !toDate) {
        return sendApiError(
          res,
          400,
          "LEAVE_DATES_REQUIRED",
          "fromDate and toDate are required (YYYY-MM-DD; use a 4-digit year, e.g. 2026).",
        );
      }
      if (fromDate > toDate) return sendApiError(res, 400, "LEAVE_DATES_INVALID", "fromDate must be <= toDate");

      const publicHolidayErr = await validateLeaveDatesNotPublicHoliday(fromDate, toDate);
      if (publicHolidayErr) {
        return sendApiError(res, 400, "LEAVE_PUBLIC_HOLIDAY", publicHolidayErr);
      }

      const durationErr = await validateLeaveDurationCaps(leaveType, fromDate, toDate);
      if (durationErr) return sendApiError(res, 400, "LEAVE_DURATION_CAP", durationErr);
      if (leaveType === "CCL") {
        const cclErr = await validateCclLifetimeCap(employeeId, fromDate, toDate);
        if (cclErr) return sendApiError(res, 400, "LEAVE_CCL_CAP", cclErr);
      }

      const VALID_TYPES = ["EL", "HPL", "COMMUTED", "CL", "RH", "SPL_H", "ML", "PL", "EOL", "CCL"];
      if (!VALID_TYPES.includes(leaveType)) {
        return sendApiError(res, 400, "LEAVE_INVALID_TYPE", `Leave type must be one of: ${VALID_TYPES.join(", ")}`);
      }

      // CL: max 3 consecutive days; half-day only for single day
      if (leaveType === "CL") {
        const days = inclusiveCalendarDays(fromDate, toDate);
        if (days > 3) return sendApiError(res, 400, "E_LVE_004", "CL max 3 consecutive days per application.");
        if (halfDay && days !== 1) return sendApiError(res, 400, "LEAVE_HALF_DAY_SINGLE", "Half-day CL only for single-day applications.");
      }

      const cfg = await getMergedSystemConfig();

      // RH: validate date is on the Restricted list
      if (leaveType === "RH") {
        if (fromDate !== toDate) return sendApiError(res, 400, "LEAVE_RH_SINGLE_DAY", "Restricted Holiday must be a single day.");
        const isValidRh = await validateRhDate(fromDate);
        if (!isValidRh) return sendApiError(res, 400, "LEAVE_RH_NOT_IN_LIST", "Selected date is not on the Restricted Holiday list for that year.");
        const rhYear = Number(fromDate.slice(0, 4));
        const rhCount = (await db.select().from(leaveRequests).where(
          and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.leaveType, "RH"))
        )).filter((r) => !["Rejected", "Cancelled"].includes(String(r.status)) && String(r.fromDate).startsWith(String(rhYear))).length;
        const rhEntitlement = Number(cfg.leave_rh_entitlement_per_year ?? "2");
        if (rhCount >= rhEntitlement) {
          return sendApiError(res, 400, "LEAVE_RH_EXHAUSTED", `Already availed ${rhEntitlement} Restricted Holidays this year.`);
        }
      }

      // SPL_H: require duty date
      if (leaveType === "SPL_H" && !body.dutyDateForSplH) {
        return sendApiError(res, 400, "LEAVE_SPLH_DUTY_DATE", "Duty date (in lieu of) is required for Special Holiday.");
      }

      // Supporting doc mandatory for ML/PL/COMMUTED/HPL when leave exceeds 3 calendar days
      const supportingDocumentUrl = body.supportingDocumentUrl != null && String(body.supportingDocumentUrl).trim() !== "" ? String(body.supportingDocumentUrl).trim() : null;
      const calendarDays = inclusiveCalendarDays(fromDate, toDate);
      if (leaveSupportingDocRequired(leaveType, calendarDays) && !supportingDocumentUrl) {
        return sendApiError(
          res,
          400,
          "LEAVE_SUPPORTING_DOC_REQUIRED",
          "Supporting / medical document is required when leave exceeds 3 days.",
          { leaveType },
        );
      }

      // Retrospective remains Admin-only; ex-post facto may be set by any eligible applicant (DO/Admin).
      if (isRetrospective && !(req.user?.roles ?? []).some((r: { tier?: string }) => r.tier === "ADMIN")) {
        return sendApiError(res, 403, "LEAVE_RETRO_DENIED", "Only Admin can create retrospective entries");
      }

      // Leave application date (Form-1 / sanction READ): default today; backdating allowed; future not allowed.
      const todayYmd = localCalendarYmdUtc();
      const rawAppDate =
        body.applicationDate != null && String(body.applicationDate).trim() !== ""
          ? normalizeIsoCalendarYmd(body.applicationDate)
          : body.appliedAt != null && String(body.appliedAt).trim() !== ""
            ? normalizeIsoCalendarYmd(body.appliedAt)
            : todayYmd;
      if (!rawAppDate) {
        return sendApiError(
          res,
          400,
          "LEAVE_APPLICATION_DATE_INVALID",
          "Leave application date must be YYYY-MM-DD with a 4-digit year (e.g. 2026).",
        );
      }
      if (rawAppDate > todayYmd) {
        return sendApiError(
          res,
          400,
          "LEAVE_APPLICATION_DATE_FUTURE",
          "Leave application date cannot be a future date.",
        );
      }
      const applicationDateYmd = rawAppDate;

      // Overlap check (exclude superseded/cancelled/rejected; exclude leave being revised)
      const revisedFromLeaveId =
        body.revisedFromLeaveId != null && String(body.revisedFromLeaveId).trim() !== ""
          ? String(body.revisedFromLeaveId).trim()
          : null;
      let originalApproved: {
        id: string;
        employeeId: string;
        leaveType: string;
        fromDate: string;
        toDate: string;
        status: string;
        debitDays: number | null;
        halfDay: string | null;
        supersededByLeaveId: string | null;
      } | null = null;
      if (revisedFromLeaveId) {
        const [orig] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, revisedFromLeaveId)).limit(1);
        if (!orig || orig.employeeId !== employeeId) {
          return sendApiError(res, 400, "LEAVE_REVISE_INVALID", "revisedFromLeaveId must be an approved leave of the same employee.");
        }
        if (orig.status !== "Approved") {
          return sendApiError(res, 400, "LEAVE_REVISE_NOT_APPROVED", "Only an Approved leave can be revised.");
        }
        if (orig.supersededByLeaveId) {
          return sendApiError(res, 400, "LEAVE_REVISE_ALREADY_SUPERSEDED", "That leave has already been superseded by a revision.");
        }
        const openRevision = (
          await db.select().from(leaveRequests).where(eq(leaveRequests.revisedFromLeaveId, revisedFromLeaveId))
        ).find((r) => ["Pending", "Verified"].includes(String(r.status)));
        if (openRevision) {
          return sendApiError(
            res,
            400,
            "LEAVE_REVISE_IN_FLIGHT",
            "A revision of this leave is already Pending or Verified. Finish or cancel it before starting another.",
          );
        }
        originalApproved = orig;
      }

      const existingForEmp = await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId));
      const activeExisting = existingForEmp.filter(
        (r) =>
          !["Rejected", "Cancelled", "Superseded"].includes(String(r.status)) &&
          !(revisedFromLeaveId && r.id === revisedFromLeaveId),
      );
      const overlaps = activeExisting.some((r) => {
        const aFrom = String(r.fromDate);
        const aTo = String(r.toDate);
        return fromDate <= aTo && toDate >= aFrom;
      });
      if (overlaps) {
        return sendApiError(res, 400, "LEAVE_OVERLAP", "Leave dates overlap with an existing leave request (pending/verified/approved).");
      }

      // Get employee for location-based prefix/suffix (Primary Location yard type)
      const locationType = await primaryLocationTypeForEmployee(employeeId);
      const prefixSuffix = await calculatePrefixSuffix(fromDate, toDate, locationType);
      const debitDays = calculateDebitDays({ leaveType, fromDate, toDate, halfDay });

      if (debitDays > 0 && !leaveTypeSkipsBalanceDebit(leaveType)) {
        try {
          // For revisions, original debit is already taken — check net additional need
          let needCheck = debitDays;
          if (originalApproved) {
            const origDebit =
              originalApproved.debitDays != null
                ? Number(originalApproved.debitDays)
                : calculateDebitDays({
                    leaveType: originalApproved.leaveType,
                    fromDate: originalApproved.fromDate,
                    toDate: originalApproved.toDate,
                    halfDay: originalApproved.halfDay,
                  });
            if (balanceLeaveTypeFor(leaveType) === balanceLeaveTypeFor(originalApproved.leaveType)) {
              needCheck = Math.max(0, debitDays - origDebit);
            }
          }
          if (needCheck > 0) await assertSufficientBalanceForApproval(employeeId, leaveType, needCheck);
        } catch {
          return sendApiError(
            res,
            400,
            "LEAVE_INSUFFICIENT_BALANCE",
            leaveType === "COMMUTED"
              ? "Insufficient HPL balance for commuted leave (debits at 2× calendar days)."
              : "Insufficient leave balance for this leave type.",
          );
        }
      }

      // Optional pay Level / Pay Rs. refresh from leave application form → employee master (Form-1).
      if (body.payLevel !== undefined || body.basicPayInr !== undefined) {
        const payUpdates: { payLevel?: number | null; basicPayInr?: number | null; updatedAt: string } = {
          updatedAt: now(),
        };
        if (body.payLevel !== undefined) {
          if (body.payLevel === null || String(body.payLevel).trim() === "") {
            payUpdates.payLevel = null;
          } else {
            const pl = Number(body.payLevel);
            if (!Number.isFinite(pl) || pl < 1 || pl > 18) {
              return sendApiError(res, 400, "LEAVE_PAY_LEVEL_INVALID", "payLevel must be 1–18 or empty");
            }
            payUpdates.payLevel = Math.round(pl);
          }
        }
        if (body.basicPayInr !== undefined) {
          if (body.basicPayInr === null || String(body.basicPayInr).trim() === "") {
            payUpdates.basicPayInr = null;
          } else {
            const pay = Number(body.basicPayInr);
            if (!Number.isFinite(pay) || pay < 0) {
              return sendApiError(res, 400, "LEAVE_PAY_RS_INVALID", "basicPayInr / Pay Rs. must be a number ≥ 0");
            }
            payUpdates.basicPayInr = pay;
          }
        }
        await db.update(employees).set(payUpdates).where(eq(employees.id, employeeId));
      }

      const id = nanoid();
      await db.insert(leaveRequests).values({
        id,
        employeeId,
        leaveType,
        fromDate,
        toDate,
        status: "Pending",
        reason: body.reason != null && String(body.reason).trim() !== "" ? String(body.reason).trim() : null,
        supportingDocumentUrl,
        isRetrospective,
        isExPostFacto,
        halfDay,
        prefixDays: prefixSuffix.prefixDays,
        suffixDays: prefixSuffix.suffixDays,
        prefixFromDate: prefixSuffix.prefixFromDate,
        suffixToDate: prefixSuffix.suffixToDate,
        debitDays,
        substituteEmployeeId: body.substituteEmployeeId ? String(body.substituteEmployeeId).trim() : null,
        addressDuringLeave: body.addressDuringLeave ? String(body.addressDuringLeave).trim() : null,
        ltcProposed: body.ltcProposed === true,
        ltcBlockYear: body.ltcBlockYear != null && String(body.ltcBlockYear).trim() !== "" ? String(body.ltcBlockYear).trim() : null,
        refundUndertakingI:
          body.refundUndertakingI != null && String(body.refundUndertakingI).trim() !== ""
            ? String(body.refundUndertakingI).trim()
            : null,
        refundUndertakingIi:
          body.refundUndertakingIi != null && String(body.refundUndertakingIi).trim() !== ""
            ? String(body.refundUndertakingIi).trim()
            : null,
        leaveHq: body.leaveHq ? String(body.leaveHq).trim() : null,
        dutyDateForSplH: body.dutyDateForSplH
          ? normalizeIsoCalendarYmd(body.dutyDateForSplH) ?? String(body.dutyDateForSplH).trim()
          : null,
        copyToJson: body.copyToJson ? String(body.copyToJson) : null,
        revisedFromLeaveId,
        cancelledAt: null,
        cancelledBy: null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        approvedBy: null,
        appliedAt: applicationDateYmd,
        orderDate: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
      });
      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (row) {
        writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
        void notifyLeaveStatusChange(row, req.user?.name ?? req.user?.email ?? undefined);
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create leave request");
    }
  });

  app.put("/api/hr/leaves/:id", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Update required", { required: "M-01:Update" });
      }
      const id = req.params.id;
      const [existing] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (!existing) {
        return sendApiError(res, 404, "LEAVE_REQUEST_NOT_FOUND", "Leave request not found");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionLeaveRequest(req.user, existing.status, newStatus) : null;

      let leaveRejection: { code: string; remarks: string } | null = null;
      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "LEAVE_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${existing.status} to ${newStatus}. DV verifies; DA approves or rejects.`,
          );
        }
        if (existing.status === "Pending" && newStatus === "Verified") {
          // Enforce reporting-officer routing — role DV alone is not enough.
          const index = await loadLeaveReportingEmployeeIndex();
          const expectedVerifierEmpId = resolveLeaveVerifierEmployeeId(existing.employeeId, index);
          if (!expectedVerifierEmpId) {
            return sendApiError(res, 400, "LEAVE_REPORTING_OFFICER_MISSING", "Employee reporting officer is not set.");
          }
          const myEmpId = req.user?.employeeId ? String(req.user.employeeId).trim() : "";
          const linked = await resolveLinkedUserIdsForEmployees([expectedVerifierEmpId]);
          const expectedDvUserId = linked.get(expectedVerifierEmpId) ?? null;
          const isAdminUser = (req.user?.roles ?? []).some((r: { tier?: string }) => r.tier === "ADMIN");
          const isMappedOfficer =
            (myEmpId && myEmpId === expectedVerifierEmpId) ||
            (expectedDvUserId != null && req.user?.id === expectedDvUserId);
          if (!isMappedOfficer && !isAdminUser) {
            return sendApiError(
              res,
              403,
              "LEAVE_VERIFY_NOT_REPORTING_OFFICER",
              "Only the employee's reporting officer can verify this leave request.",
            );
          }
          if (!expectedDvUserId && !isAdminUser) {
            return sendApiError(
              res,
              400,
              "LEAVE_REPORTING_USER_MISSING",
              "Reporting officer has no linked login user.",
            );
          }
        }
        if (existing.status === "Verified" && (newStatus === "Approved" || newStatus === "Rejected")) {
          const isAdminUser = (req.user?.roles ?? []).some((r: { tier?: string }) => r.tier === "ADMIN");
          if (!isAdminUser) {
            const index = await loadLeaveReportingEmployeeIndex();
            const expectedApproverEmpId = await resolveLeaveApproverEmployeeIdAsync(existing.employeeId, index);
            const myEmpId = req.user?.employeeId ? String(req.user.employeeId).trim() : "";
            if (!expectedApproverEmpId) {
              return sendApiError(
                res,
                400,
                "LEAVE_APPROVER_CHAIN_MISSING",
                "Final approving authority is not set in the reporting hierarchy (no higher Reporting Officer with Approver role).",
              );
            }
            if (!myEmpId || myEmpId !== expectedApproverEmpId) {
              return sendApiError(
                res,
                403,
                "LEAVE_APPROVE_NOT_REPORTING_OFFICER",
                "Only the next / final approving officer in the employee's reporting hierarchy can approve or reject this leave request.",
              );
            }
          }
        }
        if (existing.status === "Verified" && newStatus === "Pending") {
          const isAdminUser = (req.user?.roles ?? []).some((r: { tier?: string }) => r.tier === "ADMIN");
          if (!isAdminUser) {
            const index = await loadLeaveReportingEmployeeIndex();
            const expectedVerifierEmpId = resolveLeaveVerifierEmployeeId(existing.employeeId, index);
            const myEmpId = req.user?.employeeId ? String(req.user.employeeId).trim() : "";
            if (!myEmpId || myEmpId !== expectedVerifierEmpId) {
              return sendApiError(
                res,
                403,
                "LEAVE_RETURN_NOT_REPORTING_OFFICER",
                "Only the employee's reporting officer can return this leave to Pending.",
              );
            }
          }
        }
        const segRec = {
          doUser: existing.doUser,
          dvUser: existing.dvUser,
          daUser: null as string | null,
        };
        if (transition.setDvUser) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDvUser: true });
          if (!seg.ok) return sendApiError(res, 403, "LEAVE_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (transition.setApprovedBy) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDaUser: true });
          if (!seg.ok) return sendApiError(res, 403, "LEAVE_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (transition.setApprovedBy && req.user?.id) {
          const [emp] = await db.select().from(employees).where(eq(employees.id, existing.employeeId)).limit(1);
          if (emp?.userId === req.user.id) {
            return sendApiError(
              res,
              403,
              "LEAVE_SELF_APPROVE_REJECT_DENIED",
              "You cannot approve or reject your own leave request.",
            );
          }
        }
        if (newStatus === "Rejected") {
          const rej = validateDaRejection(body as Record<string, unknown>);
          if (!rej.ok) return sendApiError(res, 400, "LEAVE_DA_REJECTION_INVALID", rej.error);
          leaveRejection = { code: rej.code, remarks: rej.remarks };
        }
        if (existing.status === "Verified" && newStatus === "Pending") {
          const ret = validateDvReturnToDraft(body as Record<string, unknown>);
          if (!ret.ok) return sendApiError(res, 400, "LEAVE_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
      } else {
        if (["Approved", "Rejected", "Cancelled", "Superseded"].includes(existing.status)) {
          return sendApiError(res, 403, "LEAVE_TERMINAL_NO_EDIT", "Approved/rejected/cancelled/superseded leave cannot be edited");
        }
        if (existing.status !== "Pending") {
          return sendApiError(res, 403, "LEAVE_EDIT_DENIED", "Only pending leave requests can be edited");
        }
        if (!canCreateLeaveRequest(req.user)) {
          return sendApiError(res, 403, "LEAVE_EDIT_DENIED", "Only Data Originator or Admin can edit a pending leave request");
        }
      }

      const updates: Record<string, unknown> = {};
      if (body.status !== undefined) updates.status = body.status;
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setApprovedBy) updates.approvedBy = req.user?.id ?? null;
      if (statusChange && newStatus === "Cancelled") {
        updates.cancelledAt = now();
        updates.cancelledBy = req.user?.id ?? null;
        updates.dvUser = null;
        updates.approvedBy = null;
      }
      if (dvReturnRemarks !== null) {
        updates.dvReturnRemarks = dvReturnRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
        updates.dvUser = null;
        updates.approvedBy = null;
      }
      // DV controlling officer remarks at Verify step
      if (statusChange && newStatus === "Verified" && body.controllingOfficerRemarks) {
        updates.controllingOfficerRemarks = String(body.controllingOfficerRemarks).trim();
      }
      if (leaveRejection) {
        updates.rejectionReasonCode = leaveRejection.code;
        updates.rejectionRemarks = leaveRejection.remarks;
      }
      if (statusChange && newStatus === "Approved") {
        updates.rejectionReasonCode = null;
        updates.rejectionRemarks = null;
        if (!String(existing.orderDate ?? "").trim()) {
          updates.orderDate = new Date().toISOString().slice(0, 10);
        }
      }
      ["leaveType", "reason", "supportingDocumentUrl"].forEach((k) => {
        if (body[k] !== undefined) {
          updates[k] = body[k] === null || body[k] === "" ? null : String(body[k]);
        }
      });
      if (body.fromDate !== undefined) {
        if (body.fromDate === null || body.fromDate === "") {
          updates.fromDate = null;
        } else {
          const n = normalizeIsoCalendarYmd(body.fromDate);
          if (!n) {
            return sendApiError(
              res,
              400,
              "LEAVE_DATES_INVALID",
              "fromDate must be YYYY-MM-DD with a 4-digit year (e.g. 2026).",
            );
          }
          updates.fromDate = n;
        }
      }
      if (body.toDate !== undefined) {
        if (body.toDate === null || body.toDate === "") {
          updates.toDate = null;
        } else {
          const n = normalizeIsoCalendarYmd(body.toDate);
          if (!n) {
            return sendApiError(
              res,
              400,
              "LEAVE_DATES_INVALID",
              "toDate must be YYYY-MM-DD with a 4-digit year (e.g. 2026).",
            );
          }
          updates.toDate = n;
        }
      }
      // Ex-post facto may be corrected at Verify / Approve (and other edits with Update permission).
      if (body.isExPostFacto !== undefined) {
        updates.isExPostFacto = body.isExPostFacto === true;
      }
      if (body.copyToJson !== undefined) {
        updates.copyToJson =
          body.copyToJson === null || body.copyToJson === "" ? null : String(body.copyToJson);
      }
      ["halfDay", "substituteEmployeeId", "addressDuringLeave", "leaveHq", "ltcBlockYear", "refundUndertakingI", "refundUndertakingIi"].forEach((k) => {
        if (body[k] !== undefined) {
          updates[k] = body[k] === null || body[k] === "" ? null : String(body[k]);
        }
      });
      if (body.dutyDateForSplH !== undefined) {
        if (body.dutyDateForSplH === null || body.dutyDateForSplH === "") {
          updates.dutyDateForSplH = null;
        } else {
          const n = normalizeIsoCalendarYmd(body.dutyDateForSplH);
          if (!n) {
            return sendApiError(
              res,
              400,
              "LEAVE_DATES_INVALID",
              "dutyDateForSplH must be YYYY-MM-DD with a 4-digit year (e.g. 2026).",
            );
          }
          updates.dutyDateForSplH = n;
        }
      }
      if (!statusChange && body.ltcProposed !== undefined) {
        updates.ltcProposed = body.ltcProposed === true;
      }

      if (!statusChange) {
        const effectiveLeaveTypeEdit = String((updates.leaveType as string | undefined) ?? existing.leaveType ?? "").trim();
        const effectiveFromEdit = String((updates.fromDate as string | undefined) ?? existing.fromDate ?? "").trim();
        const effectiveToEdit = String((updates.toDate as string | undefined) ?? existing.toDate ?? "").trim();
        const durationErr = await validateLeaveDurationCaps(effectiveLeaveTypeEdit, effectiveFromEdit, effectiveToEdit);
        if (durationErr) return sendApiError(res, 400, "LEAVE_DURATION_CAP", durationErr);
        if (effectiveLeaveTypeEdit === "CCL") {
          const cclErr = await validateCclLifetimeCap(existing.employeeId, effectiveFromEdit, effectiveToEdit, existing.id);
          if (cclErr) return sendApiError(res, 400, "LEAVE_CCL_CAP", cclErr);
        }
        const datesOrTypeChanged =
          updates.leaveType !== undefined || updates.fromDate !== undefined || updates.toDate !== undefined || updates.halfDay !== undefined;
        if (datesOrTypeChanged) {
          const locationType = await primaryLocationTypeForEmployee(existing.employeeId);
          const prefixSuffix = await calculatePrefixSuffix(effectiveFromEdit, effectiveToEdit, locationType);
          const halfDayVal =
            updates.halfDay !== undefined ? (updates.halfDay as string | null) : (existing.halfDay as string | null);
          updates.prefixDays = prefixSuffix.prefixDays;
          updates.suffixDays = prefixSuffix.suffixDays;
          updates.prefixFromDate = prefixSuffix.prefixFromDate;
          updates.suffixToDate = prefixSuffix.suffixToDate;
          updates.debitDays = calculateDebitDays({
            leaveType: effectiveLeaveTypeEdit,
            fromDate: effectiveFromEdit,
            toDate: effectiveToEdit,
            halfDay: halfDayVal,
          });
        }
        const effectiveFrom = String((updates.fromDate as string | undefined) ?? existing.fromDate ?? "").trim();
        const effectiveTo = String((updates.toDate as string | undefined) ?? existing.toDate ?? "").trim();
        if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) {
          return sendApiError(res, 400, "LEAVE_DATES_INVALID", "fromDate must be <= toDate");
        }
        const publicHolidayErrEdit = await validateLeaveDatesNotPublicHoliday(effectiveFrom, effectiveTo);
        if (publicHolidayErrEdit) {
          return sendApiError(res, 400, "LEAVE_PUBLIC_HOLIDAY", publicHolidayErrEdit);
        }
        const existingForEmp = await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, existing.employeeId));
        const activeExisting = existingForEmp.filter(
          (r) => r.id !== existing.id && !["Rejected", "Cancelled", "Superseded"].includes(String(r.status)),
        );
        const overlaps = activeExisting.some((r) => effectiveFrom <= String(r.toDate) && effectiveTo >= String(r.fromDate));
        if (overlaps) {
          return sendApiError(
            res,
            400,
            "LEAVE_OVERLAP",
            "Leave dates overlap with an existing leave request (pending/verified/approved).",
          );
        }
      }
      // Supporting doc for medical types when leave exceeds 3 days (skip on pure workflow status changes)
      const effectiveLeaveType = String((updates.leaveType as string | undefined) ?? existing.leaveType ?? "").trim();
      const effectiveDocUrl =
        updates.supportingDocumentUrl !== undefined
          ? (updates.supportingDocumentUrl as string | null)
          : (existing.supportingDocumentUrl as string | null);
      const contentFieldsTouched =
        updates.leaveType !== undefined ||
        updates.fromDate !== undefined ||
        updates.toDate !== undefined ||
        updates.supportingDocumentUrl !== undefined ||
        !statusChange;
      if (contentFieldsTouched) {
        const effectiveFrom = String((updates.fromDate as string | undefined) ?? existing.fromDate ?? "").slice(0, 10);
        const effectiveTo = String((updates.toDate as string | undefined) ?? existing.toDate ?? "").slice(0, 10);
        const patchCalendarDays = inclusiveCalendarDays(effectiveFrom, effectiveTo);
        if (leaveSupportingDocRequired(effectiveLeaveType, patchCalendarDays) && !effectiveDocUrl) {
          return sendApiError(
            res,
            400,
            "LEAVE_SUPPORTING_DOC_REQUIRED",
            "Supporting / medical document is required when leave exceeds 3 days.",
            { leaveType: effectiveLeaveType },
          );
        }
      }
      try {
        await db.transaction(async (tx) => {
          if (statusChange && newStatus === "Approved" && existing.status === "Verified") {
            // Always recompute — legacy PL/ML/EOL rows stored debitDays=0 before calendar debit was enabled.
            const debitDays = calculateDebitDays({
              leaveType: existing.leaveType,
              fromDate: existing.fromDate,
              toDate: existing.toDate,
              halfDay: existing.halfDay,
            });
            updates.debitDays = debitDays;

            // Revised leave: reverse original debit, mark original Superseded, then debit new
            if (existing.revisedFromLeaveId) {
              const [orig] = await tx
                .select()
                .from(leaveRequests)
                .where(eq(leaveRequests.id, existing.revisedFromLeaveId))
                .limit(1);
              if (!orig || orig.status !== "Approved") {
                throw new Error("LEAVE_REVISE_SOURCE_INVALID");
              }
              // Credit only what was actually debited (skip-list leaves stored 0/0 — do not invent credit).
              const hasRecordedSplit =
                orig.debitFromSetOffDays != null || orig.debitFromBalanceDays != null;
              const origDebit = hasRecordedSplit
                ? Number(orig.debitFromSetOffDays ?? 0) + Number(orig.debitFromBalanceDays ?? 0)
                : orig.debitDays != null
                  ? Number(orig.debitDays)
                  : calculateDebitDays({
                      leaveType: orig.leaveType,
                      fromDate: orig.fromDate,
                      toDate: orig.toDate,
                      halfDay: orig.halfDay,
                    });
              if (origDebit > 0) {
                await creditLeaveBalanceOnReversal(tx, {
                  employeeId: orig.employeeId,
                  leaveType: orig.leaveType,
                  creditDays: origDebit,
                  fromSetOff: orig.debitFromSetOffDays != null ? Number(orig.debitFromSetOffDays) : null,
                  fromBalance: orig.debitFromBalanceDays != null ? Number(orig.debitFromBalanceDays) : null,
                });
              }
              await tx
                .update(leaveRequests)
                .set({ status: "Superseded", supersededByLeaveId: id })
                .where(eq(leaveRequests.id, orig.id));
            }

            if (debitDays > 0) {
              try {
                await assertSufficientBalanceForApprovalTx(tx, existing.employeeId, existing.leaveType, debitDays);
                const split = await debitLeaveBalanceOnApproval(tx, {
                  employeeId: existing.employeeId,
                  leaveType: existing.leaveType,
                  debitDays,
                });
                updates.debitFromSetOffDays = split.fromSetOff;
                updates.debitFromBalanceDays = split.fromBalance;
              } catch {
                throw new Error("LEAVE_INSUFFICIENT_BALANCE");
              }
            } else {
              updates.debitFromSetOffDays = 0;
              updates.debitFromBalanceDays = 0;
            }

            // Handle DA override of prefix/suffix
            if (body.prefixSuffixDisallowed === true) {
              updates.prefixSuffixDisallowed = true;
              updates.prefixDays = 0;
              updates.suffixDays = 0;
              updates.prefixFromDate = null;
              updates.suffixToDate = null;
            } else if (body.prefixSuffixDisallowed === false && existing.prefixSuffixDisallowed === true) {
              // If the admin/DA toggles "Nil" off, restore calculated prefix/suffix based on dates+location.
              const locationType = await primaryLocationTypeForEmployee(existing.employeeId);
              const prefixSuffix = await calculatePrefixSuffix(existing.fromDate, existing.toDate, locationType);
              updates.prefixSuffixDisallowed = false;
              updates.prefixDays = prefixSuffix.prefixDays;
              updates.suffixDays = prefixSuffix.suffixDays;
              updates.prefixFromDate = prefixSuffix.prefixFromDate;
              updates.suffixToDate = prefixSuffix.suffixToDate;
            }
            if (body.copyToJson !== undefined) {
              updates.copyToJson =
                body.copyToJson === null || body.copyToJson === ""
                  ? null
                  : String(body.copyToJson);
            }
          }
          await tx.update(leaveRequests).set(updates as Record<string, string | number | null>).where(eq(leaveRequests.id, id));
        });
      } catch (e) {
        if (e instanceof Error && e.message === "LEAVE_INSUFFICIENT_BALANCE") {
          return sendApiError(
            res,
            400,
            "LEAVE_INSUFFICIENT_BALANCE",
            "Insufficient leave balance for this leave type (calendar days exceed configured balance).",
          );
        }
        if (e instanceof Error && e.message === "LEAVE_REVISE_SOURCE_INVALID") {
          return sendApiError(res, 400, "LEAVE_REVISE_SOURCE_INVALID", "Cannot approve revision: original leave is not Approved.");
        }
        if (e instanceof Error && e.message === "LEAVE_BALANCE_MISSING") {
          return sendApiError(res, 400, "LEAVE_BALANCE_MISSING", "Leave balance row missing for credit reversal.");
        }
        throw e;
      }
      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (!row) return sendApiError(res, 404, "LEAVE_REQUEST_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      if (statusChange) {
        void notifyLeaveStatusChange(row, req.user?.name ?? req.user?.email ?? undefined);
        if (row.status === "Approved" && existing.status === "Verified") {
          void appendLeaveServiceBookEntry(row, req.user?.id ?? null).catch((e) => console.error("Service book leave entry failed:", e));
          void generateAndEmailSanctionOrder(row.id, row.employeeId);
        }
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update leave request");
    }
  });

  // ----- LTC claims -----
  app.get("/api/hr/claims/ltc", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const pendingMyAction =
        req.query.pendingMyAction === "1" || String(req.query.pendingMyAction ?? "").toLowerCase() === "true";
      let list = employeeId
        ? await db.select().from(ltcClaims).where(eq(ltcClaims.employeeId, employeeId)).orderBy(desc(ltcClaims.claimDate))
        : await db.select().from(ltcClaims).orderBy(desc(ltcClaims.claimDate));
      if (pendingMyAction) {
        list = list.filter((row) => ltcClaimAwaitingMyAction(req.user, row));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch LTC claims");
    }
  });

  app.post("/api/hr/claims/ltc", async (req, res) => {
    try {
      if (!canCreateLtcClaim(req.user)) {
        return sendApiError(res, 403, "LTC_CREATE_DENIED", "Only Data Originator or Admin can create LTC claims");
      }
      const body = req.body;
      const blockPeriod = body.blockPeriod != null && String(body.blockPeriod).trim() !== "" ? String(body.blockPeriod).trim() : null;
      const ltcType = body.ltcType != null && String(body.ltcType).trim() !== "" ? String(body.ltcType).trim() : null;
      const estimatedEntitlement = body.estimatedEntitlement != null && String(body.estimatedEntitlement).trim() !== "" ? Number(body.estimatedEntitlement) : null;
      const advanceAmount = body.advanceAmount != null && String(body.advanceAmount).trim() !== "" ? Number(body.advanceAmount) : null;
      if (estimatedEntitlement != null && (!Number.isFinite(estimatedEntitlement) || estimatedEntitlement < 0)) {
        return sendApiError(res, 400, "LTC_ESTIMATE_INVALID", "Estimated entitlement must be >= 0");
      }
      if (advanceAmount != null && (!Number.isFinite(advanceAmount) || advanceAmount < 0)) {
        return sendApiError(res, 400, "LTC_ADVANCE_INVALID", "Advance amount must be >= 0");
      }
      if (estimatedEntitlement != null && advanceAmount != null) {
        const cap = 0.9 * estimatedEntitlement + 1e-9;
        if (advanceAmount > cap) {
          return sendApiError(res, 400, "LTC_ADVANCE_CAP", "Advance amount must be <= 90% of estimated entitlement.");
        }
      }
      const id = nanoid();
      await db.insert(ltcClaims).values({
        id,
        employeeId: String(body.employeeId ?? ""),
        claimDate: String(body.claimDate ?? ""),
        amount: Number(body.amount ?? 0),
        period: body.period ? String(body.period) : null,
        blockPeriod,
        ltcType,
        estimatedEntitlement,
        advanceAmount,
        actualClaimAmount: null,
        netPayable: null,
        settledAt: null,
        status: "Pending",
        doUser: req.user?.id ?? null,
        dvUser: null,
        approvedBy: null,
        rejectionReasonCode: null,
        rejectionRemarks: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
      });
      const [row] = await db.select().from(ltcClaims).where(eq(ltcClaims.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create LTC claim");
    }
  });

  app.put("/api/hr/claims/ltc/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(ltcClaims).where(eq(ltcClaims.id, id));
      if (!existing) {
        return sendApiError(res, 404, "LTC_CLAIM_NOT_FOUND", "LTC claim not found");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionLtcClaim(req.user, existing.status, newStatus) : null;

      let claimRejection: { code: string; remarks: string } | null = null;
      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "LTC_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${existing.status} to ${newStatus}. DV verifies; DA approves or rejects.`,
          );
        }
        const segRec = {
          doUser: existing.doUser,
          dvUser: existing.dvUser,
          daUser: null as string | null,
        };
        if (transition.setDvUser) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDvUser: true });
          if (!seg.ok) return sendApiError(res, 403, "LTC_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (transition.setApprovedBy) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDaUser: true });
          if (!seg.ok) return sendApiError(res, 403, "LTC_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (transition.setApprovedBy && req.user?.id) {
          const [emp] = await db.select().from(employees).where(eq(employees.id, existing.employeeId)).limit(1);
          if (emp?.userId === req.user.id) {
            return sendApiError(
              res,
              403,
              "LTC_SELF_APPROVE_REJECT_DENIED",
              "You cannot approve or reject your own LTC claim.",
            );
          }
        }
        if (newStatus === "Rejected") {
          const rej = validateDaRejection(body as Record<string, unknown>);
          if (!rej.ok) return sendApiError(res, 400, "LTC_DA_REJECTION_INVALID", rej.error);
          claimRejection = { code: rej.code, remarks: rej.remarks };
        }
        if (existing.status === "Verified" && newStatus === "Pending") {
          const ret = validateDvReturnToDraft(body as Record<string, unknown>);
          if (!ret.ok) return sendApiError(res, 400, "LTC_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
      } else {
        if (["Settled", "Rejected"].includes(existing.status)) {
          return sendApiError(res, 403, "LTC_TERMINAL_NO_EDIT", "Settled or rejected LTC claims cannot be edited");
        }
        if (existing.status !== "Pending") {
          return sendApiError(res, 403, "LTC_EDIT_DENIED", "Only pending LTC claims can be edited");
        }
        if (!canCreateLtcClaim(req.user)) {
          return sendApiError(res, 403, "LTC_EDIT_DENIED", "Only Data Originator or Admin can edit a pending LTC claim");
        }
      }

      const updates: Record<string, unknown> = {};
      if (body.status !== undefined) updates.status = body.status;
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setApprovedBy) updates.approvedBy = req.user?.id ?? null;
      if (dvReturnRemarks !== null) {
        updates.dvReturnRemarks = dvReturnRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
        updates.dvUser = null;
        updates.approvedBy = null;
      }
      if (claimRejection) {
        updates.rejectionReasonCode = claimRejection.code;
        updates.rejectionRemarks = claimRejection.remarks;
      }
      if (statusChange && newStatus === "Approved") {
        updates.rejectionReasonCode = null;
        updates.rejectionRemarks = null;
      }
      ["claimDate", "amount", "period", "blockPeriod", "ltcType", "estimatedEntitlement", "advanceAmount", "actualClaimAmount"].forEach((k) => {
        if (body[k] !== undefined) {
          if (["amount", "estimatedEntitlement", "advanceAmount", "actualClaimAmount"].includes(k)) {
            updates[k] = body[k] === null || body[k] === "" ? null : Number(body[k]);
          } else {
            updates[k] = body[k] === null ? null : String(body[k]);
          }
        }
      });

      // Settlement: Approved → Settled (DA only). Net payable = actual - advance.
      if (statusChange && newStatus === "Settled") {
        const actual = body.actualClaimAmount != null && String(body.actualClaimAmount).trim() !== "" ? Number(body.actualClaimAmount) : null;
        const advance = existing.advanceAmount != null ? Number(existing.advanceAmount) : 0;
        if (actual == null || !Number.isFinite(actual) || actual < 0) {
          return sendApiError(res, 400, "LTC_ACTUAL_REQUIRED", "actualClaimAmount is required to settle.");
        }
        updates.actualClaimAmount = actual;
        updates.netPayable = actual - advance;
        updates.settledAt = now();
      }
      await db.update(ltcClaims).set(updates as Record<string, string | number | null>).where(eq(ltcClaims.id, id));
      const [row] = await db.select().from(ltcClaims).where(eq(ltcClaims.id, id));
      if (!row) return sendApiError(res, 404, "LTC_CLAIM_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update LTC claim");
    }
  });

  // ----- TA/DA claims -----
  app.get("/api/hr/claims/tada", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const pendingMyAction =
        req.query.pendingMyAction === "1" || String(req.query.pendingMyAction ?? "").toLowerCase() === "true";
      let list = employeeId
        ? await db.select().from(taDaClaims).where(eq(taDaClaims.employeeId, employeeId)).orderBy(desc(taDaClaims.travelDate))
        : await db.select().from(taDaClaims).orderBy(desc(taDaClaims.travelDate));
      if (pendingMyAction) {
        list = list.filter((row) => taDaClaimAwaitingMyAction(req.user, row));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch TA/DA claims");
    }
  });

  app.post("/api/hr/claims/tada", async (req, res) => {
    try {
      if (!canCreateTaDaClaim(req.user)) {
        return sendApiError(
          res,
          403,
          "TADA_CREATE_DENIED",
          "Only Data Originator or Admin can create TA/DA claims",
        );
      }
      const body = req.body;
      const employeeId = String(body.employeeId ?? "").trim();
      const travelDate = String(body.travelDate ?? "").trim();
      const purpose = String(body.purpose ?? "").trim();
      const amount = Number(body.amount ?? 0);
      const tourProgrammeId =
        (body as Record<string, unknown>).tourProgrammeId != null && String((body as Record<string, unknown>).tourProgrammeId).trim() !== ""
          ? String((body as Record<string, unknown>).tourProgrammeId).trim()
          : "";
      const returnDate =
        (body as Record<string, unknown>).returnDate != null && String((body as Record<string, unknown>).returnDate).trim() !== ""
          ? String((body as Record<string, unknown>).returnDate).trim()
          : "";
      const cityCategoryRaw = String((body as Record<string, unknown>).cityCategory ?? "").trim().toUpperCase();
      const days = Number((body as Record<string, unknown>).days ?? 0);
      const hotelAmount =
        (body as Record<string, unknown>).hotelAmount == null || String((body as Record<string, unknown>).hotelAmount).trim() === ""
          ? null
          : Number((body as Record<string, unknown>).hotelAmount);

      if (!employeeId) return sendApiError(res, 400, "TADA_EMPLOYEE_REQUIRED", "employeeId is required");
      if (!travelDate) return sendApiError(res, 400, "TADA_TRAVEL_DATE_REQUIRED", "travelDate is required");
      if (!returnDate) return sendApiError(res, 400, "TADA_RETURN_DATE_REQUIRED", "returnDate is required");
      if (travelDate > returnDate) return sendApiError(res, 400, "TADA_DATES_INVALID", "travelDate must be <= returnDate");
      if (!purpose) return sendApiError(res, 400, "TADA_PURPOSE_REQUIRED", "purpose is required");
      if (!Number.isFinite(amount) || amount < 0) return sendApiError(res, 400, "TADA_AMOUNT_INVALID", "amount must be >= 0");
      if (!["A", "B"].includes(cityCategoryRaw)) {
        return sendApiError(res, 400, "TADA_CITY_CATEGORY_INVALID", "cityCategory must be A or B");
      }
      if (!Number.isFinite(days) || days < 1 || days > 60) {
        return sendApiError(res, 400, "TADA_DAYS_INVALID", "days must be between 1 and 60");
      }
      if (hotelAmount != null && (!Number.isFinite(hotelAmount) || hotelAmount < 0)) {
        return sendApiError(res, 400, "TADA_HOTEL_AMOUNT_INVALID", "hotelAmount must be >= 0");
      }

      if (!tourProgrammeId) {
        return sendApiError(res, 400, "TADA_TOUR_REQUIRED", "Approved tour programme is required before bill submission.");
      }
      const [tour] = await db.select().from(tourProgrammes).where(eq(tourProgrammes.id, tourProgrammeId)).limit(1);
      if (!tour || tour.employeeId !== employeeId) {
        return sendApiError(res, 400, "TADA_TOUR_NOT_FOUND", "Tour programme not found for this employee.");
      }
      if (tour.status !== "Approved") {
        return sendApiError(res, 400, "TADA_TOUR_NOT_APPROVED", "Tour programme must be Approved before submitting TA/DA claim.");
      }
      const existingBill = await db
        .select({ id: taDaClaims.id, status: taDaClaims.status })
        .from(taDaClaims)
        .where(eq(taDaClaims.tourProgrammeId, tourProgrammeId));
      if (existingBill.some((b) => String(b.status) === "Approved")) {
        return sendApiError(res, 400, "TADA_TOUR_ALREADY_BILLED", "An approved TA/DA bill already exists for this tour programme.");
      }

      const today = new Date().toISOString().slice(0, 10);
      const daysSinceReturn = Math.floor(
        (new Date(`${today}T12:00:00.000Z`).getTime() - new Date(`${returnDate}T12:00:00.000Z`).getTime()) / 86400000,
      );
      if (daysSinceReturn >= 61) {
        return sendApiError(
          res,
          400,
          "TADA_LATE_BLOCKED",
          "Bill submission after 60 days is blocked; requires DA override.",
          { daysSinceReturn },
        );
      }

      const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!emp) return sendApiError(res, 400, "TADA_EMPLOYEE_NOT_FOUND", "Employee not found");
      const payLevel = emp.payLevel != null ? Number(emp.payLevel) : null;
      if (!payLevel || !Number.isFinite(payLevel)) {
        return sendApiError(res, 400, "TADA_PAY_LEVEL_MISSING", "Employee pay level is required for TA/DA entitlement calculation.");
      }

      const cfg = await getMergedSystemConfig();
      let entitlementRows: unknown[] = [];
      try {
        const v = JSON.parse(cfg.ta_da_entitlement_json ?? "[]") as unknown;
        entitlementRows = Array.isArray(v) ? v : [];
      } catch {
        entitlementRows = [];
      }
      type EntRow = { payLevel?: string; trainClass?: string; daA?: number; daB?: number; hotelA?: number; hotelB?: number };
      const matchPayLevel = (spec: string | undefined, pl: number): boolean => {
        const s = String(spec ?? "").trim();
        if (!s) return false;
        if (s.includes("+")) {
          const min = Number(s.replace("+", "").trim());
          return Number.isFinite(min) ? pl >= min : false;
        }
        if (s.includes("-")) {
          const [a, b] = s.split("-").map((x) => Number(x.trim()));
          return Number.isFinite(a) && Number.isFinite(b) ? pl >= a && pl <= b : false;
        }
        const n = Number(s);
        return Number.isFinite(n) ? pl === n : false;
      };
      const ent = (entitlementRows as EntRow[]).find((r) => matchPayLevel(r.payLevel, payLevel));
      if (!ent) {
        return sendApiError(res, 400, "TADA_ENTITLEMENT_NOT_CONFIGURED", "No TA/DA entitlement row found for this pay level.");
      }
      const daPerDay = cityCategoryRaw === "A" ? Number(ent.daA ?? 0) : Number(ent.daB ?? 0);
      const hotelPerDay = cityCategoryRaw === "A" ? Number(ent.hotelA ?? 0) : Number(ent.hotelB ?? 0);
      const entitledDa = Math.max(0, daPerDay) * days;
      const maxHotel = Math.max(0, hotelPerDay) * days;
      const entitledHotel = Math.min(hotelAmount ?? 0, maxHotel);
      const entitledTotal = entitledDa + entitledHotel;

      if (amount - 1e-9 > entitledTotal) {
        return sendApiError(
          res,
          400,
          "TADA_AMOUNT_EXCEEDS_ENTITLEMENT",
          "Claimed amount exceeds entitlement as per configured TA/DA matrix.",
          { entitledTotal },
        );
      }
      const id = nanoid();
      await db.insert(taDaClaims).values({
        id,
        employeeId,
        tourProgrammeId,
        travelDate,
        returnDate,
        purpose,
        amount,
        payLevelSnapshot: payLevel,
        cityCategory: cityCategoryRaw,
        days,
        hotelAmount,
        entitledTrainClass: ent.trainClass ? String(ent.trainClass) : null,
        entitledDaPerDay: daPerDay,
        entitledHotelPerDay: hotelPerDay,
        entitledTotal,
        daOverrideLateSubmission: false,
        status: "Pending",
        doUser: req.user?.id ?? null,
        dvUser: null,
        approvedBy: null,
        rejectionReasonCode: null,
        rejectionRemarks: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
      });
      const [row] = await db.select().from(taDaClaims).where(eq(taDaClaims.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create TA/DA claim");
    }
  });

  app.put("/api/hr/claims/tada/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(taDaClaims).where(eq(taDaClaims.id, id));
      if (!existing) {
        return sendApiError(res, 404, "TADA_CLAIM_NOT_FOUND", "TA/DA claim not found");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionTaDaClaim(req.user, existing.status, newStatus) : null;

      let claimRejection: { code: string; remarks: string } | null = null;
      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "TADA_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${existing.status} to ${newStatus}. DV verifies; DA approves or rejects.`,
          );
        }
        const segRec = {
          doUser: existing.doUser,
          dvUser: existing.dvUser,
          daUser: null as string | null,
        };
        if (transition.setDvUser) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDvUser: true });
          if (!seg.ok) return sendApiError(res, 403, "TADA_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (transition.setApprovedBy) {
          const seg = assertSegregationDoDvDa(req.user, segRec, { setDaUser: true });
          if (!seg.ok) return sendApiError(res, 403, "TADA_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (transition.setApprovedBy && req.user?.id) {
          const [emp] = await db.select().from(employees).where(eq(employees.id, existing.employeeId)).limit(1);
          if (emp?.userId === req.user.id) {
            return sendApiError(
              res,
              403,
              "TADA_SELF_APPROVE_REJECT_DENIED",
              "You cannot approve or reject your own TA/DA claim.",
            );
          }
        }
        if (newStatus === "Rejected") {
          const rej = validateDaRejection(body as Record<string, unknown>);
          if (!rej.ok) return sendApiError(res, 400, "TADA_DA_REJECTION_INVALID", rej.error);
          claimRejection = { code: rej.code, remarks: rej.remarks };
        }
        if (existing.status === "Verified" && newStatus === "Pending") {
          const ret = validateDvReturnToDraft(body as Record<string, unknown>);
          if (!ret.ok) return sendApiError(res, 400, "TADA_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
      } else {
        if (["Approved", "Rejected"].includes(existing.status)) {
          return sendApiError(res, 403, "TADA_TERMINAL_NO_EDIT", "Approved or rejected TA/DA claims cannot be edited");
        }
        if (existing.status !== "Pending") {
          return sendApiError(res, 403, "TADA_EDIT_DENIED", "Only pending TA/DA claims can be edited");
        }
        if (!canCreateTaDaClaim(req.user)) {
          return sendApiError(res, 403, "TADA_EDIT_DENIED", "Only Data Originator or Admin can edit a pending TA/DA claim");
        }
      }

      const updates: Record<string, unknown> = {};
      if (body.status !== undefined) updates.status = body.status;
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setApprovedBy) updates.approvedBy = req.user?.id ?? null;
      if (statusChange && newStatus === "Approved" && (body as Record<string, unknown>).daOverrideLateSubmission !== undefined) {
        updates.daOverrideLateSubmission = Boolean((body as Record<string, unknown>).daOverrideLateSubmission);
      }
      if (dvReturnRemarks !== null) {
        updates.dvReturnRemarks = dvReturnRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
        updates.dvUser = null;
        updates.approvedBy = null;
      }
      if (claimRejection) {
        updates.rejectionReasonCode = claimRejection.code;
        updates.rejectionRemarks = claimRejection.remarks;
      }
      if (statusChange && newStatus === "Approved") {
        updates.rejectionReasonCode = null;
        updates.rejectionRemarks = null;
      }
      ["travelDate", "returnDate", "purpose", "amount", "tourProgrammeId"].forEach((k) => {
        if (body[k] !== undefined) {
          updates[k] = k === "amount" ? Number(body[k]) : String(body[k]);
        }
      });
      ["cityCategory", "days", "hotelAmount"].forEach((k) => {
        if ((body as Record<string, unknown>)[k] !== undefined) {
          const v = (body as Record<string, unknown>)[k];
          if (k === "days") updates.days = v == null || v === "" ? null : Number(v);
          else if (k === "hotelAmount") updates.hotelAmount = v == null || v === "" ? null : Number(v);
          else updates.cityCategory = v == null || v === "" ? null : String(v).toUpperCase();
        }
      });

      // Recompute entitlement when editable fields change (Pending edit only).
      if (!statusChange && existing.status === "Pending") {
        const effCity = String((updates.cityCategory as string | undefined) ?? existing.cityCategory ?? "").trim().toUpperCase();
        const effDays = Number((updates.days as number | undefined) ?? existing.days ?? 0);
        const effHotel = updates.hotelAmount !== undefined ? (updates.hotelAmount as number | null) : (existing.hotelAmount as number | null);
        const effAmount = Number((updates.amount as number | undefined) ?? existing.amount ?? 0);

        if (!["A", "B"].includes(effCity)) return sendApiError(res, 400, "TADA_CITY_CATEGORY_INVALID", "cityCategory must be A or B");
        if (!Number.isFinite(effDays) || effDays < 1 || effDays > 60) return sendApiError(res, 400, "TADA_DAYS_INVALID", "days must be between 1 and 60");
        if (effHotel != null && (!Number.isFinite(effHotel) || effHotel < 0)) return sendApiError(res, 400, "TADA_HOTEL_AMOUNT_INVALID", "hotelAmount must be >= 0");
        if (!Number.isFinite(effAmount) || effAmount < 0) return sendApiError(res, 400, "TADA_AMOUNT_INVALID", "amount must be >= 0");

        const [emp] = await db.select().from(employees).where(eq(employees.id, existing.employeeId)).limit(1);
        const payLevel = emp?.payLevel != null ? Number(emp.payLevel) : null;
        if (!payLevel || !Number.isFinite(payLevel)) {
          return sendApiError(res, 400, "TADA_PAY_LEVEL_MISSING", "Employee pay level is required for TA/DA entitlement calculation.");
        }

        const cfg = await getMergedSystemConfig();
        let entitlementRows: unknown[] = [];
        try {
          const v = JSON.parse(cfg.ta_da_entitlement_json ?? "[]") as unknown;
          entitlementRows = Array.isArray(v) ? v : [];
        } catch {
          entitlementRows = [];
        }
        type EntRow = { payLevel?: string; trainClass?: string; daA?: number; daB?: number; hotelA?: number; hotelB?: number };
        const matchPayLevel = (spec: string | undefined, pl: number): boolean => {
          const s = String(spec ?? "").trim();
          if (!s) return false;
          if (s.includes("+")) {
            const min = Number(s.replace("+", "").trim());
            return Number.isFinite(min) ? pl >= min : false;
          }
          if (s.includes("-")) {
            const [a, b] = s.split("-").map((x) => Number(x.trim()));
            return Number.isFinite(a) && Number.isFinite(b) ? pl >= a && pl <= b : false;
          }
          const n = Number(s);
          return Number.isFinite(n) ? pl === n : false;
        };
        const ent = (entitlementRows as EntRow[]).find((r) => matchPayLevel(r.payLevel, payLevel));
        if (!ent) {
          return sendApiError(res, 400, "TADA_ENTITLEMENT_NOT_CONFIGURED", "No TA/DA entitlement row found for this pay level.");
        }
        const daPerDay = effCity === "A" ? Number(ent.daA ?? 0) : Number(ent.daB ?? 0);
        const hotelPerDay = effCity === "A" ? Number(ent.hotelA ?? 0) : Number(ent.hotelB ?? 0);
        const entitledDa = Math.max(0, daPerDay) * effDays;
        const maxHotel = Math.max(0, hotelPerDay) * effDays;
        const entitledHotel = Math.min(effHotel ?? 0, maxHotel);
        const entitledTotal = entitledDa + entitledHotel;
        if (effAmount - 1e-9 > entitledTotal) {
          return sendApiError(
            res,
            400,
            "TADA_AMOUNT_EXCEEDS_ENTITLEMENT",
            "Claimed amount exceeds entitlement as per configured TA/DA matrix.",
            { entitledTotal },
          );
        }
        updates.payLevelSnapshot = payLevel;
        updates.entitledTrainClass = ent.trainClass ? String(ent.trainClass) : null;
        updates.entitledDaPerDay = daPerDay;
        updates.entitledHotelPerDay = hotelPerDay;
        updates.entitledTotal = entitledTotal;
      }
      await db.update(taDaClaims).set(updates as Record<string, string | number | null>).where(eq(taDaClaims.id, id));
      const [row] = await db.select().from(taDaClaims).where(eq(taDaClaims.id, id));
      if (!row) return sendApiError(res, 404, "TADA_CLAIM_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update TA/DA claim");
    }
  });

  // ----- Service book entries (read + create; immutable after DA) -----
  app.get("/api/hr/employees/:employeeId/service-book", async (req, res) => {
    try {
      const list = await db
        .select()
        .from(serviceBookEntries)
        .where(eq(serviceBookEntries.employeeId, req.params.employeeId))
        .orderBy(desc(serviceBookEntries.approvedAt));

      const userIds = [
        ...new Set(
          list
            .flatMap((e) => [e.dvUser, e.approvedBy, e.doUser])
            .filter((id): id is string => Boolean(id && String(id).trim())),
        ),
      ];
      const userRows =
        userIds.length === 0
          ? []
          : await db
              .select({ id: users.id, name: users.name, employeeId: users.employeeId })
              .from(users)
              .where(inArray(users.id, userIds));
      const empIds = [...new Set(userRows.map((u) => u.employeeId).filter((id): id is string => Boolean(id)))];
      const empRows =
        empIds.length === 0
          ? []
          : await db
              .select({
                id: employees.id,
                firstName: employees.firstName,
                middleName: employees.middleName,
                surname: employees.surname,
              })
              .from(employees)
              .where(inArray(employees.id, empIds));
      const empNameById = new Map(
        empRows.map((e) => [
          e.id,
          [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
        ]),
      );
      const displayByUserId = new Map<string, string>();
      for (const u of userRows) {
        const fromEmp = u.employeeId ? empNameById.get(u.employeeId) : "";
        displayByUserId.set(u.id, (fromEmp && fromEmp.trim()) || u.name || u.id);
      }

      res.json(
        list.map((e) => ({
          ...e,
          verifiedByName: e.dvUser ? displayByUserId.get(e.dvUser) ?? null : null,
          approvedByName: e.approvedBy ? displayByUserId.get(e.approvedBy) ?? null : null,
        })),
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch service book");
    }
  });

  app.post("/api/hr/employees/:employeeId/service-book", async (req, res) => {
    try {
      if (!canCreateServiceBookEntry(req.user)) {
        return sendApiError(res, 403, "HR_SERVICE_BOOK_CREATE_DENIED", "Only Data Originator or Admin can create service book entries");
      }
      const employeeId = req.params.employeeId;
      const body = req.body;
      const id = nanoid();
      await db.insert(serviceBookEntries).values({
        id,
        employeeId,
        section: String(body.section ?? "History"),
        content: typeof body.content === "object" ? body.content : {},
        isImmutable: false,
        status: "Pending",
        doUser: req.user?.id ?? null,
        dvUser: null,
        approvedBy: null,
        approvedAt: null,
        rejectionReasonCode: null,
        rejectionRemarks: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
      });
      const [row] = await db.select().from(serviceBookEntries).where(eq(serviceBookEntries.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create service book entry");
    }
  });

  app.put("/api/hr/employees/:employeeId/service-book/:entryId", async (req, res) => {
    try {
      const { employeeId, entryId } = req.params;
      const [existing] = await db.select().from(serviceBookEntries).where(eq(serviceBookEntries.id, entryId)).limit(1);
      if (!existing || existing.employeeId !== employeeId) {
        return sendApiError(res, 404, "HR_SERVICE_BOOK_NOT_FOUND", "Service book entry not found");
      }
      if (existing.isImmutable || existing.status === "Approved") {
        return sendApiError(
          res,
          403,
          "HR_SERVICE_BOOK_IMMUTABLE",
          "Approved or locked service book entries cannot be updated",
        );
      }
      const body = req.body;
      // Append-only: do not allow changing section/content after creation. Only allow workflow status transitions.
      if (body.section !== undefined || body.content !== undefined) {
        return sendApiError(res, 403, "HR_SERVICE_BOOK_APPEND_ONLY", "Service book entries are append-only; create a new entry instead of editing.");
      }
      const newStatus = body.status != null ? String(body.status) : "";
      if (!newStatus) {
        return sendApiError(res, 400, "HR_SERVICE_BOOK_STATUS_REQUIRED", "status is required for workflow transition");
      }
      const wf = canTransitionServiceBookEntry(req.user, String(existing.status), newStatus);
      if (!wf.allowed) {
        return sendApiError(res, 403, "HR_SERVICE_BOOK_TRANSITION_DENIED", "You cannot perform this workflow action.");
      }
      const seg = assertSegregationDoDvDa(req.user, { doUser: existing.doUser, dvUser: existing.dvUser, daUser: existing.approvedBy }, { setDvUser: wf.setDvUser, setDaUser: wf.setApprovedBy });
      if (!seg.ok) {
        return sendApiError(res, 403, "HR_SERVICE_BOOK_SEGREGATION", seg.error);
      }
      const updates: Record<string, unknown> = {
        status: newStatus,
        ...(wf.setDvUser ? { dvUser: req.user!.id } : {}),
        ...(wf.setApprovedBy ? { approvedBy: req.user!.id, approvedAt: now(), isImmutable: newStatus === "Approved" } : {}),
      };
      // DV return to Pending requires remarks
      if (String(existing.status) === "Verified" && newStatus === "Pending") {
        const vd = validateDvReturnToDraft(body as Record<string, unknown>);
        if (!vd.ok) return sendApiError(res, 400, "HR_SERVICE_BOOK_RETURN_REMARKS", vd.error);
        updates.dvReturnRemarks = vd.remarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
      }
      // DA rejection requires reason + remarks
      if (String(existing.status) === "Verified" && newStatus === "Rejected") {
        const vr = validateDaRejection(body as Record<string, unknown>);
        if (!vr.ok) return sendApiError(res, 400, "HR_SERVICE_BOOK_REJECT_FIELDS", vr.error);
        updates.rejectionReasonCode = vr.code;
        updates.rejectionRemarks = vr.remarks;
      }

      await db.update(serviceBookEntries).set(updates as Record<string, unknown>).where(eq(serviceBookEntries.id, entryId));
      const [row] = await db.select().from(serviceBookEntries).where(eq(serviceBookEntries.id, entryId)).limit(1);
      if (!row) return sendApiError(res, 404, "HR_SERVICE_BOOK_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "HR", action: "Update", recordId: entryId, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update service book entry");
    }
  });

  app.get("/api/hr/leaves/:id/application-form", async (req, res) => {
    try {
      if (!requireLeaveRead(req, res)) return;
      const { id } = req.params;
      const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      if (!lr) return sendApiError(res, 404, "LEAVE_NOT_FOUND", "Leave request not found");
      const isAdmin = Boolean(req.user?.roles?.some((r) => String(r.tier) === "ADMIN"));
      const selfEmployeeId = req.user?.employeeId ? String(req.user.employeeId).trim() : "";
      if (!isAdmin && lr.employeeId !== selfEmployeeId) {
        const index = await loadLeaveReportingEmployeeIndex();
        if (!selfEmployeeId || !leaveEmployeeInOfficerScope(lr.employeeId, selfEmployeeId, index)) {
          return sendApiError(
            res,
            403,
            "LEAVE_ACCESS_DENIED",
            "You can only access leave applications within your reporting hierarchy.",
          );
        }
      }
      if (["Cancelled"].includes(String(lr.status))) {
        return sendApiError(res, 400, "LEAVE_CANCELLED", "Cannot print application for a cancelled leave.");
      }
      const { generateLeaveApplicationPdf } = await import("./hr-leave-application-pdf");
      const { buffer, leaveType, layout } = await generateLeaveApplicationPdf(id);
      const kind = layout === "short" ? "Short_Application" : "Form1_Application";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${kind}_${leaveType}_${id}.pdf"`,
      );
      res.send(buffer);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to generate application form";
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // REJOINING / DUTY RESUMPTION + JOINING REPORT
  // ═══════════════════════════════════════════════════════════════════════

  app.post("/api/hr/leaves/:id/rejoin", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Update") && !hasPermission(req.user, "M-01", "Create")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Create or Update required", {
          required: "M-01:Create or M-01:Update",
        });
      }
      const { id } = req.params;
      const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      if (!lr) return sendApiError(res, 404, "LEAVE_NOT_FOUND", "Leave request not found");
      if (lr.status !== "Approved") {
        return sendApiError(res, 400, "LEAVE_NOT_APPROVED", "Only approved leave can record rejoining.");
      }
      const isAdmin = (req.user.roles ?? []).some((r) => r.tier === "ADMIN");
      if (!isAdmin && req.user.employeeId && lr.employeeId !== req.user.employeeId) {
        return sendApiError(res, 403, "LEAVE_REJOIN_DENIED", "You can only record rejoining for your own leave.");
      }

      const body = req.body as Record<string, unknown>;
      const rejoiningDate = String(body.rejoiningDate ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rejoiningDate)) {
        return sendApiError(res, 400, "LEAVE_REJOIN_DATE", "rejoiningDate (YYYY-MM-DD) is required.");
      }
      const joiningReportScanUrl =
        body.joiningReportScanUrl != null && String(body.joiningReportScanUrl).trim() !== ""
          ? String(body.joiningReportScanUrl).trim()
          : null;
      const fitnessCertUrl =
        body.fitnessCertUrl != null && String(body.fitnessCertUrl).trim() !== ""
          ? String(body.fitnessCertUrl).trim()
          : null;

      const wasFirstRejoin = !lr.rejoiningDate;
      const ts = now();
      await db
        .update(leaveRequests)
        .set({
          rejoiningDate,
          rejoiningReportedAt: ts,
          rejoiningReportedBy: req.user.id,
          joiningReportScanUrl: joiningReportScanUrl ?? lr.joiningReportScanUrl,
          fitnessCertUrl: fitnessCertUrl ?? lr.fitnessCertUrl,
          joiningReportPdfUrl: `/api/hr/leaves/${id}/joining-report`,
        })
        .where(eq(leaveRequests.id, id));

      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      if (row) {
        writeAuditLog(req, { module: "HR", action: "LeaveRejoin", recordId: id, beforeValue: lr, afterValue: row }).catch(
          (e) => console.error("Audit log failed:", e),
        );
        if (wasFirstRejoin) {
          void appendLeaveServiceBookEntry(row, req.user.id, "leave_rejoining").catch((e) =>
            console.error("Service book rejoining entry failed:", e),
          );
        }
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to record rejoining");
    }
  });

  /** DV/Admin: acknowledge that signed Joining Report (hard copy / scan) was received. */
  app.post("/api/hr/leaves/:id/joining-report-ack", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const isDvOrAdmin = (req.user.roles ?? []).some((r) => ["DV", "DA", "ADMIN"].includes(String(r.tier)));
      if (!isDvOrAdmin || !hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "LEAVE_JOINING_ACK_DENIED", "Only DV/DA/Admin with M-01 Update can acknowledge Joining Report.");
      }
      const { id } = req.params;
      const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      if (!lr) return sendApiError(res, 404, "LEAVE_NOT_FOUND", "Leave request not found");
      if (lr.status !== "Approved") {
        return sendApiError(res, 400, "LEAVE_NOT_APPROVED", "Only approved leave can have Joining Report acknowledgment.");
      }
      if (!lr.rejoiningDate) {
        return sendApiError(res, 400, "LEAVE_REJOIN_REQUIRED", "Employee must record rejoining date before acknowledgment.");
      }
      const remarks =
        req.body?.remarks != null && String(req.body.remarks).trim() !== "" ? String(req.body.remarks).trim() : null;
      const ts = now();
      await db
        .update(leaveRequests)
        .set({
          joiningReportAckAt: ts,
          joiningReportAckBy: req.user.id,
          joiningReportAckRemarks: remarks,
        })
        .where(eq(leaveRequests.id, id));
      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      if (row) {
        writeAuditLog(req, {
          module: "HR",
          action: "LeaveJoiningReportAck",
          recordId: id,
          beforeValue: lr,
          afterValue: row,
        }).catch((e) => console.error("Audit log failed:", e));
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to acknowledge Joining Report");
    }
  });

  app.get("/api/hr/leaves/:id/joining-report", async (req, res) => {
    try {
      if (!requireLeaveRead(req, res)) return;
      const { id } = req.params;
      const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      if (!lr) return sendApiError(res, 404, "LEAVE_NOT_FOUND", "Leave request not found");
      if (lr.status !== "Approved") {
        return sendApiError(res, 400, "LEAVE_NOT_APPROVED", "Joining Report is only for approved leave");
      }
      if (!lr.rejoiningDate) {
        return sendApiError(res, 400, "LEAVE_REJOIN_DATE_REQUIRED", "Enter rejoining date before generating Joining Report.");
      }
      const { generateJoiningReportPdf } = await import("./hr-leave-joining-report-pdf");
      const { buffer } = await generateJoiningReportPdf(id);
      const blobKey = assertSafeUploadRelativeKey(`leaves/joining-reports/${id}.pdf`);
      const store = getUploadBlobStore();
      await store.put(blobKey, buffer, "application/pdf");
      await db.update(leaveRequests).set({ joiningReportPdfUrl: `/api/hr/leaves/${id}/joining-report` }).where(eq(leaveRequests.id, id));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Joining_Report_${id}.pdf"`);
      res.send(buffer);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to generate joining report";
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SANCTION ORDER PDF (/api/hr/leaves/:id/sanction-order)
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/api/hr/leaves/:id/sanction-order", async (req, res) => {
    try {
      if (!requireLeaveRead(req, res)) return;
      const { id } = req.params;
      const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      if (!lr) return sendApiError(res, 404, "LEAVE_NOT_FOUND", "Leave request not found");
      if (lr.status !== "Approved") {
        return sendApiError(res, 400, "LEAVE_NOT_APPROVED", "Sanction Order can only be generated for approved leaves");
      }
      const blobKey = sanctionOrderBlobKey(id);
      const store = getUploadBlobStore();
      const { generateSanctionOrderPdf } = await import("./hr-leave-sanction-order-pdf");
      const { buffer, fileNo } = await generateSanctionOrderPdf(id);
      await store.put(blobKey, buffer, "application/pdf");
      await db.update(leaveRequests).set({ orderPdfUrl: `/api/hr/leaves/${id}/sanction-order` }).where(eq(leaveRequests.id, id));
      await linkSanctionOrderToEmployeeDocuments(lr.employeeId, id, fileNo, buffer).catch((e) =>
        console.error("Link sanction order to employee documents failed:", e),
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Sanction_Order_${fileNo.replace(/\//g, "_")}.pdf"`);
      res.send(buffer);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error && e.message.trim() ? e.message.trim() : "Failed to generate sanction order";
      const known =
        /not found|not approved|Service Book|required/i.test(msg) && !/internal|ECONN|timeout/i.test(msg);
      sendApiError(res, known ? 400 : 500, known ? "LEAVE_SANCTION_ORDER_FAILED" : "INTERNAL_ERROR", msg);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LEAVE BALANCE STATEMENT PDF
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/api/hr/leave-balance-statement", async (req, res) => {
    try {
      if (!requireLeaveRead(req, res)) return;
      const isAdmin = Boolean(req.user?.roles?.some((r) => String(r.tier) === "ADMIN"));
      const selfEmployeeId = req.user?.employeeId ? String(req.user.employeeId).trim() : "";
      const employeeIds = req.query.employeeIds
        ? String(req.query.employeeIds)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      let targetId = employeeIds[0] ?? "";
      if (!targetId) {
        if (!selfEmployeeId) {
          return sendApiError(res, 400, "EMPLOYEE_REQUIRED", "employeeIds query param is required.");
        }
        targetId = selfEmployeeId;
      }
      if (!isAdmin && targetId !== selfEmployeeId) {
        return sendApiError(
          res,
          403,
          "LEAVE_STATEMENT_DENIED",
          "You can only download your own leave balance statement (Admin may download for any employee).",
        );
      }

      const { generateLeaveBalanceStatementPdf } = await import("./hr-leave-balance-statement-pdf");
      const { buffer, fileName } = await generateLeaveBalanceStatementPdf(targetId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      res.send(buffer);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to generate balance statement";
      sendApiError(res, msg === "Employee not found" ? 404 : 500, "INTERNAL_ERROR", msg);
    }
  });

  /** Organisation Employee Leave Report (sanctioned leave for a date or date range). Admin only. */
  app.get("/api/hr/reports/employee-leave", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const isAdmin = Boolean(req.user.roles?.some((r) => String(r.tier) === "ADMIN"));
      if (!isAdmin) {
        return sendApiError(res, 403, "AUTH_ADMIN_REQUIRED", "Employee Leave Report is available only to Admin.");
      }

      const modeRaw = String(req.query.mode ?? "date").trim().toLowerCase();
      const mode = modeRaw === "range" ? "range" : "date";
      const format = String(req.query.format ?? "json").trim().toLowerCase();
      const {
        buildEmployeeLeaveReport,
        buildEmployeeLeaveReportAoa,
        generateEmployeeLeaveReportPdf,
      } = await import("./hr-employee-leave-report");

      let payload;
      try {
        payload = await buildEmployeeLeaveReport({
          mode,
          date: req.query.date != null ? String(req.query.date) : undefined,
          fromDate: req.query.fromDate != null ? String(req.query.fromDate) : undefined,
          toDate: req.query.toDate != null ? String(req.query.toDate) : undefined,
        });
      } catch (err) {
        return sendApiError(
          res,
          400,
          "LEAVE_REPORT_DATES",
          err instanceof Error ? err.message : "Invalid date criteria",
        );
      }

      if (format === "json") {
        return res.json(payload);
      }

      const stamp =
        mode === "date"
          ? formatLeaveOrderDateDisplay(payload.fromDate).replace(/\//g, "-")
          : `${formatLeaveOrderDateDisplay(payload.fromDate).replace(/\//g, "-")}_to_${formatLeaveOrderDateDisplay(payload.toDate).replace(/\//g, "-")}`;

      if (format === "xlsx" || format === "excel") {
        const XLSX = await import("xlsx");
        const aoa = buildEmployeeLeaveReportAoa(payload);
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [
          { wch: 8 },
          { wch: 12 },
          { wch: 24 },
          { wch: 22 },
          { wch: 24 },
          { wch: 24 },
          { wch: 24 },
          { wch: 18 },
          { wch: 10 },
          { wch: 28 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, "Employee Leave");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Employee_Leave_Report_${stamp}.xlsx"`,
        );
        return res.send(Buffer.from(buf));
      }

      if (format === "pdf") {
        const buffer = await generateEmployeeLeaveReportPdf(payload);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Employee_Leave_Report_${stamp}.pdf"`,
        );
        return res.send(buffer);
      }

      return sendApiError(res, 400, "FORMAT_INVALID", "format must be json, pdf, or xlsx");
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate employee leave report");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SUBSTITUTE PICKER: employees not currently on leave
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/api/hr/leaves/available-substitutes", async (req, res) => {
    try {
      const fromDate = String(req.query.fromDate ?? "");
      const toDate = String(req.query.toDate ?? "");
      if (!fromDate || !toDate) return sendApiError(res, 400, "DATES_REQUIRED", "fromDate and toDate query params required");

      const allActive = await db
        .select({
          id: employees.id,
          empId: employees.empId,
          firstName: employees.firstName,
          surname: employees.surname,
          yardId: employees.yardId,
          locationPosted: employees.locationPosted,
          section: employees.section,
          gender: employees.gender,
          maritalStatus: employees.maritalStatus,
        })
        .from(employees)
        .where(eq(employees.status, "Active"));

      const onLeave = await db.select({ employeeId: leaveRequests.employeeId }).from(leaveRequests).where(
        and(
          lte(leaveRequests.fromDate, toDate),
          gte(leaveRequests.toDate, fromDate),
        )
      );
      const onLeaveFiltered = onLeave.filter((r) => true); // already filtered by date in query
      const onLeaveIds = new Set((await db.select({ employeeId: leaveRequests.employeeId, status: leaveRequests.status }).from(leaveRequests).where(
        and(lte(leaveRequests.fromDate, toDate), gte(leaveRequests.toDate, fromDate))
      )).filter((r) => ["Pending", "Verified", "Approved"].includes(String(r.status))).map((r) => r.employeeId));

      const available = allActive.filter((e) => !onLeaveIds.has(e.id));
      res.json(available);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch available substitutes");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PREFIX/SUFFIX PREVIEW (for UI)
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/api/hr/leaves/prefix-suffix-preview", async (req, res) => {
    try {
      const fromDate = String(req.query.fromDate ?? "");
      const toDate = String(req.query.toDate ?? "");
      const locationType = req.query.locationType ? String(req.query.locationType) : undefined;
      if (!fromDate || !toDate) return sendApiError(res, 400, "DATES_REQUIRED", "fromDate and toDate required");
      const result = await calculatePrefixSuffix(fromDate, toDate, locationType);
      res.json(result);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to compute prefix/suffix");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HOLIDAY MASTER CRUD (/api/hr/holidays)
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/api/hr/holidays", async (req, res) => {
    try {
      const yearParam = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      const rows = await db
        .select()
        .from(hrHolidays)
        .where(eq(hrHolidays.year, yearParam))
        .orderBy(asc(hrHolidays.date));
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch holidays");
    }
  });

  app.post("/api/hr/holidays", async (req, res) => {
    try {
      const body = req.body;
      const date = String(body.date ?? "").trim();
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "").trim();
      if (!date || !name || !category) {
        return sendApiError(res, 400, "HOLIDAY_MISSING_FIELDS", "date, name, and category are required");
      }
      const validCategories = ["Public", "Special", "Restricted", "AdHoc"];
      if (!validCategories.includes(category)) {
        return sendApiError(res, 400, "HOLIDAY_INVALID_CATEGORY", `category must be one of: ${validCategories.join(", ")}`);
      }
      const year = Number(date.slice(0, 4));
      if (!year || year < 2000 || year > 2100) {
        return sendApiError(res, 400, "HOLIDAY_INVALID_DATE", "Invalid date year");
      }
      const id = nanoid();
      const now = new Date().toISOString();
      await db.insert(hrHolidays).values({
        id,
        year,
        date,
        name,
        category,
        isTentative: body.isTentative === true,
        createdAt: now,
        updatedAt: now,
      });
      const [row] = await db.select().from(hrHolidays).where(eq(hrHolidays.id, id)).limit(1);
      writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch(() => {});
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create holiday");
    }
  });

  app.put("/api/hr/holidays/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(hrHolidays).where(eq(hrHolidays.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "HOLIDAY_NOT_FOUND", "Holiday not found");
      const body = req.body;
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (body.date !== undefined) {
        updates.date = String(body.date).trim();
        updates.year = Number(String(body.date).slice(0, 4));
      }
      if (body.name !== undefined) updates.name = String(body.name).trim();
      if (body.category !== undefined) {
        const validCategories = ["Public", "Special", "Restricted", "AdHoc"];
        if (!validCategories.includes(body.category)) {
          return sendApiError(res, 400, "HOLIDAY_INVALID_CATEGORY", `category must be one of: ${validCategories.join(", ")}`);
        }
        updates.category = body.category;
      }
      if (body.isTentative !== undefined) updates.isTentative = body.isTentative === true;
      await db.update(hrHolidays).set(updates).where(eq(hrHolidays.id, id));
      const [row] = await db.select().from(hrHolidays).where(eq(hrHolidays.id, id)).limit(1);
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch(() => {});
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update holiday");
    }
  });

  app.delete("/api/hr/holidays/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(hrHolidays).where(eq(hrHolidays.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "HOLIDAY_NOT_FOUND", "Holiday not found");
      await db.delete(hrHolidays).where(eq(hrHolidays.id, id));
      writeAuditLog(req, { module: "HR", action: "Delete", recordId: id, beforeValue: existing }).catch(() => {});
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete holiday");
    }
  });

  // Bulk import holidays (for seeding from GAD notification)
  app.post("/api/hr/holidays/bulk", async (req, res) => {
    try {
      const { holidays } = req.body;
      if (!Array.isArray(holidays) || holidays.length === 0) {
        return sendApiError(res, 400, "HOLIDAY_BULK_EMPTY", "holidays array is required");
      }
      const now = new Date().toISOString();
      const rows = holidays.map((h: { date: string; name: string; category: string; isTentative?: boolean }) => ({
        id: nanoid(),
        year: Number(String(h.date).slice(0, 4)),
        date: String(h.date).trim(),
        name: String(h.name).trim(),
        category: String(h.category).trim(),
        isTentative: h.isTentative === true,
        createdAt: now,
        updatedAt: now,
      }));
      await db.insert(hrHolidays).values(rows);
      writeAuditLog(req, { module: "HR", action: "Create", recordId: `bulk-${rows.length}` }).catch(() => {});
      res.status(201).json({ inserted: rows.length });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to bulk import holidays");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LEAVE BALANCE IMPORT (JSON + CSV)
  // ═══════════════════════════════════════════════════════════════════════

  function csvEscapeCell(cell: string | number | null | undefined): string {
    const s = cell == null ? "" : String(cell);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function employeeDisplayName(e: {
    firstName: string;
    middleName: string | null;
    surname: string;
  }): string {
    return [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  /** Download CSV template: all Active employees with empId + name; leave columns blank to fill. */
  app.get("/api/hr/leave-balances/import-template.csv", async (req, res) => {
    try {
      if (!requireLeaveRead(req, res)) return;
      const emps = await db
        .select({
          empId: employees.empId,
          id: employees.id,
          firstName: employees.firstName,
          middleName: employees.middleName,
          surname: employees.surname,
        })
        .from(employees)
        .where(eq(employees.status, "Active"))
        .orderBy(asc(employees.empId), asc(employees.surname), asc(employees.firstName));

      const headers = [
        "employeeId",
        "employeeName",
        "leaveType",
        "balanceDays",
        "setOffDays",
        "setOffExpiryDate",
      ];
      const lines = [headers.map(csvEscapeCell).join(",")];
      for (const e of emps) {
        const code = (e.empId && String(e.empId).trim()) || e.id;
        lines.push(
          [code, employeeDisplayName(e), "", "", "", ""].map(csvEscapeCell).join(","),
        );
      }

      const body = "\uFEFF" + lines.join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="leave_opening_balances_template.csv"`,
      );
      res.send(body);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to export leave balance CSV template");
    }
  });

  const leaveBalanceCsvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  function multerLeaveBalanceCsv(req: Request, res: Response, next: () => void): void {
    leaveBalanceCsvUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        sendApiError(res, 400, "BALANCE_IMPORT_CSV_UPLOAD", "CSV upload failed (max 5 MB)");
        return;
      }
      next();
    });
  }

  app.post("/api/hr/leave-balances/import-csv", multerLeaveBalanceCsv, async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Update required to import leave balances", {
          required: "M-01:Update",
        });
      }

      const file = req.file as Express.Multer.File | undefined;
      const cutoverDate =
        typeof req.body?.cutoverDate === "string" ? req.body.cutoverDate : null;
      let csvText = "";
      if (file?.buffer) {
        csvText = file.buffer.toString("utf8");
      } else if (typeof req.body?.csv === "string") {
        csvText = req.body.csv;
      }
      if (!csvText.trim()) {
        return sendApiError(
          res,
          400,
          "BALANCE_IMPORT_EMPTY",
          "Upload a CSV file (field name: file) or send { csv: \"...\" }",
        );
      }

      const { rows, parseErrors } = parseLeaveBalanceImportCsv(csvText);
      if (parseErrors.length && rows.length === 0) {
        return sendApiError(res, 400, "BALANCE_IMPORT_CSV_PARSE", parseErrors.join("; "), {
          parseErrors,
        });
      }

      const { upserted, skipped } = await upsertLeaveBalanceImportRows(rows);

      if (upserted === 0 && (skipped.length > 0 || parseErrors.length > 0)) {
        return sendApiError(res, 400, "BALANCE_IMPORT_NO_MATCH", "No rows imported — check CSV values", {
          skipped,
          parseErrors,
        });
      }

      writeAuditLog(req, {
        module: "HR",
        action: "Create",
        recordId: `balance-import-csv-${upserted}`,
        afterValue: {
          upserted,
          skippedCount: skipped.length,
          parseErrorCount: parseErrors.length,
          cutoverDate,
          source: "csv",
        },
      }).catch(() => {});
      res.json({ upserted, skipped, parseErrors, cutoverDate });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to import leave balances from CSV");
    }
  });

  app.post("/api/hr/leave-balances/import", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Update required to import leave balances", {
          required: "M-01:Update",
        });
      }
      const { balances, cutoverDate } = req.body;
      if (!Array.isArray(balances) || balances.length === 0) {
        return sendApiError(res, 400, "BALANCE_IMPORT_EMPTY", "balances array is required");
      }

      const { upserted, skipped } = await upsertLeaveBalanceImportRows(balances);

      if (upserted === 0 && skipped.length > 0) {
        return sendApiError(res, 400, "BALANCE_IMPORT_NO_MATCH", "No rows imported — check employeeId values", {
          skipped,
        });
      }

      writeAuditLog(req, {
        module: "HR",
        action: "Create",
        recordId: `balance-import-${upserted}`,
        afterValue: { upserted, skippedCount: skipped.length, cutoverDate: cutoverDate ?? null, source: "json" },
      }).catch(() => {});
      res.json({ upserted, skipped, cutoverDate: cutoverDate ?? null });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to import leave balances");
    }
  });
}
