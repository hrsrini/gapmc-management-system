/**
 * Auth middleware: resolve user from session and attach to req.
 * Loads user roles and permissions (from role_permissions); ADMIN role gets all permissions.
 */
import type { Request, Response, NextFunction } from "express";
import { sendApiError } from "./api-errors";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { users, employees, userRoles, roles, userYards, rolePermissions, permissions } from "@shared/db-schema";
import { ensureEmployeeRecordForUser } from "./ensure-user-employee";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Employee master row (SRS §1.4); required for every app user. */
  employeeId: string;
  /** Human-readable employee code from master, when set. */
  employeeEmpId: string | null;
  roles: { id: string; tier: string; name: string }[];
  yardIds: string[];
  /** Resolved from role_permissions + permissions; used for permission checks. */
  permissions: { module: string; action: string }[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      scopedLocationIds?: string[];
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

/** M-05: public receipt verification page + QR image (no login). */
export function isPublicReceiptVerificationPath(path: string, method: string): boolean {
  if (process.env.PUBLIC_RECEIPT_VERIFY_ENABLED === "false") return false;
  if (method !== "GET") return false;
  if (path.startsWith("/api/ioms/receipts/verify/")) return true;
  if (path === "/api/ioms/receipts/public/qr") return true;
  return false;
}

function isPublicApi(path: string, method: string): boolean {
  if (path === "/api/health" && method === "GET") return true;
  if (path === "/api/auth/login" && method === "POST") return true;
  if (isPublicReceiptVerificationPath(path, method)) return true;
  return false;
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  await ensureEmployeeRecordForUser(userId);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive) return null;
  if (!user.employeeId) {
    console.warn(
      `[auth] User ${userId} has no employee_id after ensure (e.g. no locations in DB); session denied.`,
    );
    return null;
  }
  const [emp] = await db
    .select({ id: employees.id, empId: employees.empId })
    .from(employees)
    .where(eq(employees.id, user.employeeId))
    .limit(1);
  if (!emp) {
    console.warn(`[auth] User ${userId} points to missing employee ${user.employeeId}; session denied.`);
    return null;
  }
  const roleRows = await db
    .select({ roleId: userRoles.roleId, tier: roles.tier, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id));
  const yardRows = await db.select({ yardId: userYards.yardId }).from(userYards).where(eq(userYards.userId, user.id));
  const roleIds = roleRows.map((r) => r.roleId);
  const isAdmin = roleRows.some((r) => r.tier === "ADMIN");

  let permList: { module: string; action: string }[] = [];
  if (isAdmin) {
    const allPerms = await db.select({ module: permissions.module, action: permissions.action }).from(permissions);
    permList = allPerms.map((p) => ({ module: p.module, action: p.action }));
  } else if (roleIds.length > 0) {
    const rpRows = await db
      .select({ module: permissions.module, action: permissions.action })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(rolePermissions.roleId, roleIds));
    const seen = new Set<string>();
    for (const p of rpRows) {
      const key = `${p.module}:${p.action}`;
      if (!seen.has(key)) {
        seen.add(key);
        permList.push({ module: p.module, action: p.action });
      }
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    employeeId: user.employeeId,
    employeeEmpId: emp.empId ?? null,
    roles: roleRows.map((r) => ({ id: r.roleId, tier: r.tier, name: r.name })),
    yardIds: yardRows.map((y) => y.yardId),
    permissions: permList,
  };
}

export async function requireAuthApi(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }
  if (isPublicApi(req.path, req.method)) {
    next();
    return;
  }
  const userId = req.session?.userId;
  if (!userId) {
    sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    return;
  }
  try {
    const user = await loadAuthUser(userId);
    if (!user) {
      (req.session as any) = null;
      sendApiError(res, 401, "AUTH_SESSION_INVALID", "Session invalid");
      return;
    }
    req.user = user;
    req.scopedLocationIds = user.yardIds;
    next();
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, "INTERNAL_ERROR", "Auth failed");
  }
}

/** Use after requireAuthApi. Returns 403 if user has none of the given role tiers (e.g. "ADMIN", "DA"). */
export function requireRole(...allowedTiers: string[]) {
  const set = new Set(allowedTiers);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      return;
    }
    const hasRole = req.user.roles.some((r) => set.has(r.tier));
    if (!hasRole) {
      sendApiError(res, 403, "AUTH_ROLE_DENIED", "Insufficient permissions");
      return;
    }
    next();
  };
}

/** Check if user has a specific permission (module + action). ADMIN tier is not auto-granted here; use permissions from loadAuthUser (ADMIN gets all). */
export function hasPermission(user: AuthUser | undefined, module: string, action: string): boolean {
  if (!user?.permissions?.length) return false;
  return user.permissions.some((p) => p.module === module && p.action === action);
}

/** Use after requireAuthApi. Returns 403 if user does not have the given permission (module:action). */
export function requirePermission(module: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      return;
    }
    if (!hasPermission(req.user, module, action)) {
      sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: `${module}:${action}` });
      return;
    }
    next();
  };
}

const METHOD_TO_ACTION: Record<string, string> = {
  GET: "Read",
  POST: "Create",
  PUT: "Update",
  PATCH: "Update",
  DELETE: "Delete",
};

/** Map API path prefix to module code (M-01 .. M-10). Returns null if path is not tied to a single module. */
export function getModuleForPath(path: string): string | null {
  /** Bug tracking: all authenticated users; not tied to IOMS module permissions. */
  if (path.startsWith("/api/bugs")) return null;
  /** Reference data: Tally catalogue, GST exempt categories (read-only for any logged-in user). */
  if (path.startsWith("/api/ioms/reference")) return null;
  /** Read-only merged system defaults for any logged-in user (Admin edits via /api/admin/config). */
  if (path.startsWith("/api/system")) return null;
  if (path.startsWith("/api/hr")) return "M-01";
  if (path.startsWith("/api/ioms/rent")) return "M-03";
  if (path.startsWith("/api/ioms/receipts") || path.startsWith("/api/ioms/reports/tally-export")) return "M-05";
  if (
    path.startsWith("/api/ioms/traders") ||
    path.startsWith("/api/ioms/assets") ||
    path.startsWith("/api/ioms/asset-allotments") ||
    path.startsWith("/api/ioms/msp-settings")
  )
    return "M-02";
  if (
    path.startsWith("/api/ioms/commodities") ||
    path.startsWith("/api/ioms/market") ||
    path.startsWith("/api/ioms/farmers") ||
    path.startsWith("/api/ioms/checkpost")
  )
    return "M-04";
  if (
    path.startsWith("/api/ioms/expenditure-heads") ||
    path.startsWith("/api/ioms/vouchers") ||
    path.startsWith("/api/ioms/advances")
  )
    return "M-06";
  if (path.startsWith("/api/ioms/fleet")) return "M-07";
  if (
    path.startsWith("/api/ioms/works") ||
    path.startsWith("/api/ioms/amc") ||
    path.startsWith("/api/ioms/land-records") ||
    path.startsWith("/api/ioms/fixed-assets")
  )
    return "M-08";
  if (path.startsWith("/api/ioms/dak")) return "M-09";
  if (path.startsWith("/api/ioms/reports")) return "M-05";
  if (path.startsWith("/api/traders")) return "M-02";
  if (path.startsWith("/api/invoices")) return "M-03";
  if (path.startsWith("/api/receipts")) return "M-05";
  if (path.startsWith("/api/agreements")) return "M-02";
  if (path.startsWith("/api/marketfees") || path.startsWith("/api/stockreturns")) return "M-04";
  return null;
}

/** Use after requireAuthApi. For all /api (except auth, health, admin), requires module permission by path and method. ADMIN full access; READ_ONLY only Read. */
export function requireModulePermissionByPath(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api")) return next();
  if (req.path.startsWith("/api/auth") || req.path.startsWith("/api/health")) return next();
  if (req.path.startsWith("/api/admin")) return next();
  if (isPublicReceiptVerificationPath(req.path, req.method)) return next();
  const module = getModuleForPath(req.path);
  if (!module) return next();
  if (!req.user) {
    sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    return;
  }
  if (req.user.roles.some((r) => r.tier === "ADMIN")) return next();
  // M-01 BR-EMP-06: DA assigns EMP-NNN via dedicated route (POST would otherwise require M-01:Create).
  if (
    req.method === "POST" &&
    /^\/api\/hr\/employees\/[^/]+\/approve-registration$/.test(req.path)
  ) {
    if (req.user.roles.some((r) => r.tier === "DA") || hasPermission(req.user, "M-01", "Approve")) {
      return next();
    }
    sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: "M-01:Approve or DA role" });
    return;
  }
  const action = METHOD_TO_ACTION[req.method] ?? "Read";
  if (!hasPermission(req.user, module, action)) {
    sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: `${module}:${action}` });
    return;
  }
  next();
}

/** Use after requireAuthApi. For /api/admin/*, requires M-10 permission for the request method. ADMIN tier always allowed. */
export function requireAdminPermissionByMethod(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    return;
  }
  // ADMIN tier: full access regardless of permission matrix
  if (req.user.roles.some((r) => r.tier === "ADMIN")) {
    return next();
  }
  const action = METHOD_TO_ACTION[req.method] ?? "Read";
  if (!hasPermission(req.user, "M-10", action)) {
    sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "Insufficient permissions", { required: `M-10:${action}` });
    return;
  }
  next();
}
