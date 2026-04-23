import { test, expect } from "@playwright/test";
import { adminEmail, adminPasswordCandidates } from "../helpers/auth";

test.describe("Login (UI)", () => {
  test("sign in and land on dashboard", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");

    await expect(page.getByTestId("input-username")).toBeVisible();
    await page.getByTestId("input-username").fill(adminEmail());

    let signedIn = false;
    for (const password of adminPasswordCandidates()) {
      await page.getByTestId("input-password").fill(password);
      const btn = page.getByTestId("button-signin");
      await expect(btn).toBeEnabled({ timeout: 15_000 });
      await btn.click({ force: true });
      try {
        await page.waitForURL("**/dashboard", { timeout: 25_000 });
        signedIn = true;
        break;
      } catch {
        await expect(btn).toBeEnabled({ timeout: 15_000 });
      }
    }

    expect(signedIn, "expected redirect to /dashboard after successful login").toBe(true);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Dashboard").first()).toBeVisible();
  });
});
