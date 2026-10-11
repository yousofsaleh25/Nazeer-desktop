import { defineConfig } from "@playwright/test";

// Electron e2e: the specs launch the built app (out/) with Playwright's _electron.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: { trace: "retain-on-failure" },
});
