#!/usr/bin/env node
/**
 * Compile the macOS speech transcription helper (resources/speech/transcribe.swift)
 * into the packaging staging dir resources/speech-helper/intent-speech-helper.
 *
 * macOS-only: on other platforms (and when swiftc is missing) this exits 0
 * without producing a binary — the packaged app then reports the OS dictation
 * engine as unavailable at runtime (voice-local.ipc.ts checks for the binary).
 *
 * Skips recompilation when the existing binary is newer than the source.
 * The staged binary is signed by the afterPack hook (scripts/sign-sidecar.js)
 * alongside the intentd sidecar, before the app seal is created.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FE_DIR = path.resolve(__dirname, "..");
const sourceFile = path.join(FE_DIR, "resources/speech/transcribe.swift");
const infoPlist = path.join(FE_DIR, "resources/speech/helper-info.plist");
const destDir = path.join(FE_DIR, "resources/speech-helper");
const destBin = path.join(destDir, "intent-speech-helper");

if (process.platform !== "darwin") {
  console.log("Skipping speech helper build (macOS only).");
  process.exit(0);
}

try {
  execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
} catch {
  console.warn("Warning: swiftc not found — speech helper not built. OS dictation will be unavailable.");
  process.exit(0);
}

if (
  fs.existsSync(destBin) &&
  fs.statSync(destBin).mtimeMs > fs.statSync(sourceFile).mtimeMs &&
  fs.statSync(destBin).mtimeMs > fs.statSync(infoPlist).mtimeMs
) {
  console.log(`Speech helper up to date: ${destBin}`);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
console.log(`Compiling ${sourceFile} -> ${destBin}`);
// The embedded Info.plist carries NSSpeechRecognitionUsageDescription —
// SFSpeechRecognizer authorization aborts without it (see helper-info.plist).
execFileSync(
  "xcrun",
  [
    "swiftc",
    "-O",
    "-o",
    destBin,
    sourceFile,
    "-Xlinker",
    "-sectcreate",
    "-Xlinker",
    "__TEXT",
    "-Xlinker",
    "__info_plist",
    "-Xlinker",
    infoPlist,
  ],
  { stdio: "inherit" },
);
// Re-sign ad-hoc so the code signature covers the embedded Info.plist
// (TCC reads the usage description through the signature's plist slot; the
// default linker-signed signature records "Info.plist entries=0"). Release
// packaging replaces this with the Developer ID signature in the afterPack
// hook (scripts/sign-sidecar.js).
execFileSync("codesign", ["-f", "-s", "-", destBin], { stdio: "inherit" });
console.log("Speech helper built.");
