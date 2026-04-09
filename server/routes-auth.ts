/**
 * Auth API: login against gapmc.users (M-10), session, me, logout.
 * Login and me return full AuthUser including permissions (from role_permissions).
 *
 * Login + logout are registered *before* requireAuthApi (see routes.ts) so they are not
 * affected by auth middleware ordering. Login awaits session.save (Express 5 async safety).
 */
import type { Express, Request } from "express";
import { compare } from "bcryptjs";
import { sendApiError } from "./api-errors";
import { loadAuthUser, type AuthUser } from "./auth";
import { findUserForLogin } from "./auth-login-lookup";

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

/** GET /api/auth/me — must run after requireAuthApi (sets req.user). */
export function registerAuthMeRoute(app: Express) {
  app.get("/api/auth/me", (req, res) => {
    if (!req.user) {
      return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
    }
    return res.json({ user: authUserToJson(req.user) });
  });
}
