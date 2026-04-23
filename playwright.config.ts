import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const healthUrl = new URL("/api/health", `${baseURL}/`).href;

let serverPort = "5000";
try {
  const u = new URL(baseURL);
  serverPort = u.port || "5000";
} catch {
  /* keep 5000 */
}

const skipWebServer =
  process.env.PW_NO_WEBSERVER === "1" || String(process.env.PW_NO_WEBSERVER).toLowerCase() === "true";

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "api",
      testMatch: "**/api/**/*.spec.ts",
    },
    {
      name: "e2e",
      testMatch: "**/e2e/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: "npm run dev",
        url: healthUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          NODE_ENV: "development",
          PORT: serverPort,
        },
      },
});
