/**
 * IOMS M-02: Trader & Asset ID Management API routes.
 * Tables: trader_licences, assistant_traders, assets, asset_allotments, trader_blocking_log, msp_settings.
 */
import type { Express } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "./db";
import {
  traderLicences,
  assistantTraders,
  assets,
  assetAllotments,
  traderBlockingLog,
  mspSettings,
  rentInvoices,
  iomsReceipts,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { writeAuditLog } from "./audit";
import { createIomsReceipt } from "./routes-receipts-ioms";

export function registerTradersAssetsRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Trader licences -----
  app.get("/api/ioms/traders/licences", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      let list = await db.select().from(traderLicences).orderBy(desc(traderLicences.createdAt));
      if (yardId) list = list.filter((r) => r.yardId === yardId);
      if (status) list = list.filter((r) => r.status === status);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch licences" });
    }
  });

  app.get("/api/ioms/traders/licences/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Licence not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch licence" });
    }
  });

  app.post("/api/ioms/traders/licences", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      const sys = await getMergedSystemConfig();
      const feeFromBody =
        body.feeAmount != null && String(body.feeAmount).trim() !== "" ? Number(body.feeAmount) : null;
      const feeAmount = feeFromBody != null && !Number.isNaN(feeFromBody) ? feeFromBody : parseSystemConfigNumber(sys, "licence_fee");
      await db.insert(traderLicences).values({
        id,
        firmName: String(body.firmName ?? ""),
        yardId: String(body.yardId ?? ""),
        mobile: String(body.mobile ?? ""),
        licenceType: String(body.licenceType ?? "Associated"),
        status: String(body.status ?? "Draft"),
        firmType: body.firmType ? String(body.firmType) : null,
        contactName: body.contactName ? String(body.contactName) : null,
        email: body.email ? String(body.email) : null,
        address: body.address ? String(body.address) : null,
        aadhaarToken: body.aadhaarToken ? String(body.aadhaarToken) : null,
        pan: body.pan ? String(body.pan) : null,
        gstin: body.gstin ? String(body.gstin) : null,
        feeAmount,
        receiptId: body.receiptId ? String(body.receiptId) : null,
        validFrom: body.validFrom ? String(body.validFrom) : null,
        validTo: body.validTo ? String(body.validTo) : null,
        isBlocked: Boolean(body.isBlocked ?? false),
        blockReason: body.blockReason ? String(body.blockReason) : null,
        doUser: body.doUser ? String(body.doUser) : null,
        dvUser: body.dvUser ? String(body.dvUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
        createdAt: now(),
        updatedAt: now(),
      });
      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create licence" });
    }
  });

  app.put("/api/ioms/traders/licences/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body as Record<string, unknown>;

      const [existing] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Licence not found" });

      const allowed = ["firmName", "firmType", "yardId", "contactName", "mobile", "email", "address", "aadhaarToken", "pan", "gstin", "licenceType", "feeAmount", "receiptId", "validFrom", "validTo", "status", "isBlocked", "blockReason", "licenceNo", "doUser", "dvUser", "daUser"];
      const updates: Record<string, unknown> = { updatedAt: now() };
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "feeAmount") updates.feeAmount = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      }
      if (body.isBlocked !== undefined) updates.isBlocked = Boolean(body.isBlocked);
      await db.update(traderLicences).set(updates as Record<string, string | number | boolean | null>).where(eq(traderLicences.id, id));

      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Licence not found" });

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
              const created = await createIomsReceipt({
                yardId: String(row.yardId),
                revenueHead: "LicenceFee",
                payerName: row.firmName,
                payerType: "TraderLicence",
                payerRefId: row.id,
                amount: Number(row.feeAmount ?? 0),
                paymentMode: "Cash",
                sourceModule: "M-02",
                sourceRecordId: row.id,
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
          await db.update(traderLicences).set({ receiptId: receiptToLink.id }).where(eq(traderLicences.id, id));
          const [updatedLicence] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
          return res.json(updatedLicence ?? row);
        }
      }

      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update licence" });
    }
  });

  // ----- Assistant traders -----
  app.get("/api/ioms/traders/assistants", async (req, res) => {
    try {
      const primaryLicenceId = req.query.primaryLicenceId as string | undefined;
      const list = primaryLicenceId
        ? await db.select().from(assistantTraders).where(eq(assistantTraders.primaryLicenceId, primaryLicenceId))
        : await db.select().from(assistantTraders).orderBy(desc(assistantTraders.personName));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch assistant traders" });
    }
  });

  app.post("/api/ioms/traders/assistants", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(assistantTraders).values({
        id,
        primaryLicenceId: String(body.primaryLicenceId ?? ""),
        personName: String(body.personName ?? ""),
        yardId: String(body.yardId ?? ""),
        status: String(body.status ?? "Active"),
        characterCertIssuer: body.characterCertIssuer ? String(body.characterCertIssuer) : null,
        certDate: body.certDate ? String(body.certDate) : null,
        manualLicenceNo: body.manualLicenceNo ? String(body.manualLicenceNo) : null,
      });
      const [row] = await db.select().from(assistantTraders).where(eq(assistantTraders.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create assistant trader" });
    }
  });

  // ----- Assets -----
  app.get("/api/ioms/assets", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const list = yardId
        ? await db.select().from(assets).where(eq(assets.yardId, yardId)).orderBy(assets.assetId)
        : await db.select().from(assets).orderBy(assets.assetId);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch assets" });
    }
  });

  // Vacated / vacant shops: no active allotment; show previous allottee, officer, rent
  app.get("/api/ioms/assets/vacant", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const allAssets = yardId
        ? await db.select().from(assets).where(eq(assets.yardId, yardId)).orderBy(assets.assetId)
        : await db.select().from(assets).orderBy(assets.assetId);
      const allAllotments = await db.select().from(assetAllotments).orderBy(desc(assetAllotments.toDate));
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
      const vacant: Array<{
        asset: (typeof allAssets)[0];
        lastAllotment: { allotteeName: string; toDate: string; daUser: string | null; id: string } | null;
        lastRentAmount: number | null;
      }> = [];
      for (const asset of allAssets) {
        const list = allotmentsByAsset.get(asset.id) ?? allotmentsByAsset.get(asset.assetId) ?? [];
        const latest = list[0];
        if (latest && latest.status === "Active") continue;
        const lastAllotment = latest
          ? { allotteeName: latest.allotteeName, toDate: latest.toDate, daUser: latest.daUser, id: latest.id }
          : null;
        const lastRentAmount = lastAllotment ? (latestRentByAllotment[lastAllotment.id] ?? null) : null;
        vacant.push({ asset, lastAllotment, lastRentAmount });
      }
      res.json(vacant);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch vacant assets" });
    }
  });

  // ----- Asset allotments (use /asset-allotments to avoid conflict with /assets/:id) -----
  app.get("/api/ioms/asset-allotments", async (req, res) => {
    try {
      const assetId = req.query.assetId as string | undefined;
      const licenceId = req.query.traderLicenceId as string | undefined;
      let list = await db.select().from(assetAllotments).orderBy(desc(assetAllotments.fromDate));
      if (assetId) list = list.filter((r) => r.assetId === assetId);
      if (licenceId) list = list.filter((r) => r.traderLicenceId === licenceId);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch allotments" });
    }
  });

  app.post("/api/ioms/asset-allotments", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(assetAllotments).values({
        id,
        assetId: String(body.assetId ?? ""),
        traderLicenceId: String(body.traderLicenceId ?? ""),
        allotteeName: String(body.allotteeName ?? ""),
        fromDate: String(body.fromDate ?? ""),
        toDate: String(body.toDate ?? ""),
        status: String(body.status ?? "Active"),
        securityDeposit: body.securityDeposit != null ? Number(body.securityDeposit) : null,
        doUser: body.doUser ? String(body.doUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
      });
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create allotment" });
    }
  });

  app.put("/api/ioms/asset-allotments/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["allotteeName", "fromDate", "toDate", "status", "securityDeposit", "doUser", "daUser"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "securityDeposit") updates.securityDeposit = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(assetAllotments).set(updates as Record<string, string | number | null>).where(eq(assetAllotments.id, id));
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update allotment" });
    }
  });

  app.get("/api/ioms/assets/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(assets).where(eq(assets.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Asset not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch asset" });
    }
  });

  app.post("/api/ioms/assets", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(assets).values({
        id,
        assetId: String(body.assetId ?? ""),
        yardId: String(body.yardId ?? ""),
        assetType: String(body.assetType ?? "Shop"),
        complexName: body.complexName ? String(body.complexName) : null,
        area: body.area ? String(body.area) : null,
        plinthAreaSqft: body.plinthAreaSqft != null ? Number(body.plinthAreaSqft) : null,
        value: body.value != null ? Number(body.value) : null,
        fileNumber: body.fileNumber ? String(body.fileNumber) : null,
        orderNumber: body.orderNumber ? String(body.orderNumber) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      });
      const [row] = await db.select().from(assets).where(eq(assets.id, id));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create asset" });
    }
  });

  app.put("/api/ioms/assets/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const allowed = ["assetId", "yardId", "assetType", "complexName", "area", "plinthAreaSqft", "value", "fileNumber", "orderNumber", "isActive"];
      const updates: Record<string, unknown> = {};
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "plinthAreaSqft" || k === "value") updates[k] = body[k] == null ? null : Number(body[k]);
        else if (k === "isActive") updates.isActive = Boolean(body.isActive);
        else updates[k] = body[k] == null ? null : String(body[k]);
      }
      await db.update(assets).set(updates as Record<string, string | number | boolean | null>).where(eq(assets.id, id));
      const [row] = await db.select().from(assets).where(eq(assets.id, id));
      if (!row) return res.status(404).json({ error: "Asset not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  // ----- Trader blocking log -----
  app.get("/api/ioms/traders/blocking-log", async (req, res) => {
    try {
      const traderLicenceId = req.query.traderLicenceId as string | undefined;
      const list = traderLicenceId
        ? await db.select().from(traderBlockingLog).where(eq(traderBlockingLog.traderLicenceId, traderLicenceId)).orderBy(desc(traderBlockingLog.actionedAt))
        : await db.select().from(traderBlockingLog).orderBy(desc(traderBlockingLog.actionedAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch blocking log" });
    }
  });

  app.post("/api/ioms/traders/blocking-log", async (req, res) => {
    try {
      const body = req.body;
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create blocking log entry" });
    }
  });

  // ----- MSP settings -----
  app.get("/api/ioms/msp-settings", async (_req, res) => {
    try {
      const list = await db.select().from(mspSettings).orderBy(mspSettings.commodity);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch MSP settings" });
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
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create MSP setting" });
    }
  });

  app.put("/api/ioms/msp-settings/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["commodity", "mspRate", "validFrom", "validTo", "updatedBy"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "mspRate") updates.mspRate = Number(body.mspRate);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(mspSettings).set(updates as Record<string, string | number | null>).where(eq(mspSettings.id, id));
      const [row] = await db.select().from(mspSettings).where(eq(mspSettings.id, id));
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update MSP setting" });
    }
  });
}
