/**
 * IOMS M-07: Vehicle Fleet Management API routes.
 * Tables: vehicles, vehicle_trip_log, vehicle_fuel_register, vehicle_maintenance.
 * Yard-scoped: list/get/create/update vehicles; trips/fuel/maintenance scoped via vehicle's yard.
 */
import type { Express } from "express";
import { eq, desc, asc, and, inArray } from "drizzle-orm";
import { db } from "./db";
import { vehicles, vehicleTripLog, vehicleFuelRegister, vehicleMaintenance } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { routeParamString } from "./route-params";
import { assertRecordDoDvDaSeparation } from "./workflow";
import { computeFleetRenewalAlerts, listFleetMaintenanceDueEnriched } from "./operational-alerts";

function vehicleInScope(req: Express.Request, yardId: string): boolean {
  const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

export function registerFleetRoutes(app: Express) {
  app.get("/api/ioms/fleet/renewal-alerts", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(vehicles.yardId, scopedIds));
      if (yardId) conditions.push(eq(vehicles.yardId, yardId));
      const base = db.select().from(vehicles);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json({ alerts: computeFleetRenewalAlerts(list) });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch fleet renewal alerts");
    }
  });

  /** Upcoming or overdue `next_service_date` on maintenance rows (calendar-style SLA aid). */
  app.get("/api/ioms/fleet/maintenance-due", async (req, res) => {
    try {
      const withinDays = Math.min(366, Math.max(1, Number(req.query.withinDays ?? 60)));
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const vCond = [];
      if (scopedIds && scopedIds.length > 0) vCond.push(inArray(vehicles.yardId, scopedIds));
      if (yardId) vCond.push(eq(vehicles.yardId, yardId));
      const vBase = db.select().from(vehicles);
      const vehiclesList = vCond.length > 0 ? await vBase.where(and(...vCond)) : await vBase;
      const ids = vehiclesList.map((v) => v.id);
      if (ids.length === 0) return res.json({ withinDays, items: [] as unknown[] });

      const maint = await db
        .select()
        .from(vehicleMaintenance)
        .where(inArray(vehicleMaintenance.vehicleId, ids))
        .orderBy(asc(vehicleMaintenance.nextServiceDate));

      const today = new Date();
      const limit = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + withinDays));
      const limitIso = limit.toISOString().slice(0, 10);
      const todayIso = today.toISOString().slice(0, 10);

      const items = listFleetMaintenanceDueEnriched(vehiclesList, maint, withinDays);
      res.json({ withinDays, today: todayIso, limitDate: limitIso, items });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch maintenance due list");
    }
  });

  app.get("/api/ioms/fleet/vehicles", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(vehicles.yardId, scopedIds));
      if (yardId) conditions.push(eq(vehicles.yardId, yardId));
      const base = db.select().from(vehicles).orderBy(vehicles.registrationNo);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch vehicles");
    }
  });

  app.get("/api/ioms/fleet/vehicles/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(vehicles).where(eq(vehicles.id, routeParamString(req.params.id))).limit(1);
      if (!row) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, row.yardId)) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch vehicle");
    }
  });

  app.post("/api/ioms/fleet/vehicles", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      if (!vehicleInScope(req, yardId))
        return sendApiError(res, 403, "FLEET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const id = nanoid();
      await db.insert(vehicles).values({
        id,
        registrationNo: String(body.registrationNo ?? ""),
        vehicleType: String(body.vehicleType ?? ""),
        yardId,
        status: String(body.status ?? "Active"),
        capacity: body.capacity ? String(body.capacity) : null,
        purchaseDate: body.purchaseDate ? String(body.purchaseDate) : null,
        purchaseValue: body.purchaseValue != null ? Number(body.purchaseValue) : null,
        insuranceExpiry: body.insuranceExpiry ? String(body.insuranceExpiry) : null,
        fitnessExpiry: body.fitnessExpiry ? String(body.fitnessExpiry) : null,
        doUser: body.doUser ? String(body.doUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
      });
      const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id));
      if (row) writeAuditLog(req, { module: "Fleet", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create vehicle");
    }
  });

  app.put("/api/ioms/fleet/vehicles/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(vehicles).where(eq(vehicles.id, id));
      if (!existing) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, existing.yardId)) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      const body = req.body;
      const yardId = body.yardId !== undefined ? String(body.yardId) : existing.yardId;
      if (body.yardId !== undefined && !vehicleInScope(req, yardId))
        return sendApiError(res, 403, "FLEET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const updates: Record<string, unknown> = {};
      ["registrationNo", "vehicleType", "yardId", "capacity", "purchaseDate", "purchaseValue", "insuranceExpiry", "fitnessExpiry", "status", "doUser", "daUser"].forEach((k) => {
        if (body[k] === undefined) return;
        if (["purchaseValue"].includes(k)) updates[k] = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      const mergedRoles = {
        doUser: updates.doUser !== undefined ? (updates.doUser as string | null) : existing.doUser,
        daUser: updates.daUser !== undefined ? (updates.daUser as string | null) : existing.daUser,
      };
      const seg = assertRecordDoDvDaSeparation(req.user, mergedRoles);
      if (!seg.ok) return sendApiError(res, 403, "FLEET_DO_DV_DA_SEGREGATION", seg.error);
      await db.update(vehicles).set(updates as Record<string, string | number | null>).where(eq(vehicles.id, id));
      const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id));
      if (!row) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Fleet", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update vehicle");
    }
  });

  app.get("/api/ioms/fleet/vehicles/:vehicleId/trips", async (req, res) => {
    try {
      const vid = routeParamString(req.params.vehicleId);
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vid)).limit(1);
      if (!vehicle) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, vehicle.yardId)) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      const list = await db.select().from(vehicleTripLog).where(eq(vehicleTripLog.vehicleId, vid)).orderBy(desc(vehicleTripLog.tripDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch trips");
    }
  });

  app.post("/api/ioms/fleet/trips", async (req, res) => {
    try {
      const body = req.body;
      const vehicleId = String(body.vehicleId ?? "");
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
      if (!vehicle) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, vehicle.yardId))
        return sendApiError(res, 403, "FLEET_VEHICLE_YARD_ACCESS_DENIED", "You do not have access to this vehicle's yard");
      const id = nanoid();
      await db.insert(vehicleTripLog).values({
        id,
        vehicleId,
        tripDate: String(body.tripDate ?? ""),
        driverId: body.driverId ? String(body.driverId) : null,
        purpose: body.purpose ? String(body.purpose) : null,
        route: body.route ? String(body.route) : null,
        odometerStart: body.odometerStart != null ? Number(body.odometerStart) : null,
        odometerEnd: body.odometerEnd != null ? Number(body.odometerEnd) : null,
        distanceKm: body.distanceKm != null ? Number(body.distanceKm) : null,
        fuelConsumed: body.fuelConsumed != null ? Number(body.fuelConsumed) : null,
        officerId: body.officerId ? String(body.officerId) : null,
      });
      const [row] = await db.select().from(vehicleTripLog).where(eq(vehicleTripLog.id, id));
      if (row) writeAuditLog(req, { module: "Fleet", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create trip");
    }
  });

  app.get("/api/ioms/fleet/vehicles/:vehicleId/fuel", async (req, res) => {
    try {
      const vid = routeParamString(req.params.vehicleId);
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vid)).limit(1);
      if (!vehicle) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, vehicle.yardId)) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      const list = await db.select().from(vehicleFuelRegister).where(eq(vehicleFuelRegister.vehicleId, vid)).orderBy(desc(vehicleFuelRegister.fuelDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch fuel register");
    }
  });

  app.post("/api/ioms/fleet/fuel", async (req, res) => {
    try {
      const body = req.body;
      const vehicleId = String(body.vehicleId ?? "");
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
      if (!vehicle) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, vehicle.yardId))
        return sendApiError(res, 403, "FLEET_VEHICLE_YARD_ACCESS_DENIED", "You do not have access to this vehicle's yard");
      const id = nanoid();
      await db.insert(vehicleFuelRegister).values({
        id,
        vehicleId,
        fuelDate: String(body.fuelDate ?? ""),
        quantityLitres: Number(body.quantityLitres ?? 0),
        ratePerLitre: body.ratePerLitre != null ? Number(body.ratePerLitre) : null,
        totalAmount: body.totalAmount != null ? Number(body.totalAmount) : null,
        voucherId: body.voucherId ? String(body.voucherId) : null,
        officerId: body.officerId ? String(body.officerId) : null,
      });
      const [row] = await db.select().from(vehicleFuelRegister).where(eq(vehicleFuelRegister.id, id));
      if (row) writeAuditLog(req, { module: "Fleet", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create fuel entry");
    }
  });

  app.get("/api/ioms/fleet/vehicles/:vehicleId/maintenance", async (req, res) => {
    try {
      const vid = routeParamString(req.params.vehicleId);
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vid)).limit(1);
      if (!vehicle) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, vehicle.yardId)) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      const list = await db.select().from(vehicleMaintenance).where(eq(vehicleMaintenance.vehicleId, vid)).orderBy(desc(vehicleMaintenance.serviceDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch maintenance");
    }
  });

  app.post("/api/ioms/fleet/maintenance", async (req, res) => {
    try {
      const body = req.body;
      const vehicleId = String(body.vehicleId ?? "");
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
      if (!vehicle) return sendApiError(res, 404, "FLEET_VEHICLE_NOT_FOUND", "Vehicle not found");
      if (!vehicleInScope(req, vehicle.yardId))
        return sendApiError(res, 403, "FLEET_VEHICLE_YARD_ACCESS_DENIED", "You do not have access to this vehicle's yard");
      const id = nanoid();
      await db.insert(vehicleMaintenance).values({
        id,
        vehicleId,
        maintenanceType: String(body.maintenanceType ?? ""),
        serviceDate: String(body.serviceDate ?? ""),
        description: body.description ? String(body.description) : null,
        cost: body.cost != null ? Number(body.cost) : null,
        vendorName: body.vendorName ? String(body.vendorName) : null,
        voucherId: body.voucherId ? String(body.voucherId) : null,
        nextServiceDate: body.nextServiceDate ? String(body.nextServiceDate) : null,
        officerId: body.officerId ? String(body.officerId) : null,
      });
      const [row] = await db.select().from(vehicleMaintenance).where(eq(vehicleMaintenance.id, id));
      if (row) writeAuditLog(req, { module: "Fleet", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create maintenance");
    }
  });
}
