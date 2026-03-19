/**
 * IOMS M-01: HRMS & Service Record API routes.
 * Tables: employees, employee_contracts, recruitment, attendances, timesheets,
 * service_book_entries, leave_requests, ltc_claims, ta_da_claims.
 */
import type { Express } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  employees,
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
import { canCreateLeaveRequest, canTransitionLeaveRequest } from "./workflow";
import { writeAuditLog } from "./audit";

export function registerHrRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Employees -----
  app.get("/api/hr/employees", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const list = yardId
        ? await db.select().from(employees).where(eq(employees.yardId, yardId)).orderBy(desc(employees.createdAt))
        : await db.select().from(employees).orderBy(desc(employees.createdAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch employees" });
    }
  });

  app.get("/api/hr/employees/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Employee not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch employee" });
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
        return res.status(400).json({ error: "yardId and joiningDate required" });
      }
      await db.insert(employees).values(payload);
      const [row] = await db.select().from(employees).where(eq(employees.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create employee" });
    }
  });

  app.put("/api/hr/employees/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const updates: Record<string, unknown> = { updatedAt: now() };
      const allowed = ["firstName", "middleName", "surname", "photoUrl", "designation", "yardId", "employeeType", "aadhaarToken", "pan", "dob", "joiningDate", "retirementDate", "mobile", "workEmail", "status", "userId", "empId"];
      for (const key of allowed) {
        if (body[key] !== undefined) updates[key === "empId" ? "empId" : key] = body[key] === null ? null : String(body[key]);
      }
      if (body.retirementDate !== undefined) updates.retirementDate = body.retirementDate;
      await db.update(employees).set(updates as Record<string, string | null>).where(eq(employees.id, id));
      const [row] = await db.select().from(employees).where(eq(employees.id, id));
      if (!row) return res.status(404).json({ error: "Employee not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update employee" });
    }
  });

  // ----- Employee contracts -----
  app.get("/api/hr/employees/:employeeId/contracts", async (req, res) => {
    try {
      const list = await db.select().from(employeeContracts).where(eq(employeeContracts.employeeId, req.params.employeeId));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch contracts" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create contract" });
    }
  });

  // ----- Recruitment -----
  app.get("/api/hr/recruitment", async (_req, res) => {
    try {
      const list = await db.select().from(recruitment).orderBy(desc(recruitment.appliedDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch recruitment" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create recruitment entry" });
    }
  });

  app.put("/api/hr/recruitment/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["position", "applicantName", "qualification", "appliedDate", "status", "interviewOutcomes", "decision"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k];
      });
      await db.update(recruitment).set(updates as Record<string, string | null>).where(eq(recruitment.id, id));
      const [row] = await db.select().from(recruitment).where(eq(recruitment.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update recruitment" });
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
      res.status(500).json({ error: "Failed to fetch attendances" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create attendance" });
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
      res.status(500).json({ error: "Failed to fetch timesheets" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create timesheet" });
    }
  });

  app.put("/api/hr/timesheets/:id", async (req, res) => {
    try {
      const timesheetId = req.params.id;
      const body = req.body;
      const [existing] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).limit(1);
      if (!existing) return res.status(404).json({ error: "Timesheet not found" });
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
      res.json(row!);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update timesheet" });
    }
  });

  // ----- Leave requests -----
  app.get("/api/hr/leaves", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string | undefined;
      const list = employeeId
        ? await db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(desc(leaveRequests.fromDate))
        : await db.select().from(leaveRequests).orderBy(desc(leaveRequests.fromDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch leave requests" });
    }
  });

  app.post("/api/hr/leaves", async (req, res) => {
    try {
      if (!canCreateLeaveRequest(req.user)) {
        return res.status(403).json({ error: "Only Data Originator or Admin can create leave requests" });
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
        approvedBy: null,
      });
      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (row) writeAuditLog(req, { module: "HR", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create leave request" });
    }
  });

  app.put("/api/hr/leaves/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (!existing) return res.status(404).json({ error: "Leave request not found" });
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionLeaveRequest(req.user, existing.status, newStatus) : null;

      if (statusChange) {
        if (!transition?.allowed) {
          return res.status(403).json({
            error: `You cannot change status from ${existing.status} to ${newStatus}. Only DA can approve or reject.`,
          });
        }
      }

      const updates: Record<string, unknown> = {};
      if (body.status !== undefined) updates.status = body.status;
      if (transition?.setApprovedBy) updates.approvedBy = req.user?.id ?? null;
      ["leaveType", "fromDate", "toDate"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k];
      });
      await db.update(leaveRequests).set(updates as Record<string, string | null>).where(eq(leaveRequests.id, id));
      const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      writeAuditLog(req, { module: "HR", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update leave request" });
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
      res.status(500).json({ error: "Failed to fetch LTC claims" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create LTC claim" });
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
      res.status(500).json({ error: "Failed to fetch TA/DA claims" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create TA/DA claim" });
    }
  });

  // ----- Service book entries (read + create; immutable after DA) -----
  app.get("/api/hr/employees/:employeeId/service-book", async (req, res) => {
    try {
      const list = await db.select().from(serviceBookEntries).where(eq(serviceBookEntries.employeeId, req.params.employeeId)).orderBy(desc(serviceBookEntries.approvedAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch service book" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create service book entry" });
    }
  });
}
