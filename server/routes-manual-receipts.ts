/**
 * M-05 manual receipt types + manual receipt creation API.
 */
import type { Express } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  assets,
  assistantTraders,
  entities,
  manualReceiptTypes,
  iomsReceipts,
  traderLicences,
  tallyLedgers,
} from "@shared/db-schema";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import {
  partyTypesForPayeeRule,
  type ManualReceiptPartyType,
  type ManualReceiptPayeeRule,
} from "@shared/manual-receipt-types";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA, unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";
import {
  counterPaymentCreateParams,
  counterPaymentPaidUpdate,
  DuesCounterPaymentError,
  parseCounterDuesPaymentBody,
} from "./dues-counter-payment";
import { createIomsReceipt, ReceiptPaymentModeError } from "./routes-receipts-ioms";

const NARRATION_MAX = 500;

function yardInScope(req: Express.Request, yardId: string): boolean {
  const scoped = req.scopedLocationIds;
  if (!scoped || scoped.length === 0) return true;
  return scoped.includes(yardId);
}

async function resolveManualPayer(args: {
  partyType: ManualReceiptPartyType;
  traderLicenceId?: string;
  entityId?: string;
  assistantId?: string;
  unifiedEntityId?: string;
  newPartyName?: string;
  newPartyAddress?: string;
  newPartyContact?: string;
}): Promise<{
  payerName: string;
  payerType: string;
  payerRefId: string | null;
  unifiedEntityId: string | null;
  payerAddress: string | null;
  payerContact: string | null;
}> {
  const { partyType } = args;

  if (partyType === "NewParty") {
    const name = String(args.newPartyName ?? "").trim();
    if (!name) throw new DuesCounterPaymentError("MANUAL_PAYER_NAME", "Party name is required for New Party");
    const uid = args.unifiedEntityId?.trim() ? args.unifiedEntityId.trim() : null;
    if (uid && !parseUnifiedEntityId(uid)) {
      throw new DuesCounterPaymentError("MANUAL_UNIFIED_INVALID", "unifiedEntityId must be TA:|TB:|AH:");
    }
    return {
      payerName: name,
      payerType: "ManualParty",
      payerRefId: null,
      unifiedEntityId: uid,
      payerAddress: args.newPartyAddress?.trim() || null,
      payerContact: args.newPartyContact?.trim() || null,
    };
  }

  if (args.unifiedEntityId?.trim()) {
    const uid = args.unifiedEntityId.trim();
    const parsed = parseUnifiedEntityId(uid);
    if (!parsed) throw new DuesCounterPaymentError("MANUAL_UNIFIED_INVALID", "unifiedEntityId must be TA:|TB:|AH:");
    if (partyType === "Trader" && parsed.kind !== "TA") {
      throw new DuesCounterPaymentError("MANUAL_PARTY_MISMATCH", "Trader party requires TA: unified entity");
    }
    if (partyType === "Entity" && parsed.kind !== "TB" && parsed.kind !== "AH") {
      throw new DuesCounterPaymentError("MANUAL_PARTY_MISMATCH", "Entity party requires TB: or AH: unified entity");
    }
    if (parsed.kind === "TA") {
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, parsed.refId)).limit(1);
      if (!lic) throw new DuesCounterPaymentError("MANUAL_LICENCE_NOT_FOUND", "Trader licence not found");
      return {
        payerName: lic.firmName ?? lic.licenceNo ?? parsed.refId,
        payerType: "TraderLicence",
        payerRefId: lic.id,
        unifiedEntityId: uid,
        payerAddress: lic.address ?? null,
        payerContact: lic.mobile ?? null,
      };
    }
    if (parsed.kind === "TB") {
      const [ent] = await db.select().from(entities).where(eq(entities.id, parsed.refId)).limit(1);
      if (!ent) throw new DuesCounterPaymentError("MANUAL_ENTITY_NOT_FOUND", "Entity not found");
      return {
        payerName: ent.name ?? ent.entityCode ?? parsed.refId,
        payerType: "Entity",
        payerRefId: ent.id,
        unifiedEntityId: uid,
        payerAddress: ent.address ?? null,
        payerContact: ent.mobile ?? null,
      };
    }
  }

  if (partyType === "Trader" && args.traderLicenceId?.trim()) {
    const id = args.traderLicenceId.trim();
    const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
    if (!lic) throw new DuesCounterPaymentError("MANUAL_LICENCE_NOT_FOUND", "Trader licence not found");
    return {
      payerName: lic.firmName ?? lic.licenceNo ?? id,
      payerType: "TraderLicence",
      payerRefId: id,
      unifiedEntityId: unifiedEntityIdFromTrackA(id),
      payerAddress: lic.address ?? null,
      payerContact: lic.mobile ?? null,
    };
  }

  if (partyType === "Entity" && args.entityId?.trim()) {
    const id = args.entityId.trim();
    const [ent] = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
    if (!ent) throw new DuesCounterPaymentError("MANUAL_ENTITY_NOT_FOUND", "Entity not found");
    return {
      payerName: ent.name ?? ent.entityCode ?? id,
      payerType: "Entity",
      payerRefId: id,
      unifiedEntityId: unifiedEntityIdFromTrackB(id),
      payerAddress: ent.address ?? null,
      payerContact: ent.mobile ?? null,
    };
  }

  if (partyType === "Assistant" && args.assistantId?.trim()) {
    const id = args.assistantId.trim();
    const [asst] = await db.select().from(assistantTraders).where(eq(assistantTraders.id, id)).limit(1);
    if (!asst) throw new DuesCounterPaymentError("MANUAL_ASSISTANT_NOT_FOUND", "Assistant trader not found");
    const [lic] = await db
      .select()
      .from(traderLicences)
      .where(eq(traderLicences.id, asst.primaryLicenceId))
      .limit(1);
    return {
      payerName: asst.personName ?? id,
      payerType: "AssistantTrader",
      payerRefId: id,
      unifiedEntityId: lic ? unifiedEntityIdFromTrackA(lic.id) : null,
      payerAddress: null,
      payerContact: null,
    };
  }

  throw new DuesCounterPaymentError("MANUAL_PAYER_REQUIRED", "Select a payee or enter New Party details");
}

export function registerManualReceiptRoutes(app: Express) {
  app.get("/api/ioms/manual-receipt-types", async (req, res) => {
    try {
      const dropdownOnly = String(req.query.dropdown ?? "") === "1" || req.query.dropdown === "true";
      const rows = await db
        .select({
          id: manualReceiptTypes.id,
          sortOrder: manualReceiptTypes.sortOrder,
          ledgerName: manualReceiptTypes.ledgerName,
          revenueHead: manualReceiptTypes.revenueHead,
          payeeRule: manualReceiptTypes.payeeRule,
          requiresPremises: manualReceiptTypes.requiresPremises,
          showInDropdown: manualReceiptTypes.showInDropdown,
          primaryGroup: manualReceiptTypes.primaryGroup,
          statementClass: manualReceiptTypes.statementClass,
          tallyLedgerId: manualReceiptTypes.tallyLedgerId,
          linkingNotes: manualReceiptTypes.linkingNotes,
          isActive: manualReceiptTypes.isActive,
          tallyLedgerName: tallyLedgers.ledgerName,
        })
        .from(manualReceiptTypes)
        .leftJoin(tallyLedgers, eq(manualReceiptTypes.tallyLedgerId, tallyLedgers.id))
        .where(
          dropdownOnly
            ? and(eq(manualReceiptTypes.isActive, true), eq(manualReceiptTypes.showInDropdown, true))
            : eq(manualReceiptTypes.isActive, true),
        )
        .orderBy(asc(manualReceiptTypes.sortOrder), asc(manualReceiptTypes.ledgerName));

      res.json(
        rows.map((r) => ({
          ...r,
          allowedPartyTypes: partyTypesForPayeeRule(r.payeeRule as ManualReceiptPayeeRule),
        })),
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list manual receipt types");
    }
  });

  app.post("/api/ioms/receipts/manual", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const manualReceiptTypeId = String(body.manualReceiptTypeId ?? "").trim();
      const yardId = String(body.yardId ?? "").trim();
      const partyType = String(body.partyType ?? "").trim() as ManualReceiptPartyType;
      const amount = Number(body.amount ?? NaN);
      const premisesAssetId = body.premisesAssetId != null ? String(body.premisesAssetId).trim() : "";
      const applicationRef = body.applicationRef != null ? String(body.applicationRef).trim() : "";
      const narrationRaw = body.narration != null ? String(body.narration) : "";
      const narration = narrationRaw.trim().slice(0, NARRATION_MAX) || null;

      if (!manualReceiptTypeId || !yardId || !partyType) {
        return sendApiError(res, 400, "MANUAL_RECEIPT_FIELDS", "manualReceiptTypeId, yardId, and partyType are required");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return sendApiError(res, 400, "MANUAL_RECEIPT_AMOUNT", "amount must be a positive number");
      }
      if (narrationRaw.length > NARRATION_MAX) {
        return sendApiError(res, 400, "MANUAL_NARRATION_LONG", `Narration must be at most ${NARRATION_MAX} characters`);
      }
      if (!yardInScope(req, yardId)) {
        return sendApiError(res, 403, "MANUAL_YARD_DENIED", "You do not have access to this yard");
      }

      const [mrt] = await db
        .select()
        .from(manualReceiptTypes)
        .where(and(eq(manualReceiptTypes.id, manualReceiptTypeId), eq(manualReceiptTypes.isActive, true)))
        .limit(1);
      if (!mrt) return sendApiError(res, 404, "MANUAL_TYPE_NOT_FOUND", "Receipt type not found");

      const allowed = partyTypesForPayeeRule(mrt.payeeRule as ManualReceiptPayeeRule);
      if (!allowed.includes(partyType)) {
        return sendApiError(res, 400, "MANUAL_PARTY_NOT_ALLOWED", `Party type ${partyType} is not allowed for this receipt type`, {
          allowed,
        });
      }
      if (mrt.requiresPremises && !premisesAssetId) {
        return sendApiError(res, 400, "MANUAL_PREMISES_REQUIRED", "Premises ID is required for this receipt type");
      }
      if (premisesAssetId) {
        const [asset] = await db.select().from(assets).where(eq(assets.id, premisesAssetId)).limit(1);
        if (!asset) return sendApiError(res, 404, "MANUAL_ASSET_NOT_FOUND", "Premises asset not found");
        if (asset.yardId !== yardId) {
          return sendApiError(res, 400, "MANUAL_ASSET_YARD", "Premises asset must belong to the selected yard");
        }
      }

      let counterPay;
      try {
        counterPay = parseCounterDuesPaymentBody(body);
      } catch (e) {
        if (e instanceof DuesCounterPaymentError) {
          return sendApiError(res, 400, e.code, e.message);
        }
        throw e;
      }

      let payer;
      try {
        payer = await resolveManualPayer({
          partyType,
          traderLicenceId: body.traderLicenceId as string | undefined,
          entityId: body.entityId as string | undefined,
          assistantId: body.assistantId as string | undefined,
          unifiedEntityId: body.unifiedEntityId as string | undefined,
          newPartyName: body.newPartyName as string | undefined,
          newPartyAddress: body.newPartyAddress as string | undefined,
          newPartyContact: body.newPartyContact as string | undefined,
        });
      } catch (e) {
        if (e instanceof DuesCounterPaymentError) {
          return sendApiError(res, 400, e.code, e.message);
        }
        throw e;
      }

      const createdBy = req.user?.id ?? "system";
      const created = await createIomsReceipt({
        yardId,
        revenueHead: mrt.revenueHead,
        payerName: payer.payerName,
        payerType: payer.payerType,
        payerRefId: payer.payerRefId ?? undefined,
        amount,
        cgst: 0,
        sgst: 0,
        unifiedEntityId: payer.unifiedEntityId,
        sourceModule: "M-05-MANUAL",
        sourceRecordId: manualReceiptTypeId,
        createdBy,
        ...counterPaymentCreateParams(counterPay),
        manualReceiptTypeId: mrt.id,
        payerPartyType: partyType,
        payerAddress: payer.payerAddress,
        payerContact: payer.payerContact,
        premisesAssetId: premisesAssetId || null,
        applicationRef: applicationRef || null,
        narration,
      });

      await db
        .update(iomsReceipts)
        .set(counterPaymentPaidUpdate(counterPay))
        .where(eq(iomsReceipts.id, created.id));

      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
      if (row) {
        writeAuditLog(req, { module: "Receipts", action: "Create", recordId: created.id, afterValue: row }).catch((e) =>
          console.error("Audit log failed:", e),
        );
      }

      res.status(201).json({ receiptId: created.id, receiptNo: created.receiptNo });
    } catch (e) {
      if (e instanceof ReceiptPaymentModeError) {
        return sendApiError(res, 400, "MANUAL_PAY_MODE", e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create manual receipt");
    }
  });
}
