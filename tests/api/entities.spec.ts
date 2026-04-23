import { test, expect } from "@playwright/test";
import { adminEmail, adminPasswordCandidates } from "../helpers/auth";

test("GET /api/ioms/entities after login", async ({ request }) => {
  let ok = false;
  for (const password of adminPasswordCandidates()) {
    const login = await request.post("/api/auth/login", {
      data: { email: adminEmail(), password },
    });
    if (login.ok()) {
      ok = true;
      break;
    }
  }
  expect(ok).toBeTruthy();

  const res = await request.get("/api/ioms/entities");
  const text = await res.text();
  let body: { code?: string } = {};
  try {
    body = JSON.parse(text) as { code?: string };
  } catch {
    /* not JSON */
  }
  if (res.status() === 503 && body.code === "ENTITY_SCHEMA_MISSING") {
    test.skip(true, "Run npm run db:apply-m02-trackb-entities (or db:push) to create gapmc.entities.");
    return;
  }
  expect(res.ok(), text).toBeTruthy();
  const list = JSON.parse(text) as unknown[];
  expect(Array.isArray(list)).toBeTruthy();
});
