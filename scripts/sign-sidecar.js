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

/**
 * afterPack hook for electron-builder
 * @param {Object} context - electron-builder context
 */
export async function signSidecar(context) {
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
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && !process.env.CSC_NAME && !process.env.CSC_LINK) {
    console.log('Skipping sidecar signing - CSC_IDENTITY_AUTO_DISCOVERY=false and no explicit identity set');
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
