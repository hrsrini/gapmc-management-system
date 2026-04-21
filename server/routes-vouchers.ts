/**
 * IOMS M-06: Payment Voucher Management API routes.
 * Tables: expenditure_heads, payment_vouchers, advance_requests.
 * Workflow: DO creates Draft; DV verifies (→Verified); DA approves (→Approved/Rejected) and pays (→Paid).
 * Scoped by user yards.
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "./db";
import { expenditureHeads, paymentVouchers, advanceRequests } from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canCreateVoucher,
  canEditDraftVoucher,
  canTransitionVoucher,
  assertSegregationDoDvDa,
  voucherAwaitingMyAction,
} from "./workflow";
import { validateDaRejection, validateDvReturnToDraft } from "@shared/workflow-rejection";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { routeParamString } from "./route-params";
import {
  contentTypeForVoucherAttachment,
  ensureVoucherAttachmentsDir,
  extFromVoucherAttachmentMime,
  isAllowedVoucherAttachmentFileName,
  unlinkVoucherAttachmentIfExists,
  voucherAttachmentFilePath,
} from "./voucher-attachment-storage";

const MAX_VOUCHER_ATTACHMENTS = 20;

const voucherAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter(_req, file, cb) {
    if (extFromVoucherAttachmentMime(file.mimetype)) return cb(null, true);
    cb(new Error("VOUCHER_ATTACHMENT_MIME"));
  },
});

function multerVoucherAttachments(req: Request, res: Response, next: NextFunction): void {
  voucherAttachmentUpload.array("files", 5)(req, res, (err: unknown) => {
    if (!err) return next();
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (msg === "VOUCHER_ATTACHMENT_MIME") {
      return sendApiError(res, 400, "VOUCHER_ATTACHMENT_MIME", "Only PDF, PNG, or JPEG files are allowed.");
    }
    if (err && typeof err === "object" && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
      return sendApiError(res, 400, "VOUCHER_ATTACHMENT_TOO_LARGE", "Each file must be 8 MB or smaller.");
    }
    console.error(err);
    return sendApiError(res, 400, "VOUCHER_ATTACHMENT_UPLOAD_FAILED", msg);
  });
}

function formatIsoDateToDDMMYYYY(isoYmd: string): string {
  const part = String(isoYmd).trim().slice(0, 10);
  const d = new Date(`${part}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return part;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** YYYY-MM (statement month) → DD-MM-YYYY using first of month. */
function formatYearMonthToDDMMYYYY(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym).trim().slice(0, 7));
  if (!m) return ym;
  return `01-${m[2]}-${m[1]}`;
}

export function registerVoucherRoutes(app: Express) {
  const now = () => new Date().toISOString();

  app.get("/api/ioms/expenditure-heads", async (_req, res) => {
    try {
      const list = await db.select().from(expenditureHeads).orderBy(expenditureHeads.code);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch expenditure heads");
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
        tallyLedgerId: body.tallyLedgerId ? String(body.tallyLedgerId) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      });
      const [row] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id));
      writeAuditLog(req, { module: "Vouchers", action: "CreateExpenditureHead", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create expenditure head");
    }
  });

  app.put("/api/ioms/expenditure-heads/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [before] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id)).limit(1);
      if (!before) return sendApiError(res, 404, "EXPENDITURE_HEAD_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["code", "description", "category", "isActive", "tallyLedgerId"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "isActive") updates.isActive = Boolean(body.isActive);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(expenditureHeads).set(updates as Record<string, string | boolean | null>).where(eq(expenditureHeads.id, id));
      const [row] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id));
      if (!row) return sendApiError(res, 404, "EXPENDITURE_HEAD_NOT_FOUND", "Not found");
      writeAuditLog(req, {
        module: "Vouchers",
        action: "UpdateExpenditureHead",
        recordId: id,
        beforeValue: before,
        afterValue: row,
      }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update expenditure head");
    }
  });

  app.get("/api/ioms/vouchers", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const pendingMyAction =
        req.query.pendingMyAction === "1" ||
        String(req.query.pendingMyAction ?? "").toLowerCase() === "true";
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(paymentVouchers.yardId, scopedIds));
      if (yardId) conditions.push(eq(paymentVouchers.yardId, yardId));
      if (status) conditions.push(eq(paymentVouchers.status, status));
      const base = db.select().from(paymentVouchers).orderBy(desc(paymentVouchers.createdAt));
      let list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      if (pendingMyAction) {
        list = list.filter((row) => voucherAwaitingMyAction(req.user, row));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch vouchers");
    }
  });

  /** M-06: monthly statement by expenditure head (Paid vouchers with paidAt in calendar month). */
  app.get("/api/ioms/vouchers/monthly-statement", async (req, res) => {
    try {
      const monthRaw = String(req.query.month ?? "").trim();
      const m = /^(\d{4})-(\d{2})$/.exec(monthRaw);
      if (!m) {
        return sendApiError(res, 400, "VOUCHER_STATEMENT_MONTH_INVALID", "Query month=YYYY-MM is required");
      }
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (mo < 1 || mo > 12) {
        return sendApiError(res, 400, "VOUCHER_STATEMENT_MONTH_INVALID", "Invalid month");
      }
      const monthStart = `${y}-${String(mo).padStart(2, "0")}-01`;
      const lastDay = new Date(y, mo, 0).getDate();
      const monthEnd = `${y}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const yardFilter = req.query.yardId as string | undefined;
      const scopedIds = req.scopedLocationIds;

      const headRows = await db.select().from(expenditureHeads);
      const headById = Object.fromEntries(headRows.map((h) => [h.id, h]));

      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(paymentVouchers.yardId, scopedIds));
      if (yardFilter) conditions.push(eq(paymentVouchers.yardId, yardFilter));

      const base = db.select().from(paymentVouchers);
      const all =
        conditions.length > 0 ? await base.where(and(...conditions)) : await base;

      const inMonth = all.filter((v) => {
        if (v.status !== "Paid" || !v.paidAt) return false;
        const d = String(v.paidAt).slice(0, 10);
        return d >= monthStart && d <= monthEnd;
      });

      type Agg = {
        expenditureHeadId: string;
        headCode: string;
        headDescription: string;
        voucherCount: number;
        totalAmount: number;
      };
      const map = new Map<string, Agg>();
      for (const v of inMonth) {
        const h = headById[v.expenditureHeadId];
        const code = h?.code ?? v.expenditureHeadId;
        const desc = h?.description ?? "";
        const cur = map.get(v.expenditureHeadId) ?? {
          expenditureHeadId: v.expenditureHeadId,
          headCode: code,
          headDescription: desc,
          voucherCount: 0,
          totalAmount: 0,
        };
        cur.voucherCount += 1;
        cur.totalAmount += Number(v.amount) || 0;
        map.set(v.expenditureHeadId, cur);
      }
      const rows = Array.from(map.values()).sort((a, b) => a.headCode.localeCompare(b.headCode));
      const grandTotal = rows.reduce((s, r) => s + r.totalAmount, 0);

      const payload = {
        month: monthRaw,
        basis: "paid" as const,
        monthStart,
        monthEnd,
        yardId: yardFilter ?? null,
        voucherCount: inMonth.length,
        grandTotal,
        rows,
      };

      const fmt = String(req.query.format ?? "").toLowerCase();
      if (fmt === "csv") {
        const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
        const lines = [
          "Expenditure head code,Description,Voucher count,Total amount (INR)",
          ...rows.map((r) =>
            [esc(r.headCode), esc(r.headDescription), String(r.voucherCount), String(r.totalAmount)].join(","),
          ),
          ["Grand total", "", String(inMonth.length), String(grandTotal)].join(","),
        ];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="voucher-statement-${monthRaw}.csv"`);
        res.send("\uFEFF" + lines.join("\r\n"));
        return;
      }

      if (fmt === "xlsx") {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();
        const aoa = [
          ["Expenditure head code", "Description", "Voucher count", "Total amount (INR)"],
          ...rows.map((r) => [r.headCode, r.headDescription, r.voucherCount, r.totalAmount] as (string | number)[]),
          ["Grand total", "", inMonth.length, grandTotal],
        ];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(wb, ws, "Statement");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="voucher-statement-${monthRaw}.xlsx"`);
        res.send(Buffer.from(buf));
        return;
      }

      if (fmt === "pdf") {
        const { default: PDFDocument } = await import("pdfkit");
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        await new Promise<void>((resolve, reject) => {
          doc.on("end", () => resolve());
          doc.on("error", reject);
          doc.fontSize(16).text(`Monthly voucher statement — ${formatYearMonthToDDMMYYYY(monthRaw)}`, { underline: true });
          doc.moveDown();
          doc
            .fontSize(10)
            .text(
              `Paid date range: ${formatIsoDateToDDMMYYYY(monthStart)} to ${formatIsoDateToDDMMYYYY(monthEnd)}. Yard filter: ${yardFilter ?? "all scoped locations"}.`,
            );
          doc.moveDown();
          for (const r of rows) {
            doc
              .fontSize(10)
              .text(
                `${r.headCode} — ${r.headDescription}: ${r.voucherCount} voucher(s), ₹${Number(r.totalAmount).toFixed(2)}`,
              );
          }
          doc.moveDown();
          doc.fontSize(11).text(`Grand total: ₹${grandTotal.toFixed(2)} (${inMonth.length} paid voucher(s))`);
          doc.end();
        });
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="voucher-statement-${monthRaw}.pdf"`);
        res.send(pdfBuffer);
        return;
      }

      res.json(payload);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build monthly statement");
    }
  });

  app.get("/api/ioms/vouchers/:id", async (req, res) => {
    try {
      const voucherId = routeParamString(req.params.id);
      const [row] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, voucherId)).limit(1);
      if (!row) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch voucher");
    }
  });

  /** M-06: upload supporting documents (Draft / Submitted only; DO / Admin). */
  app.post("/api/ioms/vouchers/:id/attachments", multerVoucherAttachments, async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      }
      if (existing.status !== "Draft" && existing.status !== "Submitted") {
        return sendApiError(
          res,
          403,
          "VOUCHER_ATTACHMENT_STATUS",
          "Supporting documents can only be added while the voucher is Draft or Submitted.",
        );
      }
      if (!canEditDraftVoucher(req.user)) {
        return sendApiError(res, 403, "VOUCHER_ATTACHMENT_DENIED", "Only Data Originator or Admin can upload attachments.");
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) {
        return sendApiError(res, 400, "VOUCHER_ATTACHMENT_REQUIRED", "Choose one or more files (field name: files).");
      }
      const prev = Array.isArray(existing.supportingDocs) ? [...existing.supportingDocs] : [];
      if (prev.length >= MAX_VOUCHER_ATTACHMENTS) {
        return sendApiError(
          res,
          400,
          "VOUCHER_ATTACHMENT_LIMIT",
          `At most ${MAX_VOUCHER_ATTACHMENTS} supporting files per voucher.`,
        );
      }
      const room = MAX_VOUCHER_ATTACHMENTS - prev.length;
      const take = files.slice(0, room);
      const added: string[] = [];
      ensureVoucherAttachmentsDir(id);
      for (const file of take) {
        const ext = extFromVoucherAttachmentMime(file.mimetype);
        if (!ext) continue;
        const stored = `${nanoid(16)}${ext}`;
        const dest = voucherAttachmentFilePath(id, stored);
        fs.writeFileSync(dest, file.buffer);
        added.push(stored);
      }
      if (!added.length) {
        return sendApiError(res, 400, "VOUCHER_ATTACHMENT_REQUIRED", "No valid files were saved.");
      }
      const nextDocs = [...prev, ...added];
      await db.update(paymentVouchers).set({ supportingDocs: nextDocs }).where(eq(paymentVouchers.id, id));
      const [row] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id));
      writeAuditLog(req, {
        module: "Vouchers",
        action: "UploadAttachments",
        recordId: id,
        beforeValue: { supportingDocs: prev },
        afterValue: { supportingDocs: nextDocs },
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to upload voucher attachments");
    }
  });

  app.get("/api/ioms/vouchers/:id/files/:fileName", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const fileName = routeParamString(req.params.fileName);
      if (!isAllowedVoucherAttachmentFileName(fileName)) {
        return sendApiError(res, 400, "VOUCHER_ATTACHMENT_NAME_INVALID", "Invalid file name");
      }
      const [existing] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      }
      const docs = Array.isArray(existing.supportingDocs) ? existing.supportingDocs : [];
      if (!docs.includes(fileName)) {
        return sendApiError(res, 404, "VOUCHER_ATTACHMENT_NOT_FOUND", "File not found for this voucher");
      }
      const abs = voucherAttachmentFilePath(id, fileName);
      if (!fs.existsSync(abs)) {
        return sendApiError(res, 404, "VOUCHER_ATTACHMENT_NOT_FOUND", "File missing on server");
      }
      const buf = fs.readFileSync(abs);
      res.setHeader("Content-Type", contentTypeForVoucherAttachment(fileName));
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read attachment");
    }
  });

  app.delete("/api/ioms/vouchers/:id/files/:fileName", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const fileName = routeParamString(req.params.fileName);
      if (!isAllowedVoucherAttachmentFileName(fileName)) {
        return sendApiError(res, 400, "VOUCHER_ATTACHMENT_NAME_INVALID", "Invalid file name");
      }
      const [existing] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      }
      if (existing.status !== "Draft" && existing.status !== "Submitted") {
        return sendApiError(
          res,
          403,
          "VOUCHER_ATTACHMENT_STATUS",
          "Attachments can only be removed while the voucher is Draft or Submitted.",
        );
      }
      if (!canEditDraftVoucher(req.user)) {
        return sendApiError(res, 403, "VOUCHER_ATTACHMENT_DENIED", "Only Data Originator or Admin can remove attachments.");
      }
      const prev = Array.isArray(existing.supportingDocs) ? [...existing.supportingDocs] : [];
      if (!prev.includes(fileName)) {
        return sendApiError(res, 404, "VOUCHER_ATTACHMENT_NOT_FOUND", "File not found for this voucher");
      }
      const nextDocs = prev.filter((n) => n !== fileName);
      unlinkVoucherAttachmentIfExists(id, fileName);
      await db.update(paymentVouchers).set({ supportingDocs: nextDocs.length ? nextDocs : null }).where(eq(paymentVouchers.id, id));
      const [row] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id));
      writeAuditLog(req, {
        module: "Vouchers",
        action: "DeleteAttachment",
        recordId: id,
        beforeValue: { supportingDocs: prev },
        afterValue: { supportingDocs: row?.supportingDocs ?? null },
      }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete attachment");
    }
  });

  app.post("/api/ioms/vouchers", async (req, res) => {
    try {
      if (!canCreateVoucher(req.user)) {
        return sendApiError(
          res,
          403,
          "VOUCHER_CREATE_DENIED",
          "Only Data Originator or Admin can create vouchers",
        );
      }
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "VOUCHER_YARD_ACCESS_DENIED", "You do not have access to this yard");
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
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create voucher");
    }
  });

  app.put("/api/ioms/vouchers/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id)).limit(1);
      if (!existing) {
        return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionVoucher(req.user, existing.status, newStatus) : null;

      let rejectionPayload: { code: string; remarks: string } | null = null;
      let returnToDraftRemarks: string | null = null;

      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "VOUCHER_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${existing.status} to ${newStatus}. Only DV can verify; only DA can approve or reject.`,
          );
        }
        const seg = assertSegregationDoDvDa(req.user, existing, {
          setDvUser: transition?.setDvUser,
          setDaUser: transition?.setDaUser,
        });
        if (!seg.ok) {
          return sendApiError(res, 403, "VOUCHER_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (newStatus === "Rejected") {
          const rej = validateDaRejection(body as Record<string, unknown>);
          if (!rej.ok) return sendApiError(res, 400, "VOUCHER_DA_REJECTION_INVALID", rej.error);
          rejectionPayload = { code: rej.code, remarks: rej.remarks };
        }
        if (existing.status === "Submitted" && newStatus === "Draft") {
          const ret = validateDvReturnToDraft(body as Record<string, unknown>);
          if (!ret.ok) return sendApiError(res, 400, "VOUCHER_RETURN_TO_DRAFT_INVALID", ret.error);
          returnToDraftRemarks = ret.remarks;
        }
      } else if (
        (existing.status === "Draft" || existing.status === "Submitted") &&
        !canEditDraftVoucher(req.user)
      ) {
        return sendApiError(
          res,
          403,
          "VOUCHER_DRAFT_EDIT_DENIED",
          "Only Data Originator or Admin can edit draft vouchers",
        );
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

      if (rejectionPayload) {
        updates.rejectionReasonCode = rejectionPayload.code;
        updates.rejectionRemarks = rejectionPayload.remarks;
      }
      if (statusChange && newStatus === "Approved") {
        updates.rejectionReasonCode = null;
        updates.rejectionRemarks = null;
      }
      if (returnToDraftRemarks !== null) {
        updates.dvReturnRemarks = returnToDraftRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
      }

      await db.update(paymentVouchers).set(updates as Record<string, unknown>).where(eq(paymentVouchers.id, id));
      const [row] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id));
      if (!row) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Vouchers", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update voucher");
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
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch advances");
    }
  });

  app.get("/api/ioms/vouchers/:voucherId/advances", async (req, res) => {
    try {
      const vid = routeParamString(req.params.voucherId);
      const [voucher] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, vid)).limit(1);
      if (!voucher) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(voucher.yardId)) {
        return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Voucher not found");
      }
      const list = await db.select().from(advanceRequests).where(eq(advanceRequests.voucherId, vid));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch advances");
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
      writeAuditLog(req, { module: "Vouchers", action: "CreateAdvance", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create advance");
    }
  });
}
