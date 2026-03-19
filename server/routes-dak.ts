/**
 * IOMS M-09: Correspondence Management (Dak) API routes.
 * Tables: dak_inward, dak_outward, dak_action_log, dak_escalations.
 * Yard-scoped when yardId is set: list/get/create/update filter by req.scopedLocationIds; null yardId = visible to all.
 */
import type { Express } from "express";
import { eq, desc, and, inArray, or, isNull } from "drizzle-orm";
import { db } from "./db";
import { dakInward, dakOutward, dakActionLog, dakEscalations } from "@shared/db-schema";
import { nanoid } from "nanoid";

function dakYardInScope(req: Express.Request, yardId: string | null): boolean {
  if (yardId == null) return true;
  const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

export function registerDakRoutes(app: Express) {
  const now = () => new Date().toISOString();

  app.get("/api/ioms/dak/inward", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) {
        conditions.push(or(isNull(dakInward.yardId), inArray(dakInward.yardId, scopedIds)));
      }
      if (yardId) conditions.push(eq(dakInward.yardId, yardId));
      if (status) conditions.push(eq(dakInward.status, status));
      const base = db.select().from(dakInward).orderBy(desc(dakInward.receivedDate));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch inward dak" });
    }
  });

  app.get("/api/ioms/dak/inward/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Inward not found" });
      if (!dakYardInScope(req, row.yardId)) return res.status(404).json({ error: "Inward not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch inward" });
    }
  });

  app.post("/api/ioms/dak/inward", async (req, res) => {
    try {
      const body = req.body;
      const yardId = body.yardId != null ? String(body.yardId) : null;
      if (yardId != null && !dakYardInScope(req, yardId)) return res.status(403).json({ error: "You do not have access to this yard" });
      const id = nanoid();
      await db.insert(dakInward).values({
        id,
        yardId: yardId || null,
        receivedDate: String(body.receivedDate ?? ""),
        fromParty: String(body.fromParty ?? ""),
        subject: String(body.subject ?? ""),
        modeOfReceipt: String(body.modeOfReceipt ?? "Hand"),
        status: String(body.status ?? "Pending"),
        fromAddress: body.fromAddress ? String(body.fromAddress) : null,
        receivedBy: body.receivedBy ? String(body.receivedBy) : null,
        assignedTo: body.assignedTo ? String(body.assignedTo) : null,
        deadline: body.deadline ? String(body.deadline) : null,
        fileRef: body.fileRef ? String(body.fileRef) : null,
        diaryNo: body.diaryNo ? String(body.diaryNo) : null,
        createdAt: now(),
      });
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create inward" });
    }
  });

  app.put("/api/ioms/dak/inward/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      if (!existing) return res.status(404).json({ error: "Inward not found" });
      if (!dakYardInScope(req, existing.yardId)) return res.status(404).json({ error: "Inward not found" });
      const body = req.body;
      const newYardId = body.yardId !== undefined ? (body.yardId == null ? null : String(body.yardId)) : existing.yardId;
      if (body.yardId !== undefined && newYardId != null && !dakYardInScope(req, newYardId)) return res.status(403).json({ error: "You do not have access to this yard" });
      const updates: Record<string, unknown> = {};
      ["yardId", "diaryNo", "receivedDate", "fromParty", "fromAddress", "subject", "modeOfReceipt", "receivedBy", "assignedTo", "deadline", "fileRef", "status"].forEach((k) => {
        if (body[k] === undefined) return;
        updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(dakInward).set(updates as Record<string, string | null>).where(eq(dakInward.id, id));
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update inward" });
    }
  });

  app.get("/api/ioms/dak/inward/:inwardId/actions", async (req, res) => {
    try {
      const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, req.params.inwardId)).limit(1);
      if (!inward) return res.status(404).json({ error: "Inward not found" });
      if (!dakYardInScope(req, inward.yardId)) return res.status(404).json({ error: "Inward not found" });
      const list = await db.select().from(dakActionLog).where(eq(dakActionLog.inwardId, req.params.inwardId)).orderBy(desc(dakActionLog.actionDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch action log" });
    }
  });

  app.post("/api/ioms/dak/actions", async (req, res) => {
    try {
      const body = req.body;
      const inwardId = String(body.inwardId ?? "");
      const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, inwardId)).limit(1);
      if (!inward) return res.status(404).json({ error: "Inward not found" });
      if (!dakYardInScope(req, inward.yardId)) return res.status(403).json({ error: "You do not have access to this inward's yard" });
      const id = nanoid();
      await db.insert(dakActionLog).values({
        id,
        inwardId,
        actionBy: String(body.actionBy ?? ""),
        actionDate: body.actionDate ? String(body.actionDate) : now(),
        actionNote: body.actionNote ? String(body.actionNote) : null,
        statusAfter: body.statusAfter ? String(body.statusAfter) : null,
      });
      const [row] = await db.select().from(dakActionLog).where(eq(dakActionLog.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create action" });
    }
  });

  app.get("/api/ioms/dak/outward", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) {
        conditions.push(or(isNull(dakOutward.yardId), inArray(dakOutward.yardId, scopedIds)));
      }
      if (yardId) conditions.push(eq(dakOutward.yardId, yardId));
      const base = db.select().from(dakOutward).orderBy(desc(dakOutward.despatchDate));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch outward dak" });
    }
  });

  app.post("/api/ioms/dak/outward", async (req, res) => {
    try {
      const body = req.body;
      const yardId = body.yardId != null ? String(body.yardId) : null;
      if (yardId != null && !dakYardInScope(req, yardId)) return res.status(403).json({ error: "You do not have access to this yard" });
      const id = nanoid();
      await db.insert(dakOutward).values({
        id,
        yardId: yardId || null,
        despatchDate: String(body.despatchDate ?? ""),
        toParty: String(body.toParty ?? ""),
        subject: String(body.subject ?? ""),
        modeOfDespatch: String(body.modeOfDespatch ?? "Post"),
        toAddress: body.toAddress ? String(body.toAddress) : null,
        inwardRefId: body.inwardRefId ? String(body.inwardRefId) : null,
        fileRef: body.fileRef ? String(body.fileRef) : null,
        despatchedBy: body.despatchedBy ? String(body.despatchedBy) : null,
        despatchNo: body.despatchNo ? String(body.despatchNo) : null,
        createdAt: now(),
      });
      const [row] = await db.select().from(dakOutward).where(eq(dakOutward.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create outward" });
    }
  });

  app.get("/api/ioms/dak/escalations", async (req, res) => {
    try {
      const inwardId = req.query.inwardId as string | undefined;
      let list = await db.select().from(dakEscalations).orderBy(desc(dakEscalations.escalatedAt));
      if (inwardId) {
        const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, inwardId)).limit(1);
        if (!inward || !dakYardInScope(req, inward.yardId)) return res.status(404).json({ error: "Inward not found" });
        list = list.filter((r) => r.inwardId === inwardId);
      } else {
        const inwards = await db.select({ id: dakInward.id, yardId: dakInward.yardId }).from(dakInward);
        const allowedIds = new Set(
          inwards.filter((i) => dakYardInScope(req, i.yardId)).map((i) => i.id)
        );
        list = list.filter((r) => allowedIds.has(r.inwardId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch escalations" });
    }
  });

  app.post("/api/ioms/dak/escalations", async (req, res) => {
    try {
      const body = req.body;
      const inwardId = String(body.inwardId ?? "");
      const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, inwardId)).limit(1);
      if (!inward) return res.status(404).json({ error: "Inward not found" });
      if (!dakYardInScope(req, inward.yardId)) return res.status(403).json({ error: "You do not have access to this inward's yard" });
      const id = nanoid();
      await db.insert(dakEscalations).values({
        id,
        inwardId,
        escalatedTo: String(body.escalatedTo ?? ""),
        escalatedAt: body.escalatedAt ? String(body.escalatedAt) : now(),
        escalationReason: body.escalationReason ? String(body.escalationReason) : null,
        resolvedAt: body.resolvedAt ? String(body.resolvedAt) : null,
      });
      const [row] = await db.select().from(dakEscalations).where(eq(dakEscalations.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create escalation" });
    }
  });
}
