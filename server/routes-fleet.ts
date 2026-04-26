/**
 * IOMS M-07: Vehicle Fleet Management API routes.
 * Tables: vehicles, vehicle_trip_log, vehicle_fuel_register, vehicle_maintenance.
 * Yard-scoped: list/get/create/update vehicles; trips/fuel/maintenance scoped via vehicle's yard.
 */
import type { Express } from "express";
import { eq, desc, asc, and, inArray } from "drizzle-orm";
import { db } from "./db";
import { employees, vehicles, works, vehicleTripLog, vehicleFuelRegister, vehicleMaintenance } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { routeParamString } from "./route-params";
import { assertRecordDoDvDaSeparation } from "./workflow";
import { computeFleetRenewalAlerts, listFleetMaintenanceDueEnriched } from "./operational-alerts";
import { getMergedSystemConfig } from "./system-config";

function vehicleInScope(req: Express.Request, yardId: string): boolean {
  const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

export function registerFleetRoutes(app: Express) {
  app.get("/api/ioms/fleet/reports/summary", async (req, res) => {
    try {
      const from = String(req.query.from ?? "").slice(0, 10);
      const to = String(req.query.to ?? "").slice(0, 10);
      if (!from || !to) return sendApiError(res, 400, "FLEET_REPORT_RANGE_REQUIRED", "from and to are required (YYYY-MM-DD)");

      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const vCond = [];
      if (scopedIds && scopedIds.length > 0) vCond.push(inArray(vehicles.yardId, scopedIds));
      const vBase = db.select().from(vehicles);
      const vehiclesList = vCond.length > 0 ? await vBase.where(and(...vCond)) : await vBase;
      const vehicleById = new Map(vehiclesList.map((v) => [v.id, v]));
      if (vehiclesList.length === 0) return res.json([]);

      const tripRows = await db
        .select()
        .from(vehicleTripLog)
        .where(inArray(vehicleTripLog.vehicleId, vehiclesList.map((v) => v.id)))
        .orderBy(desc(vehicleTripLog.tripDate));

      const cfg = await getMergedSystemConfig();
      const hiFuel = Number(cfg.fleet_trip_fuel_alert_litres ?? 0) || 0;

      const within = tripRows.filter((t) => {
        const d = String(t.tripDate ?? "").slice(0, 10);
        return d >= from && d <= to;
      });

      const agg = new Map<
        string,
        {
          tripCount: number;
          totalDistanceKm: number;
          totalFuelLitres: number;
          totalFuelCostInr: number;
          highFuelTripCount: number;
        }
      >();
      for (const t of within) {
        const vid = String(t.vehicleId);
        if (!vehicleById.has(vid)) continue;
        const cur =
          agg.get(vid) ?? { tripCount: 0, totalDistanceKm: 0, totalFuelLitres: 0, totalFuelCostInr: 0, highFuelTripCount: 0 };
        cur.tripCount += 1;
        cur.totalDistanceKm += Number(t.distanceKm ?? 0) || 0;
        const fuel = Number((t as { fuelFilledLitres?: number | null }).fuelFilledLitres ?? 0) || 0;
        const cost = Number((t as { fuelCostInr?: number | null }).fuelCostInr ?? 0) || 0;
        cur.totalFuelLitres += fuel;
        cur.totalFuelCostInr += cost;
        if (hiFuel > 0 && fuel > hiFuel) cur.highFuelTripCount += 1;
        agg.set(vid, cur);
      }

      const out = Array.from(agg.entries()).map(([vehicleId, a]) => {
        const v = vehicleById.get(vehicleId)!;
        const eff = a.totalFuelLitres > 0 ? a.totalDistanceKm / a.totalFuelLitres : null;
        return {
          vehicleId,
          registrationNo: v.registrationNo,
          yardId: v.yardId,
          tripCount: a.tripCount,
          totalDistanceKm: Number(a.totalDistanceKm.toFixed(2)),
          totalFuelLitres: Number(a.totalFuelLitres.toFixed(2)),
          totalFuelCostInr: Number(a.totalFuelCostInr.toFixed(2)),
          efficiencyKmPerLitre: eff == null ? null : Number(eff.toFixed(2)),
          highFuelTripCount: a.highFuelTripCount,
        };
      });

      res.json(out.sort((a, b) => b.totalFuelCostInr - a.totalFuelCostInr || a.registrationNo.localeCompare(b.registrationNo)));
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build fleet report");
    }
  });

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

      // Block trip logs when non-compliant: expired insurance/fitness/PUC (if present).
      const todayIso = new Date().toISOString().slice(0, 10);
      const expired =
        (vehicle.insuranceExpiry && String(vehicle.insuranceExpiry).slice(0, 10) < todayIso) ||
        (vehicle.fitnessExpiry && String(vehicle.fitnessExpiry).slice(0, 10) < todayIso) ||
        ((vehicle as { pucExpiry?: string | null }).pucExpiry && String((vehicle as { pucExpiry?: string | null }).pucExpiry).slice(0, 10) < todayIso);
      if (expired) {
        return sendApiError(
          res,
          400,
          "FLEET_VEHICLE_NON_COMPLIANT",
          "Vehicle is non-compliant (expired insurance/fitness/PUC). Renew documents before logging new trips.",
        );
      }

      const odStart = body.odometerStart != null ? Number(body.odometerStart) : null;
      const odEnd = body.odometerEnd != null ? Number(body.odometerEnd) : null;
      if (odStart != null && odEnd != null) {
        if (!Number.isFinite(odStart) || !Number.isFinite(odEnd)) {
          return sendApiError(res, 400, "FLEET_ODOMETER_INVALID", "Odometer values must be numbers");
        }
        if (odEnd < odStart) {
          return sendApiError(res, 400, "FLEET_ODOMETER_ORDER", "End odometer cannot be less than start odometer");
        }
      }
      const distanceKm =
        odStart != null && odEnd != null
          ? Math.max(0, odEnd - odStart)
          : body.distanceKm != null
            ? Number(body.distanceKm)
            : null;

      // Validate driver exists when provided.
      const driverId = body.driverId ? String(body.driverId) : null;
      if (driverId) {
        const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, driverId)).limit(1);
        if (!emp) {
          return sendApiError(res, 400, "FLEET_DRIVER_NOT_FOUND", "Driver must be a valid employee");
        }
      }

      const id = nanoid();
      await db.insert(vehicleTripLog).values({
        id,
        vehicleId,
        tripDate: String(body.tripDate ?? ""),
        driverId,
        purpose: body.purpose ? String(body.purpose) : null,
        route: body.route ? String(body.route) : null,
        odometerStart: odStart,
        odometerEnd: odEnd,
        distanceKm: distanceKm != null ? Number(distanceKm) : null,
        fuelConsumed: body.fuelConsumed != null ? Number(body.fuelConsumed) : null,
        fuelFilledLitres: body.fuelFilledLitres != null ? Number(body.fuelFilledLitres) : null,
        fuelCostInr: body.fuelCostInr != null ? Number(body.fuelCostInr) : null,
        fuelReceiptDocs: null,
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

      const serviceDate = String(body.serviceDate ?? "").slice(0, 10);
      const todayIso = new Date().toISOString().slice(0, 10);
      if (serviceDate && serviceDate > todayIso) {
        return sendApiError(res, 400, "FLEET_MAINT_DATE_FUTURE", "Maintenance date cannot be in the future");
      }

      const odometerReadingKm = body.odometerReadingKm != null ? Number(body.odometerReadingKm) : null;
      if (odometerReadingKm != null && !Number.isFinite(odometerReadingKm)) {
        return sendApiError(res, 400, "FLEET_MAINT_ODO_INVALID", "Odometer reading must be a number");
      }
      if (odometerReadingKm != null) {
        const prevRows = await db
          .select({ m: vehicleMaintenance.odometerReadingKm })
          .from(vehicleMaintenance)
          .where(eq(vehicleMaintenance.vehicleId, vehicleId))
          .orderBy(desc(vehicleMaintenance.serviceDate))
          .limit(1);
        const prev = prevRows?.[0]?.m != null ? Number(prevRows[0].m) : null;
        if (prev != null && odometerReadingKm < prev) {
          return sendApiError(res, 400, "FLEET_MAINT_ODO_ORDER", "Odometer reading must be ≥ last recorded reading for this vehicle");
        }
      }

      const cost = body.cost != null ? Number(body.cost) : null;
      if (cost != null && (!Number.isFinite(cost) || cost <= 0)) {
        return sendApiError(res, 400, "FLEET_MAINT_COST_INVALID", "Cost must be a positive number");
      }

      // If cost above threshold → require linked M-08 work order (workId).
      const cfg = await getMergedSystemConfig();
      const threshold = Number(cfg.fleet_maintenance_work_order_threshold_inr ?? 0) || 0;
      const workId = body.workId ? String(body.workId) : null;
      if (cost != null && threshold > 0 && cost > threshold && !workId) {
        return sendApiError(res, 400, "FLEET_MAINT_WORK_ORDER_REQUIRED", "Cost above threshold: link a Work Order (M-08 Work) before submission");
      }
      if (workId) {
        const [w] = await db.select({ id: works.id, yardId: works.yardId }).from(works).where(eq(works.id, workId)).limit(1);
        if (!w) return sendApiError(res, 400, "FLEET_WORK_NOT_FOUND", "Linked work order not found");
        if (!vehicleInScope(req, w.yardId)) return sendApiError(res, 403, "FLEET_WORK_YARD_DENIED", "You do not have access to the linked work order yard");
      }

      const id = nanoid();
      await db.insert(vehicleMaintenance).values({
        id,
        vehicleId,
        maintenanceType: String(body.maintenanceType ?? ""),
        serviceDate,
        odometerReadingKm,
        description: body.description ? String(body.description) : null,
        cost,
        vendorName: body.vendorName ? String(body.vendorName) : null,
        invoiceNo: body.invoiceNo ? String(body.invoiceNo) : null,
        invoiceDocs: null,
        workId,
        isEmergency: body.isEmergency != null ? Boolean(body.isEmergency) : false,
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
