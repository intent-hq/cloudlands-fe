#!/usr/bin/env node
/**
 * Compile the macOS iCloud-keychain sync helper (resources/keychain/sync-helper.swift)
 * into the packaging staging dir resources/keychain-helper/ as a minimal .app
 * bundle: intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper.
 *
 * Why a bundle, unlike the bare speech helper: this helper uses the
 * data-protection keychain with kSecAttrSynchronizable, which requires the
 * RESTRICTED com.apple.application-identifier / keychain-access-groups
 * entitlements. Restricted entitlements are only honored when authorized by
 * an embedded Developer ID provisioning profile, and a profile can only be
 * embedded in a bundle (Contents/embedded.provisionprofile). The afterPack
 * hook (scripts/sign-sidecar.js) embeds the profile and signs with the
 * matching entitlements when KEYCHAIN_HELPER_PROVISIONING_PROFILE is set.
 *
 * macOS-only: on other platforms (and when swiftc is missing) this exits 0
 * without producing a bundle — keychain sync then reports "unavailable" at
 * runtime. Ad-hoc-signed dev builds run but the keychain rejects them with
 * errSecMissingEntitlement, which the helper maps to its structured
 * "unavailable" error — fail-soft by design.
 *
 * Skips recompilation when the existing binary is newer than the sources.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FE_DIR = path.resolve(__dirname, '..');
const sourceFile = path.join(FE_DIR, 'resources/keychain/sync-helper.swift');
const infoPlist = path.join(FE_DIR, 'resources/keychain/helper-info.plist');
const destDir = path.join(FE_DIR, 'resources/keychain-helper');
const bundleDir = path.join(destDir, 'intent-keychain-helper.app');
const bundlePlist = path.join(bundleDir, 'Contents', 'Info.plist');
const destBin = path.join(bundleDir, 'Contents', 'MacOS', 'intent-keychain-helper');

if (process.platform !== 'darwin') {
  console.log('Skipping keychain helper build (macOS only).');
  process.exit(0);
}

try {
  execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' });
} catch {
  console.warn(
    'Warning: swiftc not found — keychain helper not built. Keychain sync will be unavailable.',
  );
  process.exit(0);
}

if (
  fs.existsSync(destBin) &&
  fs.existsSync(bundlePlist) &&
  fs.statSync(destBin).mtimeMs > fs.statSync(sourceFile).mtimeMs &&
  fs.statSync(destBin).mtimeMs > fs.statSync(infoPlist).mtimeMs &&
  fs.statSync(destBin).mtimeMs > fs.statSync(__filename).mtimeMs
) {
  console.log(`Keychain helper up to date: ${destBin}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(destBin), { recursive: true });
console.log(`Compiling ${sourceFile} -> ${destBin}`);
execFileSync('xcrun', ['swiftc', '-O', '-o', destBin, sourceFile], { stdio: 'inherit' });
fs.copyFileSync(infoPlist, bundlePlist);
// Ad-hoc sign the bundle so it runs locally in dev. Without the restricted
// entitlements the data-protection keychain rejects it and the helper reports
// "unavailable"; release packaging replaces this with the Developer ID
// signature + embedded provisioning profile in the afterPack hook
// (scripts/sign-sidecar.js).
execFileSync('codesign', ['-f', '-s', '-', bundleDir], { stdio: 'inherit' });
console.log('Keychain helper built.');
