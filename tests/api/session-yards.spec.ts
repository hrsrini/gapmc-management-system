import { test, expect } from "@playwright/test";
import { adminEmail, adminPasswordCandidates } from "../helpers/auth";

test("GET /api/yards with session cookie", async ({ request }) => {
  let loggedIn = false;
  for (const password of adminPasswordCandidates()) {
    const login = await request.post("/api/auth/login", {
      data: { email: adminEmail(), password },
    });
    if (login.ok()) {
      loggedIn = true;
      break;
    }
  }
  expect(loggedIn, "admin login must succeed (set PW_ADMIN_PASSWORD if custom)").toBe(true);

  const yards = await request.get("/api/yards");
  expect(yards.ok(), await yards.text()).toBeTruthy();
  const list = await yards.json();
  expect(Array.isArray(list)).toBeTruthy();
});
