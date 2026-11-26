/**
 * M-01 Posting & Reporting Officer Update API routes.
 */
import type { Express, Request, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import multer from "multer";
import { nanoid } from "nanoid";
import {
  employees,
  hrPostingUpdateRequests,
  users,
  yards,
} from "@shared/db-schema";
import { parseAdditionalChargeHoldings } from "@shared/hr-additional-charge-locations";
import {
  HO_SECTION_OPTIONS,
  isPostingChangeType,
  POSTING_OPEN_STATUSES,
  validatePostingSubmit,
  type PostingChangeType,
} from "@shared/hr-posting-update";
import { localCalendarYmdUtc } from "@shared/employee-status-effective-date";
import { MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { hasPermission } from "./auth";
import { db } from "./db";
import {
  contentTypeForEmployeeDocument,
  isAllowedEmployeeDocumentFileName,
  readEmployeeDocumentBuffer,
} from "./employee-document-storage";
import {
  allocatePostingUpdateRequestNo,
  applyPostingUpdateOnApproval,
  isHeadOfficeYardRow,
  parseJsonStringArray,
  parseJsonStringMap,
  storePostingOrderCopy,
} from "./hr-posting-update";
import {
  assertSegregationDoDvDa,
  canCreatePostingUpdate,
  canEditPostingUpdate,
  canTransitionPostingUpdate,
  postingUpdateAwaitingMyAction,
} from "./workflow";

const orderCopyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function multerOrderCopy(req: Request, res: Response, next: () => void): void {
  orderCopyUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const e = err as { code?: string; message?: string };
    if (e.code === "LIMIT_FILE_SIZE") {
      return sendApiError(res, 400, "HR_POSTING_ORDER_COPY_TOO_LARGE", "Order copy must be 5 MB or smaller.");
    }
    return sendApiError(res, 400, "HR_POSTING_ORDER_COPY_UPLOAD_FAILED", e.message || "Upload failed");
  });
}

function empHeader(e: {
  id: string;
  empId: string | null;
  firstName: string;
  middleName: string | null;
  surname: string;
  designation: string;
}) {
  const name = [e.firstName, e.middleName, e.surname].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  return {
    id: e.id,
    empId: e.empId,
    name,
    designation: e.designation,
  };
}

async function loadYardMap() {
  const list = await db.select({ id: yards.id, name: yards.name, code: yards.code, type: yards.type }).from(yards);
  return Object.fromEntries(list.map((y) => [y.id, y]));
}

function todayYmd(): string {
  return localCalendarYmdUtc(new Date());
}

export function registerHrPostingUpdateRoutes(app: Express) {
  /** Employee context for the update form (name/id/designation + current posting). */
  app.get("/api/hr/employees/:employeeId/posting-update-context", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Read required", { required: "M-01:Read" });
      }
      const employeeId = String(req.params.employeeId ?? "").trim();
      const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");

      const yardById = await loadYardMap();
      const holdings = parseAdditionalChargeHoldings(emp.locationPosted, emp.yardId);
      let reportingOfficer: { id: string; empId: string | null; name: string; designation: string } | null = null;
      if (emp.reportingOfficerEmployeeId) {
        const [ro] = await db
          .select()
          .from(employees)
          .where(eq(employees.id, emp.reportingOfficerEmployeeId))
          .limit(1);
        if (ro) {
          reportingOfficer = {
            id: ro.id,
            empId: ro.empId,
            name: [ro.firstName, ro.middleName, ro.surname].map((x) => String(x ?? "").trim()).filter(Boolean).join(" "),
            designation: ro.designation,
          };
        }
      }

      const [open] = await db
        .select({ id: hrPostingUpdateRequests.id, requestNo: hrPostingUpdateRequests.requestNo, status: hrPostingUpdateRequests.status })
        .from(hrPostingUpdateRequests)
        .where(
          and(
            eq(hrPostingUpdateRequests.employeeId, employeeId),
            inArray(hrPostingUpdateRequests.status, [...POSTING_OPEN_STATUSES]),
          ),
        )
        .limit(1);

      res.json({
        employee: empHeader(emp),
        yardId: emp.yardId,
        yardName: yardById[emp.yardId]
          ? String(yardById[emp.yardId].name ?? "").trim() || yardById[emp.yardId].code
          : emp.yardId,
        section: emp.section,
        isHeadOffice: isHeadOfficeYardRow(yardById[emp.yardId]),
        additionalCharges: holdings.map((h) => ({
          yardId: h.yardId,
          from: h.from ?? null,
          section: h.section ?? null,
          yardName: yardById[h.yardId]
            ? String(yardById[h.yardId].name ?? "").trim() || yardById[h.yardId].code
            : h.yardId,
          isHeadOffice: isHeadOfficeYardRow(yardById[h.yardId]),
        })),
        reportingOfficer,
        openRequest: open ?? null,
        hoSectionOptions: [...HO_SECTION_OPTIONS],
        yards: Object.values(yardById).map((y) => ({
          id: y.id,
          name: y.name,
          code: y.code,
          type: y.type,
          isHeadOffice: isHeadOfficeYardRow(y),
        })),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load posting update context");
    }
  });

  app.get("/api/hr/posting-updates", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Read required", { required: "M-01:Read" });
      }
      const mine = String(req.query.mine ?? "") === "1";
      const pendingMyAction = String(req.query.pendingMyAction ?? "") === "1";
      const employeeId = String(req.query.employeeId ?? "").trim();

      let rows = await db.select().from(hrPostingUpdateRequests).orderBy(desc(hrPostingUpdateRequests.createdAt));
      if (employeeId) rows = rows.filter((r) => r.employeeId === employeeId);
      if (mine) rows = rows.filter((r) => r.doUser === req.user!.id);
      if (pendingMyAction) rows = rows.filter((r) => postingUpdateAwaitingMyAction(req.user, r));

      const empIds = [...new Set(rows.map((r) => r.employeeId))];
      const emps =
        empIds.length > 0
          ? await db.select().from(employees).where(inArray(employees.id, empIds))
          : [];
      const empById = Object.fromEntries(emps.map((e) => [e.id, e]));

      res.json(
        rows.map((r) => {
          const e = empById[r.employeeId];
          return {
            ...r,
            employee: e ? empHeader(e) : null,
            awaitingMyAction: postingUpdateAwaitingMyAction(req.user, r),
          };
        }),
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list posting updates");
    }
  });

  app.get("/api/hr/posting-updates/:id", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Read required", { required: "M-01:Read" });
      }
      const id = String(req.params.id ?? "").trim();
      const [row] = await db.select().from(hrPostingUpdateRequests).where(eq(hrPostingUpdateRequests.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "HR_POSTING_UPDATE_NOT_FOUND", "Request not found");

      const [emp] = await db.select().from(employees).where(eq(employees.id, row.employeeId)).limit(1);
      const yardById = await loadYardMap();

      const userIds = [row.doUser, row.dvUser, row.approvedBy].filter(Boolean) as string[];
      const userRows =
        userIds.length > 0
          ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))
          : [];
      const userName = (uid: string | null) => {
        if (!uid) return null;
        const u = userRows.find((x) => x.id === uid);
        return u ? String(u.name ?? "").trim() || String(u.email ?? "").trim() || uid : uid;
      };

      let newRo: ReturnType<typeof empHeader> | null = null;
      if (row.newReportingOfficerEmployeeId) {
        const [ro] = await db.select().from(employees).where(eq(employees.id, row.newReportingOfficerEmployeeId)).limit(1);
        if (ro) newRo = empHeader(ro);
      }
      let oldRo: ReturnType<typeof empHeader> | null = null;
      if (row.oldReportingOfficerEmployeeId) {
        const [ro] = await db.select().from(employees).where(eq(employees.id, row.oldReportingOfficerEmployeeId)).limit(1);
        if (ro) oldRo = empHeader(ro);
      }

      res.json({
        ...row,
        employee: emp ? empHeader(emp) : null,
        yardNames: Object.fromEntries(
          Object.values(yardById).map((y) => [y.id, String(y.name ?? "").trim() || y.code || y.id]),
        ),
        additionalYardIds: parseJsonStringArray(row.additionalYardIds),
        withdrawYardIds: parseJsonStringArray(row.withdrawYardIds),
        hoSectionByYardId: parseJsonStringMap(row.hoSectionByYardId),
        newReportingOfficer: newRo,
        oldReportingOfficer: oldRo,
        actors: {
          doName: userName(row.doUser),
          dvName: userName(row.dvUser),
          daName: userName(row.approvedBy),
        },
        awaitingMyAction: postingUpdateAwaitingMyAction(req.user, row),
        canVerify:
          row.status === "PendingVerification" &&
          canTransitionPostingUpdate(req.user, row.status, "PendingApproval").allowed &&
          postingUpdateAwaitingMyAction(req.user, row),
        canApprove:
          row.status === "PendingApproval" &&
          canTransitionPostingUpdate(req.user, row.status, "Approved").allowed &&
          postingUpdateAwaitingMyAction(req.user, row),
        canReturn:
          (row.status === "PendingVerification" &&
            canTransitionPostingUpdate(req.user, row.status, "ReturnedToDO").allowed &&
            postingUpdateAwaitingMyAction(req.user, row)) ||
          (row.status === "PendingApproval" &&
            canTransitionPostingUpdate(req.user, row.status, "ReturnedToDO").allowed &&
            postingUpdateAwaitingMyAction(req.user, row)),
        canReject:
          row.status === "PendingApproval" &&
          canTransitionPostingUpdate(req.user, row.status, "Rejected").allowed &&
          postingUpdateAwaitingMyAction(req.user, row),
        canResubmit:
          row.status === "ReturnedToDO" &&
          canEditPostingUpdate(req.user) &&
          (req.user.roles?.some((r) => r.tier === "ADMIN") || row.doUser === req.user.id),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load posting update");
    }
  });

  app.post("/api/hr/employees/:employeeId/posting-updates", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!canCreatePostingUpdate(req.user) || !hasPermission(req.user, "M-01", "Create")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "DO with M-01 Create required", {
          required: "M-01:Create + DO",
        });
      }
      const employeeId = String(req.params.employeeId ?? "").trim();
      const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");

      const [open] = await db
        .select({ id: hrPostingUpdateRequests.id })
        .from(hrPostingUpdateRequests)
        .where(
          and(
            eq(hrPostingUpdateRequests.employeeId, employeeId),
            inArray(hrPostingUpdateRequests.status, [...POSTING_OPEN_STATUSES]),
          ),
        )
        .limit(1);
      if (open) {
        return sendApiError(
          res,
          409,
          "HR_POSTING_UPDATE_PENDING",
          "This employee already has a pending posting update request.",
          { requestId: open.id },
        );
      }

      const body = req.body ?? {};
      if (!isPostingChangeType(body.changeType)) {
        return sendApiError(res, 400, "HR_POSTING_CHANGE_TYPE", "Invalid change type");
      }
      const changeType = body.changeType as PostingChangeType;
      const yardById = await loadYardMap();
      const fieldErrors = validatePostingSubmit(
        {
          changeType,
          newYardId: body.newYardId,
          newSection: body.newSection,
          newReportingOfficerEmployeeId: body.newReportingOfficerEmployeeId,
          additionalYardIds: Array.isArray(body.additionalYardIds) ? body.additionalYardIds : [],
          hoSectionByYardId: body.hoSectionByYardId && typeof body.hoSectionByYardId === "object" ? body.hoSectionByYardId : {},
          withdrawYardIds: Array.isArray(body.withdrawYardIds) ? body.withdrawYardIds : [],
          effectiveFrom: body.effectiveFrom,
          orderNo: body.orderNo,
          orderDate: body.orderDate,
          remarks: body.remarks,
        },
        {
          todayYmd: todayYmd(),
          isHeadOfficeYardId: (id) => isHeadOfficeYardRow(yardById[id]),
        },
      );
      if (Object.keys(fieldErrors).length > 0) {
        return sendApiError(res, 400, "HR_POSTING_VALIDATION", "Validation failed", { fieldErrors });
      }

      // Extra business checks
      if (changeType === "Transfer") {
        const newYardId = String(body.newYardId ?? "").trim();
        if (newYardId === emp.yardId) {
          return sendApiError(res, 400, "HR_POSTING_VALIDATION", "Validation failed", {
            fieldErrors: { newYardId: "Select a location different from the current primary location." },
          });
        }
        const roId = String(body.newReportingOfficerEmployeeId ?? "").trim();
        if (roId === employeeId) {
          return sendApiError(res, 400, "HR_POSTING_VALIDATION", "Validation failed", {
            fieldErrors: { newReportingOfficerEmployeeId: "Select the reporting officer." },
          });
        }
      }
      if (changeType === "ChangeReportingOfficer") {
        const roId = String(body.newReportingOfficerEmployeeId ?? "").trim();
        if (roId === employeeId || roId === emp.reportingOfficerEmployeeId) {
          return sendApiError(res, 400, "HR_POSTING_VALIDATION", "Validation failed", {
            fieldErrors: { newReportingOfficerEmployeeId: "Select the reporting officer." },
          });
        }
      }
      if (changeType === "AssignAdditionalCharge") {
        const held = new Set(parseAdditionalChargeHoldings(emp.locationPosted, emp.yardId).map((h) => h.yardId));
        held.add(emp.yardId);
        const ids = (Array.isArray(body.additionalYardIds) ? body.additionalYardIds : []).map((x: unknown) =>
          String(x).trim(),
        );
        if (ids.some((id: string) => held.has(id))) {
          return sendApiError(res, 400, "HR_POSTING_VALIDATION", "Validation failed", {
            fieldErrors: { additionalYardIds: "Select at least one location." },
          });
        }
      }
      if (changeType === "WithdrawAdditionalCharge") {
        const held = new Set(parseAdditionalChargeHoldings(emp.locationPosted, emp.yardId).map((h) => h.yardId));
        const ids = (Array.isArray(body.withdrawYardIds) ? body.withdrawYardIds : []).map((x: unknown) => String(x).trim());
        if (ids.some((id: string) => !held.has(id))) {
          return sendApiError(res, 400, "HR_POSTING_VALIDATION", "Validation failed", {
            fieldErrors: { withdrawYardIds: "Select at least one additional charge to withdraw." },
          });
        }
      }

      const nowIso = new Date().toISOString();
      const requestNo = await allocatePostingUpdateRequestNo();
      const id = nanoid();
      const additionalYardIds = Array.isArray(body.additionalYardIds)
        ? JSON.stringify(body.additionalYardIds.map((x: unknown) => String(x).trim()).filter(Boolean))
        : null;
      const withdrawYardIds = Array.isArray(body.withdrawYardIds)
        ? JSON.stringify(body.withdrawYardIds.map((x: unknown) => String(x).trim()).filter(Boolean))
        : null;
      const hoSectionByYardId =
        body.hoSectionByYardId && typeof body.hoSectionByYardId === "object"
          ? JSON.stringify(body.hoSectionByYardId)
          : null;

      const [row] = await db
        .insert(hrPostingUpdateRequests)
        .values({
          id,
          requestNo,
          employeeId,
          changeType,
          oldYardId: emp.yardId,
          oldLocationPosted: emp.locationPosted,
          oldSection: emp.section,
          oldReportingOfficerEmployeeId: emp.reportingOfficerEmployeeId,
          newYardId: body.newYardId ? String(body.newYardId).trim() : null,
          newSection: body.newSection ? String(body.newSection).trim() : null,
          newReportingOfficerEmployeeId: body.newReportingOfficerEmployeeId
            ? String(body.newReportingOfficerEmployeeId).trim()
            : null,
          additionalYardIds,
          hoSectionByYardId,
          withdrawYardIds,
          effectiveFrom: String(body.effectiveFrom).trim(),
          orderNo: body.orderNo ? String(body.orderNo).trim() : null,
          orderDate: body.orderDate ? String(body.orderDate).trim() : null,
          remarks: body.remarks ? String(body.remarks).trim() : null,
          orderCopyBlobKey: body.orderCopyBlobKey ? String(body.orderCopyBlobKey).trim() : null,
          orderCopyFileName: body.orderCopyFileName ? String(body.orderCopyFileName).trim() : null,
          orderCopyMimeType: body.orderCopyMimeType ? String(body.orderCopyMimeType).trim() : null,
          orderCopySizeBytes:
            body.orderCopySizeBytes != null && Number.isFinite(Number(body.orderCopySizeBytes))
              ? Number(body.orderCopySizeBytes)
              : null,
          status: "PendingVerification",
          doUser: req.user.id,
          dvUser: null,
          approvedBy: null,
          submittedAt: nowIso,
          verifiedAt: null,
          approvedAt: null,
          returnedAt: null,
          rejectedAt: null,
          returnOrRejectRemarks: null,
          workflowRevisionCount: 0,
          serviceBookEntryId: null,
          documentId: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      writeAuditLog(req, {
        module: "HR",
        action: "Create",
        recordId: id,
        afterValue: { requestNo, changeType, employeeId },
      }).catch(() => {});

      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "";
      if (/uq_hr_posting_update_open_per_employee/i.test(msg)) {
        return sendApiError(
          res,
          409,
          "HR_POSTING_UPDATE_PENDING",
          "This employee already has a pending posting update request.",
        );
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create posting update");
    }
  });

  app.post(
    "/api/hr/employees/:employeeId/posting-updates/order-copy",
    multerOrderCopy,
    async (req, res) => {
      try {
        if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
        if (!canCreatePostingUpdate(req.user) || !hasPermission(req.user, "M-01", "Create")) {
          return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions");
        }
        const employeeId = String(req.params.employeeId ?? "").trim();
        const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
        if (!emp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
        const file = req.file;
        if (!file) return sendApiError(res, 400, "HR_POSTING_ORDER_COPY_REQUIRED", "Upload file required (field name: file)");
        const stored = await storePostingOrderCopy({
          employeeId,
          buffer: file.buffer,
          mimeType: file.mimetype,
          originalName: file.originalname,
        });
        res.status(201).json(stored);
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : "Failed to upload order copy";
        sendApiError(res, 400, "HR_POSTING_ORDER_COPY_UPLOAD_FAILED", msg);
      }
    },
  );

  app.get("/api/hr/posting-updates/:id/order-copy", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Read required");
      }
      const id = String(req.params.id ?? "").trim();
      const [row] = await db.select().from(hrPostingUpdateRequests).where(eq(hrPostingUpdateRequests.id, id)).limit(1);
      if (!row?.orderCopyFileName || !row.orderCopyBlobKey) {
        return sendApiError(res, 404, "HR_POSTING_ORDER_COPY_NOT_FOUND", "No order copy attached");
      }
      if (!isAllowedEmployeeDocumentFileName(row.orderCopyFileName)) {
        return sendApiError(res, 400, "HR_POSTING_ORDER_COPY_NAME_INVALID", "Invalid stored file name");
      }
      const buf = await readEmployeeDocumentBuffer(row.employeeId, row.orderCopyFileName);
      if (!buf) return sendApiError(res, 404, "HR_POSTING_ORDER_COPY_NOT_FOUND", "Order copy file missing");
      res.setHeader("Content-Type", row.orderCopyMimeType || contentTypeForEmployeeDocument(row.orderCopyFileName));
      res.setHeader("Content-Disposition", `inline; filename="${row.orderCopyFileName}"`);
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to download order copy");
    }
  });

  app.put("/api/hr/posting-updates/:id", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      if (!hasPermission(req.user, "M-01", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-01 Update required", { required: "M-01:Update" });
      }
      const id = String(req.params.id ?? "").trim();
      const [existing] = await db.select().from(hrPostingUpdateRequests).where(eq(hrPostingUpdateRequests.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "HR_POSTING_UPDATE_NOT_FOUND", "Request not found");

      const body = (req.body ?? {}) as Record<string, unknown>;
      const newStatus = body.status != null ? String(body.status).trim() : null;
      const nowIso = new Date().toISOString();

      // DO resubmit / edit while ReturnedToDO (or PendingVerification own)
      if (!newStatus || newStatus === existing.status) {
        const editable =
          existing.status === "ReturnedToDO" ||
          (existing.status === "PendingVerification" && existing.doUser === req.user.id);
        if (!editable || !canEditPostingUpdate(req.user)) {
          return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Cannot edit this request");
        }
        if (existing.status === "ReturnedToDO" && body.resubmit === true) {
          const tr = canTransitionPostingUpdate(req.user, existing.status, "PendingVerification");
          if (!tr.allowed) return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Cannot resubmit");
          // Re-validate payload if provided
          const changeType = (body.changeType ? String(body.changeType) : existing.changeType) as PostingChangeType;
          if (!isPostingChangeType(changeType)) {
            return sendApiError(res, 400, "HR_POSTING_CHANGE_TYPE", "Invalid change type");
          }
          const yardById = await loadYardMap();
          const asOptStr = (v: unknown): string | null => {
            if (v == null) return null;
            const s = String(v).trim();
            return s || null;
          };
          const submitInput = {
            changeType,
            newYardId: asOptStr(body.newYardId ?? existing.newYardId),
            newSection: asOptStr(body.newSection ?? existing.newSection),
            newReportingOfficerEmployeeId: asOptStr(
              body.newReportingOfficerEmployeeId ?? existing.newReportingOfficerEmployeeId,
            ),
            additionalYardIds: Array.isArray(body.additionalYardIds)
              ? (body.additionalYardIds as string[])
              : parseJsonStringArray(existing.additionalYardIds),
            hoSectionByYardId:
              body.hoSectionByYardId && typeof body.hoSectionByYardId === "object"
                ? (body.hoSectionByYardId as Record<string, string>)
                : parseJsonStringMap(existing.hoSectionByYardId),
            withdrawYardIds: Array.isArray(body.withdrawYardIds)
              ? (body.withdrawYardIds as string[])
              : parseJsonStringArray(existing.withdrawYardIds),
            effectiveFrom: asOptStr(body.effectiveFrom ?? existing.effectiveFrom),
            orderNo: asOptStr(body.orderNo ?? existing.orderNo),
            orderDate: asOptStr(body.orderDate ?? existing.orderDate),
            remarks: asOptStr(body.remarks ?? existing.remarks),
          };
          const fieldErrors = validatePostingSubmit(submitInput, {
            todayYmd: todayYmd(),
            isHeadOfficeYardId: (yid) => isHeadOfficeYardRow(yardById[yid]),
          });
          if (Object.keys(fieldErrors).length > 0) {
            return sendApiError(res, 400, "HR_POSTING_VALIDATION", "Validation failed", { fieldErrors });
          }
          const [row] = await db
            .update(hrPostingUpdateRequests)
            .set({
              changeType,
              newYardId: submitInput.newYardId ? String(submitInput.newYardId).trim() : null,
              newSection: submitInput.newSection ? String(submitInput.newSection).trim() : null,
              newReportingOfficerEmployeeId: submitInput.newReportingOfficerEmployeeId
                ? String(submitInput.newReportingOfficerEmployeeId).trim()
                : null,
              additionalYardIds: JSON.stringify(submitInput.additionalYardIds ?? []),
              hoSectionByYardId: JSON.stringify(submitInput.hoSectionByYardId ?? {}),
              withdrawYardIds: JSON.stringify(submitInput.withdrawYardIds ?? []),
              effectiveFrom: String(submitInput.effectiveFrom).trim(),
              orderNo: submitInput.orderNo ? String(submitInput.orderNo).trim() : null,
              orderDate: submitInput.orderDate ? String(submitInput.orderDate).trim() : null,
              remarks: submitInput.remarks ? String(submitInput.remarks).trim() : null,
              orderCopyBlobKey:
                body.orderCopyBlobKey != null ? String(body.orderCopyBlobKey).trim() || null : existing.orderCopyBlobKey,
              orderCopyFileName:
                body.orderCopyFileName != null
                  ? String(body.orderCopyFileName).trim() || null
                  : existing.orderCopyFileName,
              orderCopyMimeType:
                body.orderCopyMimeType != null
                  ? String(body.orderCopyMimeType).trim() || null
                  : existing.orderCopyMimeType,
              orderCopySizeBytes:
                body.orderCopySizeBytes != null
                  ? Number(body.orderCopySizeBytes)
                  : existing.orderCopySizeBytes,
              status: "PendingVerification",
              dvUser: null,
              verifiedAt: null,
              submittedAt: nowIso,
              returnedAt: null,
              returnOrRejectRemarks: null,
              workflowRevisionCount: (existing.workflowRevisionCount ?? 0) + 1,
              updatedAt: nowIso,
            })
            .where(eq(hrPostingUpdateRequests.id, id))
            .returning();
          return res.json(row);
        }
        return sendApiError(res, 400, "HR_POSTING_NO_STATUS", "Provide status or resubmit=true");
      }

      const tr = canTransitionPostingUpdate(req.user, existing.status, newStatus);
      if (!tr.allowed) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Transition not allowed");
      }

      if (tr.setDvUser || tr.setApprovedBy) {
        const seg = assertSegregationDoDvDa(
          req.user,
          { doUser: existing.doUser, dvUser: existing.dvUser },
          { setDvUser: tr.setDvUser, setDaUser: tr.setApprovedBy },
        );
        if (!seg.ok) return sendApiError(res, 403, "AUTH_SEGREGATION", seg.error);
      }

      if (newStatus === "ReturnedToDO" || newStatus === "Rejected") {
        const remarks = String(body.returnOrRejectRemarks ?? body.returnRemarks ?? body.rejectionRemarks ?? "").trim();
        if (remarks.length < MIN_WORKFLOW_REMARKS_LENGTH) {
          return sendApiError(
            res,
            400,
            "HR_POSTING_REMARK_REQUIRED",
            `Enter a remark to return or reject (at least ${MIN_WORKFLOW_REMARKS_LENGTH} characters).`,
          );
        }
      }

      if (newStatus === "Approved") {
        try {
          const updated = await applyPostingUpdateOnApproval(id, req.user.id);
          writeAuditLog(req, {
            module: "HR",
            action: "Update",
            recordId: id,
            beforeValue: { status: existing.status },
            afterValue: { status: "Approved" },
          }).catch(() => {});
          return res.json(updated);
        } catch (e) {
          console.error(e);
          return sendApiError(
            res,
            500,
            "HR_POSTING_APPLY_FAILED",
            e instanceof Error ? e.message : "Failed to apply posting update",
          );
        }
      }

      const updates: Partial<typeof hrPostingUpdateRequests.$inferInsert> = {
        status: newStatus,
        updatedAt: nowIso,
      };
      if (newStatus === "PendingApproval") {
        updates.dvUser = req.user.id;
        updates.verifiedAt = nowIso;
        updates.returnOrRejectRemarks = null;
      }
      if (newStatus === "ReturnedToDO") {
        updates.returnedAt = nowIso;
        updates.returnOrRejectRemarks = String(
          body.returnOrRejectRemarks ?? body.returnRemarks ?? "",
        ).trim();
        updates.workflowRevisionCount = (existing.workflowRevisionCount ?? 0) + 1;
        if (existing.status === "PendingApproval") {
          // clear verification so DO resubmits cleanly
          updates.dvUser = null;
          updates.verifiedAt = null;
        }
      }
      if (newStatus === "Rejected") {
        updates.approvedBy = req.user.id;
        updates.rejectedAt = nowIso;
        updates.returnOrRejectRemarks = String(
          body.returnOrRejectRemarks ?? body.rejectionRemarks ?? "",
        ).trim();
      }

      const [row] = await db
        .update(hrPostingUpdateRequests)
        .set(updates)
        .where(eq(hrPostingUpdateRequests.id, id))
        .returning();

      writeAuditLog(req, {
        module: "HR",
        action: "Update",
        recordId: id,
        beforeValue: { status: existing.status },
        afterValue: { status: newStatus },
      }).catch(() => {});

      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update posting request");
    }
  });
}
