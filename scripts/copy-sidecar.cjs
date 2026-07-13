#!/usr/bin/env node
/**
 * Cross-platform script to copy the intentd binary into the electron-builder
 * resources staging directory for packaging.
 *
 * The packaged binary will land at `process.resourcesPath/intentd/intentd` at runtime
 * (intentd.exe on Windows), matching the path contract in
 * src/features/backend/main/intentd-sidecar.ts::resolveIntentdBinaryPath.
 *
 * macOS signing: the bundled binary is signed/notarized by electron-builder's afterSign
 * hook (scripts/notarize.js) along with the rest of the app bundle. No separate signing
 * step is required here.
 */
const fs = require("fs");
const path = require("path");

const FE_DIR = path.resolve(__dirname, "..");
const MONOREPO_DIR = path.resolve(FE_DIR, "../..");

// Source: packages/intentd/target/release/intentd (or INTENTD_BIN override)
const defaultSourceBin = path.join(
  MONOREPO_DIR,
  "packages/intentd/target/release",
  process.platform === "win32" ? "intentd.exe" : "intentd"
);
const sourceBin = process.env.INTENTD_BIN?.trim() || defaultSourceBin;

// Destination: packages/cloudlands-fe/resources/sidecar/intentd (staging dir, gitignored)
const destDir = path.join(FE_DIR, "resources/sidecar");
const ext = process.platform === "win32" ? ".exe" : "";
const destBin = path.join(destDir, `intentd${ext}`);

if (!fs.existsSync(sourceBin)) {
  console.error(`Error: intentd binary not found at ${sourceBin}`);
  console.error("Build it first: cd packages/intentd && cargo build --release");
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(sourceBin, destBin);

// Make executable on Unix
if (process.platform !== "win32") {
  fs.chmodSync(destBin, 0o755);
}

console.log(`Copied intentd binary to ${destBin}`);
console.log(`Source: ${sourceBin}`);
