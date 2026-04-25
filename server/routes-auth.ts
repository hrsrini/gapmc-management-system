/**
 * Auth API: login against gapmc.users (M-10), session, me, logout.
 * Login and me return full AuthUser including permissions (from role_permissions).
 *
 * Login + logout are registered *before* requireAuthApi (see routes.ts) so they are not
 * affected by auth middleware ordering. Login awaits session.save (Express 5 async safety).
 */
import type { Express, Request } from "express";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { sendApiError } from "./api-errors";
import { loadAuthUser, type AuthUser } from "./auth";
import { findUserForLogin } from "./auth-login-lookup";
import { db } from "./db";
import { employees, roles, userRoles, users } from "@shared/db-schema";
import speakeasy from "speakeasy";
import { getMergedSystemConfig } from "./system-config";

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/** Plain JSON shape for the client (explicit fields + snake_case mirrors for older clients). */
function authUserToJson(u: AuthUser) {
  const employeeId = u.employeeId;
  const employeeEmpId = u.employeeEmpId ?? null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    employeeId,
    employee_id: employeeId,
    employeeEmpId,
    employee_emp_id: employeeEmpId,
    roles: u.roles,
    yardIds: u.yardIds,
    permissions: u.permissions,
  };
}

/** POST /api/auth/login, POST /api/auth/logout — no requireAuthApi (public / session-only). */
export function registerPublicAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req, res) => {
    try {
      const body = req.body ?? {};
      const passwordRaw = body.password;
      const password = typeof passwordRaw === "string" ? passwordRaw : passwordRaw != null ? String(passwordRaw) : "";
      const identifier =
        typeof body.login === "string"
          ? body.login.trim()
          : typeof body.email === "string"
            ? body.email.trim()
            : "";
      const mfaCode = body.mfaCode != null ? String(body.mfaCode).trim().replace(/\s/g, "") : "";
      if (!identifier || password === "") {
        return sendApiError(res, 400, "AUTH_LOGIN_FIELDS_REQUIRED", "email (or username) and password required");
      }
      const lower = identifier.toLowerCase();
      const { user, ambiguousLocalPart } = await findUserForLogin(lower);
      if (ambiguousLocalPart) {
        return sendApiError(
          res,
          401,
          "AUTH_LOGIN_AMBIGUOUS_IDENTIFIER",
          "Several accounts share that short name; sign in with your full email address.",
        );
      }
      if (!user) {
        return sendApiError(res, 401, "AUTH_LOGIN_INVALID", "Invalid email/username or password");
      }
      if (!user.isActive) {
        return sendApiError(res, 401, "AUTH_LOGIN_INACTIVE", "Account is inactive");
      }
      if (!user.passwordHash) {
        return sendApiError(res, 401, "AUTH_LOGIN_INVALID", "Invalid email/username or password");
      }
      const match = await compare(password, user.passwordHash);
      if (!match) {
        return sendApiError(res, 401, "AUTH_LOGIN_INVALID", "Invalid email/username or password");
      }
      if (user.employeeId) {
        const [emp] = await db
          .select({ status: employees.status })
          .from(employees)
          .where(eq(employees.id, user.employeeId))
          .limit(1);
        if (!emp || emp.status !== "Active") {
          return sendApiError(
            res,
            403,
            "AUTH_EMPLOYMENT_INACTIVE",
            "Your employment record is not active; sign-in is disabled (SRS §1.4).",
          );
        }
      }
      // US-M10-003: MFA for privileged roles (DA / ADMIN / ACCOUNTS) — feature-flagged via system config.
      const cfg = await getMergedSystemConfig();
      const mfaEnforced = String(cfg.mfa_privileged_enforced ?? "false").trim().toLowerCase() === "true";

      // When MFA is disabled, clear any stale MFA gating state to avoid trapping users.
      if (!mfaEnforced) {
        req.session.mfaPending = false;
        req.session.mfaVerified = false;
        req.session.mfaTempSecret = undefined;
      }

      // MFA enforcement off → continue with normal session login.
      if (!mfaEnforced) {
        req.session.userId = user.id;
        await saveSession(req);
        const authUser = await loadAuthUser(user.id);
        if (!authUser) {
          return sendApiError(
            res,
            403,
            "AUTH_EMPLOYEE_LINK_REQUIRED",
            "This account must be linked to an employee master record. Run: npm run db:seed-ioms-m10 (or ask an administrator).",
          );
        }
        if (typeof authUser.employeeId !== "string" || authUser.employeeId.length === 0) {
          console.error("[auth/login] loadAuthUser returned empty employeeId", { userId: user.id });
          return sendApiError(res, 500, "INTERNAL_ERROR", "Login failed");
        }
        return res.json({ user: authUserToJson(authUser) });
      }

      // MFA enabled
      const tiers = await db
        .select({ tier: roles.tier })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, user.id));
      const tierSet = new Set(tiers.map((t) => t.tier));
      const isPrivileged = tierSet.has("DA") || tierSet.has("ADMIN") || tierSet.has("ACCOUNTS");

      if (isPrivileged) {
        const [u] = await db
          .select({ mfaEnabled: users.mfaEnabled, mfaSecret: users.mfaSecret })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        const enrolled = Boolean(u?.mfaEnabled) && Boolean(u?.mfaSecret);
        if (!enrolled) {
          // Create a limited session to allow enrollment endpoints only.
          req.session.userId = user.id;
          req.session.mfaPending = true;
          req.session.mfaVerified = false;
          await saveSession(req);
          return res.json({ mfaRequired: true, enrolled: false, message: "MFA enrollment required." });
        }
        if (!mfaCode) {
          return res.json({ mfaRequired: true, enrolled: true, message: "Enter your 6-digit authenticator code." });
        }
        const ok = speakeasy.totp.verify({
          secret: String(u!.mfaSecret),
          encoding: "base32",
          token: mfaCode,
          window: 1,
        });
        if (!ok) {
          return sendApiError(res, 401, "AUTH_MFA_INVALID", "Invalid MFA code");
        }
        req.session.mfaVerified = true;
        req.session.mfaPending = false;
      }

      req.session.userId = user.id;
      await saveSession(req);
      const authUser = await loadAuthUser(user.id);
      if (!authUser) {
        return sendApiError(
          res,
          403,
          "AUTH_EMPLOYEE_LINK_REQUIRED",
          "This account must be linked to an employee master record. Run: npm run db:seed-ioms-m10 (or ask an administrator).",
        );
      }
      if (typeof authUser.employeeId !== "string" || authUser.employeeId.length === 0) {
        console.error("[auth/login] loadAuthUser returned empty employeeId", { userId: user.id });
        return sendApiError(res, 500, "INTERNAL_ERROR", "Login failed");
      }
      return res.json({ user: authUserToJson(authUser) });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Login failed");
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
      });
      res.clearCookie("gapmc.sid");
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Logout failed");
    }
  });
}

/** US-M10-003: MFA enrollment / verification (requires session; allowed even when mfaPending=true). */
export function registerMfaRoutes(app: Express) {
  app.post("/api/auth/mfa/setup", async (req, res) => {
    try {
      const cfg = await getMergedSystemConfig();
      const mfaEnforced = String(cfg.mfa_privileged_enforced ?? "false").trim().toLowerCase() === "true";
      if (!mfaEnforced) {
        return sendApiError(res, 400, "AUTH_MFA_DISABLED", "MFA is disabled by system configuration.");
      }
      const uid = req.session?.userId;
      if (!uid) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const [u] = await db.select({ email: users.email, mfaEnabled: users.mfaEnabled }).from(users).where(eq(users.id, uid)).limit(1);
      if (!u) return sendApiError(res, 404, "AUTH_USER_NOT_FOUND", "User not found");
      const secret = speakeasy.generateSecret({ name: `GAPMC IOMS (${u.email})`, length: 20 });
      req.session.mfaTempSecret = secret.base32;
      req.session.mfaPending = true;
      req.session.mfaVerified = false;
      await saveSession(req);
      return res.json({
        otpauthUrl: secret.otpauth_url,
        secretBase32: secret.base32,
        message: "Scan the QR (otpauth URL) in an authenticator app, then verify using /api/auth/mfa/verify.",
      });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to start MFA setup");
    }
  });

  app.post("/api/auth/mfa/verify", async (req, res) => {
    try {
      const cfg = await getMergedSystemConfig();
      const mfaEnforced = String(cfg.mfa_privileged_enforced ?? "false").trim().toLowerCase() === "true";
      if (!mfaEnforced) {
        return sendApiError(res, 400, "AUTH_MFA_DISABLED", "MFA is disabled by system configuration.");
      }
      const uid = req.session?.userId;
      if (!uid) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const secret = req.session.mfaTempSecret;
      if (!secret) return sendApiError(res, 400, "AUTH_MFA_SETUP_REQUIRED", "Start MFA setup first");
      const token = req.body?.code != null ? String(req.body.code).trim().replace(/\s/g, "") : "";
      if (!token) return sendApiError(res, 400, "AUTH_MFA_CODE_REQUIRED", "MFA code required");
      const ok = speakeasy.totp.verify({ secret, encoding: "base32", token, window: 1 });
      if (!ok) return sendApiError(res, 401, "AUTH_MFA_INVALID", "Invalid MFA code");
      const ts = new Date().toISOString();
      await db.update(users).set({ mfaEnabled: true, mfaSecret: secret, mfaVerifiedAt: ts, updatedAt: ts }).where(eq(users.id, uid));
      req.session.mfaTempSecret = undefined;
      req.session.mfaPending = false;
      req.session.mfaVerified = true;
      await saveSession(req);
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to verify MFA");
    }
  });
}

/** GET /api/auth/me — must run after requireAuthApi (sets req.user). */
export function registerAuthMeRoute(app: Express) {
  app.get("/api/auth/me", (req, res) => {
    if (!req.user) {
      return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    }
    return res.json({ user: authUserToJson(req.user) });
  });
}
