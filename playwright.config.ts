import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running Vakta server (pnpm dev) with the demo
 * company seeded (pnpm db:seed). Start them with: pnpm test:e2e
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
