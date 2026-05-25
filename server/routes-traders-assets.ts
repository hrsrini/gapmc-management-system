/**
 * IOMS M-02: Trader & Asset ID Management API routes.
 * Tables: trader_licences, assistant_traders, assets, asset_allotments, trader_blocking_log, msp_settings.
 * CC-05: list/get/mutate filtered by req.scopedLocationIds when non-empty.
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { eq, desc, and, inArray, sql, or, ilike, isNotNull, ne, type InferSelectModel } from "drizzle-orm";
import { db, pool } from "./db";
import {
  traderLicences,
  assistantTraders,
  entities,
  entityAllotments,
  preReceipts,
  assets,
  assetAllotments,
  traderBlockingLog,
  traderStockOpenings,
  commodities,
  measurementUnits,
  mspSettings,
  yards,
  rentInvoices,
  iomsReceipts,
  adHocEntities,
  purchaseTransactions,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { writeAuditLog } from "./audit";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { tenantLicenceIsGstExempt, resolveGovtGstExemptCategoryId } from "./gst-exempt";
import {
  assertRecordDoDvDaSeparation,
  assertSegregationDoDvDa,
  canTransitionEntityAllotmentApproval,
} from "./workflow";
import { sendApiError } from "./api-errors";
import { disablePortalAccessForUnifiedEntity } from "./routes-portal";
import { parseReportPaging, parseReportSort, reportSearchPattern } from "./report-paging";
import { orderLicenceReport, LICENCE_REPORT_SORT_ALLOW } from "./report-order";
import { applyM03ReceiptToRentDepositLedger } from "./rent-deposit-ledger-from-receipt";
import { m03ReceiptPrincipalTowardInvoice } from "@shared/m03-receipt-breakdown";
import {
  HrEmployeeRuleError,
  normalizeMobile10,
  assertPersonalEmailFormat,
  normalizeAadhaarMasked,
} from "./hr-employee-rules";
import { INDIAN_PAN_RE, normalizePanInput } from "@shared/india-validation";
import { isPanTakenAcrossActiveMasters } from "./pan-uniqueness";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA, unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";
import { resolveRentInvoiceCounterparty } from "./rent-invoice-payer";
import {
  TRACKB_SUBTYPES,
  normalizeTrackBSubType,
  isTrackBGovtSubType,
  TRACKB_NON_GOV_DUES_API_HINT,
} from "@shared/track-b-entity";
import { traderLicenceUsesBmSupplement } from "@shared/m02-licence-bm-bk";
import {
  assertVacatedToDateNotFuture,
  capVacatedOnYmd,
  inferAgreementTypeFromDates,
  normalizeAgreementType,
  normalizePremisesStatus,
  normalizeRentRevisionMode,
  resolveVacatedDisplayYmd,
  roundedMoney2,
  todayYmdUtc,
} from "@shared/premises-allocation";
import { hasPermission } from "./auth";
import { routeParamString } from "./route-params";
import { registerEntityAllotmentRoutes } from "./entity-allotment-routes";
import { assertPremisesNotAlreadyAllocatedActive } from "./premises-allocation-guard";
import { buildPreReceiptPdfA4Double } from "./pre-receipt-pdf";
import {
  billingMonthWithinAllotment,
  findDuplicatePreReceiptForMonth,
  resolvePreReceiptIssueContext,
  resolvePreReceiptPrintFields,
} from "./pre-receipt-issue";
import {
  contentTypeForAssetAllotmentAgreement,
  extFromAssetAllotmentAgreementMime,
  isAllowedAssetAllotmentAgreementFileName,
  readAssetAllotmentAgreementBuffer,
  writeAssetAllotmentAgreementBuffer,
} from "./asset-allotment-agreement-storage";
import {
  writeTraderBmFormBuffer,
  readTraderBmFormBuffer,
  unlinkTraderBmFormIfExists,
  isAllowedBmFormFileName,
  extFromBmFormMime,
  contentTypeForBmFormFile,
} from "./trader-licence-bm-form-storage";
import {
  allocateTraderLicenceActivationIds,
  formatProvisionalLicenceNo,
  nextApplicationSerialTx,
  nextEntityPublicCodeTx,
} from "./trader-licence-identity";

const TRADER_LICENCE_MOBILE_DUP_STATUSES = ["Draft", "Pending", "Query", "Active"] as const;

async function traderLicenceMobileInUse(mobileNorm: string, excludeLicenceId: string | null): Promise<boolean> {
  const statusDup = inArray(traderLicences.status, [...TRADER_LICENCE_MOBILE_DUP_STATUSES]);
  const hit = excludeLicenceId
    ? await db
        .select({ id: traderLicences.id })
        .from(traderLicences)
        .where(and(eq(traderLicences.mobile, mobileNorm), statusDup, ne(traderLicences.id, excludeLicenceId)))
        .limit(1)
    : await db
        .select({ id: traderLicences.id })
        .from(traderLicences)
        .where(and(eq(traderLicences.mobile, mobileNorm), statusDup))
        .limit(1);
  return Boolean(hit[0]);
}

function ymdFieldError(label: string, v: string | null | undefined, required: boolean): string | null {
  if (v == null || String(v).trim() === "") return required ? `${label} is required.` : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${label} must be YYYY-MM-DD.`;
  const t = new Date(`${s}T12:00:00.000Z`).getTime();
  if (Number.isNaN(t)) return `${label} is invalid.`;
  return null;
}

/** Optional Form BM supporting-document link (paste https URL; binary upload can map here later). */
function parseOptionalHttpUrl(v: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (v == null || String(v).trim() === "") return { ok: true, value: null };
  const s = String(v).trim().slice(0, 4000);
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, message: "BM document URL must start with http:// or https://." };
    }
    return { ok: true, value: s };
  } catch {
    return { ok: false, message: "BM document URL is not a valid URL." };
  }
}

function validateLicenceForPendingStatus(p: {
  licenceType: string;
  applicationKind: string | null | undefined;
  fatherSpouseName: string | null | undefined;
  dateOfBirth: string | null | undefined;
  emergencyContactMobile: string | null | undefined;
  characterCertIssuer: string | null | undefined;
  characterCertDate: string | null | undefined;
  renewalNoArrearsDeclared: boolean | null | undefined;
  bmUndertakingAccepted?: boolean | null | undefined;
}): { code: string; message: string } | null {
  const kind = String(p.applicationKind ?? "New").trim() || "New";
  if (kind === "Renewal" && p.renewalNoArrearsDeclared !== true) {
    return {
      code: "LICENCE_BK_DECLARATION",
      message:
        "Confirm the BK declaration (no outstanding market / licence arrears on the previous licence) before submitting for review.",
    };
  }
  if (!traderLicenceUsesBmSupplement(p.licenceType)) return null;
  if (p.bmUndertakingAccepted !== true) {
    return {
      code: "LICENCE_BM_UNDERTAKING",
      message: "Confirm the Form BM undertaking before submitting this application for review.",
    };
  }
  if (!String(p.fatherSpouseName ?? "").trim()) {
    return { code: "LICENCE_BM_FATHER_SPOUSE", message: "Father / spouse name is required for this licence type (Form BM)." };
  }
  const dobErr = ymdFieldError("Date of birth", p.dateOfBirth, true);
  if (dobErr) return { code: "LICENCE_BM_DOB", message: dobErr };
  const dobT = new Date(`${String(p.dateOfBirth).trim()}T12:00:00.000Z`).getTime();
  if (dobT > Date.now()) return { code: "LICENCE_BM_DOB", message: "Date of birth cannot be in the future." };
  const em = normalizeMobile10(String(p.emergencyContactMobile ?? ""));
  if (!em) {
    return {
      code: "LICENCE_BM_EMERGENCY_MOBILE",
      message: "Emergency contact mobile (10 digits) is required for this licence type (Form BM).",
    };
  }
  if (!String(p.characterCertIssuer ?? "").trim()) {
    return {
      code: "LICENCE_BM_CHAR_CERT",
      message: "Character certificate issuing authority is required for this licence type (Form BM).",
    };
  }
  if (p.characterCertDate != null && String(p.characterCertDate).trim() !== "") {
    const ce = ymdFieldError("Character certificate date", p.characterCertDate, false);
    if (ce) return { code: "LICENCE_BM_CHAR_CERT_DATE", message: ce };
  }
  return null;
}

function sendHrRule(res: Response, e: unknown): boolean {
  if (e instanceof HrEmployeeRuleError) {
    sendApiError(res, 400, e.code, e.message);
    return true;
  }
  return false;
}

function yardInScope(req: Request, yardId: string): boolean {
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

/** ADMIN may access trader-licence rows across yards (e.g. list with allYards=1, cross-yard support). */
function licenceYardAccessible(req: Request, yardId: string): boolean {
  if (req.user?.roles.some((r) => r.tier === "ADMIN")) return true;
  return yardInScope(req, yardId);
}

/** Premises master (M-02) must sit on a Yard row, not CheckPost or HO. */
async function assertPremisesYardLocation(
  yardId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const [y] = await db.select({ type: yards.type }).from(yards).where(eq(yards.id, yardId)).limit(1);
  if (!y) return { ok: false, code: "YARD_NOT_FOUND", message: "Yard not found" };
  if (y.type !== "Yard") {
    return {
      ok: false,
      code: "PREMISES_YARD_TYPE_REQUIRED",
      message: "Premises must be on a Yard location (not a checkpost or HO).",
    };
  }
  return { ok: true };
}

/** Canonical quantity label for a commodity (same rule as GET /api/ioms/commodities). */
async function resolvedCommodityUnitLabel(commodityId: string): Promise<string | null> {
  const [r] = await db
    .select({
      unitName: measurementUnits.name,
      unitLegacy: commodities.unit,
    })
    .from(commodities)
    .leftJoin(measurementUnits, eq(commodities.unitId, measurementUnits.id))
    .where(eq(commodities.id, commodityId))
    .limit(1);
  if (!r) return null;
  const label = String(r.unitName ?? r.unitLegacy ?? "").trim();
  return label.length > 0 ? label : null;
}

export function registerTradersAssetsRoutes(app: Express) {
  registerEntityAllotmentRoutes(app);
  const now = () => new Date().toISOString();

  const bmFormUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, cb) {
      if (extFromBmFormMime(file.mimetype)) return cb(null, true);
      cb(new Error("BM_FORM_MIME"));
    },
  });

  function multerBmFormSingle(req: Request, res: Response, next: NextFunction): void {
    bmFormUpload.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      const msg = err instanceof Error ? err.message : "Upload failed";
      if (msg === "BM_FORM_MIME") {
        return sendApiError(res, 400, "BM_FORM_MIME", "Only PDF, PNG, or JPEG files are allowed.");
      }
      if (err && typeof err === "object" && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
        return sendApiError(res, 400, "BM_FORM_TOO_LARGE", "File must be 2 MB or smaller.");
      }
      console.error(err);
      return sendApiError(res, 400, "BM_FORM_UPLOAD_FAILED", msg);
    });
  }

  async function allocateNextPreReceiptNo(): Promise<string> {
    const rows = await db
      .select({ n: preReceipts.preReceiptNo })
      .from(preReceipts)
      .where(isNotNull(preReceipts.preReceiptNo));
    let max = 0;
    for (const r of rows) {
      const m = /^PR-(\d{4,})$/i.exec(String(r.n ?? "").trim());
      if (!m) continue;
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
    const next = max + 1;
    return `PR-${String(next).padStart(4, "0")}`;
  }

  // ----- Track B entities -----
  app.get("/api/ioms/reference/entity-subtypes", async (_req, res) => {
    res.json({
      trackB: [...TRACKB_SUBTYPES],
      billing: {
        preReceiptEligibleSubtypes: ["Govt"],
        notes: {
          Govt: "Pre-receipt instrument (M-02) applies; settlement creates/links IOMS receipt.",
          Commercial: "Use M-03 rent / GST tax invoices (not pre-receipts) for this Track B sub-type.",
          AdHocOccupant: "Use M-03 rent / GST tax invoices (not pre-receipts) unless SRS specifies otherwise.",
        },
      },
    });
  });

  app.get("/api/ioms/entities", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(entities.yardId, scopedIds));
      if (yardId) conditions.push(eq(entities.yardId, yardId));
      const base = db.select().from(entities).orderBy(desc(entities.updatedAt));
      const list = conditions.length ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      const pg = e as { code?: string; message?: string };
      const msg = String(pg?.message ?? (e instanceof Error ? e.message : e));
      if (
        pg?.code === "42P01" ||
        /gapmc\.entities.*does not exist|relation\s+"gapmc\.entities"/i.test(msg)
      ) {
        return sendApiError(
          res,
          503,
          "ENTITY_SCHEMA_MISSING",
          "The Track B entities table is missing. Run: npm run db:apply-m02-trackb-entities (or npm run db:push), then reload.",
        );
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch entities");
    }
  });

  app.get("/api/ioms/entities/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(entities).where(eq(entities.id, req.params.id)).limit(1);
      if (!row) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      if (!yardInScope(req, row.yardId)) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch entity");
    }
  });

  app.post("/api/ioms/entities", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      if (!yardInScope(req, yardId)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const yardTypeCheck = await assertPremisesYardLocation(yardId);
      if (!yardTypeCheck.ok) {
        return sendApiError(res, 400, yardTypeCheck.code, yardTypeCheck.message);
      }
      const panNorm = body.pan != null && String(body.pan).trim() !== "" ? normalizePanInput(String(body.pan)) : null;
      if (panNorm && (panNorm.length !== 10 || !INDIAN_PAN_RE.test(panNorm))) {
        return sendApiError(res, 400, "ENTITY_PAN_FORMAT", "PAN must match ABCDE1234F.");
      }
      if (panNorm && (await isPanTakenAcrossActiveMasters({ panUpper: panNorm }))) {
        return sendApiError(res, 400, "ENTITY_PAN_DUPLICATE", "PAN is already used by another active record.");
      }
      if (body.entityCode != null && String(body.entityCode).trim() !== "") {
        return sendApiError(
          res,
          400,
          "ENTITY_CODE_SYSTEM_ASSIGNED",
          "Entity ID (ENT-YYYY-NNNNN) is assigned automatically by the system and cannot be supplied on create.",
        );
      }
      const track = String(body.track ?? "TrackB");
      if (track !== "TrackB") return sendApiError(res, 400, "ENTITY_TRACK_INVALID", "Only TrackB entities can be created here");
      const subType = normalizeTrackBSubType(body.subType);
      if (body.subType != null && String(body.subType).trim() !== "" && subType == null) {
        return sendApiError(res, 400, "ENTITY_SUBTYPE_INVALID", `subType must be one of: ${TRACKB_SUBTYPES.join(", ")}`);
      }
      const id = nanoid();
      const ts = now();
      const [row] = await db.transaction(async (tx) => {
        const entityCode = await nextEntityPublicCodeTx(tx);
        await tx.insert(entities).values({
          id,
          entityCode,
          track,
          subType,
          name: String(body.name ?? ""),
          yardId,
          pan: panNorm,
          gstin: body.gstin ? String(body.gstin) : null,
          mobile: body.mobile ? normalizeMobile10(String(body.mobile)) : null,
          email: body.email ? String(body.email).trim().toLowerCase() : null,
          address: body.address ? String(body.address) : null,
          status: String(body.status ?? "Active"),
          createdAt: ts,
          updatedAt: ts,
        });
        return tx.select().from(entities).where(eq(entities.id, id));
      });
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create entity");
    }
  });

  app.put("/api/ioms/entities/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      const body = req.body;
      const updates: Record<string, unknown> = { updatedAt: now() };
      ["name", "pan", "gstin", "email", "address", "status"].forEach((k) => {
        if (body[k] === undefined) return;
        let v: string | null = body[k] == null ? null : String(body[k]);
        if (v && k === "email") v = v.trim().toLowerCase();
        if (k === "pan") {
          const p = v != null && v.trim() !== "" ? normalizePanInput(v) : null;
          updates[k] = p;
        } else {
          updates[k] = v;
        }
      });
      if (updates.pan != null && String(updates.pan).trim() !== "") {
        const p = String(updates.pan);
        if (p.length !== 10 || !INDIAN_PAN_RE.test(p)) {
          return sendApiError(res, 400, "ENTITY_PAN_FORMAT", "PAN must match ABCDE1234F.");
        }
        if (await isPanTakenAcrossActiveMasters({ panUpper: p, excludeEntityId: id })) {
          return sendApiError(res, 400, "ENTITY_PAN_DUPLICATE", "PAN is already used by another active record.");
        }
      }
      if (body.track !== undefined) {
        const track = String(body.track);
        if (track !== "TrackB") return sendApiError(res, 400, "ENTITY_TRACK_INVALID", "Only TrackB entities are supported");
        updates.track = "TrackB";
      }
      if (body.subType !== undefined) {
        const subType = normalizeTrackBSubType(body.subType);
        if (body.subType != null && String(body.subType).trim() !== "" && subType == null) {
          return sendApiError(res, 400, "ENTITY_SUBTYPE_INVALID", `subType must be one of: ${TRACKB_SUBTYPES.join(", ")}`);
        }
        const nextSub = subType ?? existing.subType ?? null;
        if (isTrackBGovtSubType(existing.subType) && !isTrackBGovtSubType(nextSub)) {
          const prs = await db.select().from(preReceipts).where(eq(preReceipts.entityId, id));
          const hasOpen = prs.some((p) => {
            const st = String(p.status ?? "");
            return st !== "Settled" && st !== "Cancelled";
          });
          if (hasOpen) {
            return sendApiError(
              res,
              400,
              "ENTITY_SUBTYPE_BLOCKED_OPEN_PR",
              "Cannot change sub-type away from Govt while open pre-receipts exist (settle or cancel them first).",
            );
          }
        }
        updates.subType = subType;
      }
      if (body.mobile !== undefined) updates.mobile = body.mobile == null ? null : normalizeMobile10(String(body.mobile));
      if (body.yardId !== undefined) {
        const yid = String(body.yardId);
        if (!yardInScope(req, yid)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
        const yardTypeCheck = await assertPremisesYardLocation(yid);
        if (!yardTypeCheck.ok) {
          return sendApiError(res, 400, yardTypeCheck.code, yardTypeCheck.message);
        }
        updates.yardId = yid;
      }
      if (body.entityCode !== undefined) {
        const incoming = String(body.entityCode ?? "").trim();
        const current = String(existing.entityCode ?? "").trim();
        if (incoming && incoming !== current) {
          return sendApiError(
            res,
            400,
            "ENTITY_CODE_IMMUTABLE",
            "Entity ID (ENT-YYYY-NNNNN) cannot be changed once assigned.",
          );
        }
      }
      const nextStatus = updates.status !== undefined ? String(updates.status ?? "") : String(existing.status ?? "");
      const needsEntityCode =
        !String(existing.entityCode ?? "").trim() && nextStatus === "Active";
      await db.transaction(async (tx) => {
        if (needsEntityCode) {
          (updates as Record<string, unknown>).entityCode = await nextEntityPublicCodeTx(tx);
        }
        await tx.update(entities).set(updates as Record<string, string | null>).where(eq(entities.id, id));
      });
      if (nextStatus && nextStatus !== "Active") {
        await disablePortalAccessForUnifiedEntity(`TB:${id}`, req.user?.id ?? null).catch((e) =>
          console.error("[portal] disable on entity status change failed:", e),
        );
      }
      const [row] = await db.select().from(entities).where(eq(entities.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update entity");
    }
  });

  // ----- M-02 Sr.15: Unified entity master (Track A + Track B + Ad-hoc) -----
  app.get("/api/ioms/unified-entities", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const q = String(req.query.q ?? "").trim().toLowerCase();
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;

      const inScope = (y: string) => !scopedIds || scopedIds.length === 0 || scopedIds.includes(y);

      const [lics, ents, adHocs] = await Promise.all([
        db.select().from(traderLicences).orderBy(desc(traderLicences.updatedAt)),
        db.select().from(entities).orderBy(desc(entities.updatedAt)),
        db.select().from(adHocEntities).orderBy(desc(adHocEntities.updatedAt)),
      ]);

      const list = [
        ...lics.map((l) => {
          const publicEntityCode = l.entityPublicCode?.trim() || null;
          return {
            id: `TA:${l.id}`,
            kind: "TrackA" as const,
            refId: l.id,
            yardId: l.yardId,
            name: l.firmName,
            status: l.status,
            pan: l.pan,
            gstin: l.gstin,
            mobile: l.mobile,
            email: l.email,
            address: l.address,
            licenceNo: l.licenceNo,
            publicEntityCode,
            displayEntityId: publicEntityCode ? `TA : ${publicEntityCode}` : null,
          };
        }),
        ...ents.map((e) => {
          const publicEntityCode = e.entityCode?.trim() || null;
          return {
            id: `TB:${e.id}`,
            kind: "TrackB" as const,
            refId: e.id,
            yardId: e.yardId,
            name: e.name,
            status: e.status,
            pan: e.pan,
            gstin: e.gstin,
            mobile: e.mobile,
            email: e.email,
            address: e.address,
            subType: e.subType,
            publicEntityCode,
            displayEntityId: publicEntityCode ? `TB : ${publicEntityCode}` : null,
          };
        }),
        ...adHocs.map((a) => {
          const publicEntityCode = a.entityCode?.trim() || null;
          return {
            id: `AH:${a.id}`,
            kind: "AdHoc" as const,
            refId: a.id,
            yardId: a.yardId,
            name: a.name,
            status: a.status,
            pan: a.pan,
            gstin: a.gstin,
            mobile: a.mobile,
            email: a.email,
            address: a.address,
            publicEntityCode,
            displayEntityId: publicEntityCode ? `AH : ${publicEntityCode}` : null,
          };
        }),
      ]
        .filter((r) => inScope(r.yardId))
        .filter((r) => (yardId ? r.yardId === yardId : true))
        .filter((r) => {
          if (!q) return true;
          const hay =
            `${r.id} ${r.displayEntityId ?? ""} ${r.publicEntityCode ?? ""} ${r.name ?? ""} ${r.mobile ?? ""} ${r.email ?? ""} ${r.pan ?? ""} ${r.gstin ?? ""} ${(r as { licenceNo?: string }).licenceNo ?? ""}`.toLowerCase();
          return hay.includes(q);
        });

      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch unified entities");
    }
  });

  // ----- M-02 Sr.6: Outstanding dues + counter payment (partial payments) -----
  app.get("/api/ioms/dues", async (req, res) => {
    try {
      const unifiedId = String(req.query.unifiedId ?? "").trim();
      const parsed = parseUnifiedEntityId(unifiedId);
      if (!parsed) return sendApiError(res, 400, "DUES_UNIFIED_ID", "Query unifiedId must be TA:<id> | TB:<id> | AH:<id>");

      const dues: Array<Record<string, unknown>> = [];

      if (parsed.kind === "TA") {
        const tenantLicenceId = parsed.refId;
        const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, tenantLicenceId)).limit(1);
        if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");

        const invs = await db
          .select()
          .from(rentInvoices)
          .where(and(eq(rentInvoices.tenantLicenceId, tenantLicenceId), inArray(rentInvoices.status, ["Approved", "Paid"])));

        const invoiceIds = invs.map((i) => i.id);
        const recs =
          invoiceIds.length === 0
            ? []
            : await db
                .select()
                .from(iomsReceipts)
                .where(and(eq(iomsReceipts.sourceModule, "M-03"), inArray(iomsReceipts.sourceRecordId, invoiceIds)));

        const paidByInvoice: Record<string, number> = {};
        for (const r of recs) {
          const invId = String(r.sourceRecordId ?? "");
          if (!invId) continue;
          const isPaid = String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled";
          if (!isPaid) continue;
          paidByInvoice[invId] = (paidByInvoice[invId] ?? 0) + Number(r.totalAmount ?? 0);
        }

        for (const i of invs) {
          const total = Number(i.totalAmount ?? 0);
          const paid = Number(paidByInvoice[i.id] ?? 0);
          const outstanding = Math.max(0, total - paid);
          if (outstanding <= 0) continue;
          dues.push({
            kind: "RentInvoice",
            invoiceId: i.id,
            invoiceNo: i.invoiceNo,
            periodMonth: i.periodMonth,
            assetId: i.assetId,
            yardId: i.yardId,
            totalAmount: total,
            paidAmount: paid,
            outstandingAmount: outstanding,
            status: i.status,
          });
        }

        // M-04: approved purchase market fee vs linked IOMS receipt (Pending = still due at counter).
        const purchases = await db
          .select()
          .from(purchaseTransactions)
          .where(and(eq(purchaseTransactions.traderLicenceId, tenantLicenceId), eq(purchaseTransactions.status, "Approved")));
        const ptIds = purchases.map((p) => p.id).filter(Boolean);
        const m04Receipts =
          ptIds.length === 0
            ? []
            : await db
                .select()
                .from(iomsReceipts)
                .where(and(eq(iomsReceipts.sourceModule, "M-04"), inArray(iomsReceipts.sourceRecordId, ptIds)));
        const m04ByPurchaseId: Record<string, InferSelectModel<typeof iomsReceipts>[]> = {};
        for (const r of m04Receipts) {
          const sid = String(r.sourceRecordId ?? "");
          if (!sid) continue;
          if (!m04ByPurchaseId[sid]) m04ByPurchaseId[sid] = [];
          m04ByPurchaseId[sid].push(r);
        }
        for (const pt of purchases) {
          const fee = Number(pt.marketFeeAmount ?? 0);
          if (!Number.isFinite(fee) || fee <= 0) continue;
          const recs = m04ByPurchaseId[pt.id] ?? [];
          const paidSum = recs
            .filter((r) => String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled")
            .reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
          const outstanding = Math.max(0, fee - paidSum);
          if (outstanding <= 0) continue;
          const pending = recs.find((r) => String(r.status ?? "") === "Pending");
          dues.push({
            kind: "MarketFeePurchase",
            purchaseTransactionId: pt.id,
            transactionNo: pt.transactionNo ?? null,
            transactionDate: pt.transactionDate,
            yardId: pt.yardId,
            commodityId: pt.commodityId,
            totalAmount: fee,
            paidAmount: paidSum,
            outstandingAmount: outstanding,
            receiptId: pending?.id ?? recs[0]?.id ?? null,
            receiptStatus: pending ? String(pending.status) : "Pending receipt",
          });
        }
      } else if (parsed.kind === "TB") {
        const entityId = parsed.refId;
        const [ent] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
        if (!ent || !yardInScope(req, ent.yardId)) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
        let trackBBillingHint: string | undefined;
        if (!isTrackBGovtSubType(ent.subType)) {
          trackBBillingHint = TRACKB_NON_GOV_DUES_API_HINT;
        } else {
          const prs = await db.select().from(preReceipts).where(eq(preReceipts.entityId, entityId));
          for (const pr of prs) {
            const st = String(pr.status ?? "");
            if (st === "Settled" || st === "Cancelled") continue;
            const amt = Number(pr.amount ?? 0);
            if (amt <= 0) continue;
            dues.push({
              kind: "PreReceipt",
              preReceiptId: pr.id,
              preReceiptNo: pr.preReceiptNo,
              yardId: pr.yardId,
              amount: amt,
              status: st,
            });
          }
        }
        return res.json({ unifiedId, dues, trackBEntitySubType: ent.subType ?? null, trackBBillingHint });
      } else {
        const adhocId = parsed.refId;
        const [ah] = await db.select().from(adHocEntities).where(eq(adHocEntities.id, adhocId)).limit(1);
        if (!ah || !yardInScope(req, ah.yardId)) return sendApiError(res, 404, "ADHOC_ENTITY_NOT_FOUND", "Ad-hoc entity not found");
        // No linked billing tables yet for AH:* (future: link to allotments / fees).
      }

      res.json({ unifiedId, dues });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch dues");
    }
  });

  app.post("/api/ioms/dues/pay-rent-invoice", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const invoiceId = String(body.invoiceId ?? "");
      const payAmount = Number(body.amount ?? NaN);
      if (!invoiceId || !Number.isFinite(payAmount) || payAmount <= 0) {
        return sendApiError(res, 400, "DUES_PAY_FIELDS", "invoiceId and amount (number>0) are required");
      }
      const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
      if (!inv) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      if (String(inv.status) !== "Approved" && String(inv.status) !== "Paid") {
        return sendApiError(res, 400, "DUES_PAY_STATUS", "Only Approved/Paid invoices can be paid via counter flow");
      }

      const recs = await db
        .select()
        .from(iomsReceipts)
        .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invoiceId)));
      const alreadyPaid = recs
        .filter((r) => String(r.status) === "Paid" || String(r.status) === "Reconciled")
        .reduce((s, r) => s + m03ReceiptPrincipalTowardInvoice(r), 0);

      const total = Number(inv.totalAmount ?? 0);
      const outstanding = Math.max(0, total - alreadyPaid);
      if (payAmount > outstanding + 0.0001) {
        return sendApiError(res, 400, "DUES_PAY_TOO_MUCH", "Payment amount exceeds outstanding", { outstanding });
      }

      const createdBy = req.user?.id ?? "system";
      const revenueHead = inv.isGovtEntity ? "GSTInvoice" : "Rent";
      const payer = await resolveRentInvoiceCounterparty(inv);
      const created = await createIomsReceipt({
        yardId: inv.yardId,
        revenueHead,
        payerName: payer.payerName,
        payerType: payer.payerType,
        payerRefId: payer.payerRefId,
        amount: payAmount,
        cgst: 0,
        sgst: 0,
        tdsAmount: 0,
        paymentMode: "Cash",
        sourceModule: "M-03",
        sourceRecordId: inv.id,
        unifiedEntityId: payer.unifiedEntityId,
        createdBy,
      });

      await db.update(iomsReceipts).set({ status: "Paid", gatewayRef: "Manual" }).where(eq(iomsReceipts.id, created.id));
      const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
      if (paidRow) {
        try {
          await applyM03ReceiptToRentDepositLedger(paidRow);
        } catch (e) {
          console.error("[dues] rent deposit Collection hook failed:", e);
        }
      }

      const newOutstanding = Math.max(0, outstanding - payAmount);
      if (newOutstanding <= 0.0001 && String(inv.status) !== "Paid") {
        await db.update(rentInvoices).set({ status: "Paid" }).where(eq(rentInvoices.id, invoiceId));
      }

      res.status(201).json({ receiptId: created.id, receiptNo: created.receiptNo, newOutstanding });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to record payment");
    }
  });

  /**
   * M-02 US-M02-005: Online payment flow (Phase-2 prep).
   * Creates a Pending receipt with paymentMode=Online, then the UI can initiate gateway payment via /api/ioms/receipts/:id/payments/initiate.
   */
  app.post("/api/ioms/dues/create-online-receipt", async (req, res) => {
    try {
      if (process.env.PAYMENT_GATEWAY_INIT_ENABLED !== "true") {
        return sendApiError(
          res,
          403,
          "RECEIPT_GATEWAY_DISABLED",
          "Online dues payment is disabled until the gateway is enabled (set PAYMENT_GATEWAY_INIT_ENABLED=true).",
        );
      }
      const body = req.body as Record<string, unknown>;
      const kind = String(body.kind ?? "").trim();
      const payAmount = Number(body.amount ?? NaN);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        return sendApiError(res, 400, "DUES_ONLINE_AMOUNT", "amount must be a positive number");
      }

      const createdBy = req.user?.id ?? "system";

      if (kind === "rent") {
        const invoiceId = String(body.invoiceId ?? "");
        if (!invoiceId) return sendApiError(res, 400, "DUES_ONLINE_FIELDS", "kind=rent requires invoiceId");
        const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
        if (!inv) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
        const scopedIds = req.scopedLocationIds;
        if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
          return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
        }
        if (String(inv.status) !== "Approved" && String(inv.status) !== "Paid") {
          return sendApiError(res, 400, "DUES_PAY_STATUS", "Only Approved/Paid invoices can be paid");
        }

        const recs = await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invoiceId)));
        const alreadyPaid = recs
          .filter((r) => String(r.status) === "Paid" || String(r.status) === "Reconciled")
          .reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
        const total = Number(inv.totalAmount ?? 0);
        const outstanding = Math.max(0, total - alreadyPaid);
        if (payAmount > outstanding + 0.0001) {
          return sendApiError(res, 400, "DUES_PAY_TOO_MUCH", "Payment amount exceeds outstanding", { outstanding });
        }

        const revenueHead = inv.isGovtEntity ? "GSTInvoice" : "Rent";
        const payer = await resolveRentInvoiceCounterparty(inv);
        const created = await createIomsReceipt({
          yardId: inv.yardId,
          revenueHead,
          payerName: payer.payerName,
          payerType: payer.payerType,
          payerRefId: payer.payerRefId,
          amount: payAmount,
          cgst: 0,
          sgst: 0,
          tdsAmount: 0,
          paymentMode: "Online",
          sourceModule: "M-03",
          sourceRecordId: inv.id,
          unifiedEntityId: payer.unifiedEntityId,
          createdBy,
        });
        return res.status(201).json({ receiptId: created.id, receiptNo: created.receiptNo, kind: "rent" });
      }

      if (kind === "market") {
        const purchaseTransactionId = String(body.purchaseTransactionId ?? "").trim();
        if (!purchaseTransactionId) {
          return sendApiError(res, 400, "DUES_ONLINE_FIELDS", "kind=market requires purchaseTransactionId");
        }
        const [pt] = await db
          .select()
          .from(purchaseTransactions)
          .where(eq(purchaseTransactions.id, purchaseTransactionId))
          .limit(1);
        if (!pt) return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
        if (String(pt.status) !== "Approved") {
          return sendApiError(res, 400, "DUES_MARKET_PAY_STATUS", "Only Approved purchases can be paid");
        }
        const scopedIds = req.scopedLocationIds;
        if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(pt.yardId)) {
          return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
        }
        const L = Number(pt.marketFeeAmount ?? 0);
        if (!Number.isFinite(L) || L <= 0) {
          return sendApiError(res, 400, "DUES_MARKET_PAY_NO_FEE", "This purchase has no market fee to settle");
        }
        const allRecs = await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-04"), eq(iomsReceipts.sourceRecordId, purchaseTransactionId)));
        const paidSum = allRecs
          .filter((r) => String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled")
          .reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
        const outstanding = Math.max(0, L - paidSum);
        if (payAmount > outstanding + 0.01) {
          return sendApiError(res, 400, "DUES_MARKET_PAY_TOO_MUCH", "Payment amount exceeds outstanding market fee", {
            outstanding,
          });
        }
        const [licOnlineMkt] = await db
          .select({ firmName: traderLicences.firmName })
          .from(traderLicences)
          .where(eq(traderLicences.id, String(pt.traderLicenceId ?? "")))
          .limit(1);
        const created = await createIomsReceipt({
          yardId: pt.yardId,
          revenueHead: "MarketFee",
          payerName: (licOnlineMkt?.firmName?.trim() && licOnlineMkt.firmName) || String(pt.traderLicenceId ?? ""),
          payerType: "TraderLicence",
          payerRefId: String(pt.traderLicenceId ?? ""),
          amount: payAmount,
          cgst: 0,
          sgst: 0,
          tdsAmount: 0,
          paymentMode: "Online",
          sourceModule: "M-04",
          sourceRecordId: pt.id,
          unifiedEntityId: pt.traderLicenceId ? unifiedEntityIdFromTrackA(String(pt.traderLicenceId)) : null,
          createdBy,
        });
        return res.status(201).json({ receiptId: created.id, receiptNo: created.receiptNo, kind: "market" });
      }

      return sendApiError(res, 400, "DUES_ONLINE_KIND", "kind must be 'rent' or 'market'");
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create online payment receipt");
    }
  });

  /** Counter payment toward M-04 market fee for an approved purchase (partial or full). */
  app.post("/api/ioms/dues/pay-market-fee", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const purchaseTransactionId = String(body.purchaseTransactionId ?? "").trim();
      if (!purchaseTransactionId) {
        return sendApiError(res, 400, "DUES_MARKET_PAY_FIELDS", "purchaseTransactionId is required");
      }
      const payAmount = Number(body.amount ?? NaN);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        return sendApiError(res, 400, "DUES_MARKET_PAY_AMOUNT", "amount must be a positive number");
      }

      const [pt] = await db
        .select()
        .from(purchaseTransactions)
        .where(eq(purchaseTransactions.id, purchaseTransactionId))
        .limit(1);
      if (!pt) return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
      if (String(pt.status) !== "Approved") {
        return sendApiError(res, 400, "DUES_MARKET_PAY_STATUS", "Only Approved purchases can be paid via counter flow");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(pt.yardId)) {
        return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
      }

      const L = Number(pt.marketFeeAmount ?? 0);
      if (!Number.isFinite(L) || L <= 0) {
        return sendApiError(res, 400, "DUES_MARKET_PAY_NO_FEE", "This purchase has no market fee to settle");
      }

      const allRecs = await db
        .select()
        .from(iomsReceipts)
        .where(and(eq(iomsReceipts.sourceModule, "M-04"), eq(iomsReceipts.sourceRecordId, purchaseTransactionId)));

      const paidSum = allRecs
        .filter((r) => String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled")
        .reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
      const outstanding = Math.max(0, L - paidSum);
      if (outstanding <= 0.0001) {
        return sendApiError(res, 400, "DUES_MARKET_PAY_NONE", "No outstanding market fee for this purchase");
      }
      if (payAmount > outstanding + 0.01) {
        return sendApiError(res, 400, "DUES_MARKET_PAY_TOO_MUCH", "Payment amount exceeds outstanding market fee", {
          outstanding,
        });
      }

      const [lic] = await db
        .select()
        .from(traderLicences)
        .where(eq(traderLicences.id, String(pt.traderLicenceId)))
        .limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }

      const pendingRecs = allRecs.filter((r) => String(r.status ?? "") === "Pending");
      const createdBy = req.user?.id ?? "system";

      const singlePendingInPlace =
        pendingRecs.length === 1 &&
        paidSum < 0.0001 &&
        Math.abs(payAmount - outstanding) < 0.02 &&
        Math.abs(Number(pendingRecs[0]!.totalAmount ?? 0) - L) < 0.02;

      if (singlePendingInPlace) {
        const pr = pendingRecs[0]!;
        await db.update(iomsReceipts).set({ status: "Paid", gatewayRef: "Manual" }).where(eq(iomsReceipts.id, pr.id));
        const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, pr.id)).limit(1);
        if (row) {
          await writeAuditLog(req, {
            module: "Receipts",
            action: "Update",
            recordId: pr.id,
            beforeValue: pr,
            afterValue: row,
          }).catch((e) => console.error("Audit log failed:", e));
        }
        return res.status(201).json({
          receiptId: pr.id,
          receiptNo: pr.receiptNo,
          newOutstanding: Math.max(0, outstanding - payAmount),
        });
      }

      const created = await createIomsReceipt({
        yardId: pt.yardId,
        revenueHead: "MarketFee",
        payerName: lic.firmName ?? pt.traderLicenceId,
        payerType: "TraderLicence",
        payerRefId: pt.traderLicenceId,
        amount: payAmount,
        paymentMode: "Cash",
        sourceModule: "M-04",
        sourceRecordId: pt.id,
        unifiedEntityId: unifiedEntityIdFromTrackA(pt.traderLicenceId),
        createdBy,
      });

      await db.update(iomsReceipts).set({ status: "Paid", gatewayRef: "Manual" }).where(eq(iomsReceipts.id, created.id));

      let remaining = payAmount;
      for (const pr of pendingRecs) {
        if (remaining <= 0.0001) break;
        const prev = Number(pr.totalAmount ?? 0);
        const next = Math.max(0, prev - remaining);
        const consumed = prev - next;
        remaining -= consumed;
        if (next <= 0.01) {
          await db
            .update(iomsReceipts)
            .set({
              status: "Reconciled",
              amount: 0,
              totalAmount: 0,
              gatewayRef: "NettedWithCounterPay",
            })
            .where(eq(iomsReceipts.id, pr.id));
        } else {
          await db.update(iomsReceipts).set({ amount: next, totalAmount: next }).where(eq(iomsReceipts.id, pr.id));
        }
      }

      await db
        .update(purchaseTransactions)
        .set({ receiptId: created.id })
        .where(eq(purchaseTransactions.id, pt.id));

      const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
      if (paidRow) {
        await writeAuditLog(req, { module: "Receipts", action: "Create", recordId: created.id, afterValue: paidRow }).catch((e) =>
          console.error("Audit log failed:", e),
        );
      }

      const newOutstanding = Math.max(0, outstanding - payAmount);
      res.status(201).json({ receiptId: created.id, receiptNo: created.receiptNo, newOutstanding });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to record market fee payment");
    }
  });

  app.post("/api/ioms/unified-entities/ad-hoc", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const yardId = String(body.yardId ?? "");
      if (!yardId) return sendApiError(res, 400, "ADHOC_YARD_REQUIRED", "yardId is required");
      if (!yardInScope(req, yardId)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const name = String(body.name ?? "").trim();
      if (!name) return sendApiError(res, 400, "ADHOC_NAME_REQUIRED", "name is required");
      const panNorm = body.pan != null && String(body.pan).trim() !== "" ? normalizePanInput(String(body.pan)) : null;
      if (panNorm && (panNorm.length !== 10 || !INDIAN_PAN_RE.test(panNorm))) {
        return sendApiError(res, 400, "ADHOC_PAN_FORMAT", "PAN must match ABCDE1234F.");
      }
      if (panNorm && (await isPanTakenAcrossActiveMasters({ panUpper: panNorm }))) {
        return sendApiError(res, 400, "ADHOC_PAN_DUPLICATE", "PAN is already used by another active record.");
      }
      if (body.entityCode != null && String(body.entityCode).trim() !== "") {
        return sendApiError(
          res,
          400,
          "ENTITY_CODE_SYSTEM_ASSIGNED",
          "Entity ID (ENT-YYYY-NNNNN) is assigned automatically by the system and cannot be supplied on create.",
        );
      }

      const id = nanoid();
      const ts = now();
      const [row] = await db.transaction(async (tx) => {
        const entityCode = await nextEntityPublicCodeTx(tx);
        await tx.insert(adHocEntities).values({
          id,
          entityCode,
          name,
          yardId,
          pan: panNorm,
          gstin: body.gstin ? String(body.gstin) : null,
          mobile: body.mobile ? normalizeMobile10(String(body.mobile)) : null,
          email: body.email ? String(body.email).trim().toLowerCase() : null,
          address: body.address ? String(body.address) : null,
          status: String(body.status ?? "Active"),
          createdAt: ts,
          updatedAt: ts,
        });
        return tx.select().from(adHocEntities).where(eq(adHocEntities.id, id));
      });
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create ad-hoc entity");
    }
  });

  app.get("/api/ioms/unified-entities/by-id", async (req, res) => {
    try {
      const unifiedId = String(req.query.unifiedId ?? "").trim();
      const parsed = parseUnifiedEntityId(unifiedId);
      if (!parsed) return sendApiError(res, 400, "UNIFIED_ID_INVALID", "unifiedId must be TA:<id> | TB:<id> | AH:<id>");

      if (parsed.kind === "TA") {
        const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, parsed.refId)).limit(1);
        if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
        return res.json({ unifiedId, kind: "TrackA", refId: lic.id, record: lic });
      }
      if (parsed.kind === "TB") {
        const [ent] = await db.select().from(entities).where(eq(entities.id, parsed.refId)).limit(1);
        if (!ent || !yardInScope(req, ent.yardId)) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
        return res.json({ unifiedId, kind: "TrackB", refId: ent.id, record: ent });
      }
      const [ah] = await db.select().from(adHocEntities).where(eq(adHocEntities.id, parsed.refId)).limit(1);
      if (!ah || !yardInScope(req, ah.yardId)) return sendApiError(res, 404, "ADHOC_ENTITY_NOT_FOUND", "Ad-hoc entity not found");
      return res.json({ unifiedId, kind: "AdHoc", refId: ah.id, record: ah });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to resolve unified entity");
    }
  });

  // ----- Track B govt pre-receipts -----
  app.get("/api/ioms/pre-receipts", async (req, res) => {
    try {
      const entityId = req.query.entityId as string | undefined;
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      let list = await db.select().from(preReceipts).orderBy(desc(preReceipts.updatedAt));
      list = list.filter((r) => yardInScope(req, r.yardId));
      if (entityId) list = list.filter((r) => r.entityId === entityId);
      if (yardId) list = list.filter((r) => r.yardId === yardId);
      if (status) list = list.filter((r) => r.status === status);

      const entityIds = Array.from(new Set(list.map((r) => r.entityId).filter(Boolean)));
      const yardIds = Array.from(new Set(list.map((r) => r.yardId).filter(Boolean)));
      const receiptIds = Array.from(
        new Set(list.map((r) => r.settledReceiptId).filter((x): x is string => Boolean(x))),
      );
      const yardNameById = new Map<string, string>();
      if (yardIds.length > 0) {
        const yardRows = await db
          .select({ id: yards.id, name: yards.name, code: yards.code })
          .from(yards)
          .where(inArray(yards.id, yardIds));
        for (const y of yardRows) {
          yardNameById.set(y.id, String(y.name?.trim() || y.code?.trim() || y.id));
        }
      }
      const entityById = new Map<string, { entityCode: string | null; name: string }>();
      if (entityIds.length > 0) {
        const entRows = await db
          .select({ id: entities.id, entityCode: entities.entityCode, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, entityIds));
        for (const e of entRows) {
          entityById.set(e.id, {
            entityCode: e.entityCode?.trim() || null,
            name: String(e.name ?? "").trim(),
          });
        }
      }
      const receiptNoById = new Map<string, string>();
      if (receiptIds.length > 0) {
        const recRows = await db
          .select({ id: iomsReceipts.id, receiptNo: iomsReceipts.receiptNo })
          .from(iomsReceipts)
          .where(inArray(iomsReceipts.id, receiptIds));
        for (const rec of recRows) {
          receiptNoById.set(rec.id, String(rec.receiptNo ?? "").trim());
        }
      }

      res.json(
        list.map((r) => {
          const ent = entityById.get(r.entityId);
          const code = ent?.entityCode ?? null;
          const settledReceiptNo = r.settledReceiptId
            ? receiptNoById.get(r.settledReceiptId) ?? null
            : null;
          return {
            ...r,
            entityCode: code,
            entityName: ent?.name ?? null,
            entityDisplay: code
              ? `${code} — ${ent?.name ?? ""}`.trim()
              : ent?.name?.trim() || null,
            yardName: yardNameById.get(r.yardId) ?? null,
            settledReceiptNo,
          };
        }),
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch pre-receipts");
    }
  });

  app.get("/api/ioms/pre-receipts/issue-context", async (req, res) => {
    try {
      const entityId = String(req.query.entityId ?? "").trim();
      if (!entityId) return sendApiError(res, 400, "ENTITY_ID_REQUIRED", "entityId is required");
      const [ent] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
      if (!ent) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      if (!yardInScope(req, ent.yardId)) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      if (!isTrackBGovtSubType(ent.subType)) {
        return sendApiError(
          res,
          400,
          "PRE_RECEIPT_ENTITY_NOT_GOVT",
          "Pre-receipts apply only to Govt Track B entities.",
        );
      }
      const allotments = await db
        .select()
        .from(entityAllotments)
        .where(
          and(
            eq(entityAllotments.entityId, entityId),
            eq(entityAllotments.status, "Active"),
            eq(entityAllotments.approvalStatus, "Approved"),
          ),
        )
        .orderBy(desc(entityAllotments.toDate));
      const allot = allotments[0];
      if (!allot) {
        return sendApiError(
          res,
          400,
          "PRE_RECEIPT_NO_ALLOTMENT",
          "No active approved premises allocation for this entity. Complete premises allocation before issuing a pre-receipt.",
        );
      }
      const ctx = await resolvePreReceiptIssueContext(entityId);
      if (!ctx) {
        return sendApiError(
          res,
          400,
          "PRE_RECEIPT_ALLOTMENT_INVALID",
          "Active allocation has no valid monthly rent or premises details.",
        );
      }
      return res.json({ entityId, ...ctx });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to resolve pre-receipt issue context");
    }
  });

  app.get("/api/ioms/pre-receipts/:id/pdf", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [pre] = await db.select().from(preReceipts).where(eq(preReceipts.id, id)).limit(1);
      if (!pre) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      if (!yardInScope(req, pre.yardId)) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      const [ent] = await db.select().from(entities).where(eq(entities.id, pre.entityId)).limit(1);
      if (!ent) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      const [yard] = await db.select().from(yards).where(eq(yards.id, pre.yardId)).limit(1);
      const yardDisplay = String(yard?.name?.trim() || yard?.code?.trim() || pre.yardId);
      const printFields = await resolvePreReceiptPrintFields(pre.entityId);
      const pdfPre = printFields
        ? {
            ...pre,
            rentPremisesType: printFields.rentPremisesType,
            rentPremisesRef: printFields.rentPremisesId,
          }
        : pre;
      const buf = await buildPreReceiptPdfA4Double({ pre: pdfPre, entityName: ent.name, yardDisplayName: yardDisplay });
      const safeNo = String(pre.preReceiptNo ?? id).replace(/[^\w.-]+/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="pre-receipt-${safeNo}.pdf"`);
      return res.send(buf);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate pre-receipt PDF");
    }
  });

  app.get("/api/ioms/pre-receipts/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      if (!id) return sendApiError(res, 400, "PRE_RECEIPT_ID", "Pre-receipt id is required");
      const [row] = await db.select().from(preReceipts).where(eq(preReceipts.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      if (!yardInScope(req, row.yardId)) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      const [ent] = await db
        .select({ entityCode: entities.entityCode, name: entities.name })
        .from(entities)
        .where(eq(entities.id, row.entityId))
        .limit(1);
      const code = ent?.entityCode?.trim() || null;
      let settledReceiptNo: string | null = null;
      if (row.settledReceiptId) {
        const [rec] = await db
          .select({ receiptNo: iomsReceipts.receiptNo })
          .from(iomsReceipts)
          .where(eq(iomsReceipts.id, row.settledReceiptId))
          .limit(1);
        settledReceiptNo = rec?.receiptNo?.trim() || null;
      }
      const printFields = await resolvePreReceiptPrintFields(row.entityId);
      return res.json({
        ...row,
        entityCode: code,
        entityName: ent?.name?.trim() || null,
        entityDisplay: code ? `${code} — ${ent?.name ?? ""}`.trim() : ent?.name?.trim() || null,
        settledReceiptNo,
        rentPremisesId: printFields?.rentPremisesId ?? row.rentPremisesRef ?? null,
        rentAllotmentReferenceNo: printFields?.rentAllotmentReferenceNo ?? null,
        agreementFrom: printFields?.agreementFrom ?? null,
        agreementTo: printFields?.agreementTo ?? null,
      });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch pre-receipt");
    }
  });

  app.post("/api/ioms/pre-receipts", async (req, res) => {
    try {
      const body = req.body;
      const entityId = String(body.entityId ?? "");
      const [ent] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
      if (!ent) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      if (!yardInScope(req, ent.yardId)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this entity yard");
      // Track B: pre-receipt billing instrument applies only to Govt sub-type (Commercial / AdHocOccupant → M-03 tax invoices).
      if (!isTrackBGovtSubType(ent.subType)) {
        return sendApiError(
          res,
          400,
          "PRE_RECEIPT_ENTITY_NOT_GOVT",
          "Pre-receipts can be issued only for Govt sub-type entities (Commercial and Ad-hoc occupant entities use tax invoice flows).",
          { entityId, subType: ent.subType },
        );
      }
      const rentBRaw = body.rentBillingMonth != null ? String(body.rentBillingMonth).trim().slice(0, 7) : "";
      if (!rentBRaw) {
        return sendApiError(res, 400, "PRE_RECEIPT_BILLING_MONTH_REQUIRED", "Billing month (YYYY-MM) is required.");
      }
      if (!/^\d{4}-\d{2}$/.test(rentBRaw)) {
        return sendApiError(res, 400, "PRE_RECEIPT_BILLING_MONTH", "rentBillingMonth must be YYYY-MM.");
      }
      const issueCtx = await resolvePreReceiptIssueContext(entityId);
      if (!issueCtx) {
        return sendApiError(
          res,
          400,
          "PRE_RECEIPT_NO_ALLOTMENT",
          "No active approved premises allocation with monthly rent for this entity.",
        );
      }
      const [allotRow] = await db
        .select({ fromDate: entityAllotments.fromDate, toDate: entityAllotments.toDate })
        .from(entityAllotments)
        .where(eq(entityAllotments.id, issueCtx.allotmentId))
        .limit(1);
      if (allotRow && !billingMonthWithinAllotment(rentBRaw, allotRow.fromDate, allotRow.toDate)) {
        return sendApiError(
          res,
          400,
          "PRE_RECEIPT_BILLING_OUTSIDE_AGREEMENT",
          "Billing month falls outside the active agreement period for this premises.",
          { rentBillingMonth: rentBRaw, agreementFrom: allotRow.fromDate, agreementTo: allotRow.toDate },
        );
      }
      const dup = await findDuplicatePreReceiptForMonth(entityId, rentBRaw);
      if (dup) {
        return sendApiError(
          res,
          409,
          "PRE_RECEIPT_DUPLICATE_MONTH",
          "A pre-receipt already exists for this entity and billing month.",
          { existingId: dup.id, existingPreReceiptNo: dup.preReceiptNo },
        );
      }
      const id = nanoid();
      const preNoRaw = String(body.preReceiptNo ?? "").trim();
      const preNo = preNoRaw ? preNoRaw : await allocateNextPreReceiptNo();
      await db.insert(preReceipts).values({
        id,
        preReceiptNo: preNo,
        entityId,
        yardId: ent.yardId,
        rentPremisesType: issueCtx.rentPremisesType,
        rentPremisesRef: issueCtx.rentPremisesId,
        rentBillingMonth: rentBRaw,
        purpose: null,
        amount: issueCtx.amount,
        status: "Issued",
        issuedAt: now(),
        dispatchedAt: null,
        acknowledgedAt: null,
        settledAt: null,
        settledReceiptId: null,
        remarks: body.remarks ? String(body.remarks) : null,
        createdBy: req.user?.id ?? null,
        updatedAt: now(),
      });
      const [row] = await db.select().from(preReceipts).where(eq(preReceipts.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create pre-receipt");
    }
  });

  app.put("/api/ioms/pre-receipts/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      if (!id) return sendApiError(res, 400, "PRE_RECEIPT_ID", "Pre-receipt id is required");
      const [existing] = await db.select().from(preReceipts).where(eq(preReceipts.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      const [ent] = await db.select().from(entities).where(eq(entities.id, existing.entityId)).limit(1);
      if (!ent) return sendApiError(res, 404, "PRE_RECEIPT_NOT_FOUND", "Not found");
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = { updatedAt: now() };
      if (body.status !== undefined) {
        const next = String(body.status);
        const cur = String(existing.status);
        if (next !== cur) {
          const ok =
            (cur === "Issued" && (next === "Dispatched" || next === "Cancelled")) ||
            (cur === "Dispatched" && (next === "Acknowledged" || next === "Cancelled")) ||
            (cur === "Acknowledged" && (next === "Settled" || next === "Cancelled")) ||
            (cur === "Settled" && next === "Settled") ||
            (cur === "Cancelled" && next === "Cancelled");
          if (!ok) {
            return sendApiError(
              res,
              400,
              "PRE_RECEIPT_BAD_TRANSITION",
              `Cannot change status from ${cur} to ${next}`,
            );
          }
          updates.status = next;
          if (next === "Dispatched") updates.dispatchedAt = now();
          if (next === "Acknowledged") updates.acknowledgedAt = now();
          if (next === "Settled") {
            let rid = body.settledReceiptId != null ? String(body.settledReceiptId).trim() : "";
            if (!rid) {
              if (!req.user?.id) {
                return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
              }
              // Auto-create IOMS receipt on settlement when not provided.
              const created = await createIomsReceipt({
                yardId: existing.yardId,
                revenueHead: "Rent",
                payerName: ent.name,
                payerType: "Entity",
                payerRefId: ent.id,
                amount: Number(existing.amount ?? 0) || 0,
                paymentMode: "Cash",
                sourceModule: "M-02",
                sourceRecordId: existing.id,
                unifiedEntityId: unifiedEntityIdFromTrackB(ent.id),
                createdBy: req.user.id,
              });
              rid = created.id;
            }
            updates.settledAt = now();
            updates.settledReceiptId = rid;
          }
        }
      }
      if (body.remarks !== undefined) {
        updates.remarks = body.remarks == null || body.remarks === "" ? null : String(body.remarks);
      }
      if (body.rentBillingMonth !== undefined) {
        const m =
          body.rentBillingMonth == null || body.rentBillingMonth === ""
            ? null
            : String(body.rentBillingMonth).trim().slice(0, 7);
        if (m && !/^\d{4}-\d{2}$/.test(m)) {
          return sendApiError(res, 400, "PRE_RECEIPT_BILLING_MONTH", "rentBillingMonth must be YYYY-MM.");
        }
        if (m) {
          const printFields = await resolvePreReceiptPrintFields(existing.entityId);
          if (
            printFields &&
            !billingMonthWithinAllotment(m, printFields.agreementFrom, printFields.agreementTo)
          ) {
            return sendApiError(
              res,
              400,
              "PRE_RECEIPT_BILLING_OUTSIDE_AGREEMENT",
              "Billing month falls outside the active agreement period for this premises.",
              {
                rentBillingMonth: m,
                agreementFrom: printFields.agreementFrom,
                agreementTo: printFields.agreementTo,
              },
            );
          }
          const dup = await findDuplicatePreReceiptForMonth(existing.entityId, m, id);
          if (dup) {
            return sendApiError(
              res,
              409,
              "PRE_RECEIPT_DUPLICATE_MONTH",
              "A pre-receipt already exists for this entity and billing month.",
              { existingId: dup.id, existingPreReceiptNo: dup.preReceiptNo },
            );
          }
        }
        updates.rentBillingMonth = m;
      }
      try {
        await db.update(preReceipts).set(updates as Record<string, string | number | null>).where(eq(preReceipts.id, id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/rent_premises|rent_billing|column .*does not exist/i.test(msg)) {
          return sendApiError(
            res,
            500,
            "PRE_RECEIPT_SCHEMA",
            "Database is missing pre-receipt print columns. On the server run: npm run db:apply-pre-receipt-print-fields",
          );
        }
        throw e;
      }
      const [row] = await db.select().from(preReceipts).where(eq(preReceipts.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update pre-receipt");
    }
  });

  // ----- Trader licences -----
  app.get("/api/ioms/traders/licences", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const licenceTypesRaw = req.query.licenceTypes as string | undefined;
      const licenceTypes =
        licenceTypesRaw && String(licenceTypesRaw).trim()
          ? String(licenceTypesRaw)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const paged = req.query.paged === "1";
      const allYards = String(req.query.allYards ?? "").trim() === "1";
      const isAdmin = Boolean(req.user?.roles.some((r) => r.tier === "ADMIN"));
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (!(allYards && isAdmin) && scopedIds && scopedIds.length > 0) {
        conditions.push(inArray(traderLicences.yardId, scopedIds));
      }
      if (yardId) conditions.push(eq(traderLicences.yardId, yardId));
      if (status) conditions.push(eq(traderLicences.status, status));
      if (licenceTypes.length > 0) conditions.push(inArray(traderLicences.licenceType, licenceTypes));

      if (paged) {
        const { page, pageSize, q } = parseReportPaging(req);
        const { sortKey, sortDir } = parseReportSort(req, LICENCE_REPORT_SORT_ALLOW, "createdAt");
        const pattern = reportSearchPattern(q);
        const all = [...conditions];
        if (pattern) {
          all.push(
            or(
              ilike(traderLicences.licenceNo, pattern),
              ilike(traderLicences.firmName, pattern),
              ilike(traderLicences.mobile, pattern),
              ilike(traderLicences.id, pattern),
              ilike(traderLicences.email, pattern),
              ilike(traderLicences.licenceType, pattern),
              ilike(traderLicences.contactName, pattern),
              ilike(traderLicences.provisionalLicenceNo, pattern),
              ilike(traderLicences.applicationSerial, pattern),
              ilike(traderLicences.entityPublicCode, pattern),
              sql`cast(${traderLicences.feeAmount} as text) ilike ${pattern}`,
            )!,
          );
        }
        const wc = all.length ? and(...all) : undefined;
        const countQ = db.select({ c: sql<number>`count(*)::int` }).from(traderLicences);
        const [{ c: total }] = wc ? await countQ.where(wc) : await countQ;
        const licenceBase = db.select().from(traderLicences);
        const licenceFiltered = wc ? licenceBase.where(wc) : licenceBase;
        const dataQ = licenceFiltered.orderBy(...orderLicenceReport(sortKey, sortDir));
        const rows =
          pageSize === "all"
            ? await dataQ
            : await dataQ.limit(pageSize).offset((page - 1) * pageSize);
        return res.json({ total, page, pageSize, rows });
      }

      const base = db.select().from(traderLicences).orderBy(desc(traderLicences.createdAt));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch licences");
    }
  });

  app.get("/api/ioms/traders/licences/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, req.params.id)).limit(1);
      if (!row) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!licenceYardAccessible(req, row.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch licence");
    }
  });

  /** Form BM: download uploaded supporting document (M-02 Read). */
  app.get("/api/ioms/traders/licences/:id/bm-form-document", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Read")) {
        return sendApiError(res, 403, "BM_FORM_READ_DENIED", "You do not have permission to read trader licences.");
      }
      const id = routeParamString(req.params.id);
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const fn = lic.bmFormDocFile ? String(lic.bmFormDocFile).trim() : "";
      if (!fn || !isAllowedBmFormFileName(fn)) {
        return sendApiError(res, 404, "BM_FORM_NOT_FOUND", "No BM supporting document file on this licence.");
      }
      const buf = await readTraderBmFormBuffer(id, fn);
      if (!buf?.length) return sendApiError(res, 404, "BM_FORM_NOT_FOUND", "File missing on server");
      res.setHeader("Content-Type", contentTypeForBmFormFile(fn));
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read BM form document");
    }
  });

  /** Form BM: upload/replace supporting document file (PDF/JPEG/PNG; not after licence number issued). */
  app.post("/api/ioms/traders/licences/:id/bm-form-document", multerBmFormSingle, async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Update") && !hasPermission(req.user, "M-02", "Create")) {
        return sendApiError(res, 403, "BM_FORM_UPLOAD_DENIED", "You do not have permission to upload BM documents.");
      }
      const id = routeParamString(req.params.id);
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!traderLicenceUsesBmSupplement(lic.licenceType)) {
        return sendApiError(res, 400, "BM_FORM_TYPE", "BM supporting documents apply only to functionary licence types.");
      }
      const issuedNo = lic.licenceNo != null && String(lic.licenceNo).trim() !== "";
      if (issuedNo) {
        return sendApiError(
          res,
          403,
          "BM_FORM_LICENCE_LOCKED",
          "This licence number has been issued. The BM supporting document cannot be replaced.",
        );
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file?.buffer?.length) {
        return sendApiError(res, 400, "BM_FORM_REQUIRED", "Choose one file (field name: file).");
      }
      const ext = extFromBmFormMime(file.mimetype);
      if (!ext) return sendApiError(res, 400, "BM_FORM_MIME", "Only PDF, PNG, or JPEG files are allowed.");
      const stored = `${nanoid(16)}${ext}`;
      const prev = lic.bmFormDocFile ? String(lic.bmFormDocFile).trim() : "";
      if (prev && isAllowedBmFormFileName(prev)) {
        await unlinkTraderBmFormIfExists(id, prev).catch(() => undefined);
      }
      await writeTraderBmFormBuffer(id, stored, file.buffer);
      await db.update(traderLicences).set({ bmFormDocFile: stored, updatedAt: now() }).where(eq(traderLicences.id, id));
      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (row) writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: lic, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to upload BM form document");
    }
  });

  /** Form BM: remove uploaded supporting document file. */
  app.delete("/api/ioms/traders/licences/:id/bm-form-document", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Update") && !hasPermission(req.user, "M-02", "Create")) {
        return sendApiError(res, 403, "BM_FORM_DELETE_DENIED", "You do not have permission to update trader licences.");
      }
      const id = routeParamString(req.params.id);
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!traderLicenceUsesBmSupplement(lic.licenceType)) {
        return sendApiError(res, 400, "BM_FORM_TYPE", "BM supporting documents apply only to functionary licence types.");
      }
      const issuedNo = lic.licenceNo != null && String(lic.licenceNo).trim() !== "";
      if (issuedNo) {
        return sendApiError(res, 403, "BM_FORM_LICENCE_LOCKED", "This licence number has been issued. The BM file cannot be removed here.");
      }
      const prev = lic.bmFormDocFile ? String(lic.bmFormDocFile).trim() : "";
      if (prev && isAllowedBmFormFileName(prev)) {
        await unlinkTraderBmFormIfExists(id, prev).catch(() => undefined);
      }
      await db.update(traderLicences).set({ bmFormDocFile: null, updatedAt: now() }).where(eq(traderLicences.id, id));
      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (row) writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: lic, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to remove BM form document");
    }
  });

  // ----- Trader stock openings (M-02 legacy opening balance) -----
  app.get("/api/ioms/traders/licences/:licenceId/stock-openings", async (req, res) => {
    try {
      const licenceId = req.params.licenceId;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, licenceId)).limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const list = await db
        .select()
        .from(traderStockOpenings)
        .where(eq(traderStockOpenings.traderLicenceId, licenceId))
        .orderBy(desc(traderStockOpenings.effectiveDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch stock openings");
    }
  });

  app.post("/api/ioms/traders/licences/:licenceId/stock-openings", async (req, res) => {
    try {
      const licenceId = req.params.licenceId;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, licenceId)).limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const body = req.body as Record<string, unknown>;
      const commodityId = String(body.commodityId ?? "");
      const unit = String(body.unit ?? "");
      const effectiveDate = String(body.effectiveDate ?? "");
      const quantity = Number(body.quantity);
      if (!commodityId || !unit || !effectiveDate || !Number.isFinite(quantity)) {
        return sendApiError(res, 400, "STOCK_OPENING_FIELDS", "commodityId, unit, effectiveDate, quantity (number) required");
      }
      const [com] = await db.select().from(commodities).where(eq(commodities.id, commodityId)).limit(1);
      if (!com) return sendApiError(res, 400, "STOCK_OPENING_COMMODITY_INVALID", "Commodity not found");
      const expectedUnit = await resolvedCommodityUnitLabel(commodityId);
      if (!expectedUnit) {
        return sendApiError(
          res,
          400,
          "STOCK_OPENING_COMMODITY_NO_UNIT",
          "This commodity has no unit in master data. Configure the commodity unit under Market / Admin before recording opening stock.",
        );
      }
      if (unit.trim() !== expectedUnit) {
        return sendApiError(
          res,
          400,
          "STOCK_OPENING_UNIT_MISMATCH",
          `Unit must be "${expectedUnit}" for this commodity (from master data).`,
        );
      }
      const [dup] = await db
        .select({ id: traderStockOpenings.id })
        .from(traderStockOpenings)
        .where(and(eq(traderStockOpenings.traderLicenceId, licenceId), eq(traderStockOpenings.commodityId, commodityId)))
        .limit(1);
      if (dup) {
        return sendApiError(
          res,
          409,
          "STOCK_OPENING_COMMODITY_DUPLICATE",
          "This licence already has an opening stock line for this commodity. Delete the existing line if you need to replace it.",
        );
      }
      const id = nanoid();
      const ts = now();
      await db.insert(traderStockOpenings).values({
        id,
        traderLicenceId: licenceId,
        yardId: lic.yardId,
        commodityId,
        quantity,
        unit,
        effectiveDate,
        remarks: body.remarks ? String(body.remarks) : null,
        createdAt: ts,
        createdBy: req.user?.id ?? null,
      });
      const [row] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create stock opening");
    }
  });

  app.put("/api/ioms/traders/stock-openings/:openingId", async (req, res) => {
    try {
      const openingId = req.params.openingId;
      const [existing] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId)).limit(1);
      if (!existing) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, existing.traderLicenceId)).limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      if (body.commodityId !== undefined) {
        const cid = String(body.commodityId);
        const [com] = await db.select().from(commodities).where(eq(commodities.id, cid)).limit(1);
        if (!com) return sendApiError(res, 400, "STOCK_OPENING_COMMODITY_INVALID", "Commodity not found");
        updates.commodityId = cid;
      }
      if (body.quantity !== undefined) updates.quantity = Number(body.quantity);
      if (body.unit !== undefined) updates.unit = String(body.unit);
      if (body.effectiveDate !== undefined) updates.effectiveDate = String(body.effectiveDate);
      if (body.remarks !== undefined) updates.remarks = body.remarks == null ? null : String(body.remarks);
      if (body.commodityId !== undefined || body.unit !== undefined) {
        const cid = body.commodityId !== undefined ? String(body.commodityId) : existing.commodityId;
        const u = body.unit !== undefined ? String(body.unit) : existing.unit;
        const expectedUnit = await resolvedCommodityUnitLabel(cid);
        if (!expectedUnit) {
          return sendApiError(
            res,
            400,
            "STOCK_OPENING_COMMODITY_NO_UNIT",
            "This commodity has no unit in master data. Configure the commodity unit under Market / Admin before recording opening stock.",
          );
        }
        if (String(u).trim() !== expectedUnit) {
          return sendApiError(
            res,
            400,
            "STOCK_OPENING_UNIT_MISMATCH",
            `Unit must be "${expectedUnit}" for this commodity (from master data).`,
          );
        }
      }
      if (body.commodityId !== undefined && String(body.commodityId) !== existing.commodityId) {
        const nextCid = String(body.commodityId);
        const [other] = await db
          .select({ id: traderStockOpenings.id })
          .from(traderStockOpenings)
          .where(
            and(
              eq(traderStockOpenings.traderLicenceId, existing.traderLicenceId),
              eq(traderStockOpenings.commodityId, nextCid),
              ne(traderStockOpenings.id, openingId),
            ),
          )
          .limit(1);
        if (other) {
          return sendApiError(
            res,
            409,
            "STOCK_OPENING_COMMODITY_DUPLICATE",
            "Another opening stock line for this commodity already exists on this licence.",
          );
        }
      }
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId));
        return res.json(row!);
      }
      await db.update(traderStockOpenings).set(updates as Record<string, string | number | null>).where(eq(traderStockOpenings.id, openingId));
      const [row] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId));
      if (row) writeAuditLog(req, { module: "Traders", action: "Update", recordId: openingId, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row!);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update stock opening");
    }
  });

  app.delete("/api/ioms/traders/stock-openings/:openingId", async (req, res) => {
    try {
      const openingId = req.params.openingId;
      const [existing] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId)).limit(1);
      if (!existing) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, existing.traderLicenceId)).limit(1);
      if (!lic || !licenceYardAccessible(req, lic.yardId)) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      await db.delete(traderStockOpenings).where(eq(traderStockOpenings.id, openingId));
      writeAuditLog(req, { module: "Traders", action: "Delete", recordId: openingId, beforeValue: existing }).catch((e) => console.error("Audit log failed:", e));
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete stock opening");
    }
  });

  app.post("/api/ioms/traders/licences", async (req, res) => {
    try {
      const body = req.body;
      const yid = String(body.yardId ?? "");
      if (!licenceYardAccessible(req, yid)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      if (!body.mobile || String(body.mobile).trim() === "") {
        return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
      }
      let mobileNorm: string;
      let emailNorm: string | null;
      let aadhaarNorm: string | null;
      try {
        const m = normalizeMobile10(String(body.mobile));
        if (m == null) {
          return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
        }
        mobileNorm = m;
        emailNorm =
          body.email != null && String(body.email).trim() !== "" ? String(body.email).trim().toLowerCase() : null;
        assertPersonalEmailFormat(emailNorm);
        aadhaarNorm = normalizeAadhaarMasked(body.aadhaarToken ?? null);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
      if (await traderLicenceMobileInUse(mobileNorm, null)) {
        return sendApiError(
          res,
          400,
          "LICENCE_MOBILE_DUPLICATE",
          "This mobile number is already used on another draft, in-review, or active trader licence.",
        );
      }
      const licenceTypeStr = String(body.licenceType ?? "Associated");
      const applicationKindStr = body.applicationKind ? String(body.applicationKind) : "New";
      const fatherSpouse =
        body.fatherSpouseName != null && String(body.fatherSpouseName).trim() !== ""
          ? String(body.fatherSpouseName).trim()
          : null;
      const dob =
        body.dateOfBirth != null && String(body.dateOfBirth).trim() !== "" ? String(body.dateOfBirth).trim() : null;
      let emergencyNorm: string | null = null;
      try {
        emergencyNorm =
          body.emergencyContactMobile != null && String(body.emergencyContactMobile).trim() !== ""
            ? normalizeMobile10(String(body.emergencyContactMobile))
            : null;
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
      const charIss =
        body.characterCertIssuer != null && String(body.characterCertIssuer).trim() !== ""
          ? String(body.characterCertIssuer).trim()
          : null;
      const charDt =
        body.characterCertDate != null && String(body.characterCertDate).trim() !== ""
          ? String(body.characterCertDate).trim()
          : null;
      const bmDocRes = parseOptionalHttpUrl(body.bmFormDocUrl);
      if (!bmDocRes.ok) {
        return sendApiError(res, 400, "LICENCE_BM_DOC_URL", bmDocRes.message);
      }
      const renewalDecl = Boolean(body.renewalNoArrearsDeclared ?? false);
      const bmUndertakingAccepted = Boolean(body.bmUndertakingAccepted ?? false);
      const statusStr = String(body.status ?? "Draft");
      if (statusStr === "Pending") {
        const pendErr = validateLicenceForPendingStatus({
          licenceType: licenceTypeStr,
          applicationKind: applicationKindStr,
          fatherSpouseName: fatherSpouse,
          dateOfBirth: dob,
          emergencyContactMobile: emergencyNorm,
          characterCertIssuer: charIss,
          characterCertDate: charDt,
          renewalNoArrearsDeclared: renewalDecl,
          bmUndertakingAccepted,
        });
        if (pendErr) return sendApiError(res, 400, pendErr.code, pendErr.message);
      }
      const id = nanoid();
      const panNorm = body.pan != null && String(body.pan).trim() !== "" ? normalizePanInput(String(body.pan)) : null;
      if (panNorm && (panNorm.length !== 10 || !INDIAN_PAN_RE.test(panNorm))) {
        return sendApiError(res, 400, "LICENCE_PAN_FORMAT", "PAN must match ABCDE1234F.");
      }
      if (panNorm && (await isPanTakenAcrossActiveMasters({ panUpper: panNorm }))) {
        return sendApiError(res, 400, "LICENCE_PAN_DUPLICATE", "PAN is already used by another active record.");
      }
      const govtGstRes = await resolveGovtGstExemptCategoryId(body.govtGstExemptCategoryId);
      if (!govtGstRes.ok) {
        return sendApiError(res, 400, govtGstRes.code, govtGstRes.message);
      }
      const sys = await getMergedSystemConfig();
      const feeFromBody =
        body.feeAmount != null && String(body.feeAmount).trim() !== "" ? Number(body.feeAmount) : null;
      const feeAmount = feeFromBody != null && !Number.isNaN(feeFromBody) ? feeFromBody : parseSystemConfigNumber(sys, "licence_fee");
      const ts = now();
      await db.transaction(async (tx) => {
        let applicationSerial: string | null = null;
        if (statusStr === "Pending") {
          applicationSerial = await nextApplicationSerialTx(tx);
        }
        await tx.insert(traderLicences).values({
          id,
          firmName: String(body.firmName ?? ""),
          yardId: String(body.yardId ?? ""),
          mobile: mobileNorm,
          licenceType: licenceTypeStr,
          status: statusStr,
          parentLicenceId: body.parentLicenceId ? String(body.parentLicenceId) : null,
          applicationKind: applicationKindStr,
          firmType: body.firmType ? String(body.firmType) : null,
          contactName: body.contactName ? String(body.contactName) : null,
          email: emailNorm,
          address: body.address ? String(body.address) : null,
          aadhaarToken: aadhaarNorm,
          pan: panNorm,
          gstin: body.gstin ? String(body.gstin) : null,
          feeAmount,
          receiptId: body.receiptId ? String(body.receiptId) : null,
          validFrom: body.validFrom ? String(body.validFrom) : null,
          validTo: body.validTo ? String(body.validTo) : null,
          isBlocked: Boolean(body.isBlocked ?? false),
          blockReason: body.blockReason ? String(body.blockReason) : null,
          dvReturnRemarks: null,
          workflowRevisionCount: 0,
          govtGstExemptCategoryId: govtGstRes.id,
          isNonGstEntity: Boolean(body.isNonGstEntity ?? false),
          fatherSpouseName: fatherSpouse,
          dateOfBirth: dob,
          emergencyContactMobile: emergencyNorm,
          characterCertIssuer: charIss,
          characterCertDate: charDt,
          bmFormDocUrl: bmDocRes.value,
          parentLicenceFeeSnapshot: null,
          renewalNoArrearsDeclared: renewalDecl,
          bmUndertakingAccepted,
          provisionalLicenceNo: null,
          applicationSerial,
          entityPublicCode: null,
          doUser: body.doUser ? String(body.doUser) : null,
          dvUser: body.dvUser ? String(body.dvUser) : null,
          daUser: body.daUser ? String(body.daUser) : null,
          createdAt: ts,
          updatedAt: ts,
        });
      });
      let [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id));
      if (row?.receiptId != null && String(row.receiptId).trim() !== "" && !(row.provisionalLicenceNo != null && String(row.provisionalLicenceNo).trim() !== "")) {
        const [yardRow] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, row.yardId)).limit(1);
        await db
          .update(traderLicences)
          .set({
            provisionalLicenceNo: formatProvisionalLicenceNo(String(yardRow?.code ?? row.yardId)),
            updatedAt: now(),
          })
          .where(eq(traderLicences.id, id));
        [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id));
      }
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create licence");
    }
  });

  app.put("/api/ioms/traders/licences/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body as Record<string, unknown>;

      const [existing] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!licenceYardAccessible(req, existing.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");

      const issuedNo = existing.licenceNo != null && String(existing.licenceNo).trim() !== "";
      /** After licence number is issued, application data is frozen; these keys remain patchable (tax / operational). */
      const ISSUED_ALLOWED_BODY_KEYS = new Set([
        "govtGstExemptCategoryId",
        "isNonGstEntity",
        "isBlocked",
        "blockReason",
      ]);
      if (issuedNo) {
        for (const key of Object.keys(body)) {
          if (body[key] === undefined) continue;
          if (!ISSUED_ALLOWED_BODY_KEYS.has(key)) {
            return sendApiError(
              res,
              403,
              "LICENCE_FINAL_LOCKED",
              "This licence number has been issued. Only GST exemption category, non-GST flag, and block fields can be updated.",
            );
          }
        }
      }

      const newYardId = body.yardId !== undefined ? String(body.yardId) : existing.yardId;
      if (body.yardId !== undefined && !licenceYardAccessible(req, newYardId)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }

      const allowedAll = [
        "firmName",
        "firmType",
        "yardId",
        "contactName",
        "mobile",
        "email",
        "address",
        "aadhaarToken",
        "pan",
        "gstin",
        "licenceType",
        "feeAmount",
        "receiptId",
        "validFrom",
        "validTo",
        "status",
        "isBlocked",
        "blockReason",
        "licenceNo",
        "doUser",
        "dvUser",
        "daUser",
        "govtGstExemptCategoryId",
        "parentLicenceId",
        "applicationKind",
        "fatherSpouseName",
        "dateOfBirth",
        "emergencyContactMobile",
        "characterCertIssuer",
        "characterCertDate",
        "bmFormDocUrl",
        "renewalNoArrearsDeclared",
        "bmUndertakingAccepted",
      ];
      const allowed = issuedNo
        ? allowedAll.filter((k) => ISSUED_ALLOWED_BODY_KEYS.has(k))
        : allowedAll;
      const updates: Record<string, unknown> = { updatedAt: now() };
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "feeAmount") updates.feeAmount = body[k] == null ? null : Number(body[k]);
        else if (k === "renewalNoArrearsDeclared") updates.renewalNoArrearsDeclared = Boolean(body[k]);
        else if (k === "bmUndertakingAccepted") updates.bmUndertakingAccepted = Boolean(body[k]);
        else if (k === "emergencyContactMobile") {
          const raw = body[k];
          try {
            updates.emergencyContactMobile =
              raw == null || String(raw).trim() === "" ? null : normalizeMobile10(String(raw));
          } catch (e) {
            if (sendHrRule(res, e)) return;
            throw e;
          }
        } else if (k === "bmFormDocUrl") {
          const p = parseOptionalHttpUrl(body[k]);
          if (!p.ok) return sendApiError(res, 400, "LICENCE_BM_DOC_URL", p.message);
          updates.bmFormDocUrl = p.value;
        } else if (k === "pan") {
          const raw = body[k];
          const panNorm = raw == null || String(raw).trim() === "" ? null : normalizePanInput(String(raw));
          if (panNorm && (panNorm.length !== 10 || !INDIAN_PAN_RE.test(panNorm))) {
            return sendApiError(res, 400, "LICENCE_PAN_FORMAT", "PAN must match ABCDE1234F.");
          }
          if (panNorm && (await isPanTakenAcrossActiveMasters({ panUpper: panNorm, excludeTraderLicenceId: id }))) {
            return sendApiError(res, 400, "LICENCE_PAN_DUPLICATE", "PAN is already used by another active record.");
          }
          updates.pan = panNorm;
        } else updates[k] = body[k] == null ? null : String(body[k]);
      }
      if (body.isBlocked !== undefined) updates.isBlocked = Boolean(body.isBlocked);
      if (body.isNonGstEntity !== undefined) updates.isNonGstEntity = Boolean(body.isNonGstEntity);

      if (body.dvReturnRemarks !== undefined) {
        const raw = body.dvReturnRemarks;
        updates.dvReturnRemarks =
          raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, 4000);
      }

      const mergedStatus =
        updates.status !== undefined ? String(updates.status) : String(existing.status);
      if (mergedStatus === "Query" && existing.status !== "Query") {
        const remark =
          updates.dvReturnRemarks !== undefined ? (updates.dvReturnRemarks as string | null) : null;
        if (remark == null || String(remark).trim() === "") {
          return sendApiError(
            res,
            400,
            "QUERY_REMARKS_REQUIRED",
            "Reviewer remarks are required when returning an application for correction.",
          );
        }
      }
      if (existing.status === "Query" && mergedStatus === "Pending") {
        updates.workflowRevisionCount = (existing.workflowRevisionCount ?? 0) + 1;
        updates.dvReturnRemarks = null;
      }

      const hasAppSerial = existing.applicationSerial != null && String(existing.applicationSerial).trim() !== "";
      if (mergedStatus === "Pending" && !hasAppSerial) {
        const nextSer = await db.transaction(async (tx) => nextApplicationSerialTx(tx));
        updates.applicationSerial = nextSer;
      }

      if (mergedStatus === "Pending") {
        const mergedBmDoc =
          updates.bmFormDocUrl !== undefined ? (updates.bmFormDocUrl as string | null) : (existing.bmFormDocUrl ?? null);
        const bmUrlCheck = parseOptionalHttpUrl(mergedBmDoc);
        if (!bmUrlCheck.ok) return sendApiError(res, 400, "LICENCE_BM_DOC_URL", bmUrlCheck.message);
        const mergedType =
          updates.licenceType !== undefined ? String(updates.licenceType) : String(existing.licenceType);
        const mergedKind =
          updates.applicationKind !== undefined
            ? (updates.applicationKind as string | null)
            : (existing.applicationKind ?? null);
        const mergedFather =
          updates.fatherSpouseName !== undefined
            ? (updates.fatherSpouseName as string | null)
            : (existing.fatherSpouseName ?? null);
        const mergedDob =
          updates.dateOfBirth !== undefined ? (updates.dateOfBirth as string | null) : (existing.dateOfBirth ?? null);
        const mergedEmerg =
          updates.emergencyContactMobile !== undefined
            ? (updates.emergencyContactMobile as string | null)
            : (existing.emergencyContactMobile ?? null);
        const mergedChar =
          updates.characterCertIssuer !== undefined
            ? (updates.characterCertIssuer as string | null)
            : (existing.characterCertIssuer ?? null);
        const mergedCharD =
          updates.characterCertDate !== undefined
            ? (updates.characterCertDate as string | null)
            : (existing.characterCertDate ?? null);
        const mergedRenewalDecl =
          updates.renewalNoArrearsDeclared !== undefined
            ? Boolean(updates.renewalNoArrearsDeclared)
            : Boolean(existing.renewalNoArrearsDeclared ?? false);
        const mergedBmUnder =
          updates.bmUndertakingAccepted !== undefined
            ? Boolean(updates.bmUndertakingAccepted)
            : Boolean(existing.bmUndertakingAccepted ?? false);
        const pendErr = validateLicenceForPendingStatus({
          licenceType: mergedType,
          applicationKind: mergedKind,
          fatherSpouseName: mergedFather,
          dateOfBirth: mergedDob,
          emergencyContactMobile: mergedEmerg,
          characterCertIssuer: mergedChar,
          characterCertDate: mergedCharD,
          renewalNoArrearsDeclared: mergedRenewalDecl,
          bmUndertakingAccepted: mergedBmUnder,
        });
        if (pendErr) return sendApiError(res, 400, pendErr.code, pendErr.message);
      }

      const mergedMobile = updates.mobile !== undefined ? updates.mobile : existing.mobile;
      const mergedEmail = updates.email !== undefined ? updates.email : existing.email;
      const mergedAadhaar = updates.aadhaarToken !== undefined ? updates.aadhaarToken : existing.aadhaarToken;
      try {
        if (mergedMobile == null || String(mergedMobile).trim() === "") {
          return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
        }
        const mn = normalizeMobile10(String(mergedMobile));
        if (!mn) {
          return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
        }
        updates.mobile = mn;
        const en =
          mergedEmail == null || String(mergedEmail).trim() === "" ? null : String(mergedEmail).trim().toLowerCase();
        assertPersonalEmailFormat(en);
        updates.email = en;
        updates.aadhaarToken = normalizeAadhaarMasked(mergedAadhaar as string | null);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }

      if (await traderLicenceMobileInUse(String(updates.mobile ?? existing.mobile), id)) {
        return sendApiError(
          res,
          400,
          "LICENCE_MOBILE_DUPLICATE",
          "This mobile number is already used on another draft, in-review, or active trader licence.",
        );
      }

      const mergedLicenceNo =
        updates.licenceNo !== undefined ? (updates.licenceNo as string | null) : (existing.licenceNo ?? null);
      const mergedEntityPublic =
        updates.entityPublicCode !== undefined
          ? (updates.entityPublicCode as string | null)
          : (existing.entityPublicCode ?? null);
      if (mergedStatus === "Active") {
        const ids = await allocateTraderLicenceActivationIds({
          existingLicenceNo: mergedLicenceNo,
          existingEntityPublicCode: mergedEntityPublic,
        });
        if (!String(mergedLicenceNo ?? "").trim()) updates.licenceNo = ids.licenceNo;
        if (!String(mergedEntityPublic ?? "").trim()) updates.entityPublicCode = ids.entityPublicCode;
      }

      const prevReceipt = existing.receiptId != null && String(existing.receiptId).trim() !== "";
      const nextReceiptRaw =
        updates.receiptId !== undefined ? (updates.receiptId as string | null) : (existing.receiptId ?? null);
      const nextReceipt = nextReceiptRaw != null && String(nextReceiptRaw).trim() !== "" ? String(nextReceiptRaw).trim() : null;
      const receiptJustSet = Boolean(nextReceipt) && !prevReceipt;
      const provEmpty = !(existing.provisionalLicenceNo != null && String(existing.provisionalLicenceNo).trim() !== "");
      if (receiptJustSet && provEmpty) {
        const yidForProv = updates.yardId !== undefined ? String(updates.yardId) : existing.yardId;
        const [yardRow] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, yidForProv)).limit(1);
        updates.provisionalLicenceNo = formatProvisionalLicenceNo(String(yardRow?.code ?? yidForProv));
      }

      const mergedRoles = {
        doUser: updates.doUser !== undefined ? (updates.doUser as string | null) : existing.doUser,
        dvUser: updates.dvUser !== undefined ? (updates.dvUser as string | null) : existing.dvUser,
        daUser: updates.daUser !== undefined ? (updates.daUser as string | null) : existing.daUser,
      };
      const seg = assertRecordDoDvDaSeparation(req.user, mergedRoles);
      if (!seg.ok) return sendApiError(res, 403, "LICENCE_DO_DV_DA_SEGREGATION", seg.error);
      if (updates.govtGstExemptCategoryId !== undefined) {
        const gRes = await resolveGovtGstExemptCategoryId(updates.govtGstExemptCategoryId);
        if (!gRes.ok) return sendApiError(res, 400, gRes.code, gRes.message);
        updates.govtGstExemptCategoryId = gRes.id;
      }
      await db.update(traderLicences).set(updates as Record<string, string | number | boolean | null>).where(eq(traderLicences.id, id));

      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");

      // Phase-1 linkage: when a licence becomes Active and fee is present, auto-create (or reuse) a LicenceFee receipt.
      const shouldCreateReceipt =
        row.status === "Active" &&
        row.receiptId == null &&
        row.feeAmount != null &&
        Number(row.feeAmount) > 0;

      if (shouldCreateReceipt) {
        const [existingReceipt] = await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-02"), eq(iomsReceipts.sourceRecordId, row.id)))
          .limit(1);

        const receiptToLink = existingReceipt
          ? existingReceipt
          : await (async () => {
              const createdBy = req.user?.id ?? "system";
              const exempt = await tenantLicenceIsGstExempt(row.id);
              const created = await createIomsReceipt({
                yardId: String(row.yardId),
                revenueHead: "LicenceFee",
                payerName: row.firmName,
                payerType: "TraderLicence",
                payerRefId: row.id,
                amount: Number(row.feeAmount ?? 0),
                cgst: exempt ? 0 : undefined,
                sgst: exempt ? 0 : undefined,
                paymentMode: "Cash",
                sourceModule: "M-02",
                sourceRecordId: row.id,
                unifiedEntityId: unifiedEntityIdFromTrackA(row.id),
                createdBy,
              });
              const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
              if (createdRow) {
                await writeAuditLog(req, {
                  module: "Receipts",
                  action: "Create",
                  recordId: createdRow.id,
                  afterValue: createdRow,
                }).catch((e) => console.error("Audit log failed:", e));
              }
              return createdRow ?? null;
            })();

        if (receiptToLink?.id) {
          const provMissing = !(row.provisionalLicenceNo != null && String(row.provisionalLicenceNo).trim() !== "");
          const receiptPatch: Record<string, string | null> = { receiptId: receiptToLink.id, updatedAt: now() };
          if (provMissing) {
            const [yardRow] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, row.yardId)).limit(1);
            receiptPatch.provisionalLicenceNo = formatProvisionalLicenceNo(String(yardRow?.code ?? row.yardId));
          }
          await db.update(traderLicences).set(receiptPatch).where(eq(traderLicences.id, id));
          const [updatedLicence] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
          if (updatedLicence) {
            writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: updatedLicence }).catch((e) =>
              console.error("Audit log failed:", e)
            );
          }
          return res.json(updatedLicence ?? row);
        }
      }

      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e)
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update licence");
    }
  });

  /** Form BK: renewal fee resolution before creating a Draft (same rules as POST …/renew body defaults). */
  app.get("/api/ioms/traders/licences/:id/renew-preview", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!existing || !licenceYardAccessible(req, existing.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      }
      const issuedNo = existing.licenceNo != null && String(existing.licenceNo).trim() !== "";
      if (!issuedNo) {
        return sendApiError(res, 400, "LICENCE_RENEW_NOT_ISSUED", "Only an issued licence can be renewed");
      }
      if (existing.isBlocked) {
        return sendApiError(res, 400, "LICENCE_RENEW_BLOCKED", "Blocked licences cannot be renewed");
      }
      const sys = await getMergedSystemConfig();
      const cfgFee = parseSystemConfigNumber(sys, "licence_fee");
      const parentFee =
        existing.feeAmount != null && Number.isFinite(Number(existing.feeAmount)) ? Number(existing.feeAmount) : null;
      const defaultRenewalFee = parentFee != null ? parentFee : cfgFee;
      const resolutionSource = parentFee != null ? "parent_licence_fee" : "system_licence_fee";
      res.json({
        canRenew: true,
        parentLicenceId: existing.id,
        parentLicenceNo: existing.licenceNo ?? null,
        parentFeeAmount: parentFee,
        systemLicenceFee: cfgFee,
        defaultRenewalFee,
        resolutionSource,
        resolutionNote:
          "POST /renew accepts optional feeAmount (≥0); if omitted, the draft uses parent licence fee when set, otherwise system_config licence_fee. Payment remains counter / M-05 receipt after approval (no hosted checkout in Phase-1).",
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build renewal preview");
    }
  });

  /** Track A licence renewal: new Draft application prefilled from an issued licence (Form BK / Section 54). */
  app.post("/api/ioms/traders/licences/:id/renew", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body as Record<string, unknown>;
      const [existing] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!licenceYardAccessible(req, existing.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");

      const issuedNo = existing.licenceNo != null && String(existing.licenceNo).trim() !== "";
      if (!issuedNo) {
        return sendApiError(res, 400, "LICENCE_RENEW_NOT_ISSUED", "Only an issued licence can be renewed");
      }
      if (existing.isBlocked) {
        return sendApiError(res, 400, "LICENCE_RENEW_BLOCKED", "Blocked licences cannot be renewed");
      }

      const newId = nanoid();
      const ts = now();
      const validFrom = body.validFrom != null && String(body.validFrom).trim() !== "" ? String(body.validFrom) : null;
      const validTo = body.validTo != null && String(body.validTo).trim() !== "" ? String(body.validTo) : null;

      const sys = await getMergedSystemConfig();
      const cfgFee = parseSystemConfigNumber(sys, "licence_fee");
      const bodyFeeRaw = body.feeAmount;
      const bodyFee =
        bodyFeeRaw != null && String(bodyFeeRaw).trim() !== "" ? Number(bodyFeeRaw) : null;
      const resolvedFee =
        bodyFee != null && Number.isFinite(bodyFee) && bodyFee >= 0
          ? bodyFee
          : existing.feeAmount != null && Number.isFinite(Number(existing.feeAmount))
            ? Number(existing.feeAmount)
            : cfgFee;

      let childBmFile: string | null = null;
      const parentFn = existing.bmFormDocFile ? String(existing.bmFormDocFile).trim() : "";
      if (parentFn && isAllowedBmFormFileName(parentFn)) {
        const buf = await readTraderBmFormBuffer(existing.id, parentFn);
        if (buf?.length) {
          const extM = /\.([a-zA-Z0-9]+)$/i.exec(parentFn);
          const extRaw = extM ? `.${extM[1]!.toLowerCase()}` : ".pdf";
          const safeExt = [".pdf", ".png", ".jpg", ".jpeg"].includes(extRaw) ? (extRaw === ".jpeg" ? ".jpg" : extRaw) : ".pdf";
          const stored = `${nanoid(16)}${safeExt}`;
          await writeTraderBmFormBuffer(newId, stored, buf);
          childBmFile = stored;
        }
      }

      await db.insert(traderLicences).values({
        id: newId,
        parentLicenceId: existing.id,
        applicationKind: "Renewal",
        firmName: existing.firmName,
        yardId: existing.yardId,
        mobile: existing.mobile,
        licenceType: existing.licenceType,
        status: "Draft",
        firmType: existing.firmType,
        contactName: existing.contactName,
        email: existing.email,
        address: existing.address,
        aadhaarToken: existing.aadhaarToken,
        pan: existing.pan,
        gstin: existing.gstin,
        feeAmount: resolvedFee,
        receiptId: null,
        validFrom,
        validTo,
        isBlocked: false,
        blockReason: null,
        dvReturnRemarks: null,
        workflowRevisionCount: 0,
        govtGstExemptCategoryId: existing.govtGstExemptCategoryId,
        isNonGstEntity: Boolean(existing.isNonGstEntity ?? false),
        fatherSpouseName: existing.fatherSpouseName ?? null,
        dateOfBirth: existing.dateOfBirth ?? null,
        emergencyContactMobile: existing.emergencyContactMobile ?? null,
        characterCertIssuer: existing.characterCertIssuer ?? null,
        characterCertDate: existing.characterCertDate ?? null,
        bmFormDocUrl: existing.bmFormDocUrl ?? null,
        bmFormDocFile: childBmFile,
        parentLicenceFeeSnapshot:
          existing.feeAmount != null && Number.isFinite(Number(existing.feeAmount)) ? Number(existing.feeAmount) : null,
        renewalNoArrearsDeclared: false,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        licenceNo: null,
        createdAt: ts,
        updatedAt: ts,
      });

      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, newId)).limit(1);
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: newId, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to renew licence");
    }
  });

  // ----- Assistant traders -----
  app.get("/api/ioms/traders/assistants", async (req, res) => {
    try {
      const primaryLicenceId = req.query.primaryLicenceId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      if (primaryLicenceId) {
        const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, primaryLicenceId)).limit(1);
        if (!lic || !licenceYardAccessible(req, lic.yardId)) return res.json([]);
      }
      let list =
        primaryLicenceId != null && primaryLicenceId !== ""
          ? await db.select().from(assistantTraders).where(eq(assistantTraders.primaryLicenceId, primaryLicenceId))
          : await db.select().from(assistantTraders).orderBy(desc(assistantTraders.personName));
      if (scopedIds && scopedIds.length > 0) {
        list = list.filter((a) => scopedIds.includes(a.yardId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch assistant traders");
    }
  });

  app.post("/api/ioms/traders/assistants", async (req, res) => {
    try {
      const body = req.body;
      const ay = String(body.yardId ?? "");
      if (!yardInScope(req, ay)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const primaryLicenceId = String(body.primaryLicenceId ?? "");
      const [primary] = await db.select().from(traderLicences).where(eq(traderLicences.id, primaryLicenceId)).limit(1);
      if (!primary) {
        return sendApiError(res, 400, "ASSISTANT_PRIMARY_NOT_FOUND", "Primary trader licence not found");
      }
      if (!yardInScope(req, primary.yardId)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to the primary licence yard");
      }
      if (primary.status !== "Active") {
        return sendApiError(
          res,
          400,
          "ASSISTANT_PRIMARY_NOT_ACTIVE",
          "Assistant can only be linked to an Active primary trader licence.",
        );
      }
      if (ay !== primary.yardId) {
        return sendApiError(
          res,
          400,
          "ASSISTANT_YARD_MISMATCH",
          "Assistant yard must match the primary trader licence yard.",
        );
      }
      const id = nanoid();
      await db.insert(assistantTraders).values({
        id,
        primaryLicenceId,
        personName: String(body.personName ?? ""),
        yardId: String(body.yardId ?? ""),
        status: String(body.status ?? "Active"),
        characterCertIssuer: body.characterCertIssuer ? String(body.characterCertIssuer) : null,
        certDate: body.certDate ? String(body.certDate) : null,
        manualLicenceNo: body.manualLicenceNo ? String(body.manualLicenceNo) : null,
      });
      const [row] = await db.select().from(assistantTraders).where(eq(assistantTraders.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create assistant trader");
    }
  });

  // ----- Assets -----
  app.get("/api/ioms/assets", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(assets.yardId, scopedIds));
      if (yardId) conditions.push(eq(assets.yardId, yardId));
      const base = db.select().from(assets).orderBy(assets.assetId);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch assets");
    }
  });

  // Vacated / vacant shops: no active allotment; show previous allottee, officer, rent
  app.get("/api/ioms/assets/vacant", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(assets.yardId, scopedIds));
      if (yardId) conditions.push(eq(assets.yardId, yardId));
      const base = db.select().from(assets).orderBy(assets.assetId);
      const allAssets = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      const allAllotments = await db.select().from(assetAllotments).orderBy(desc(assetAllotments.toDate));
      const activeEntityByAsset = await db
        .select({ assetId: entityAllotments.assetId })
        .from(entityAllotments)
        .where(eq(entityAllotments.status, "Active"));
      const activeEntityOccupied = new Set(activeEntityByAsset.map((r) => r.assetId));

      const allInvoices = await db.select().from(rentInvoices).orderBy(desc(rentInvoices.periodMonth));
      const latestRentByAllotment: Record<string, number> = {};
      for (const inv of allInvoices) {
        if (inv.allotmentId && latestRentByAllotment[inv.allotmentId] == null)
          latestRentByAllotment[inv.allotmentId] = inv.rentAmount ?? inv.totalAmount ?? 0;
      }
      const allotmentsByAsset = new Map<string, typeof allAllotments>();
      for (const a of allAllotments) {
        const list = allotmentsByAsset.get(a.assetId) ?? [];
        list.push(a);
        allotmentsByAsset.set(a.assetId, list);
      }
      const todayYmd = todayYmdUtc();
      const vacant: Array<{
        asset: (typeof allAssets)[0];
        lastAllotment: { allotteeName: string; fromDate: string; toDate: string; id: string; status: string } | null;
        /** Actual vacated date (today or earlier); not future agreement end. */
        vacatedOn: string | null;
        lastRentAmount: number | null;
      }> = [];
      for (const asset of allAssets) {
        const list = allotmentsByAsset.get(asset.id) ?? allotmentsByAsset.get(asset.assetId) ?? [];
        const latest = list[0];
        if (latest && latest.status === "Active") continue;
        if (activeEntityOccupied.has(asset.id)) continue;
        const lastAllotment = latest
          ? {
              allotteeName: latest.allotteeName,
              fromDate: latest.fromDate,
              toDate: latest.toDate,
              id: latest.id,
              status: String(latest.status ?? ""),
            }
          : null;
        const vacatedOn = resolveVacatedDisplayYmd(list, todayYmd);
        const lastRentAmount = lastAllotment ? (latestRentByAllotment[lastAllotment.id] ?? null) : null;
        vacant.push({ asset, lastAllotment, vacatedOn, lastRentAmount });
      }
      res.json(vacant);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch vacant assets");
    }
  });

  // ----- Asset allotments (use /asset-allotments to avoid conflict with /assets/:id) -----
  app.get("/api/ioms/asset-allotments", async (req, res) => {
    try {
      const assetId = req.query.assetId as string | undefined;
      const licenceId = req.query.traderLicenceId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      let list = await db.select().from(assetAllotments).orderBy(desc(assetAllotments.fromDate));
      if (assetId) list = list.filter((r) => r.assetId === assetId);
      if (licenceId) list = list.filter((r) => r.traderLicenceId === licenceId);
      if (scopedIds && scopedIds.length > 0) {
        const inScope = await db.select({ id: assets.id }).from(assets).where(inArray(assets.yardId, scopedIds));
        const ok = new Set(inScope.map((a) => a.id));
        list = list.filter((r) => ok.has(r.assetId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch allotments");
    }
  });

  // US-M02-003 gaps fix: scanned agreement PDF upload/download for trader (Track A) premises allocations.
  const assetAgreementUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });
  function multerAssetAgreementSingle(req: Request, res: Response, next: NextFunction): void {
    assetAgreementUpload.single("file")(req, res, (err: unknown) => {
      const e = err as { code?: string; message?: string } | undefined;
      if (e?.code === "LIMIT_FILE_SIZE") {
        return sendApiError(res, 400, "E-AST-011", "Agreement PDF must be 20 MB or smaller.");
      }
      if (err) {
        return sendApiError(res, 400, "AGREEMENT_UPLOAD_FAILED", e?.message || "Upload failed.");
      }
      next();
    });
  }

  app.post("/api/ioms/asset-allotments/:id/agreement", multerAssetAgreementSingle, async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, row.assetId)).limit(1);
      if (!assetRow || !yardInScope(req, assetRow.yardId)) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      const appr = String(row.approvalStatus ?? "Draft");
      if (!["Draft", "Rejected"].includes(appr)) {
        return sendApiError(res, 400, "AGREEMENT_UPLOAD_STATE", "Agreement uploads are allowed only in Draft or Rejected status.");
      }
      const file = (req as unknown as { file?: { buffer: Buffer; mimetype: string } }).file;
      if (!file) return sendApiError(res, 400, "AGREEMENT_FILE_REQUIRED", "Upload file required (field name: file)");
      const ext = extFromAssetAllotmentAgreementMime(file.mimetype);
      if (!ext) return sendApiError(res, 400, "AGREEMENT_FILE_TYPE", "Only PDF uploads are accepted for scanned agreements.");

      const storedName = `agreement-${Date.now()}-${nanoid(10)}${ext}`;
      if (!isAllowedAssetAllotmentAgreementFileName(storedName)) return sendApiError(res, 400, "AGREEMENT_FILE_NAME", "Internal file naming error.");
      await writeAssetAllotmentAgreementBuffer(id, storedName, file.buffer);
      await db.update(assetAllotments).set({ agreementDocFile: storedName, agreementDocUploadedAt: now() }).where(eq(assetAllotments.id, id));
      const [fresh] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, afterValue: fresh }).catch((e) => console.error("Audit log failed:", e));
      return res.json(fresh);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to upload agreement");
    }
  });

  app.get("/api/ioms/asset-allotments/:id/agreement", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id)).limit(1);
      if (!row?.agreementDocFile) return sendApiError(res, 404, "AGREEMENT_NOT_FOUND", "No agreement PDF recorded.");
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, row.assetId)).limit(1);
      if (!assetRow || !yardInScope(req, assetRow.yardId)) return sendApiError(res, 404, "AGREEMENT_NOT_FOUND", "No agreement PDF.");
      const buf = await readAssetAllotmentAgreementBuffer(id, row.agreementDocFile);
      if (!buf) return sendApiError(res, 404, "AGREEMENT_BLOB_MISSING", "Stored PDF not found.");
      const fn = encodeURIComponent(`${row.premisesRefNo || row.id}-agreement.pdf`);
      res.setHeader("Content-Type", contentTypeForAssetAllotmentAgreement(row.agreementDocFile));
      res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
      return res.send(buf);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read agreement PDF");
    }
  });

  app.post("/api/ioms/asset-allotments", async (req, res) => {
    try {
      const body = req.body;
      const aid = String(body.assetId ?? "");
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, aid)).limit(1);
      if (!assetRow) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      if (!yardInScope(req, assetRow.yardId))
        return sendApiError(res, 403, "ASSET_YARD_ACCESS_DENIED", "You do not have access to this asset's yard");

      const traderLicenceId = String(body.traderLicenceId ?? "").trim();
      if (!traderLicenceId) return sendApiError(res, 400, "TRADER_LICENCE_REQUIRED", "traderLicenceId is required");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      if (lic.status !== "Active" || lic.isBlocked) {
        return sendApiError(
          res,
          400,
          "LICENCE_NOT_ELIGIBLE",
          lic.isBlocked
            ? "Trader licence is blocked and cannot receive a premises allocation."
            : `Trader licence must be Active for allocation (current status: ${lic.status}).`,
        );
      }

      // Validate agreement dates + finance fields (US-M02-003)
      const fromDate = String(body.fromDate ?? "").trim();
      let toDate = String(body.toDate ?? "").trim();
      const ferr = ymdFieldError("Agreement from", fromDate, true);
      if (ferr) return sendApiError(res, 400, "AGREEMENT_FROM", ferr);
      const terr = ymdFieldError("Agreement to", toDate, true);
      if (terr) return sendApiError(res, 400, "AGREEMENT_TO", terr);
      if (fromDate > toDate) return sendApiError(res, 400, "AGREEMENT_RANGE", "Agreement To must be on or after Agreement From.");

      const monthlyRent = Number((body as Record<string, unknown>).monthlyRent ?? (body as Record<string, unknown>).monthly_rent);
      if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
        return sendApiError(res, 400, "MONTHLY_RENT", "Monthly rent must be greater than 0.");
      }
      const rr = normalizeRentRevisionMode((body as Record<string, unknown>).rentRevisionMode ?? (body as Record<string, unknown>).rent_revision_mode);
      if (!rr) {
        return sendApiError(res, 400, "RENT_REVISION_MODE", "Rent Revision Mode is required (StandardConsecutiveRenewal or PwdCertificate).");
      }
      let agreementType = inferAgreementTypeFromDates(fromDate, toDate);
      const overridden = normalizeAgreementType((body as Record<string, unknown>).agreementType ?? (body as Record<string, unknown>).agreement_type);
      if (overridden) agreementType = overridden;

      const approvalStatus = String((body as Record<string, unknown>).approvalStatus ?? "Draft").trim() || "Draft";

      // BR-PRE-023: one active allocation per premises (asset) across all allocation tables.
      const nextStatus = String(body.status ?? "Pending");
      if (nextStatus === "Vacated") {
        const vErr = assertVacatedToDateNotFuture(toDate);
        if (vErr) return sendApiError(res, 400, "VACATED_DATE_FUTURE", vErr);
        toDate = capVacatedOnYmd(toDate);
      }
      if (nextStatus === "Active") {
        const check = await assertPremisesNotAlreadyAllocatedActive({ assetId: aid });
        if (!check.ok) {
          return sendApiError(
            res,
            400,
            "PREMISES_ALREADY_ALLOCATED",
            "Cannot allocate: another Active allocation already exists for this premises.",
            { assetId: aid, entityAllotments: check.entityConflicts, traderAllotments: check.traderConflicts },
          );
        }
      }

      const id = nanoid();
      await db.insert(assetAllotments).values({
        id,
        assetId: String(body.assetId ?? ""),
        traderLicenceId,
        allotteeName: String(body.allotteeName ?? "").trim(),
        fromDate,
        toDate,
        status: nextStatus,
        securityDeposit: body.securityDeposit != null ? Number(body.securityDeposit) : null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        approvalStatus: approvalStatus as any,
        premisesRefNo: null,
        monthlyRent: roundedMoney2(monthlyRent),
        gstApplicable: !Boolean((lic as unknown as { isNonGstEntity?: boolean | null }).isNonGstEntity),
        gstLocked: false,
        agreementType,
        agreementDocFile: null,
        agreementDocUploadedAt: null,
        rentRevisionMode: rr,
        consecutiveRenewalCount: Number.isFinite(Number((body as Record<string, unknown>).consecutiveRenewalCount))
          ? Number((body as Record<string, unknown>).consecutiveRenewalCount)
          : 0,
        verifiedAt: null,
        approvedAt: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
        rejectionRemarks: null,
        agreementGapDaOverride: false,
        daGstOverride: false,
      });
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create allotment");
    }
  });

  app.put("/api/ioms/asset-allotments/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existingAllot] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id)).limit(1);
      if (!existingAllot) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, existingAllot.assetId)).limit(1);
      if (!assetRow || !yardInScope(req, assetRow.yardId)) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      const body = req.body;
      const currentApproval = String(existingAllot.approvalStatus ?? "Draft");
      const newApproval = body.approvalStatus !== undefined ? String(body.approvalStatus).trim() : null;

      // Workflow transitions (DO→DV→DA)
      if (newApproval && newApproval !== currentApproval) {
        const transition = canTransitionEntityAllotmentApproval(req.user, currentApproval, newApproval);
        if (!transition.allowed) {
          return sendApiError(res, 403, "ALLOTMENT_STATUS_DENIED", `Cannot transition from ${currentApproval} to ${newApproval}.`);
        }

        const nextDv =
          transition.setDvUser && newApproval === "Verified" ? req.user?.id ?? null : existingAllot.dvUser ?? null;
        const nextDa =
          transition.setDaUser && (newApproval === "Approved" || newApproval === "Rejected")
            ? req.user?.id ?? null
            : existingAllot.daUser ?? null;

        const seg = assertSegregationDoDvDa(
          req.user,
          { doUser: existingAllot.doUser ?? null, dvUser: nextDv, daUser: nextDa },
          transition,
        );
        if (!seg.ok) return sendApiError(res, 403, "ALLOTMENT_DO_DV_DA_SEGREGATION", seg.error);

        if (currentApproval === "Draft" && newApproval === "Verified") {
          if (!existingAllot.agreementDocFile)
            return sendApiError(res, 400, "E-AST-011", "Notarised agreement PDF must be uploaded before DV verification.");
        }

        if (currentApproval === "Verified" && newApproval === "Draft") {
          const remarks = body.dvReturnRemarks ? String(body.dvReturnRemarks).trim() : "";
          if (remarks.length < 5) {
            return sendApiError(res, 400, "DV_RETURN_REMARKS", "Return remarks (minimum 5 characters) required when verifier returns allocation to Draft.");
          }
        }

        if (newApproval === "Approved") {
          if (!existingAllot.agreementDocFile)
            return sendApiError(res, 400, "E-AST-011", "Notarised agreement PDF is mandatory before DA approval.");

          let premRef = existingAllot.premisesRefNo ?? null;
          if (!premRef) {
            const [yRow] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, assetRow.yardId)).limit(1);
            const yc = String(yRow?.code ?? "YRD").trim().replace(/\s+/g, "") || "YRD";
            const premisesKey = `${assetRow.assetId}|${yc}`;
            const q = `
              INSERT INTO gapmc.premises_ref_counters (premises_key, last_nn)
              VALUES ($1, 1)
              ON CONFLICT (premises_key) DO UPDATE
              SET last_nn = gapmc.premises_ref_counters.last_nn + 1
              RETURNING last_nn
            `;
            const resQ = await pool.query<{ last_nn: number }>(q, [premisesKey]);
            const nn = Number(resQ.rows[0]?.last_nn ?? 1);
            premRef = `${assetRow.assetId}-${yc}-${String(nn).padStart(2, "0")}`;
          }

          // BR-PRE-023: prevent setting to Active when another active allocation exists.
          const check = await assertPremisesNotAlreadyAllocatedActive({ assetId: existingAllot.assetId, excludeAssetAllotmentId: id });
          if (!check.ok) {
            return sendApiError(
              res,
              400,
              "PREMISES_ALREADY_ALLOCATED",
              "Cannot set allocation to Active: another Active allocation already exists for this premises.",
              { assetId: existingAllot.assetId, entityAllotments: check.entityConflicts, traderAllotments: check.traderConflicts },
            );
          }

          await db
            .update(assetAllotments)
            .set({
              approvalStatus: "Approved",
              dvUser: existingAllot.dvUser,
              verifiedAt: existingAllot.verifiedAt,
              daUser: transition.setDaUser ? req.user?.id ?? null : existingAllot.daUser,
              approvedAt: now(),
              premisesRefNo: premRef,
              gstLocked: true,
              status: "Active",
            })
            .where(eq(assetAllotments.id, id));

          const [after] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
          writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existingAllot, afterValue: after }).catch((e) =>
            console.error(e),
          );
          return res.json(after);
        }

        const patchWorkflow: Record<string, unknown> = { approvalStatus: newApproval };
        if (newApproval === "Verified") {
          patchWorkflow.dvUser = transition.setDvUser ? req.user?.id ?? null : existingAllot.dvUser;
          patchWorkflow.verifiedAt = now();
        }
        if (newApproval === "Rejected") {
          patchWorkflow.daUser = transition.setDaUser ? req.user?.id ?? null : existingAllot.daUser;
          patchWorkflow.rejectionRemarks = body.rejectionRemarks ? String(body.rejectionRemarks).trim() : null;
        }
        if (newApproval === "Draft" && currentApproval === "Rejected") {
          patchWorkflow.workflowRevisionCount = Number(existingAllot.workflowRevisionCount ?? 0) + 1;
        }
        if (currentApproval === "Verified" && newApproval === "Draft") {
          patchWorkflow.dvReturnRemarks = body.dvReturnRemarks ? String(body.dvReturnRemarks).trim() : null;
          patchWorkflow.workflowRevisionCount = Number(existingAllot.workflowRevisionCount ?? 0) + 1;
          patchWorkflow.dvUser = null;
          patchWorkflow.verifiedAt = null;
        }

        await db.update(assetAllotments).set(patchWorkflow).where(eq(assetAllotments.id, id));
        const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
        if (!row) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
        writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existingAllot, afterValue: row }).catch((e) =>
          console.error("Audit log failed:", e),
        );
        return res.json(row);
      }

      const financeEditable = ["Draft", "Rejected"].includes(String(existingAllot.approvalStatus ?? ""));
      const updates: Record<string, unknown> = {};
      ["allotteeName", "fromDate", "toDate", "status", "securityDeposit"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "securityDeposit") updates.securityDeposit = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (financeEditable) {
        if ((body as Record<string, unknown>).monthlyRent !== undefined) {
          updates.monthlyRent = roundedMoney2(Number((body as Record<string, unknown>).monthlyRent));
        }
        if ((body as Record<string, unknown>).rentRevisionMode !== undefined) {
          const rr = normalizeRentRevisionMode((body as Record<string, unknown>).rentRevisionMode);
          if (!rr) return sendApiError(res, 400, "RENT_REVISION_MODE", "Rent Revision Mode is required (StandardConsecutiveRenewal or PwdCertificate).");
          updates.rentRevisionMode = rr;
        }
      }

      // BR-PRE-023: prevent switching to Active when another active allocation exists for this premises.
      const resultingStatus = (updates.status !== undefined ? String(updates.status) : existingAllot.status) ?? "Active";
      const effectiveStatus =
        (updates.status !== undefined ? String(updates.status) : existingAllot.status) ?? "Active";
      if (effectiveStatus === "Vacated") {
        let resultingTo = (updates.toDate !== undefined ? String(updates.toDate) : existingAllot.toDate) ?? "";
        if (updates.status === "Vacated" && updates.toDate === undefined && !resultingTo) {
          resultingTo = todayYmdUtc();
          updates.toDate = resultingTo;
        }
        const vOnErr = ymdFieldError("Vacated on", resultingTo, true);
        if (vOnErr) return sendApiError(res, 400, "VACATED_ON", vOnErr);
        const vFut = assertVacatedToDateNotFuture(resultingTo);
        if (vFut) return sendApiError(res, 400, "VACATED_DATE_FUTURE", vFut);
        updates.toDate = capVacatedOnYmd(resultingTo);
      }
      if (resultingStatus === "Active") {
        const check = await assertPremisesNotAlreadyAllocatedActive({ assetId: existingAllot.assetId, excludeAssetAllotmentId: id });
        if (!check.ok) {
          return sendApiError(
            res,
            400,
            "PREMISES_ALREADY_ALLOCATED",
            "Cannot set allocation to Active: another Active allocation already exists for this premises.",
            { assetId: existingAllot.assetId, entityAllotments: check.entityConflicts, traderAllotments: check.traderConflicts },
          );
        }
      }

      await db.update(assetAllotments).set(updates as Record<string, string | number | null>).where(eq(assetAllotments.id, id));
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
      if (!row) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existingAllot, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update allotment");
    }
  });

  app.get("/api/ioms/assets/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(assets).where(eq(assets.id, req.params.id)).limit(1);
      if (!row) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      if (!yardInScope(req, row.yardId)) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch asset");
    }
  });

  app.post("/api/ioms/assets", async (req, res) => {
    try {
      const body = req.body;
      const yid = String(body.yardId ?? "");
      if (!yardInScope(req, yid)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const yv = await assertPremisesYardLocation(yid);
      if (!yv.ok) return sendApiError(res, 400, yv.code, yv.message);
      const id = nanoid();
      await db.insert(assets).values({
        id,
        assetId: String(body.assetId ?? ""),
        yardId: yid,
        assetType: String(body.assetType ?? "Shop"),
        complexName: body.complexName ? String(body.complexName) : null,
        area: body.area ? String(body.area) : null,
        plinthAreaSqft: body.plinthAreaSqft != null ? Number(body.plinthAreaSqft) : null,
        value: body.value != null ? Number(body.value) : null,
        fileNumber: body.fileNumber ? String(body.fileNumber) : null,
        orderNumber: body.orderNumber ? String(body.orderNumber) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
        premisesStatus: (() => {
          const raw = (body as Record<string, unknown>).premisesStatus ?? (body as Record<string, unknown>).premises_status;
          if (raw === undefined || raw === null) return "Active";
          const n = normalizePremisesStatus(raw);
          return n ?? "Active";
        })(),
      });
      const [row] = await db.select().from(assets).where(eq(assets.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create asset");
    }
  });

  app.put("/api/ioms/assets/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      const body = req.body;
      const newYard = body.yardId !== undefined ? String(body.yardId) : existing.yardId;
      if (body.yardId !== undefined && !yardInScope(req, newYard)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const yvPut = await assertPremisesYardLocation(newYard);
      if (!yvPut.ok) return sendApiError(res, 400, yvPut.code, yvPut.message);
      const allowed = [
        "assetId",
        "yardId",
        "assetType",
        "complexName",
        "area",
        "plinthAreaSqft",
        "value",
        "fileNumber",
        "orderNumber",
        "isActive",
        "premisesStatus",
        "premises_status",
      ];
      const updates: Record<string, unknown> = {};
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "plinthAreaSqft" || k === "value") updates[k] = body[k] == null ? null : Number(body[k]);
        else if (k === "isActive") updates.isActive = Boolean(body.isActive);
        else if (k === "premisesStatus" || k === "premises_status") {
          const n = normalizePremisesStatus(body[k]);
          if (!n) continue;
          updates.premisesStatus = n;
        } else updates[k] = body[k] == null ? null : String(body[k]);
      }
      await db.update(assets).set(updates as Record<string, string | number | boolean | null>).where(eq(assets.id, id));
      const [row] = await db.select().from(assets).where(eq(assets.id, id));
      if (!row) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update asset");
    }
  });

  // ----- Trader blocking log -----
  app.get("/api/ioms/traders/blocking-log", async (req, res) => {
    try {
      const traderLicenceId = req.query.traderLicenceId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      if (traderLicenceId) {
        const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
        if (!lic || !licenceYardAccessible(req, lic.yardId)) return res.json([]);
      }
      let list = traderLicenceId
        ? await db.select().from(traderBlockingLog).where(eq(traderBlockingLog.traderLicenceId, traderLicenceId)).orderBy(desc(traderBlockingLog.actionedAt))
        : await db.select().from(traderBlockingLog).orderBy(desc(traderBlockingLog.actionedAt));
      if (!traderLicenceId && scopedIds && scopedIds.length > 0) {
        const licences = await db.select().from(traderLicences).where(inArray(traderLicences.yardId, scopedIds));
        const ok = new Set(licences.map((l) => l.id));
        list = list.filter((e) => ok.has(e.traderLicenceId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch blocking log");
    }
  });

  app.post("/api/ioms/traders/blocking-log", async (req, res) => {
    try {
      const body = req.body;
      const lid = String(body.traderLicenceId ?? "");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, lid)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!licenceYardAccessible(req, lic.yardId))
        return sendApiError(res, 403, "LICENCE_YARD_ACCESS_DENIED", "You do not have access to this licence's yard");
      const id = nanoid();
      await db.insert(traderBlockingLog).values({
        id,
        traderLicenceId: String(body.traderLicenceId ?? ""),
        action: String(body.action ?? "Blocked"),
        reason: String(body.reason ?? ""),
        actionedBy: String(body.actionedBy ?? ""),
        actionedAt: body.actionedAt ? String(body.actionedAt) : now(),
      });
      const [row] = await db.select().from(traderBlockingLog).where(eq(traderBlockingLog.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create blocking log entry");
    }
  });

  // ----- MSP settings -----
  app.get("/api/ioms/msp-settings", async (_req, res) => {
    try {
      const list = await db.select().from(mspSettings).orderBy(mspSettings.commodity);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch MSP settings");
    }
  });

  app.post("/api/ioms/msp-settings", async (req, res) => {
    try {
      const body = req.body;
      const sys = await getMergedSystemConfig();
      const defaultMsp = parseSystemConfigNumber(sys, "msp_rate");
      const id = nanoid();
      await db.insert(mspSettings).values({
        id,
        commodity: String(body.commodity ?? ""),
        mspRate:
          body.mspRate != null && String(body.mspRate).trim() !== "" ? Number(body.mspRate) : defaultMsp,
        validFrom: String(body.validFrom ?? ""),
        validTo: String(body.validTo ?? ""),
        updatedBy: body.updatedBy ? String(body.updatedBy) : null,
      });
      const [row] = await db.select().from(mspSettings).where(eq(mspSettings.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create MSP setting");
    }
  });

  app.put("/api/ioms/msp-settings/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existingMsp] = await db.select().from(mspSettings).where(eq(mspSettings.id, id)).limit(1);
      if (!existingMsp) return sendApiError(res, 404, "MSP_SETTING_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["commodity", "mspRate", "validFrom", "validTo", "updatedBy"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "mspRate") updates.mspRate = Number(body.mspRate);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(mspSettings).set(updates as Record<string, string | number | null>).where(eq(mspSettings.id, id));
      const [row] = await db.select().from(mspSettings).where(eq(mspSettings.id, id));
      if (!row) return sendApiError(res, 404, "MSP_SETTING_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existingMsp, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update MSP setting");
    }
  });
}
