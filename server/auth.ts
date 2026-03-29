/**
 * Auth middleware: resolve user from session and attach to req.
 * Loads user roles and permissions (from role_permissions); ADMIN role gets all permissions.
 */
import type { Request, Response, NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { users, userRoles, roles, userYards, rolePermissions, permissions } from "@shared/db-schema";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
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

function isPublicApi(path: string, method: string): boolean {
  if (path === "/api/health" && method === "GET") return true;
  if (path === "/api/auth/login" && method === "POST") return true;
  return false;
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive) return null;
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
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const user = await loadAuthUser(userId);
    if (!user) {
      (req.session as any) = null;
      res.status(401).json({ error: "Session invalid" });
      return;
    }
    req.user = user;
    req.scopedLocationIds = user.yardIds;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Auth failed" });
  }
}

/** Use after requireAuthApi. Returns 403 if user has none of the given role tiers (e.g. "ADMIN", "DA"). */
export function requireRole(...allowedTiers: string[]) {
  const set = new Set(allowedTiers);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const hasRole = req.user.roles.some((r) => set.has(r.tier));
    if (!hasRole) {
      res.status(403).json({ error: "Insufficient permissions" });
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
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!hasPermission(req.user, module, action)) {
      res.status(403).json({ error: "Insufficient permissions", required: `${module}:${action}` });
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
  /** Read-only merged system defaults for any logged-in user (Admin edits via /api/admin/config). */
  if (path.startsWith("/api/system")) return null;
  if (path.startsWith("/api/hr")) return "M-01";
  if (path.startsWith("/api/ioms/rent")) return "M-03";
  if (path.startsWith("/api/ioms/receipts")) return "M-05";
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
  const module = getModuleForPath(req.path);
  if (!module) return next();
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.roles.some((r) => r.tier === "ADMIN")) return next();
  const action = METHOD_TO_ACTION[req.method] ?? "Read";
  if (!hasPermission(req.user, module, action)) {
    res.status(403).json({ error: "Insufficient permissions", required: `${module}:${action}` });
    return;
  }
  next();
}

/** Use after requireAuthApi. For /api/admin/*, requires M-10 permission for the request method. ADMIN tier always allowed. */
export function requireAdminPermissionByMethod(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // ADMIN tier: full access regardless of permission matrix
  if (req.user.roles.some((r) => r.tier === "ADMIN")) {
    return next();
  }
  const action = METHOD_TO_ACTION[req.method] ?? "Read";
  if (!hasPermission(req.user, "M-10", action)) {
    res.status(403).json({ error: "Insufficient permissions", required: `M-10:${action}` });
    return;
  }
  next();
}
