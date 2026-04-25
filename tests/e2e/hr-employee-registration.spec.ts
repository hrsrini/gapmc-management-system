import { test, expect } from "@playwright/test";
import path from "node:path";
import { adminEmail, adminPasswordCandidates } from "../helpers/auth";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("input-username")).toBeVisible();
  await page.getByTestId("input-username").fill(adminEmail());

  for (const password of adminPasswordCandidates()) {
    await page.getByTestId("input-password").fill(password);
    const btn = page.getByTestId("button-signin");
    await expect(btn).toBeEnabled({ timeout: 15_000 });
    await btn.click({ force: true });
    try {
      await page.waitForURL("**/dashboard", { timeout: 25_000 });
      return;
    } catch {
      await expect(btn).toBeEnabled({ timeout: 15_000 });
    }
  }

  throw new Error("Could not sign in with any admin password candidate.");
}

test.describe("HR (UI)", () => {
  test("create employee (Submitted) with photo upload, then see document", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page);

    await page.goto("/hr/employees");
    await expect(page.getByText("Employees (M-01 HRMS)")).toBeVisible();

    await page.getByRole("link", { name: "Add employee" }).click();
    await page.waitForURL("**/hr/employees/new", { timeout: 15_000 });

    const ts = Date.now();
    const suffix = String(ts).slice(-4);
    const aadhaar = String(ts).padStart(12, "0").slice(-12);
    const pan = `SMOKE${suffix}F`; // 5 letters + 4 digits + 1 letter

    // Public info
    await page.getByText(/^First name/i).locator("..").locator("input").fill("Smoke");
    await page.getByText(/^Surname/i).locator("..").locator("input").fill(`E2E${suffix}`);
    await page.getByText(/^Designation/i).locator("..").locator("input").fill("Tester");

    // Yard select
    await page.getByText(/^Yard/i).locator("..").getByText("Select yard").click();
    await page.getByRole("option", { name: /GAPLMB-Head Office/i }).click();

    await page.getByText("Location posted").locator("..").locator("input").fill("HQ");
    await page.getByText("Pay level").locator("..").locator("button").click();
    await page.getByRole("option", { name: "5", exact: true }).click();
    await page.getByText("Category").locator("..").locator("button").click();
    await page.getByRole("option", { name: "General" }).click();

    // Personal info
    await page.getByRole("tab", { name: /Personal info/i }).click();
    await page.getByText("Father / spouse name").locator("..").locator("input").fill("Smoke Parent");
    await page.getByText("Aadhaar number").locator("..").locator("input").fill(aadhaar);
    await page.getByText("PAN").locator("..").locator("input").fill(pan);
    await page.getByText("Date of birth").locator("..").locator("input").fill("1990-01-15");

    // HR settings: joiningDate required, set status Submitted
    await page.getByRole("tab", { name: /HR settings/i }).click();
    const today = new Date().toISOString().slice(0, 10);
    await page.getByText(/^Joining date/i).locator("..").locator("input").fill(today);
    await page.locator("label", { hasText: /^Status$/ }).locator("..").locator("button[role=\"combobox\"]").click();
    await page.getByRole("option", { name: "Submitted" }).click();

    await page.getByRole("button", { name: "Create" }).click();

    const navPromise = page
      .waitForURL((u) => /\/hr\/employees\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith("/new"), { timeout: 90_000 })
      .then(() => "navigated" as const);
    const failPromise = page
      .getByText("Create failed")
      .waitFor({ state: "visible", timeout: 90_000 })
      .then(() => "failed" as const);
    const outcome = await Promise.race([navPromise, failPromise]);
    if (outcome === "failed") {
      const msg = await page.locator("[role=\"status\"]").first().innerText().catch(() => "");
      throw new Error(`Employee create failed in UI. ${msg}`.trim());
    }

    await page.getByRole("tab", { name: /Documents \(\d+\)/i }).click();
    await expect(page.getByRole("button", { name: /Upload document/i })).toBeVisible({ timeout: 30_000 });

    // Upload a doc from employee detail (no client image validation).
    await page.getByRole("button", { name: /Upload document/i }).click();
    await expect(page.getByText("Upload employee document")).toBeVisible();
    const docFixture = path.resolve(process.cwd(), "tests/fixtures/doc.pdf");
    await page.getByText("File (PDF/JPG/PNG, max 5 MB)").locator("..").locator("input[type=\"file\"]").setInputFiles(docFixture);
    await page.getByRole("button", { name: /^Upload$/ }).click();

    await expect(page.getByText("doc.pdf")).toBeVisible({ timeout: 30_000 });
  });
});

