#!/usr/bin/env node
/**
 * Sidecar Signing Script for Electron Builder (afterPack hook)
 *
 * This script signs the intentd sidecar binary BEFORE electron-builder signs the main app.
 * It runs in the afterPack phase, after the app directory is assembled but before code signing.
 *
 * The problem it solves:
 * - macOS code signing creates a sealed signature for the entire .app bundle
 * - If we sign the sidecar AFTER the app is sealed (via mac.binaries), it modifies nested code
 *   and breaks the outer signature seal, causing "nested code is modified or invalid" errors
 * - By signing the sidecar BEFORE the app seal is created, it becomes part of the seal
 *
 * This hook is called automatically by electron-builder when configured in electron-builder.yml:
 *   afterPack: scripts/sign-sidecar.js
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Find the Developer ID Application signing identity from the keychain
 * @returns {Promise<string|null>} - Identity hash or null if none found
 */
async function findSigningIdentity() {
  try {
    const { stdout } = await execAsync('security find-identity -v -p codesigning');
    // Parse output like: 1) ABCD1234... "Developer ID Application: Name (TEAM)"
    // Extract the hash (40 hex chars) that appears before "Developer ID Application"
    const hashMatch = stdout.match(/\s+([0-9A-F]{40})\s+"Developer ID Application:/);
    if (hashMatch) {
      return hashMatch[1];
    }
    return null;
  } catch (error) {
    console.warn('  Could not query keychain:', error.message);
    return null;
  }
}

/**
 * Sign a binary with codesign
 * @param {string} binaryPath - Absolute path to the binary to sign
 * @param {string} identity - Code signing identity (certificate hash or name)
 * @returns {Promise<void>}
 */
async function signBinary(binaryPath, identity) {
  console.log(`  Signing: ${binaryPath}`);
  console.log(`  Identity: ${identity}`);

  // Sign with hardened runtime and secure timestamp
  // --force: replace any existing signature
  // --options runtime: enable hardened runtime (required for notarization)
  // --timestamp: add secure timestamp (required for Gatekeeper)
  const args = ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, binaryPath];

  try {
    const { stdout, stderr } = await execFileAsync('codesign', args);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log('  ✓ Signed successfully');
  } catch (error) {
    console.error('  ✗ Signing failed:', error.message);
    throw error;
  }
}

/**
 * Verify a binary's code signature
 * @param {string} binaryPath - Absolute path to the binary to verify
 * @returns {Promise<void>}
 */
async function verifySignature(binaryPath) {
  console.log(`  Verifying: ${binaryPath}`);

  const args = ['--verify', '--deep', '--strict', '--verbose=2', binaryPath];

  try {
    const { stdout, stderr } = await execFileAsync('codesign', args);
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr); // codesign outputs to stderr even on success
    console.log('  ✓ Verification passed');
  } catch (error) {
    console.error('  ✗ Verification failed:', error.message);
    throw error;
  }
}

/** Bundle ID of the keychain sync helper (resources/keychain/helper-info.plist). */
const KEYCHAIN_HELPER_BUNDLE_ID = 'dev.intentapp.cloudlands-fe.keychain-helper';

/**
 * Sign the iCloud-keychain sync helper bundle
 * (Resources/keychain-helper/intent-keychain-helper.app).
 *
 * The helper needs the RESTRICTED com.apple.application-identifier +
 * keychain-access-groups entitlements to use the data-protection keychain
 * (kSecUseDataProtectionKeychain / kSecAttrSynchronizable). macOS only honors
 * restricted entitlements when an embedded provisioning profile authorizes
 * them, so when KEYCHAIN_HELPER_PROVISIONING_PROFILE points at a Developer ID
 * provisioning profile for the helper's App ID this embeds it
 * (Contents/embedded.provisionprofile) and signs with matching entitlements
 * (team ID extracted from the profile). Without the profile the bundle is
 * signed plainly — it still runs, and the keychain rejects it with
 * errSecMissingEntitlement, which the helper reports as its structured
 * "unavailable" error (fail-soft).
 *
 * This signature must survive electron-builder's own signing pass, which
 * runs after afterPack and re-signs every nested bundle with the main app
 * entitlements. mac.signIgnore in electron-builder.yml excludes this bundle
 * from that pass so the entitlements written here are what ships.
 *
 * @param {string} bundlePath - Absolute path to intent-keychain-helper.app
 * @param {string} identity - Code signing identity
 */
async function signKeychainHelper(bundlePath, identity) {
  const profilePath = process.env.KEYCHAIN_HELPER_PROVISIONING_PROFILE;
  if (!profilePath || !fs.existsSync(profilePath)) {
    if (profilePath) {
      console.warn(`  KEYCHAIN_HELPER_PROVISIONING_PROFILE not found at ${profilePath}`);
    }
    console.log(
      '  No keychain-helper provisioning profile — signing without restricted entitlements ' +
        '(keychain sync will report "unavailable" at runtime).',
    );
    await signBinary(bundlePath, identity);
    await verifySignature(bundlePath);
    return;
  }

  console.log(`  Embedding provisioning profile: ${profilePath}`);
  fs.copyFileSync(profilePath, path.join(bundlePath, 'Contents', 'embedded.provisionprofile'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keychain-helper-sign-'));
  try {
    // Team ID comes from the profile itself so the entitlements always match
    // what the profile authorizes.
    const decodedProfile = path.join(tmpDir, 'profile.plist');
    await execFileAsync('security', ['cms', '-D', '-i', profilePath, '-o', decodedProfile]);
    const { stdout: teamRaw } = await execFileAsync('plutil', [
      '-extract',
      'TeamIdentifier.0',
      'raw',
      '-o',
      '-',
      decodedProfile,
    ]);
    const teamId = teamRaw.trim();
    if (!/^[A-Z0-9]{10}$/.test(teamId)) {
      throw new Error(`Could not extract a team ID from the provisioning profile (got "${teamId}")`);
    }

    const appIdentifier = `${teamId}.${KEYCHAIN_HELPER_BUNDLE_ID}`;
    const entitlementsPath = path.join(tmpDir, 'entitlements.plist');
    fs.writeFileSync(
      entitlementsPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.application-identifier</key>
  <string>${appIdentifier}</string>
  <key>com.apple.developer.team-identifier</key>
  <string>${teamId}</string>
  <key>keychain-access-groups</key>
  <array>
    <string>${appIdentifier}</string>
  </array>
</dict>
</plist>
`,
    );

    console.log(`  Signing with restricted keychain entitlements (team ${teamId}): ${bundlePath}`);
    await execFileAsync('codesign', [
      '--force',
      '--options',
      'runtime',
      '--timestamp',
      '--entitlements',
      entitlementsPath,
      '--sign',
      identity,
      bundlePath,
    ]);
    console.log('  ✓ Signed successfully');
    await verifySignature(bundlePath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * afterPack hook for electron-builder
 * @param {Object} context - electron-builder context
 */
async function signSidecar(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // Only sign on macOS
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping sidecar signing - not a macOS build');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const sidecarPath = path.join(appPath, 'Contents', 'Resources', 'intentd', 'intentd');
  // Optional macOS speech transcription helper (scripts/build-speech-helper.cjs);
  // absent when the staging build skipped it (no swiftc / non-mac packaging host).
  const speechHelperPath = path.join(
    appPath,
    'Contents',
    'Resources',
    'speech-helper',
    'intent-speech-helper',
  );
  // Optional iCloud-keychain sync helper bundle (scripts/build-keychain-helper.cjs);
  // absent when the staging build skipped it (no swiftc / non-mac packaging host).
  const keychainHelperBundlePath = path.join(
    appPath,
    'Contents',
    'Resources',
    'keychain-helper',
    'intent-keychain-helper.app',
  );

  console.log('=== Signing intentd sidecar (afterPack) ===');
  console.log(`App: ${appPath}`);
  console.log(`Sidecar: ${sidecarPath}`);

  // Check if the sidecar exists
  if (!fs.existsSync(sidecarPath)) {
    console.error(`ERROR: Sidecar not found at ${sidecarPath}`);
    throw new Error('intentd sidecar binary not found in app bundle');
  }

  // Resolve the signing identity
  // Priority: CSC_NAME env > auto-detect from keychain > fallback string
  let identity = process.env.CSC_NAME;

  if (!identity) {
    console.log('  CSC_NAME not set, detecting identity from keychain...');
    identity = await findSigningIdentity();

    if (identity) {
      console.log(`  Found identity: ${identity}`);
    } else {
      console.log('  No Developer ID Application certificate found in keychain');
      console.log('  Falling back to identity string "Developer ID Application"');
      identity = 'Developer ID Application';
    }
  }

  // Only skip if auto-discovery is disabled AND no explicit identity is set
  if (
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' &&
    !process.env.CSC_NAME &&
    !process.env.CSC_LINK
  ) {
    console.log(
      'Skipping sidecar signing - CSC_IDENTITY_AUTO_DISCOVERY=false and no explicit identity set',
    );
    console.log('This is expected for local unsigned builds.');
    return;
  }

  try {
    // Sign the sidecar binary
    await signBinary(sidecarPath, identity);

    // Verify the signature
    await verifySignature(sidecarPath);

    // Sign the speech helper when bundled (same seal-ordering constraint)
    if (fs.existsSync(speechHelperPath)) {
      await signBinary(speechHelperPath, identity);
      await verifySignature(speechHelperPath);
    }

    // Sign the keychain sync helper bundle when bundled (same seal-ordering
    // constraint; embeds the provisioning profile + restricted entitlements
    // when KEYCHAIN_HELPER_PROVISIONING_PROFILE is set).
    if (fs.existsSync(keychainHelperBundlePath)) {
      await signKeychainHelper(keychainHelperBundlePath, identity);
    }

    console.log('=== Sidecar signing complete ===');
  } catch (error) {
    console.error('=== Sidecar signing failed ===');
    // If we couldn't find a cert and signing failed, that's expected for unsigned builds
    const keychainIdentity = await findSigningIdentity();
    if (!keychainIdentity && !process.env.CSC_NAME) {
      console.warn('No codesigning identity available - skipping with warning');
      console.warn('This is expected for local unsigned development builds.');
      return;
    }
    // Otherwise, fail the build loudly
    throw error;
  }
}

// Default export for electron-builder afterPack hook
export default signSidecar;
