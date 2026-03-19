/**
 * Auth API: login against gapmc.users (M-10), session, me, logout.
 * Login and me return full AuthUser including permissions (from role_permissions).
 */
import type { Express } from "express";
import { compare } from "bcryptjs";
import { loadAuthUser } from "./auth";
import { findUserForLogin } from "./auth-login-lookup";

export function registerAuthRoutes(app: Express) {
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
        return res.status(400).json({ error: "email (or username) and password required" });
      }
      const lower = identifier.toLowerCase();
      const { user, ambiguousLocalPart } = await findUserForLogin(lower);
      if (ambiguousLocalPart) {
        return res.status(401).json({
          error: "Several accounts share that short name; sign in with your full email address.",
        });
      }
      if (!user) {
        return res.status(401).json({ error: "Invalid email/username or password" });
      }
      if (!user.isActive) {
        return res.status(401).json({ error: "Account is inactive" });
      }
      if (!user.passwordHash) {
        return res.status(401).json({ error: "Invalid email/username or password" });
      }
      const match = await compare(password, user.passwordHash);
      if (!match) {
        return res.status(401).json({ error: "Invalid email/username or password" });
      }
      req.session.userId = user.id;
      req.session.save(async (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Login failed" });
        }
        const authUser = await loadAuthUser(user.id);
        if (!authUser) return res.status(500).json({ error: "Login failed" });
        res.json({ user: authUser });
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json({ user: req.user });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Logout failed" });
      }
      res.clearCookie("gapmc.sid");
      res.json({ ok: true });
    });
  });
}
