/**
 * IOMS M-01: HRMS & Service Record API routes.
 * Tables: employees, employee_contracts, recruitment, attendances, timesheets,
 * service_book_entries, leave_requests, ltc_claims, ta_da_claims.
 */
import type { Express } from "express";
import { eq, desc, or, and, gte, lte, isNotNull } from "drizzle-orm";
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
  ltcClaims,
  taDaClaims,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canCreateLeaveRequest,
  canTransitionLeaveRequest,
  leaveRequestAwaitingMyAction,
  assertSegregationDoDvDa,
} from "./workflow";
import { validateDaRejection, validateDvReturnToDraft } from "@shared/workflow-rejection";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";

export function registerHrRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Employees -----
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
      const yardId = req.query.yardId as string | undefined;
      const list = yardId
        ? await db.select().from(employees).where(eq(employees.yardId, yardId)).orderBy(desc(employees.createdAt))
        : await db.select().from(employees).orderBy(desc(employees.createdAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch employees");
    }
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
      const payload = {
        id,
        firstName: String(body.firstName ?? ""),
        surname: String(body.surname ?? ""),
        designation: String(body.designation ?? ""),
        yardId: String(body.yardId ?? ""),
        employeeType: String(body.employeeType ?? "Regular"),
        joiningDate: String(body.joiningDate ?? ""),
        status: String(body.status ?? "Active"),
        middleName: body.middleName ? String(body.middleName) : null,
        photoUrl: body.photoUrl ? String(body.photoUrl) : null,
        aadhaarToken: body.aadhaarToken ? String(body.aadhaarToken) : null,
        pan: body.pan ? String(body.pan) : null,
        dob: body.dob ? String(body.dob) : null,
        retirementDate: body.retirementDate ? String(body.retirementDate) : null,
        mobile: body.mobile ? String(body.mobile) : null,
        workEmail: body.workEmail ? String(body.workEmail) : null,
        userId: body.userId ? String(body.userId) : null,
        createdAt: now(),
        updatedAt: now(),
      };
      if (!payload.yardId || !payload.joiningDate) {
        return sendApiError(res, 400, "HR_EMPLOYEE_FIELDS_REQUIRED", "yardId and joiningDate required");
      }
      await db.insert(employees).values(payload);
      const [row] = await db.select().from(employees).where(eq(employees.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create employee");
    }
  });

  app.put("/api/hr/employees/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [beforeEmp] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!beforeEmp) return sendApiError(res, 404, "HR_EMPLOYEE_NOT_FOUND", "Employee not found");
      const body = req.body;
      const updates: Record<string, unknown> = { updatedAt: now() };
      const allowed = ["firstName", "middleName", "surname", "photoUrl", "designation", "yardId", "employeeType", "aadhaarToken", "pan", "dob", "joiningDate", "retirementDate", "mobile", "workEmail", "status", "userId", "empId"];
      for (const key of allowed) {
        if (body[key] !== undefined) updates[key === "empId" ? "empId" : key] = body[key] === null ? null : String(body[key]);
      }
      if (body.retirementDate !== undefined) updates.retirementDate = body.retirementDate;

      const terminalStatuses = ["Inactive", "Retired", "Suspended", "Resigned"];
      await db.transaction(async (tx) => {
        await tx.update(employees).set(updates as Record<string, string | null>).where(eq(employees.id, id));
        const [after] = await tx
          .select({ status: employees.status, userId: employees.userId })
          .from(employees)
          .where(eq(employees.id, id))
          .limit(1);
        if (after?.status && terminalStatuses.includes(after.status)) {
          if (after.userId) {
            await tx
              .update(users)
              .set({ isActive: false, updatedAt: now() })
              .where(or(eq(users.employeeId, id), eq(users.id, after.userId)));
          } else {
            await tx.update(users).set({ isActive: false, updatedAt: now() }).where(eq(users.employeeId, id));
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
      const id = nanoid();
      await db.insert(leaveRequests).values({
        id,
        employeeId: String(body.employeeId ?? ""),
        leaveType: String(body.leaveType ?? ""),
        fromDate: String(body.fromDate ?? ""),
        toDate: String(body.toDate ?? ""),
        status: "Pending",
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
        if (["Approved", "Rejected"].includes(existing.status)) {
          return sendApiError(res, 403, "LEAVE_TERMINAL_NO_EDIT", "Approved or rejected leave cannot be edited");
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
      ["leaveType", "fromDate", "toDate"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k];
      });
      await db.update(leaveRequests).set(updates as Record<string, string | number | null>).where(eq(leaveRequests.id, id));
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
      const list = employeeId
        ? await db.select().from(ltcClaims).where(eq(ltcClaims.employeeId, employeeId)).orderBy(desc(ltcClaims.claimDate))
        : await db.select().from(ltcClaims).orderBy(desc(ltcClaims.claimDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch LTC claims");
    }
  });

  app.post("/api/hr/claims/ltc", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(ltcClaims).values({
        id,
        employeeId: String(body.employeeId ?? ""),
        claimDate: String(body.claimDate ?? ""),
        amount: Number(body.amount ?? 0),
        period: body.period ? String(body.period) : null,
        status: String(body.status ?? "Pending"),
      });
      const [row] = await db.select().from(ltcClaims).where(eq(ltcClaims.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create LTC claim");
    }
  });

  // ----- TA/DA claims -----
  app.get("/api/hr/claims/tada", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const list = employeeId
        ? await db.select().from(taDaClaims).where(eq(taDaClaims.employeeId, employeeId)).orderBy(desc(taDaClaims.travelDate))
        : await db.select().from(taDaClaims).orderBy(desc(taDaClaims.travelDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch TA/DA claims");
    }
  });

  app.post("/api/hr/claims/tada", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(taDaClaims).values({
        id,
        employeeId: String(body.employeeId ?? ""),
        travelDate: String(body.travelDate ?? ""),
        purpose: String(body.purpose ?? ""),
        amount: Number(body.amount ?? 0),
        status: String(body.status ?? "Pending"),
      });
      const [row] = await db.select().from(taDaClaims).where(eq(taDaClaims.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create TA/DA claim");
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
      const employeeId = req.params.employeeId;
      const body = req.body;
      const id = nanoid();
      await db.insert(serviceBookEntries).values({
        id,
        employeeId,
        section: String(body.section ?? "History"),
        content: typeof body.content === "object" ? body.content : {},
        isImmutable: Boolean(body.isImmutable ?? false),
        status: String(body.status ?? "Draft"),
        approvedBy: body.approvedBy ? String(body.approvedBy) : null,
        approvedAt: body.approvedAt ? String(body.approvedAt) : null,
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
      const updates: Record<string, unknown> = {};
      if (body.section !== undefined) updates.section = String(body.section);
      if (body.content !== undefined) updates.content = typeof body.content === "object" ? body.content : {};
      if (body.status !== undefined) updates.status = String(body.status);
      if (body.isImmutable !== undefined) updates.isImmutable = Boolean(body.isImmutable);
      if (body.approvedBy !== undefined) updates.approvedBy = body.approvedBy == null ? null : String(body.approvedBy);
      if (body.approvedAt !== undefined) updates.approvedAt = body.approvedAt == null ? null : String(body.approvedAt);
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(serviceBookEntries).where(eq(serviceBookEntries.id, entryId)).limit(1);
        return res.json(row!);
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
