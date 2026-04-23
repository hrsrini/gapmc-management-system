import { test, expect } from "@playwright/test";
import { adminEmail, adminPasswordCandidates } from "../helpers/auth";

test("POST /api/auth/login returns user with employeeId", async ({ request }) => {
  let lastStatus = 0;
  let lastBody = "";
  for (const password of adminPasswordCandidates()) {
    const res = await request.post("/api/auth/login", {
      data: { email: adminEmail(), password },
    });
    lastStatus = res.status();
    lastBody = await res.text();
    if (res.ok()) {
      const json = JSON.parse(lastBody) as { user?: { employeeId?: string } };
      expect(json.user?.employeeId, "employee master must be linked").toBeTruthy();
      return;
    }
  }
  throw new Error(
    `login failed after ${adminPasswordCandidates().length} attempt(s). Last HTTP ${lastStatus}: ${lastBody}`,
  );
});
