import type { Express, Request } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import {
  cancelLeaveLicenceAndCreateFresh,
  generateLeaveLicenceFinal,
  getLeaveLicenceByPremisesAgreement,
  getLeaveLicenceDetail,
  getVersionPdfBuffer,
  openOrCreateLeaveLicence,
  previewLeaveLicencePdf,
  saveLeaveLicenceDraft,
  uploadSignedLeaveLicence,
} from "./leave-licence-agreement-service";
import {
  extFromLeaveLicenceMime,
  isAllowedLeaveLicencePdfFileName,
  readLeaveLicencePdfBuffer,
} from "./leave-licence-agreement-storage";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function routeParam(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

function userId(req: Request): string | undefined {
  return (req as Request & { user?: { id?: string } }).user?.id;
}

export function registerLeaveLicenceAgreementRoutes(app: Express) {
  app.get("/api/ioms/leave-licence-agreements/by-premises/:premisesAgreementId", async (req, res) => {
    try {
      const premisesAgreementId = routeParam(req, "premisesAgreementId");
      const row = await getLeaveLicenceByPremisesAgreement(premisesAgreementId);
      if (!row) return res.json({ exists: false, agreement: null });
      const detail = await getLeaveLicenceDetail(row.id);
      res.json({ exists: true, agreement: detail });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load leave-licence agreement");
    }
  });

  app.post("/api/ioms/leave-licence-agreements/open", async (req, res) => {
    try {
      const premisesAgreementId = String(req.body?.premisesAgreementId ?? "").trim();
      if (!premisesAgreementId) {
        return sendApiError(res, 400, "PREMISES_REQUIRED", "premisesAgreementId is required");
      }
      const detail = await openOrCreateLeaveLicence({
        premisesAgreementId,
        createdBy: userId(req),
      });
      writeAuditLog(req, {
        module: "LeaveLicenceAgreements",
        action: "Open",
        recordId: detail?.id ?? "",
        afterValue: { premisesAgreementId, id: detail?.id },
      }).catch(() => undefined);
      res.json(detail);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to open agreement";
      sendApiError(res, 400, "OPEN_FAILED", msg);
    }
  });

  app.get("/api/ioms/leave-licence-agreements/:id", async (req, res) => {
    try {
      const detail = await getLeaveLicenceDetail(routeParam(req, "id"));
      if (!detail) return sendApiError(res, 404, "NOT_FOUND", "Agreement not found");
      res.json(detail);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load agreement");
    }
  });

  app.put("/api/ioms/leave-licence-agreements/:id", async (req, res) => {
    try {
      const result = await saveLeaveLicenceDraft({
        id: routeParam(req, "id"),
        snapshot: req.body?.snapshot ?? req.body,
        userId: userId(req),
      });
      res.json(result);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Save failed";
      const issues = (e as Error & { issues?: unknown }).issues;
      res.status(400).json({ error: msg, code: "SAVE_FAILED", issues });
    }
  });

  app.post("/api/ioms/leave-licence-agreements/:id/preview-pdf", async (req, res) => {
    try {
      const { buffer, pageCount, issues } = await previewLeaveLicencePdf({
        id: routeParam(req, "id"),
        snapshot: req.body?.snapshot,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="leave-licence-draft.pdf"');
      res.setHeader("X-Page-Count", String(pageCount));
      res.setHeader("X-Validation-Warn", issues.filter((i) => i.severity === "Warn").length ? "1" : "0");
      res.send(buffer);
    } catch (e) {
      console.error(e);
      sendApiError(res, 400, "PREVIEW_FAILED", e instanceof Error ? e.message : "Preview failed");
    }
  });

  app.post("/api/ioms/leave-licence-agreements/:id/generate-final", async (req, res) => {
    try {
      const result = await generateLeaveLicenceFinal({
        id: routeParam(req, "id"),
        snapshot: req.body?.snapshot,
        userId: userId(req),
      });
      writeAuditLog(req, {
        module: "LeaveLicenceAgreements",
        action: "GenerateFinal",
        recordId: result.id,
        afterValue: { versionNo: result.currentVersionNo, sha256: result.contentSha256 },
      }).catch(() => undefined);
      res.json(result);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Generate failed";
      const issues = (e as Error & { issues?: unknown }).issues;
      res.status(400).json({ error: msg, code: "GENERATE_FAILED", issues });
    }
  });

  app.get("/api/ioms/leave-licence-agreements/:id/pdf/:versionId", async (req, res) => {
    try {
      const id = routeParam(req, "id");
      const versionId = routeParam(req, "versionId");
      const found = await getVersionPdfBuffer(id, versionId);
      if (!found?.buffer) return sendApiError(res, 404, "NOT_FOUND", "PDF not found");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${found.fileName}"`);
      res.send(found.buffer);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to download PDF");
    }
  });

  app.get("/api/ioms/leave-licence-agreements/:id/signed-scan", async (req, res) => {
    try {
      const detail = await getLeaveLicenceDetail(routeParam(req, "id"));
      if (!detail?.signedScanFile) return sendApiError(res, 404, "NOT_FOUND", "Signed scan not found");
      const buf = await readLeaveLicencePdfBuffer(detail.id, detail.signedScanFile);
      if (!buf) return sendApiError(res, 404, "NOT_FOUND", "Signed scan file missing");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${detail.signedScanFile}"`);
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to download signed scan");
    }
  });

  app.post(
    "/api/ioms/leave-licence-agreements/:id/upload-signed",
    upload.single("file"),
    async (req, res) => {
      try {
        const file = req.file;
        if (!file) return sendApiError(res, 400, "FILE_REQUIRED", "PDF file is required");
        const ext = extFromLeaveLicenceMime(file.mimetype, file.originalname);
        if (!ext) return sendApiError(res, 400, "INVALID_FILE", "Only PDF uploads are allowed");
        const storedName = `signed-${Date.now()}-${nanoid(8)}.pdf`;
        if (!isAllowedLeaveLicencePdfFileName(storedName)) {
          return sendApiError(res, 400, "INVALID_FILE", "Invalid stored file name");
        }
        const detail = await uploadSignedLeaveLicence({
          id: routeParam(req, "id"),
          buffer: file.buffer,
          fileName: storedName,
          userId: userId(req),
        });
        writeAuditLog(req, {
          module: "LeaveLicenceAgreements",
          action: "UploadSigned",
          recordId: detail?.id ?? "",
          afterValue: { file: storedName },
        }).catch(() => undefined);
        res.json(detail);
      } catch (e) {
        console.error(e);
        sendApiError(res, 400, "UPLOAD_FAILED", e instanceof Error ? e.message : "Upload failed");
      }
    },
  );

  app.post(
    "/api/ioms/leave-licence-agreements/:id/cancel",
    upload.single("orderFile"),
    async (req, res) => {
      try {
        const reason = String(req.body?.reason ?? "").trim();
        const effectiveDate = String(req.body?.effectiveDate ?? "").trim();
        const orderRef = String(req.body?.orderRef ?? "").trim();
        let orderFileName: string | undefined;
        let orderBuffer: Buffer | undefined;
        if (req.file) {
          const ext = extFromLeaveLicenceMime(req.file.mimetype, req.file.originalname);
          if (!ext) return sendApiError(res, 400, "INVALID_FILE", "Order copy must be a PDF");
          orderFileName = `cancel-order-${Date.now()}-${nanoid(8)}.pdf`;
          orderBuffer = req.file.buffer;
        }
        const cancelledId = routeParam(req, "id");
        const fresh = await cancelLeaveLicenceAndCreateFresh({
          id: cancelledId,
          reason,
          effectiveDate,
          orderRef,
          orderFileName,
          orderBuffer,
          userId: userId(req),
        });
        writeAuditLog(req, {
          module: "LeaveLicenceAgreements",
          action: "Cancel",
          recordId: cancelledId,
          afterValue: { freshId: fresh?.id, reason, effectiveDate, orderRef },
        }).catch(() => undefined);
        res.json(fresh);
      } catch (e) {
        console.error(e);
        sendApiError(res, 400, "CANCEL_FAILED", e instanceof Error ? e.message : "Cancel failed");
      }
    },
  );
}
