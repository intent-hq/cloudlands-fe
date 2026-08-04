#!/usr/bin/env node
/**
 * Ensure the dev Electron.app Info.plist carries
 * NSSpeechRecognitionUsageDescription so OS dictation works under `make dev`.
 *
 * Packaged builds get the key via electron-builder.yml `extendInfo`, but dev
 * runs use the stock Electron binary (node_modules/electron/dist/Electron.app)
 * whose Info.plist lacks it. macOS attributes TCC responsibility for the
 * spawned intent-speech-helper to that parent app, so SFSpeechRecognizer
 * authorization SIGABRTs the helper with a TCC termination the moment
 * dictation runs (see DiagnosticReports: "namespace":"TCC",
 * NSSpeechRecognitionUsageDescription missing).
 *
 * Idempotent: skips when the key is already present. After inserting the key
 * the app is re-signed ad-hoc so the modified Info.plist does not leave a
 * broken code seal; a codesign failure only warns (fail-soft) — dev Electron
 * still launches with a broken seal, and dev-launcher.mjs already rewrites
 * this same plist per-launch for the dock name without re-signing. Note the
 * launcher restores its pre-launch plist snapshot on exit, which may drop
 * this key again — this script runs inside dev:base / dev:cdp:base
 * (package.json) on every dev start, so the key is always re-applied before
 * Electron launches.
 *
 * macOS-only; exits 0 (no-op) on other platforms or when the Electron
 * binary is not installed yet.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Same copy as electron-builder.yml extendInfo (packaged-app key).
const USAGE_DESCRIPTION =
  "Intent uses macOS speech recognition to transcribe your voice into text for dictation.";
const PLIST_KEY = "NSSpeechRecognitionUsageDescription";

const appPath = path.resolve(
  __dirname,
  "..",
  "node_modules/electron/dist/Electron.app",
);
const plistPath = path.join(appPath, "Contents/Info.plist");

if (process.platform !== "darwin") {
  process.exit(0);
}

if (!fs.existsSync(plistPath)) {
  console.log("Dev Electron not installed; skipping speech plist patch.");
  process.exit(0);
}

function hasKey() {
  try {
    execFileSync("plutil", ["-extract", PLIST_KEY, "raw", plistPath], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

if (hasKey()) {
  console.log(`Dev Electron Info.plist already has ${PLIST_KEY}.`);
  process.exit(0);
}

console.log(`Adding ${PLIST_KEY} to dev Electron Info.plist...`);
execFileSync(
  "plutil",
  ["-insert", PLIST_KEY, "-string", USAGE_DESCRIPTION, plistPath],
  { stdio: "inherit" },
);

// Re-seal the bundle so the plist edit doesn't leave an invalid signature.
try {
  execFileSync("codesign", ["-f", "-s", "-", appPath], { stdio: "ignore" });
  console.log("Dev Electron re-signed ad-hoc after plist patch.");
} catch {
  console.warn(
    "Warning: ad-hoc re-sign of dev Electron failed after plist patch; continuing.",
  );
}
