import { defineConfig, devices } from "@playwright/test";

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  use: { baseURL: "http://localhost:4173", locale: "id-ID", timezoneId: "Asia/Jakarta" },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 17 Pro"] } },
    { name: "iphone-dark", use: { ...devices["iPhone 17 Pro"], colorScheme: "dark" } },
    { name: "ipad-portrait", use: { ...devices["iPad Mini"] } },
    { name: "ipad-landscape", use: { ...devices["iPad Pro 11 landscape"] } },
    { name: "desktop-safari", use: { ...devices["Desktop Safari"], ...desktop } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], ...desktop } },
  ],
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
