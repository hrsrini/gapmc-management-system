/**
 * IOMS M-06: Payment Voucher Management API routes.
 * Tables: expenditure_heads, payment_vouchers, advance_requests.
 * Workflow: DO creates Draft; DV verifies (→Verified); DA approves (→Approved/Rejected) and pays (→Paid).
 * Scoped by user yards.
 */
import type { Express } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "./db";
import { expenditureHeads, paymentVouchers, advanceRequests } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { canCreateVoucher, canEditDraftVoucher, canTransitionVoucher } from "./workflow";
import { writeAuditLog } from "./audit";

export function registerVoucherRoutes(app: Express) {
  const now = () => new Date().toISOString();

  app.get("/api/ioms/expenditure-heads", async (_req, res) => {
    try {
      const list = await db.select().from(expenditureHeads).orderBy(expenditureHeads.code);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch expenditure heads" });
    }
  });

  app.post("/api/ioms/expenditure-heads", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(expenditureHeads).values({
        id,
        code: String(body.code ?? ""),
        description: String(body.description ?? ""),
        category: body.category ? String(body.category) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      });
      const [row] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create expenditure head" });
    }
  });

  app.put("/api/ioms/expenditure-heads/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["code", "description", "category", "isActive"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "isActive") updates.isActive = Boolean(body.isActive);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(expenditureHeads).set(updates as Record<string, string | boolean | null>).where(eq(expenditureHeads.id, id));
      const [row] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update expenditure head" });
    }
  });

  app.get("/api/ioms/vouchers", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(paymentVouchers.yardId, scopedIds));
      if (yardId) conditions.push(eq(paymentVouchers.yardId, yardId));
      if (status) conditions.push(eq(paymentVouchers.status, status));
      const base = db.select().from(paymentVouchers).orderBy(desc(paymentVouchers.createdAt));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch vouchers" });
    }
  });

  app.get("/api/ioms/vouchers/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Voucher not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return res.status(404).json({ error: "Voucher not found" });
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch voucher" });
    }
  });

  app.post("/api/ioms/vouchers", async (req, res) => {
    try {
      if (!canCreateVoucher(req.user)) {
        return res.status(403).json({ error: "Only Data Originator or Admin can create vouchers" });
      }
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return res.status(403).json({ error: "You do not have access to this yard" });
      }
      const id = nanoid();
      await db.insert(paymentVouchers).values({
        id,
        voucherType: String(body.voucherType ?? ""),
        yardId,
        expenditureHeadId: String(body.expenditureHeadId ?? ""),
        payeeName: String(body.payeeName ?? ""),
        amount: Number(body.amount ?? 0),
        status: "Draft",
        payeeAccount: body.payeeAccount ? String(body.payeeAccount) : null,
        payeeBank: body.payeeBank ? String(body.payeeBank) : null,
        description: body.description ? String(body.description) : null,
        sourceModule: body.sourceModule ? String(body.sourceModule) : null,
        sourceRecordId: body.sourceRecordId ? String(body.sourceRecordId) : null,
        supportingDocs: Array.isArray(body.supportingDocs) ? body.supportingDocs : null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        paidAt: null,
        paymentRef: null,
        voucherNo: body.voucherNo ? String(body.voucherNo) : null,
        createdAt: now(),
      });
      const [row] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id));
      writeAuditLog(req, { module: "Vouchers", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create voucher" });
    }
  });

  app.put("/api/ioms/vouchers/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Voucher not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return res.status(404).json({ error: "Voucher not found" });
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionVoucher(req.user, existing.status, newStatus) : null;

      if (statusChange) {
        if (!transition?.allowed) {
          return res.status(403).json({
            error: `You cannot change status from ${existing.status} to ${newStatus}. Only DV can verify; only DA can approve or reject.`,
          });
        }
      } else if (
        (existing.status === "Draft" || existing.status === "Submitted") &&
        !canEditDraftVoucher(req.user)
      ) {
        return res.status(403).json({ error: "Only Data Originator or Admin can edit draft vouchers" });
      }

      const updates: Record<string, unknown> = {};
      ["voucherNo", "voucherType", "yardId", "expenditureHeadId", "payeeName", "payeeAccount", "payeeBank", "amount", "description", "sourceModule", "sourceRecordId", "status", "doUser", "dvUser", "daUser", "paidAt", "paymentRef"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "amount") updates.amount = Number(body.amount);
        else if (k === "supportingDocs") updates.supportingDocs = Array.isArray(body.supportingDocs) ? body.supportingDocs : null;
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setDaUser) updates.daUser = req.user?.id ?? null;
      if (newStatus === "Paid") updates.paidAt = now();

      await db.update(paymentVouchers).set(updates as Record<string, unknown>).where(eq(paymentVouchers.id, id));
      const [row] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      writeAuditLog(req, { module: "Vouchers", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update voucher" });
    }
  });

  app.get("/api/ioms/advances", async (req, res) => {
    try {
      const voucherId = req.query.voucherId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      let list = await db.select().from(advanceRequests).orderBy(desc(advanceRequests.id));
      if (voucherId) list = list.filter((a) => a.voucherId === voucherId);
      if (scopedIds && scopedIds.length > 0) {
        const voucherIds = (await db.select({ id: paymentVouchers.id }).from(paymentVouchers).where(inArray(paymentVouchers.yardId, scopedIds))).map((r) => r.id);
        list = list.filter((a) => voucherIds.includes(a.voucherId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch advances" });
    }
  });

  app.get("/api/ioms/vouchers/:voucherId/advances", async (req, res) => {
    try {
      const [voucher] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, req.params.voucherId)).limit(1);
      if (!voucher) return res.status(404).json({ error: "Voucher not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(voucher.yardId)) {
        return res.status(404).json({ error: "Voucher not found" });
      }
      const list = await db.select().from(advanceRequests).where(eq(advanceRequests.voucherId, req.params.voucherId));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch advances" });
    }
  });

  app.post("/api/ioms/advances", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(advanceRequests).values({
        id,
        voucherId: String(body.voucherId ?? ""),
        employeeId: String(body.employeeId ?? ""),
        purpose: String(body.purpose ?? ""),
        amount: Number(body.amount ?? 0),
        recoverySchedule: body.recoverySchedule ? String(body.recoverySchedule) : null,
        recoveredAmount: body.recoveredAmount != null ? Number(body.recoveredAmount) : 0,
      });
      const [row] = await db.select().from(advanceRequests).where(eq(advanceRequests.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create advance" });
    }
  });
}
