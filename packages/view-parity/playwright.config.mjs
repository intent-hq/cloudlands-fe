import { defineConfig } from "@playwright/test";
import path from "node:path";

const output = process.env.PARITY_RUN_DIR;
if (!output)
  throw new Error(
    "Use the package scripts to create a fresh evidence directory. See pnpm --filter @intent/view-parity help.",
  );

export default defineConfig({
  testDir: "./tests",
  outputDir: path.join(output, "tests"),
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  failOnFlakyTests: true,
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(output, "results.json") }],
    ["html", { outputFolder: path.join(output, "html"), open: "never" }],
  ],
  use: {
    browserName: "chromium",
    viewport: { width: 420, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "parity", testMatch: "parity.spec.mjs" },
    { name: "core", testMatch: ["core.spec.mjs", "*.core.spec.mjs"] },
    { name: "extended", testMatch: ["extended.spec.mjs", "*.extended.spec.mjs"] },
  ],
});
