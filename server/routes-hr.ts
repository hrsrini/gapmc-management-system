/**
 * IOMS M-01: HRMS & Service Record API routes.
 * Tables: employees, employee_contracts, recruitment, attendances, timesheets,
 * service_book_entries, leave_requests, ltc_claims, ta_da_claims.
 */
import type { Express, Response, Request } from "express";
import path from "path";
import { eq, desc, or, and, gte, lte, isNotNull } from "drizzle-orm";
import multer from "multer";
import { db } from "./db";
import {
  employees,
  users,
  employeeContracts,
  recruitment,
  attendances,
  timesheets,
  serviceBookEntries,
  leaveRequests,
  employeeLeaveBalances,
  tourProgrammes,
  ltcClaims,
  taDaClaims,
  employeeDocuments,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
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
  isDraftOrSubmitted,
  parseEmployeeMasterSrs411Fields,
} from "./hr-employee-rules";
import { aadhaarFingerprintHmac, maskAadhaar, readAadhaarRawFromRequestBody } from "./aadhaar-fingerprint";
import { inclusiveCalendarDays } from "./hr-leave-utils";

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

const OFFICIAL_EMP_ID_RE = /^EMP-\d{3}$/i;

function hasOfficialEmpId(empId: string | null | undefined): boolean {
  if (empId == null || String(empId).trim() === "") return false;
  return OFFICIAL_EMP_ID_RE.test(String(empId).trim());
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
      const list = yardId
        ? await db.select().from(employees).where(eq(employees.yardId, yardId)).orderBy(desc(employees.createdAt))
        : await db.select().from(employees).orderBy(desc(employees.createdAt));
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
      if (!hasPermission(req.user, "M-10", "Read")) {
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
    if (!hasPermission(req.user, "M-10", "Create")) {
      return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-10:Create" });
    }
    await handleCreateEmployeeLogin(req, res, req.params.id);
  });

  app.put("/api/hr/employees/:id/login", async (req, res) => {
    if (!req.user) {
      return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    }
    if (!hasPermission(req.user, "M-10", "Update")) {
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
      const statusRaw = String(body.status ?? "Draft");
      if (statusRaw !== "Draft" && statusRaw !== "Submitted") {
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
        srs411 = parseEmployeeMasterSrs411Fields({
          locationPosted: body.locationPosted as string | null | undefined,
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

      const payload = {
        id,
        empId: null as string | null,
        firstName: String(body.firstName ?? ""),
        surname: String(body.surname ?? ""),
        designation: String(body.designation ?? ""),
        yardId: String(body.yardId ?? ""),
        employeeType: String(body.employeeType ?? "Regular"),
        joiningDate: String(body.joiningDate ?? ""),
        status: statusRaw,
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
        locationPosted: srs411.locationPosted,
        payLevel: srs411.payLevel,
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
      if (emp.status !== "Submitted") {
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
      try {
        newEmpId = await allocateNextEmpId();
      } catch (e) {
        if (sendHrEmployeeRuleError(res, e)) return;
        throw e;
      }
      await db
        .update(employees)
        .set({ empId: newEmpId, status: "Active", updatedAt: now() })
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

      const updates: Record<string, unknown> = { updatedAt: now() };
      const allowed = [
        "firstName",
        "middleName",
        "surname",
        "photoUrl",
        "designation",
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
        "locationPosted",
        "payLevel",
        "bankAccountNumber",
        "ifscCode",
        "category",
        "fatherOrSpouseName",
      ];
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        if (key === "payLevel") {
          if (body.payLevel === null || (typeof body.payLevel === "string" && String(body.payLevel).trim() === "")) {
            updates.payLevel = null;
          } else {
            updates.payLevel = typeof body.payLevel === "number" ? body.payLevel : String(body.payLevel).trim();
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

      const merged: typeof beforeEmp = { ...beforeEmp };
      for (const k of Object.keys(updates)) {
        if (k === "updatedAt") continue;
        (merged as Record<string, unknown>)[k] = updates[k];
      }
      const newStatus = (updates.status !== undefined ? String(updates.status) : beforeEmp.status) as string;
      if (isDraftOrSubmitted(beforeEmp.status) && newStatus === "Active") {
        return sendApiError(
          res,
          400,
          "HR_EMP_ACTIVE_VIA_APPROVE",
          "Cannot set status to Active from Draft/Submitted here. Use Approve registration (DA) to assign EMP-ID and activate.",
        );
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

      const terminalStatuses = ["Inactive", "Retired", "Suspended", "Resigned"];
      await db.transaction(async (tx) => {
        await tx.update(employees).set(setPayload).where(eq(employees.id, id));
        const [after] = await tx
          .select({ status: employees.status, userId: employees.userId })
          .from(employees)
          .where(eq(employees.id, id))
          .limit(1);
        if (after?.status && terminalStatuses.includes(after.status)) {
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
  app.get("/api/hr/leave-balances", async (_req, res) => {
    try {
      const rows = await db.select().from(employeeLeaveBalances).orderBy(desc(employeeLeaveBalances.updatedAt));
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch leave balances");
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
      const normalized: { employeeId: string; leaveType: string; balanceDays: number }[] = [];
      for (const r of rows) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        const employeeId = String(o.employeeId ?? "").trim();
        const leaveType = String(o.leaveType ?? "").trim();
        const balanceDays = Number(o.balanceDays);
        if (!employeeId || !leaveType || !Number.isFinite(balanceDays) || balanceDays < 0) {
          return sendApiError(res, 400, "HR_LEAVE_BALANCE_ROW_INVALID", "Each row needs employeeId, leaveType, and balanceDays >= 0.");
        }
        normalized.push({ employeeId, leaveType, balanceDays });
      }
      for (const r of normalized) {
        const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, r.employeeId)).limit(1);
        if (!emp) {
          return sendApiError(res, 400, "HR_LEAVE_BALANCE_EMP_NOT_FOUND", `Unknown employeeId ${r.employeeId}`);
        }
        const [existing] = await db
          .select()
          .from(employeeLeaveBalances)
          .where(and(eq(employeeLeaveBalances.employeeId, r.employeeId), eq(employeeLeaveBalances.leaveType, r.leaveType)))
          .limit(1);
        if (existing) {
          await db
            .update(employeeLeaveBalances)
            .set({ balanceDays: r.balanceDays, updatedAt: now() })
            .where(eq(employeeLeaveBalances.id, existing.id));
        } else {
          await db.insert(employeeLeaveBalances).values({
            id: nanoid(),
            employeeId: r.employeeId,
            leaveType: r.leaveType,
            balanceDays: r.balanceDays,
            updatedAt: now(),
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

  // ----- Leave requests -----
  app.get("/api/hr/leaves", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const pendingMyAction =
        req.query.pendingMyAction === "1" || String(req.query.pendingMyAction ?? "").toLowerCase() === "true";
      let list = employeeId
        ? await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(desc(leaveRequests.fromDate))
        : await db.select().from(leaveRequests).orderBy(desc(leaveRequests.fromDate));
      if (pendingMyAction) {
        list = list.filter((row) => leaveRequestAwaitingMyAction(req.user, row));
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
      if (!canCreateLeaveRequest(req.user)) {
        return sendApiError(
          res,
          403,
          "LEAVE_CREATE_DENIED",
          "Only Data Originator or Admin can create leave requests",
        );
      }
      const body = req.body;
      const leaveType = String(body.leaveType ?? "").trim();
      const employeeId = String(body.employeeId ?? "").trim();
      const fromDate = String(body.fromDate ?? "").trim();
      const toDate = String(body.toDate ?? "").trim();
      const isRetrospective = Boolean((body as Record<string, unknown>).isRetrospective);

      if (!employeeId) return sendApiError(res, 400, "LEAVE_EMPLOYEE_REQUIRED", "employeeId is required");
      if (!fromDate || !toDate) return sendApiError(res, 400, "LEAVE_DATES_REQUIRED", "fromDate and toDate are required");
      if (fromDate > toDate) return sendApiError(res, 400, "LEAVE_DATES_INVALID", "fromDate must be <= toDate");

      // BR-LVE-03: CL max 3 consecutive days per application.
      if (leaveType.toUpperCase() === "CL") {
        const days = inclusiveCalendarDays(fromDate, toDate);
        if (days > 3) {
          return sendApiError(res, 400, "E_LVE_004", "CL max 3 consecutive days per application.");
        }
      }

      // BR-LVE-01: block holidays overlap (config-driven).
      const cfg = await getMergedSystemConfig();
      let holidays: string[] = [];
      try {
        const v = JSON.parse(cfg.leave_holidays_json ?? "[]") as unknown;
        holidays = Array.isArray(v) ? v.map((x) => String(x)) : [];
      } catch {
        holidays = [];
      }
      if (holidays.length > 0) {
        const overlapsHoliday = holidays.some((d) => d >= fromDate && d <= toDate);
        if (overlapsHoliday) {
          return sendApiError(res, 400, "LEAVE_HOLIDAY_OVERLAP", "Leave dates overlap with a configured public holiday.");
        }
      }

      // Retrospective entries are restricted to Admin (HR policy).
      if (isRetrospective && !(req.user?.roles ?? []).some((r: { tier?: string }) => r.tier === "ADMIN")) {
        return sendApiError(res, 403, "LEAVE_RETRO_DENIED", "Only Admin can create retrospective entries");
      }

      // Overlap check: block overlaps with any non-terminal leave (Pending/Verified/Approved).
      const existingForEmp = await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId));
      const activeExisting = existingForEmp.filter((r) => !["Rejected", "Cancelled"].includes(String(r.status)));
      const overlaps = activeExisting.some((r) => {
        const aFrom = String(r.fromDate);
        const aTo = String(r.toDate);
        return fromDate <= aTo && toDate >= aFrom;
      });
      if (overlaps) {
        return sendApiError(
          res,
          400,
          "LEAVE_OVERLAP",
          "Leave dates overlap with an existing leave request (pending/verified/approved).",
        );
      }
      const supportingDocumentUrl =
        body.supportingDocumentUrl != null && String(body.supportingDocumentUrl).trim() !== ""
          ? String(body.supportingDocumentUrl).trim()
          : null;
      // SRS checklist: supporting docs required for certain leave types (ML/CCL).
      if (["ML", "CCL"].includes(leaveType.toUpperCase()) && !supportingDocumentUrl) {
        return sendApiError(
          res,
          400,
          "LEAVE_SUPPORTING_DOC_REQUIRED",
          "Supporting document is required for this leave type.",
          { leaveType },
        );
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
        supportingDocumentUrl:
          supportingDocumentUrl,
        isRetrospective,
        cancelledAt: null,
        cancelledBy: null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        approvedBy: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
      });
      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create leave request");
    }
  });

  app.put("/api/hr/leaves/:id", async (req, res) => {
    try {
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
          // Enforce reporting-officer routing (BR-LVE-11).
          const [emp] = await db.select().from(employees).where(eq(employees.id, existing.employeeId)).limit(1);
          const roId = emp?.reportingOfficerEmployeeId ?? null;
          if (!roId) {
            return sendApiError(res, 400, "LEAVE_REPORTING_OFFICER_MISSING", "Employee reporting officer is not set.");
          }
          const [roEmp] = await db.select().from(employees).where(eq(employees.id, roId)).limit(1);
          const effectiveRoId =
            emp?.id && roEmp?.id && emp.id === roEmp.id
              ? (roEmp.reportingOfficerEmployeeId ?? null)
              : roId;
          if (!effectiveRoId) {
            return sendApiError(res, 400, "LEAVE_REPORTING_CHAIN_MISSING", "Reporting officer's reporting officer is not set.");
          }
          const [effectiveRo] = await db.select().from(employees).where(eq(employees.id, effectiveRoId)).limit(1);
          const expectedDvUserId = effectiveRo?.userId ?? null;
          if (!expectedDvUserId) {
            return sendApiError(res, 400, "LEAVE_REPORTING_USER_MISSING", "Reporting officer has no linked login user.");
          }
          if (req.user?.id !== expectedDvUserId && !(req.user?.roles ?? []).some((r: { tier?: string }) => r.tier === "ADMIN")) {
            return sendApiError(res, 403, "LEAVE_VERIFY_NOT_REPORTING_OFFICER", "Only the employee's reporting officer can verify this leave request.");
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
        if (["Approved", "Rejected", "Cancelled"].includes(existing.status)) {
          return sendApiError(res, 403, "LEAVE_TERMINAL_NO_EDIT", "Approved/rejected/cancelled leave cannot be edited");
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
      if (leaveRejection) {
        updates.rejectionReasonCode = leaveRejection.code;
        updates.rejectionRemarks = leaveRejection.remarks;
      }
      if (statusChange && newStatus === "Approved") {
        updates.rejectionReasonCode = null;
        updates.rejectionRemarks = null;
      }
      ["leaveType", "fromDate", "toDate", "reason", "supportingDocumentUrl"].forEach((k) => {
        if (body[k] !== undefined) {
          updates[k] = body[k] === null || body[k] === "" ? null : String(body[k]);
        }
      });

      if (!statusChange) {
        const effectiveFrom = String((updates.fromDate as string | undefined) ?? existing.fromDate ?? "").trim();
        const effectiveTo = String((updates.toDate as string | undefined) ?? existing.toDate ?? "").trim();
        if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) {
          return sendApiError(res, 400, "LEAVE_DATES_INVALID", "fromDate must be <= toDate");
        }
        const existingForEmp = await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, existing.employeeId));
        const activeExisting = existingForEmp.filter(
          (r) => r.id !== existing.id && !["Rejected", "Cancelled"].includes(String(r.status)),
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
      const effectiveLeaveType = String((updates.leaveType as string | undefined) ?? existing.leaveType ?? "").trim();
      const effectiveDocUrl =
        updates.supportingDocumentUrl !== undefined
          ? (updates.supportingDocumentUrl as string | null)
          : (existing.supportingDocumentUrl as string | null);
      if (["ML", "CCL"].includes(effectiveLeaveType.toUpperCase()) && !effectiveDocUrl) {
        return sendApiError(
          res,
          400,
          "LEAVE_SUPPORTING_DOC_REQUIRED",
          "Supporting document is required for this leave type.",
          { leaveType: effectiveLeaveType },
        );
      }
      try {
        await db.transaction(async (tx) => {
          if (statusChange && newStatus === "Approved" && existing.status === "Verified") {
            const days = inclusiveCalendarDays(existing.fromDate, existing.toDate);
            const [bal] = await tx
              .select()
              .from(employeeLeaveBalances)
              .where(
                and(
                  eq(employeeLeaveBalances.employeeId, existing.employeeId),
                  eq(employeeLeaveBalances.leaveType, existing.leaveType),
                ),
              )
              .limit(1);
            if (bal) {
              if (bal.balanceDays + 1e-9 < days) {
                throw new Error("LEAVE_INSUFFICIENT_BALANCE");
              }
              await tx
                .update(employeeLeaveBalances)
                .set({ balanceDays: bal.balanceDays - days, updatedAt: now() })
                .where(eq(employeeLeaveBalances.id, bal.id));
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
        throw e;
      }
      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (!row) return sendApiError(res, 404, "LEAVE_REQUEST_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
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
      const list = await db.select().from(serviceBookEntries).where(eq(serviceBookEntries.employeeId, req.params.employeeId)).orderBy(desc(serviceBookEntries.approvedAt));
      res.json(list);
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
}
