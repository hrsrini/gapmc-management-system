import { test, expect } from "@playwright/test";

test("GET /api/health", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ status: "ok", database: "ok" });
});
