/**
 * IOMS M-09: Correspondence Management (Dak) API routes.
 * Tables: dak_inward, dak_outward, dak_action_log, dak_escalations.
 * Yard-scoped when yardId is set: list/get/create/update filter by req.scopedLocationIds; null yardId = visible to all.
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { eq, desc, and, inArray, or, isNull, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { dakInward, dakOutward, dakActionLog, dakEscalations } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { generateNextDakDiaryNo, generateNextTapalRef } from "./dak-diary-sequence";
import { routeParamString } from "./route-params";
import {
  contentTypeForVoucherAttachment,
  extFromVoucherAttachmentMime,
  isAllowedVoucherAttachmentFileName,
} from "./voucher-attachment-storage";
import { readDakAttachmentBuffer, unlinkDakAttachmentIfExists, writeDakAttachmentBuffer } from "./dak-attachment-storage";

const MAX_DAK_ATTACHMENTS = 20;

const dakAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter(_req, file, cb) {
    if (extFromVoucherAttachmentMime(file.mimetype)) return cb(null, true);
    cb(new Error("DAK_ATTACHMENT_MIME"));
  },
});

function multerDakAttachments(req: Request, res: Response, next: NextFunction): void {
  dakAttachmentUpload.array("files", 5)(req, res, (err: unknown) => {
    if (!err) return next();
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (msg === "DAK_ATTACHMENT_MIME") {
      return sendApiError(res, 400, "DAK_ATTACHMENT_MIME", "Only PDF, PNG, or JPEG files are allowed.");
    }
    if (err && typeof err === "object" && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
      return sendApiError(res, 400, "DAK_ATTACHMENT_TOO_LARGE", "Each file must be 8 MB or smaller.");
    }
    console.error(err);
    return sendApiError(res, 400, "DAK_ATTACHMENT_UPLOAD_FAILED", msg);
  });
}

function dakYardInScope(req: Express.Request, yardId: string | null): boolean {
  if (yardId == null) return true;
  const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerDakRoutes(app: Express) {
  const now = () => new Date().toISOString();

  app.get("/api/ioms/dak/inward", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const yardId = req.query.yardId as string | undefined;
      const subjectQ = (req.query.subject as string | undefined)?.trim();
      const assignedToMe =
        req.query.assignedToMe === "1" || String(req.query.assignedToMe ?? "").toLowerCase() === "true";
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) {
        conditions.push(or(isNull(dakInward.yardId), inArray(dakInward.yardId, scopedIds)));
      }
      if (yardId) conditions.push(eq(dakInward.yardId, yardId));
      if (status) conditions.push(eq(dakInward.status, status));
      if (subjectQ) {
        conditions.push(sql`position(lower(${subjectQ}) in lower(${dakInward.subject})) > 0`);
      }
      if (assignedToMe) {
        const u = req.user;
        const candidates = [u?.id, u?.email, u?.name].filter((x): x is string => Boolean(x && String(x).trim()));
        if (candidates.length > 0) {
          conditions.push(inArray(dakInward.assignedTo, candidates));
          conditions.push(ne(dakInward.status, "Closed"));
        }
      }
      const base = db.select().from(dakInward).orderBy(desc(dakInward.receivedDate));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch inward dak");
    }
  });

  /**
   * M-09: group inward rows by normalised subject (trim + case-insensitive) for subject-file style navigation.
   * Same yard scope as GET /inward. Optional ?yardId=
   */
  app.get("/api/ioms/dak/inward/subject-summary", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) {
        conditions.push(or(isNull(dakInward.yardId), inArray(dakInward.yardId, scopedIds)));
      }
      if (yardId) conditions.push(eq(dakInward.yardId, yardId));
      const base = db.select({ subject: dakInward.subject }).from(dakInward);
      const rows = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      const map = new Map<string, { sampleSubject: string; count: number }>();
      for (const r of rows) {
        const sub = (r.subject ?? "").trim();
        if (!sub) continue;
        const key = sub.toLowerCase();
        const cur = map.get(key);
        if (!cur) map.set(key, { sampleSubject: sub, count: 1 });
        else cur.count += 1;
      }
      const groups = Array.from(map.values())
        .map((v) => ({
          sampleSubject: v.sampleSubject,
          count: v.count,
        }))
        .sort((a, b) => b.count - a.count || a.sampleSubject.localeCompare(b.sampleSubject));
      res.json({ groups });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch dak subject summary");
    }
  });

  /** M-09: inward items with deadline on or before today, not Closed (SLA-style). */
  app.get("/api/ioms/dak/inward/sla-overdue", async (req, res) => {
    try {
      const asOf = todayUtcYmd();
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [
        isNotNull(dakInward.deadline),
        lte(dakInward.deadline, asOf),
        ne(dakInward.status, "Closed"),
      ];
      if (scopedIds && scopedIds.length > 0) {
        const yardScope = or(isNull(dakInward.yardId), inArray(dakInward.yardId, scopedIds));
        if (yardScope) conditions.push(yardScope);
      }
      const rows = await db
        .select()
        .from(dakInward)
        .where(and(...conditions))
        .orderBy(desc(dakInward.deadline));
      res.json({ asOf, count: rows.length, rows });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch Dak SLA overdue list");
    }
  });

  /** M-09: upload scans for inward dak (M-09:Update). */
  app.post("/api/ioms/dak/inward/:id/attachments", multerDakAttachments, async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(dakInward).where(eq(dakInward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, existing.yardId)) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_REQUIRED", "Choose one or more files (field name: files).");
      }
      const prev = Array.isArray(existing.attachments) ? [...existing.attachments] : [];
      if (prev.length >= MAX_DAK_ATTACHMENTS) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_LIMIT", `At most ${MAX_DAK_ATTACHMENTS} files per inward record.`);
      }
      const room = MAX_DAK_ATTACHMENTS - prev.length;
      const take = files.slice(0, room);
      const added: string[] = [];
      for (const file of take) {
        const ext = extFromVoucherAttachmentMime(file.mimetype);
        if (!ext) continue;
        const stored = `${nanoid(16)}${ext}`;
        await writeDakAttachmentBuffer("inward", id, stored, file.buffer);
        added.push(stored);
      }
      if (!added.length) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_REQUIRED", "No valid files were saved.");
      }
      const nextDocs = [...prev, ...added];
      await db.update(dakInward).set({ attachments: nextDocs }).where(eq(dakInward.id, id));
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      writeAuditLog(req, {
        module: "Dak",
        action: "UploadInwardAttachments",
        recordId: id,
        beforeValue: { attachments: prev },
        afterValue: { attachments: nextDocs },
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to upload dak inward attachments");
    }
  });

  app.get("/api/ioms/dak/inward/:id/files/:fileName", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const fileName = routeParamString(req.params.fileName);
      if (!isAllowedVoucherAttachmentFileName(fileName)) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_NAME_INVALID", "Invalid file name");
      }
      const [existing] = await db.select().from(dakInward).where(eq(dakInward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, existing.yardId)) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      const docs = Array.isArray(existing.attachments) ? existing.attachments : [];
      if (!docs.includes(fileName)) {
        return sendApiError(res, 404, "DAK_ATTACHMENT_NOT_FOUND", "File not found for this inward");
      }
      const buf = await readDakAttachmentBuffer("inward", id, fileName);
      if (!buf?.length) return sendApiError(res, 404, "DAK_ATTACHMENT_NOT_FOUND", "File missing on server");
      res.setHeader("Content-Type", contentTypeForVoucherAttachment(fileName));
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read dak inward attachment");
    }
  });

  app.delete("/api/ioms/dak/inward/:id/files/:fileName", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const fileName = routeParamString(req.params.fileName);
      if (!isAllowedVoucherAttachmentFileName(fileName)) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_NAME_INVALID", "Invalid file name");
      }
      const [existing] = await db.select().from(dakInward).where(eq(dakInward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, existing.yardId)) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      const prev = Array.isArray(existing.attachments) ? [...existing.attachments] : [];
      if (!prev.includes(fileName)) {
        return sendApiError(res, 404, "DAK_ATTACHMENT_NOT_FOUND", "File not found for this inward");
      }
      const nextDocs = prev.filter((n) => n !== fileName);
      await unlinkDakAttachmentIfExists("inward", id, fileName);
      await db.update(dakInward).set({ attachments: nextDocs.length ? nextDocs : null }).where(eq(dakInward.id, id));
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      writeAuditLog(req, {
        module: "Dak",
        action: "DeleteInwardAttachment",
        recordId: id,
        beforeValue: { attachments: prev },
        afterValue: { attachments: row?.attachments ?? null },
      }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete dak inward attachment");
    }
  });

  app.get("/api/ioms/dak/inward/:id", async (req, res) => {
    try {
      const inwardId = routeParamString(req.params.id);
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, inwardId)).limit(1);
      if (!row) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, row.yardId)) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch inward");
    }
  });

  app.post("/api/ioms/dak/inward", async (req, res) => {
    try {
      const body = req.body;
      const yardId = body.yardId != null ? String(body.yardId) : null;
      if (yardId != null && !dakYardInScope(req, yardId)) return sendApiError(res, 403, "DAK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const receivedDateRaw = String(body.receivedDate ?? "").trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
      const manualDiary = body.diaryNo != null ? String(body.diaryNo).trim() : "";
      let diaryNo: string | null = manualDiary || null;
      if (!diaryNo) {
        // SRS v3 prefers "Tapal" format, but field remains diaryNo for compatibility.
        diaryNo = await generateNextTapalRef({ kind: "IN", yardId, date: receivedDateRaw });
      }
      const id = nanoid();
      await db.insert(dakInward).values({
        id,
        yardId: yardId || null,
        receivedDate: receivedDateRaw,
        fromParty: String(body.fromParty ?? ""),
        subject: String(body.subject ?? ""),
        modeOfReceipt: String(body.modeOfReceipt ?? "Hand"),
        status: String(body.status ?? "Pending"),
        fromAddress: body.fromAddress ? String(body.fromAddress) : null,
        receivedBy: body.receivedBy ? String(body.receivedBy) : null,
        assignedTo: body.assignedTo ? String(body.assignedTo) : null,
        deadline: body.deadline ? String(body.deadline) : null,
        fileRef: body.fileRef ? String(body.fileRef) : null,
        attachments: null,
        diaryNo,
        createdAt: now(),
      });
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      if (row) writeAuditLog(req, { module: "Dak", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e: unknown) {
      console.error(e);
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
      if (code === "23505") {
        return sendApiError(res, 409, "DAK_DIARY_NO_DUPLICATE", "Diary number already exists; leave blank for auto or choose another.");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create inward");
    }
  });

  app.put("/api/ioms/dak/inward/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      if (!existing) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, existing.yardId)) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      const body = req.body;
      const newYardId = body.yardId !== undefined ? (body.yardId == null ? null : String(body.yardId)) : existing.yardId;
      if (body.yardId !== undefined && newYardId != null && !dakYardInScope(req, newYardId)) return sendApiError(res, 403, "DAK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const updates: Record<string, unknown> = {};
      ["yardId", "diaryNo", "receivedDate", "fromParty", "fromAddress", "subject", "modeOfReceipt", "receivedBy", "assignedTo", "deadline", "fileRef", "status"].forEach((k) => {
        if (body[k] === undefined) return;
        updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(dakInward).set(updates as Record<string, string | null>).where(eq(dakInward.id, id));
      const [row] = await db.select().from(dakInward).where(eq(dakInward.id, id));
      if (!row) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Dak", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update inward");
    }
  });

  app.get("/api/ioms/dak/inward/:inwardId/actions", async (req, res) => {
    try {
      const inwardIdParam = routeParamString(req.params.inwardId);
      const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, inwardIdParam)).limit(1);
      if (!inward) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, inward.yardId)) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      const list = await db
        .select()
        .from(dakActionLog)
        .where(eq(dakActionLog.inwardId, inwardIdParam))
        .orderBy(desc(dakActionLog.actionDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch action log");
    }
  });

  app.post("/api/ioms/dak/actions", async (req, res) => {
    try {
      const body = req.body;
      const inwardId = String(body.inwardId ?? "");
      const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, inward.yardId)) return sendApiError(res, 403, "DAK_INWARD_YARD_ACCESS_DENIED", "You do not have access to this inward's yard");
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
      if (row) writeAuditLog(req, { module: "Dak", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create action");
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
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch outward dak");
    }
  });

  app.post("/api/ioms/dak/outward", async (req, res) => {
    try {
      const body = req.body;
      const yardId = body.yardId != null ? String(body.yardId) : null;
      if (yardId != null && !dakYardInScope(req, yardId)) return sendApiError(res, 403, "DAK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const despatchDateRaw = String(body.despatchDate ?? "").trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
      const manualDespatch = body.despatchNo != null ? String(body.despatchNo).trim() : "";
      const despatchNo = manualDespatch || (await generateNextTapalRef({ kind: "OUT", yardId, date: despatchDateRaw }));
      const id = nanoid();
      await db.insert(dakOutward).values({
        id,
        yardId: yardId || null,
        despatchDate: despatchDateRaw,
        toParty: String(body.toParty ?? ""),
        subject: String(body.subject ?? ""),
        modeOfDespatch: String(body.modeOfDespatch ?? "Post"),
        toAddress: body.toAddress ? String(body.toAddress) : null,
        inwardRefId: body.inwardRefId ? String(body.inwardRefId) : null,
        fileRef: body.fileRef ? String(body.fileRef) : null,
        attachments: null,
        despatchedBy: body.despatchedBy ? String(body.despatchedBy) : null,
        despatchNo,
        createdAt: now(),
      });
      const [row] = await db.select().from(dakOutward).where(eq(dakOutward.id, id));
      if (row) writeAuditLog(req, { module: "Dak", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create outward");
    }
  });

  app.get("/api/ioms/dak/outward/:id", async (req, res) => {
    try {
      const outwardId = routeParamString(req.params.id);
      const [row] = await db.select().from(dakOutward).where(eq(dakOutward.id, outwardId)).limit(1);
      if (!row) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      if (!dakYardInScope(req, row.yardId)) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch outward");
    }
  });

  app.post("/api/ioms/dak/outward/:id/attachments", multerDakAttachments, async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(dakOutward).where(eq(dakOutward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      if (!dakYardInScope(req, existing.yardId)) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_REQUIRED", "Choose one or more files (field name: files).");
      }
      const prev = Array.isArray(existing.attachments) ? [...existing.attachments] : [];
      if (prev.length >= MAX_DAK_ATTACHMENTS) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_LIMIT", `At most ${MAX_DAK_ATTACHMENTS} files per outward record.`);
      }
      const room = MAX_DAK_ATTACHMENTS - prev.length;
      const take = files.slice(0, room);
      const added: string[] = [];
      for (const file of take) {
        const ext = extFromVoucherAttachmentMime(file.mimetype);
        if (!ext) continue;
        const stored = `${nanoid(16)}${ext}`;
        await writeDakAttachmentBuffer("outward", id, stored, file.buffer);
        added.push(stored);
      }
      if (!added.length) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_REQUIRED", "No valid files were saved.");
      }
      const nextDocs = [...prev, ...added];
      await db.update(dakOutward).set({ attachments: nextDocs }).where(eq(dakOutward.id, id));
      const [row] = await db.select().from(dakOutward).where(eq(dakOutward.id, id));
      writeAuditLog(req, {
        module: "Dak",
        action: "UploadOutwardAttachments",
        recordId: id,
        beforeValue: { attachments: prev },
        afterValue: { attachments: nextDocs },
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to upload dak outward attachments");
    }
  });

  app.get("/api/ioms/dak/outward/:id/files/:fileName", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const fileName = routeParamString(req.params.fileName);
      if (!isAllowedVoucherAttachmentFileName(fileName)) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_NAME_INVALID", "Invalid file name");
      }
      const [existing] = await db.select().from(dakOutward).where(eq(dakOutward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      if (!dakYardInScope(req, existing.yardId)) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      const docs = Array.isArray(existing.attachments) ? existing.attachments : [];
      if (!docs.includes(fileName)) {
        return sendApiError(res, 404, "DAK_ATTACHMENT_NOT_FOUND", "File not found for this outward");
      }
      const buf = await readDakAttachmentBuffer("outward", id, fileName);
      if (!buf?.length) return sendApiError(res, 404, "DAK_ATTACHMENT_NOT_FOUND", "File missing on server");
      res.setHeader("Content-Type", contentTypeForVoucherAttachment(fileName));
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read dak outward attachment");
    }
  });

  app.delete("/api/ioms/dak/outward/:id/files/:fileName", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const fileName = routeParamString(req.params.fileName);
      if (!isAllowedVoucherAttachmentFileName(fileName)) {
        return sendApiError(res, 400, "DAK_ATTACHMENT_NAME_INVALID", "Invalid file name");
      }
      const [existing] = await db.select().from(dakOutward).where(eq(dakOutward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      if (!dakYardInScope(req, existing.yardId)) return sendApiError(res, 404, "DAK_OUTWARD_NOT_FOUND", "Outward not found");
      const prev = Array.isArray(existing.attachments) ? [...existing.attachments] : [];
      if (!prev.includes(fileName)) {
        return sendApiError(res, 404, "DAK_ATTACHMENT_NOT_FOUND", "File not found for this outward");
      }
      const nextDocs = prev.filter((n) => n !== fileName);
      await unlinkDakAttachmentIfExists("outward", id, fileName);
      await db.update(dakOutward).set({ attachments: nextDocs.length ? nextDocs : null }).where(eq(dakOutward.id, id));
      const [row] = await db.select().from(dakOutward).where(eq(dakOutward.id, id));
      writeAuditLog(req, {
        module: "Dak",
        action: "DeleteOutwardAttachment",
        recordId: id,
        beforeValue: { attachments: prev },
        afterValue: { attachments: row?.attachments ?? null },
      }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete dak outward attachment");
    }
  });

  app.get("/api/ioms/dak/escalations", async (req, res) => {
    try {
      const inwardId = req.query.inwardId as string | undefined;
      let list = await db.select().from(dakEscalations).orderBy(desc(dakEscalations.escalatedAt));
      if (inwardId) {
        const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, inwardId)).limit(1);
        if (!inward || !dakYardInScope(req, inward.yardId)) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
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
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch escalations");
    }
  });

  app.post("/api/ioms/dak/escalations", async (req, res) => {
    try {
      const body = req.body;
      const inwardId = String(body.inwardId ?? "");
      const [inward] = await db.select().from(dakInward).where(eq(dakInward.id, inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "DAK_INWARD_NOT_FOUND", "Inward not found");
      if (!dakYardInScope(req, inward.yardId)) return sendApiError(res, 403, "DAK_INWARD_YARD_ACCESS_DENIED", "You do not have access to this inward's yard");
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
      if (row) writeAuditLog(req, { module: "Dak", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create escalation");
    }
  });
}
