/**
 * M-05 §8.4 — Bank account master, receipt deposits, cash-in-hand (FR-RCP-010–014).
 */
import type { Express, Request } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import {
  gaplmbBankAccountRoles,
  gaplmbBankAccounts,
  gaplmbBankAccountYards,
  receiptDeposits,
} from "@shared/db-schema";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import {
  listYardMappingHistory,
  syncBankAccountYardMappings,
} from "./bank-account-yard-mapping";
import {
  approveReceiptDeposit,
  computeCashInHandSummary,
  createReceiptDepositBatch,
  deferReceiptsToNextDay,
  enrichDepositRecord,
  isDvOrDa,
  listBankAccountsForUser,
  listUndepositedReceipts,
  rejectReceiptDeposit,
  reverseApprovedReceiptDeposit,
  saveBankAccountVersionSnapshot,
  listBankAccountVersions,
  userRoleTiers,
  verifyReceiptDeposit,
} from "./receipt-deposit-service";
import {
  buildCashInHandLocationContext,
  CashInHandYardAccessError,
  isHeadOfficeScopedRequest,
  resolveCashInHandYardIds,
  yardAllowedForCashInHand,
} from "./receipt-deposit-location-scope";

function nowIso(): string {
  return new Date().toISOString();
}

export function registerReceiptDepositRoutes(app: Express) {
  // ----- Bank Account Master (FR-RCP-010) -----
  app.get("/api/ioms/receipt-deposits/bank-accounts", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      const tiers = userRoleTiers(req.user);
      let yardIds: string[];
      try {
        yardIds = await resolveCashInHandYardIds(req, yardId || undefined);
      } catch (e) {
        if (e instanceof CashInHandYardAccessError) {
          return sendApiError(res, 403, "RECEIPT_YARD_ACCESS_DENIED", "Yard access denied");
        }
        throw e;
      }
      const list = await listBankAccountsForUser({
        yardIds,
        roleTiers: tiers,
        activeOnly: req.query.activeOnly !== "false",
      });
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list bank accounts");
    }
  });

  app.get("/api/ioms/receipt-deposits/bank-accounts/all", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("ADMIN") && !tiers.includes("DA")) {
        return sendApiError(res, 403, "FORBIDDEN", "Admin or DA required");
      }
      const rows = await db.select().from(gaplmbBankAccounts).orderBy(desc(gaplmbBankAccounts.updatedAt));
      const yardLinks = await db.select().from(gaplmbBankAccountYards);
      const roleLinks = await db.select().from(gaplmbBankAccountRoles);
      res.json(
        rows.map((a) => ({
          ...a,
          yardIds: yardLinks.filter((y) => y.bankAccountId === a.id).map((y) => y.yardId),
          roleTiers: roleLinks.filter((r) => r.bankAccountId === a.id).map((r) => r.roleTier),
        })),
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list bank accounts");
    }
  });

  app.post("/api/ioms/receipt-deposits/bank-accounts", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("ADMIN") && !tiers.includes("DA")) {
        return sendApiError(res, 403, "FORBIDDEN", "Admin or DA required");
      }
      const body = req.body as Record<string, unknown>;
      const bankName = String(body.bankName ?? "").trim();
      const accountNumber = String(body.accountNumber ?? "").trim();
      if (!bankName || !accountNumber) {
        return sendApiError(res, 400, "BANK_ACCOUNT_FIELDS", "bankName and accountNumber are required");
      }
      const id = nanoid();
      const ts = nowIso();
      await db.insert(gaplmbBankAccounts).values({
        id,
        bankName,
        accountNumber,
        ifscCode: body.ifscCode ? String(body.ifscCode).trim() : null,
        branch: body.branch ? String(body.branch).trim() : null,
        isActive: body.isActive !== false,
        createdBy: req.user?.id ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
      const yardIds = Array.isArray(body.yardIds) ? body.yardIds.map(String) : [];
      const roleTiers = Array.isArray(body.roleTiers) ? body.roleTiers.map(String) : [];
      const remarks = body.remarks ? String(body.remarks).trim() : null;
      await syncBankAccountYardMappings({
        bankAccountId: id,
        newYardIds: yardIds,
        changedBy: req.user?.id ?? null,
        remarks: remarks || "Initial bank account setup",
      });
      for (const r of roleTiers) {
        await db.insert(gaplmbBankAccountRoles).values({ bankAccountId: id, roleTier: r });
      }
      const [row] = await db.select().from(gaplmbBankAccounts).where(eq(gaplmbBankAccounts.id, id)).limit(1);
      if (row) {
        await saveBankAccountVersionSnapshot({
          bankAccountId: id,
          changedBy: req.user?.id ?? null,
          snapshot: { ...row, yardIds, roleTiers },
        });
      }
      writeAuditLog(req, { module: "Receipts", action: "Create", recordId: id, afterValue: row }).catch(() => {});
      res.status(201).json({ ...row, yardIds, roleTiers });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create bank account");
    }
  });

  app.put("/api/ioms/receipt-deposits/bank-accounts/:id", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("ADMIN") && !tiers.includes("DA")) {
        return sendApiError(res, 403, "FORBIDDEN", "Admin or DA required");
      }
      const id = String(req.params.id);
      const [existing] = await db.select().from(gaplmbBankAccounts).where(eq(gaplmbBankAccounts.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "NOT_FOUND", "Bank account not found");
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = { updatedAt: nowIso() };
      if (body.bankName !== undefined) updates.bankName = String(body.bankName).trim();
      if (body.accountNumber !== undefined) updates.accountNumber = String(body.accountNumber).trim();
      if (body.ifscCode !== undefined) updates.ifscCode = body.ifscCode ? String(body.ifscCode).trim() : null;
      if (body.branch !== undefined) updates.branch = body.branch ? String(body.branch).trim() : null;
      if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
      await db.update(gaplmbBankAccounts).set(updates as Record<string, string | boolean>).where(eq(gaplmbBankAccounts.id, id));

      let yardIdsAfter = await db
        .select({ yardId: gaplmbBankAccountYards.yardId })
        .from(gaplmbBankAccountYards)
        .where(eq(gaplmbBankAccountYards.bankAccountId, id))
        .then((rows) => rows.map((r) => r.yardId));
      if (Array.isArray(body.yardIds)) {
        const remarks = body.remarks ? String(body.remarks).trim() : null;
        const synced = await syncBankAccountYardMappings({
          bankAccountId: id,
          newYardIds: body.yardIds.map(String),
          changedBy: req.user?.id ?? null,
          remarks,
        });
        yardIdsAfter = synced.newYardIds;
      }
      if (Array.isArray(body.roleTiers)) {
        await db.delete(gaplmbBankAccountRoles).where(eq(gaplmbBankAccountRoles.bankAccountId, id));
        for (const r of body.roleTiers.map(String)) {
          await db.insert(gaplmbBankAccountRoles).values({ bankAccountId: id, roleTier: r });
        }
      }
      const [row] = await db.select().from(gaplmbBankAccounts).where(eq(gaplmbBankAccounts.id, id)).limit(1);
      if (row) {
        const roleLinks = await db
          .select()
          .from(gaplmbBankAccountRoles)
          .where(eq(gaplmbBankAccountRoles.bankAccountId, id));
        await saveBankAccountVersionSnapshot({
          bankAccountId: id,
          changedBy: req.user?.id ?? null,
          snapshot: {
            ...row,
            yardIds: yardIdsAfter,
            roleTiers: roleLinks.map((r) => r.roleTier),
          },
        });
      }
      writeAuditLog(req, { module: "Receipts", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch(() => {});
      res.json({ ...row, yardIds: yardIdsAfter });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update bank account");
    }
  });

  /** FR-RCP-010: link / de-link / add / remove yard mappings with audit remarks. */
  app.patch("/api/ioms/receipt-deposits/bank-accounts/:id/yards", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("ADMIN") && !tiers.includes("DA")) {
        return sendApiError(res, 403, "FORBIDDEN", "Admin or DA required");
      }
      const id = String(req.params.id);
      const [existing] = await db.select().from(gaplmbBankAccounts).where(eq(gaplmbBankAccounts.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "NOT_FOUND", "Bank account not found");
      const body = req.body as Record<string, unknown>;
      if (!Array.isArray(body.yardIds)) {
        return sendApiError(res, 400, "YARD_IDS_REQUIRED", "yardIds array is required");
      }
      const synced = await syncBankAccountYardMappings({
        bankAccountId: id,
        newYardIds: body.yardIds.map(String),
        changedBy: req.user?.id ?? null,
        remarks: body.remarks ? String(body.remarks).trim() : null,
      });
      await db
        .update(gaplmbBankAccounts)
        .set({ updatedAt: nowIso() })
        .where(eq(gaplmbBankAccounts.id, id));
      const [row] = await db.select().from(gaplmbBankAccounts).where(eq(gaplmbBankAccounts.id, id)).limit(1);
      if (row) {
        await saveBankAccountVersionSnapshot({
          bankAccountId: id,
          changedBy: req.user?.id ?? null,
          snapshot: { ...row, yardIds: synced.newYardIds },
        });
      }
      writeAuditLog(req, {
        module: "Receipts",
        action: "Update",
        recordId: id,
        afterValue: { yardIds: synced.newYardIds, remarks: body.remarks ?? null },
      }).catch(() => {});
      res.json({ ...row, yardIds: synced.newYardIds });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update yard mappings");
    }
  });

  app.get("/api/ioms/receipt-deposits/bank-accounts/:id/mapping-history", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("ADMIN") && !tiers.includes("DA") && !tiers.includes("DV") && !tiers.includes("DO")) {
        return sendApiError(res, 403, "FORBIDDEN", "Accounts access required");
      }
      const id = String(req.params.id);
      const history = await listYardMappingHistory(id);
      res.json(history);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list mapping history");
    }
  });

  app.get("/api/ioms/receipt-deposits/bank-accounts/:id/versions", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("ADMIN") && !tiers.includes("DA")) {
        return sendApiError(res, 403, "FORBIDDEN", "Admin or DA required");
      }
      const id = String(req.params.id);
      const versions = await listBankAccountVersions(id);
      res.json(
        versions.map((v) => ({
          ...v,
          snapshot: JSON.parse(v.snapshotJson) as Record<string, unknown>,
        })),
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list bank account versions");
    }
  });

  app.post("/api/ioms/receipt-deposits/cash-in-hand/send-summary", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!isDvOrDa(tiers)) {
        return sendApiError(res, 403, "FORBIDDEN", "DV or DA role required");
      }
      const { runReceiptDepositDailyJobs } = await import("./cron-receipt-deposit");
      const { getEmailConfigStatus } = await import("./smtp-config");
      const dispatch = await runReceiptDepositDailyJobs();
      const email = await getEmailConfigStatus();
      let message = "Cash-in-hand summary written to server logs.";
      if (dispatch.emailSent) {
        message = `Cash-in-hand summary emailed to ${email.notifyEmailTo}.`;
      } else if (email.notifyDigestsReady) {
        message = "Cash-in-hand summary processed; check server logs if email did not arrive.";
      } else if (email.smtpReady) {
        message =
          "Summary logged. Set Default notify inbox under Admin → Config → Gmail SMTP to receive digest email.";
      } else {
        message =
          "Summary logged to server console. Configure Gmail SMTP under Admin → Config to enable email delivery.";
      }
      res.json({ ok: true, message, email, dispatch });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to send summary");
    }
  });

  // ----- Undeposited receipts & cash-in-hand (SCR-RCP-05 / SCR-RCP-06) -----
  app.get("/api/ioms/receipt-deposits/cash-in-hand/locations", async (req, res) => {
    try {
      const ctx = await buildCashInHandLocationContext(req);
      res.json(ctx);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load cash-in-hand locations");
    }
  });

  app.get("/api/ioms/receipt-deposits/undeposited", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      let yardIds: string[];
      try {
        yardIds = await resolveCashInHandYardIds(req, yardId || undefined);
      } catch (e) {
        if (e instanceof CashInHandYardAccessError) {
          return sendApiError(res, 403, "RECEIPT_YARD_ACCESS_DENIED", "Yard access denied");
        }
        throw e;
      }
      const from = String(req.query.from ?? "").trim().slice(0, 10);
      const to = String(req.query.to ?? "").trim().slice(0, 10);
      const list = await listUndepositedReceipts({
        yardIds,
        ...(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { fromYmd: from } : {}),
        ...(to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { toYmd: to } : {}),
      });
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list undeposited receipts");
    }
  });

  app.get("/api/ioms/receipt-deposits/cash-in-hand", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      let yardIds: string[];
      try {
        yardIds = await resolveCashInHandYardIds(req, yardId || undefined);
      } catch (e) {
        if (e instanceof CashInHandYardAccessError) {
          return sendApiError(res, 403, "RECEIPT_YARD_ACCESS_DENIED", "Yard access denied");
        }
        throw e;
      }
      const cfg = await getMergedSystemConfig();
      const maxDays = parseSystemConfigNumber(cfg, "receipt_deposit_carry_forward_days");
      const summary = await computeCashInHandSummary({
        yardIds,
        maxCarryForwardDays: maxDays > 0 ? maxDays : 2,
      });
      res.json(summary);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to compute cash-in-hand");
    }
  });

  app.post("/api/ioms/receipt-deposits/defer", async (req, res) => {
    try {
      const body = req.body as { receiptIds?: string[]; untilDate?: string };
      const ids = Array.isArray(body.receiptIds) ? body.receiptIds.map(String) : [];
      const until = String(body.untilDate ?? "").trim().slice(0, 10);
      if (ids.length === 0) return sendApiError(res, 400, "RECEIPT_IDS", "receiptIds required");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        return sendApiError(res, 400, "DEFER_DATE", "untilDate must be YYYY-MM-DD");
      }
      await deferReceiptsToNextDay(ids, until);
      res.json({ ok: true, count: ids.length });
    } catch (e) {
      console.error(e);
      sendApiError(res, 400, "DEFER_FAILED", e instanceof Error ? e.message : "Defer failed");
    }
  });

  // ----- Deposit batches -----
  app.get("/api/ioms/receipt-deposits", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      const status = String(req.query.status ?? "").trim();
      let yardIds: string[];
      try {
        yardIds = await resolveCashInHandYardIds(req, yardId || undefined);
      } catch (e) {
        if (e instanceof CashInHandYardAccessError) {
          return sendApiError(res, 403, "RECEIPT_YARD_ACCESS_DENIED", "Yard access denied");
        }
        throw e;
      }
      const ho = await isHeadOfficeScopedRequest(req);
      if (!yardId && ho) {
        yardIds = [];
      }
      const conds = [];
      if (yardIds.length > 0) conds.push(inArray(receiptDeposits.yardId, yardIds));
      if (status) conds.push(eq(receiptDeposits.status, status));
      const rows =
        conds.length > 0
          ? await db
              .select()
              .from(receiptDeposits)
              .where(and(...conds))
              .orderBy(desc(receiptDeposits.createdAt))
          : await db.select().from(receiptDeposits).orderBy(desc(receiptDeposits.createdAt));
      const enriched = await Promise.all(rows.map((r) => enrichDepositRecord(r)));
      res.json(enriched);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list deposits");
    }
  });

  app.get("/api/ioms/receipt-deposits/:id", async (req, res) => {
    try {
      const id = String(req.params.id);
      const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      if (!dep) return sendApiError(res, 404, "NOT_FOUND", "Deposit not found");
      if (!(await yardAllowedForCashInHand(req, dep.yardId))) {
        return sendApiError(res, 404, "NOT_FOUND", "Deposit not found");
      }
      res.json(await enrichDepositRecord(dep));
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch deposit");
    }
  });

  app.post("/api/ioms/receipt-deposits", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const yardId = String(body.yardId ?? "").trim();
      const bankAccountId = String(body.bankAccountId ?? "").trim();
      const depositDate = String(body.depositDate ?? new Date().toISOString().slice(0, 10)).trim();
      const receiptIds = Array.isArray(body.receiptIds) ? body.receiptIds.map(String) : [];
      if (!yardId || !bankAccountId) {
        return sendApiError(res, 400, "DEPOSIT_FIELDS", "yardId and bankAccountId are required");
      }
      if (!(await yardAllowedForCashInHand(req, yardId))) {
        return sendApiError(res, 403, "RECEIPT_YARD_ACCESS_DENIED", "Yard access denied");
      }
      const createdBy = req.user?.id ?? "system";
      const result = await createReceiptDepositBatch({
        yardId,
        bankAccountId,
        depositDate,
        receiptIds,
        createdBy,
      });
      const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, result.id)).limit(1);
      if (dep) {
        writeAuditLog(req, { module: "Receipts", action: "Create", recordId: result.id, afterValue: dep }).catch(() => {});
      }
      res.status(201).json(await enrichDepositRecord(dep!));
    } catch (e) {
      console.error(e);
      sendApiError(res, 400, "DEPOSIT_CREATE_FAILED", e instanceof Error ? e.message : "Create failed");
    }
  });

  app.post("/api/ioms/receipt-deposits/:id/verify", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!isDvOrDa(tiers)) {
        return sendApiError(res, 403, "FORBIDDEN", "DV or DA role required");
      }
      const id = String(req.params.id);
      const body = req.body as Record<string, unknown>;
      const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      if (!dep || !(await yardAllowedForCashInHand(req, dep.yardId))) {
        return sendApiError(res, 404, "NOT_FOUND", "Deposit not found");
      }
      await verifyReceiptDeposit({
        depositId: id,
        passbookReference: String(body.passbookReference ?? ""),
        passbookDate: String(body.passbookDate ?? "").slice(0, 10),
        verifiedBy: req.user?.id ?? "system",
      });
      const [updated] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      writeAuditLog(req, { module: "Receipts", action: "Verify", recordId: id, beforeValue: dep, afterValue: updated }).catch(() => {});
      res.json(await enrichDepositRecord(updated!));
    } catch (e) {
      console.error(e);
      sendApiError(res, 400, "DEPOSIT_VERIFY_FAILED", e instanceof Error ? e.message : "Verify failed");
    }
  });

  app.post("/api/ioms/receipt-deposits/:id/approve", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("DA") && !tiers.includes("ADMIN")) {
        return sendApiError(res, 403, "FORBIDDEN", "DA role required");
      }
      const id = String(req.params.id);
      const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      if (!dep || !(await yardAllowedForCashInHand(req, dep.yardId))) {
        return sendApiError(res, 404, "NOT_FOUND", "Deposit not found");
      }
      const { ledgerMessages } = await approveReceiptDeposit({
        depositId: id,
        approvedBy: req.user?.id ?? "system",
      });
      const [updated] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      writeAuditLog(req, { module: "Receipts", action: "Approve", recordId: id, beforeValue: dep, afterValue: updated }).catch(() => {});
      res.json({ ...(await enrichDepositRecord(updated!)), ledgerMessages });
    } catch (e) {
      console.error(e);
      sendApiError(res, 400, "DEPOSIT_APPROVE_FAILED", e instanceof Error ? e.message : "Approve failed");
    }
  });

  app.post("/api/ioms/receipt-deposits/:id/reject", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("DA") && !tiers.includes("ADMIN")) {
        return sendApiError(res, 403, "FORBIDDEN", "DA role required");
      }
      const id = String(req.params.id);
      const body = req.body as Record<string, unknown>;
      const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      if (!dep || !(await yardAllowedForCashInHand(req, dep.yardId))) {
        return sendApiError(res, 404, "NOT_FOUND", "Deposit not found");
      }
      await rejectReceiptDeposit({
        depositId: id,
        rejectionReason: String(body.rejectionReason ?? ""),
      });
      const [updated] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      writeAuditLog(req, { module: "Receipts", action: "Reject", recordId: id, beforeValue: dep, afterValue: updated }).catch(() => {});
      res.json(await enrichDepositRecord(updated!));
    } catch (e) {
      console.error(e);
      sendApiError(res, 400, "DEPOSIT_REJECT_FAILED", e instanceof Error ? e.message : "Reject failed");
    }
  });

  app.post("/api/ioms/receipt-deposits/:id/reverse", async (req, res) => {
    try {
      const tiers = userRoleTiers(req.user);
      if (!tiers.includes("DA") && !tiers.includes("ADMIN")) {
        return sendApiError(res, 403, "FORBIDDEN", "DA role required");
      }
      const id = String(req.params.id);
      const body = req.body as Record<string, unknown>;
      const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      if (!dep || !(await yardAllowedForCashInHand(req, dep.yardId))) {
        return sendApiError(res, 404, "NOT_FOUND", "Deposit not found");
      }
      const { ledgerMessages } = await reverseApprovedReceiptDeposit({
        depositId: id,
        reversalReason: String(body.reversalReason ?? ""),
        reversedBy: req.user?.id ?? "system",
      });
      const [updated] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, id)).limit(1);
      writeAuditLog(req, { module: "Receipts", action: "Reverse", recordId: id, beforeValue: dep, afterValue: updated }).catch(() => {});
      res.json({ ...(await enrichDepositRecord(updated!)), ledgerMessages });
    } catch (e) {
      console.error(e);
      sendApiError(res, 400, "DEPOSIT_REVERSE_FAILED", e instanceof Error ? e.message : "Reverse failed");
    }
  });
}
