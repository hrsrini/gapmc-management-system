/**
 * IOMS M-03: Rent / GST Tax Invoice API routes.
 * Tables: rent_invoices, rent_deposit_ledger, credit_notes.
 * Workflow: DO creates Draft; DV verifies (Draft→Verified); DA approves (Verified→Approved).
 */
import type { Express } from "express";
import { eq, desc, and, inArray, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { rentInvoices, rentDepositLedger, creditNotes, iomsReceipts } from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canCreateRentInvoice,
  canEditDraftRentInvoice,
  canTransitionRentInvoice,
} from "./workflow";
import { writeAuditLog } from "./audit";
import { createIomsReceipt } from "./routes-receipts-ioms";

export function registerRentIomsRoutes(app: Express) {
  // ----- Rent invoices (IOMS M-03; distinct from gapmc.invoices; scoped by user yards) -----
  app.get("/api/ioms/rent/invoices", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(rentInvoices.yardId, scopedIds));
      if (yardId) conditions.push(eq(rentInvoices.yardId, yardId));
      if (status) conditions.push(eq(rentInvoices.status, status));
      const base = db.select().from(rentInvoices).orderBy(desc(rentInvoices.periodMonth));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch rent invoices" });
    }
  });

  app.get("/api/ioms/rent/invoices/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Rent invoice not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return res.status(404).json({ error: "Rent invoice not found" });
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch rent invoice" });
    }
  });

  app.post("/api/ioms/rent/invoices", async (req, res) => {
    try {
      if (!canCreateRentInvoice(req.user)) {
        return res.status(403).json({ error: "Only Data Originator or Admin can create rent invoices" });
      }
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return res.status(403).json({ error: "You do not have access to this yard" });
      }
      const id = nanoid();
      const now = new Date().toISOString();
      await db.insert(rentInvoices).values({
        id,
        allotmentId: String(body.allotmentId ?? ""),
        tenantLicenceId: String(body.tenantLicenceId ?? ""),
        assetId: String(body.assetId ?? ""),
        yardId,
        periodMonth: String(body.periodMonth ?? ""),
        rentAmount: Number(body.rentAmount ?? 0),
        cgst: Number(body.cgst ?? 0),
        sgst: Number(body.sgst ?? 0),
        totalAmount: Number(body.totalAmount ?? 0),
        status: "Draft",
        isGovtEntity: Boolean(body.isGovtEntity ?? false),
        invoiceNo: body.invoiceNo ? String(body.invoiceNo) : null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        generatedAt: null,
        approvedAt: null,
      });
      const [row] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id));
      writeAuditLog(req, { module: "Rent/Tax", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create rent invoice" });
    }
  });

  app.put("/api/ioms/rent/invoices/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Rent invoice not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return res.status(404).json({ error: "Rent invoice not found" });
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionRentInvoice(req.user, existing.status, newStatus) : null;

      if (statusChange) {
        if (!transition?.allowed) {
          return res.status(403).json({
            error: `You cannot change status from ${existing.status} to ${newStatus}. Only DV can verify; only DA can approve.`,
          });
        }
      } else if (existing.status === "Draft" && !canEditDraftRentInvoice(req.user)) {
        return res.status(403).json({ error: "Only Data Originator or Admin can edit draft invoices" });
      }

      const updates: Record<string, unknown> = {};
      ["invoiceNo", "allotmentId", "tenantLicenceId", "assetId", "yardId", "periodMonth", "rentAmount", "cgst", "sgst", "totalAmount", "isGovtEntity", "status", "doUser", "dvUser", "daUser", "generatedAt", "approvedAt"].forEach((k) => {
        if (body[k] === undefined) return;
        if (["rentAmount", "cgst", "sgst", "totalAmount"].includes(k)) updates[k] = Number(body[k]);
        else if (k === "isGovtEntity") updates.isGovtEntity = Boolean(body.isGovtEntity);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });

      const now = new Date().toISOString();
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setDaUser) {
        updates.daUser = req.user?.id ?? null;
        if (newStatus === "Approved") updates.approvedAt = now;
      }

      await db.update(rentInvoices).set(updates as Record<string, string | number | boolean | null>).where(eq(rentInvoices.id, id));
      const [row] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });

      // Phase-1 linkage: when a rent invoice becomes Approved/Paid, ensure a matching IOMS receipt exists.
      // Note: current UI doesn't expose a "Mark Paid" flow for M-03 yet; this keeps receipts ready for later payment wiring.
      if (statusChange && (newStatus === "Approved" || newStatus === "Paid")) {
        const [existingReceipt] = await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, id)))
          .limit(1);

        let receiptRow = existingReceipt ?? null;

        if (!receiptRow) {
          const createdBy = req.user?.id ?? "system";
          const revenueHead = row.isGovtEntity ? "GSTInvoice" : "Rent";

          const created = await createIomsReceipt({
            yardId: row.yardId,
            revenueHead,
            payerName: row.tenantLicenceId,
            payerType: "TenantLicence",
            payerRefId: row.tenantLicenceId,
            amount: row.rentAmount,
            cgst: row.cgst,
            sgst: row.sgst,
            paymentMode: "Cash",
            sourceModule: "M-03",
            sourceRecordId: row.id,
            createdBy,
          });

          const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
          receiptRow = createdRow ?? null;
          if (createdRow) {
            await writeAuditLog(req, { module: "Receipts", action: "Create", recordId: createdRow.id, afterValue: createdRow }).catch((e) => {
              console.error("Audit log failed:", e);
            });
          }
        }

        if (newStatus === "Paid" && receiptRow && receiptRow.status !== "Paid") {
          const beforeReceipt = receiptRow;
          await db
            .update(iomsReceipts)
            .set({ status: "Paid", gatewayRef: "Manual" })
            .where(eq(iomsReceipts.id, receiptRow.id));

          const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptRow.id)).limit(1);
          if (paidRow) {
            await writeAuditLog(req, {
              module: "Receipts",
              action: "Update",
              recordId: paidRow.id,
              beforeValue: beforeReceipt,
              afterValue: paidRow,
            }).catch((e) => console.error("Audit log failed:", e));
          }
        }
      }

      writeAuditLog(req, { module: "Rent/Tax", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update rent invoice" });
    }
  });

  // ----- Rent deposit ledger -----
  app.get("/api/ioms/rent/ledger", async (req, res) => {
    try {
      const tenantLicenceId = req.query.tenantLicenceId as string | undefined;
      const assetId = req.query.assetId as string | undefined;
      let list = await db.select().from(rentDepositLedger).orderBy(desc(rentDepositLedger.entryDate));
      if (tenantLicenceId) list = list.filter((r) => r.tenantLicenceId === tenantLicenceId);
      if (assetId) list = list.filter((r) => r.assetId === assetId);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch ledger" });
    }
  });

  app.post("/api/ioms/rent/ledger", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(rentDepositLedger).values({
        id,
        tenantLicenceId: String(body.tenantLicenceId ?? ""),
        assetId: String(body.assetId ?? ""),
        entryDate: String(body.entryDate ?? ""),
        entryType: String(body.entryType ?? "Rent"),
        debit: body.debit != null ? Number(body.debit) : 0,
        credit: body.credit != null ? Number(body.credit) : 0,
        balance: Number(body.balance ?? 0),
        invoiceId: body.invoiceId ? String(body.invoiceId) : null,
        receiptId: body.receiptId ? String(body.receiptId) : null,
      });
      const [row] = await db.select().from(rentDepositLedger).where(eq(rentDepositLedger.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create ledger entry" });
    }
  });

  // ----- GSTR-1 export (outward supplies JSON for GSTN) -----
  app.get("/api/ioms/rent/gstr1", async (req, res) => {
    try {
      const fromMonth = (req.query.fromMonth as string) || "";
      const toMonth = (req.query.toMonth as string) || "";
      if (!fromMonth || !toMonth) {
        return res.status(400).json({ error: "Query params fromMonth and toMonth required (YYYY-MM)" });
      }
      const scopedIds = req.scopedLocationIds;
      const conditions = [
        inArray(rentInvoices.status, ["Approved", "Paid"]),
        gte(rentInvoices.periodMonth, fromMonth),
        lte(rentInvoices.periodMonth, toMonth),
        eq(rentInvoices.isGovtEntity, false),
      ];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(rentInvoices.yardId, scopedIds));
      const list = await db
        .select({
          invoiceNo: rentInvoices.invoiceNo,
          id: rentInvoices.id,
          periodMonth: rentInvoices.periodMonth,
          tenantLicenceId: rentInvoices.tenantLicenceId,
          assetId: rentInvoices.assetId,
          yardId: rentInvoices.yardId,
          rentAmount: rentInvoices.rentAmount,
          cgst: rentInvoices.cgst,
          sgst: rentInvoices.sgst,
          totalAmount: rentInvoices.totalAmount,
        })
        .from(rentInvoices)
        .where(and(...conditions))
        .orderBy(desc(rentInvoices.periodMonth));
      const gstin = process.env.GSTIN || null;
      res.json({
        gstin,
        fromMonth,
        toMonth,
        supplies: list.map((r) => ({
          invoiceNo: r.invoiceNo ?? r.id,
          periodMonth: r.periodMonth,
          customerRef: r.tenantLicenceId,
          assetId: r.assetId,
          yardId: r.yardId,
          taxableValue: r.rentAmount,
          cgst: r.cgst,
          sgst: r.sgst,
          totalAmount: r.totalAmount,
        })),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to generate GSTR-1 export" });
    }
  });

  // ----- Credit notes -----
  app.get("/api/ioms/rent/credit-notes", async (req, res) => {
    try {
      const invoiceId = req.query.invoiceId as string | undefined;
      let list = await db.select().from(creditNotes).orderBy(desc(creditNotes.creditNoteNo));
      if (invoiceId) list = list.filter((r) => r.invoiceId === invoiceId);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch credit notes" });
    }
  });

  app.get("/api/ioms/rent/credit-notes/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Credit note not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch credit note" });
    }
  });

  app.post("/api/ioms/rent/credit-notes", async (req, res) => {
    try {
      const body = req.body;
      const invoiceId = String(body.invoiceId ?? "");
      if (!invoiceId) return res.status(400).json({ error: "invoiceId is required" });
      const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
      if (!inv) return res.status(404).json({ error: "Rent invoice not found" });
      if (inv.status === "Paid") return res.status(400).json({ error: "Credit note not allowed for paid invoice" });
      if (inv.status !== "Approved") return res.status(400).json({ error: "Credit note only for approved invoices" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return res.status(404).json({ error: "Rent invoice not found" });
      }
      const id = nanoid();
      await db.insert(creditNotes).values({
        id,
        creditNoteNo: String(body.creditNoteNo ?? ""),
        invoiceId,
        reason: String(body.reason ?? ""),
        amount: Number(body.amount ?? 0),
        status: String(body.status ?? "Draft"),
        daUser: body.daUser ? String(body.daUser) : null,
        approvedAt: body.approvedAt ? String(body.approvedAt) : null,
      });
      const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create credit note" });
    }
  });

  app.put("/api/ioms/rent/credit-notes/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["creditNoteNo", "invoiceId", "reason", "amount", "status", "daUser", "approvedAt"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "amount") updates.amount = Number(body.amount);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(creditNotes).set(updates as Record<string, string | number | null>).where(eq(creditNotes.id, id));
      const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update credit note" });
    }
  });
}
