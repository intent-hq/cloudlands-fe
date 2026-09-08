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
 * Team-relative suffix of the cross-app shared keychain access group (the
 * full group is `TEAMID.dev.intentapp.backends`). The composed group must
 * match what the helper resolves from its own entitlements at runtime and
 * the group the iOS app adopts. Note the literal here has NO leading dot
 * (the `${teamId}.` composition supplies it), while sync-helper.swift's
 * `sharedGroupSuffix` is `.dev.intentapp.backends` WITH the dot (matched via
 * `hasSuffix`) — keep both in sync when renaming the group.
 */
export const SHARED_KEYCHAIN_GROUP_SUFFIX = 'dev.intentapp.backends';

/**
 * The keychain-access-groups to sign the helper with: always the default
 * app-identifier group FIRST (existing items live there and stay readable for
 * migration), plus the shared group when the provisioning profile authorizes
 * it (exact entry or the `TEAMID.*` wildcard). Signing with a group the
 * profile does not authorize would fail codesign/taskgated outright, so an
 * older profile degrades to today's single-group entitlements instead.
 *
 * @param {string} teamId - 10-char Apple team ID from the profile
 * @param {string[]} profileGroups - keychain-access-groups the profile authorizes
 * @returns {string[]} groups for the entitlements plist
 */
export function resolveKeychainAccessGroups(teamId, profileGroups) {
  const appGroup = `${teamId}.${KEYCHAIN_HELPER_BUNDLE_ID}`;
  const sharedGroup = `${teamId}.${SHARED_KEYCHAIN_GROUP_SUFFIX}`;
  const authorized =
    Array.isArray(profileGroups) &&
    profileGroups.some((g) => g === sharedGroup || g === `${teamId}.*`);
  return authorized ? [appGroup, sharedGroup] : [appGroup];
}

/**
 * Parse the element count plutil prints when `-extract <keypath> raw` targets
 * an array (raw mode prints an array's length, not its contents).
 *
 * @param {string} stdout - plutil raw-mode output
 * @returns {number|null} the non-negative element count, or null when the
 *   output is not a plain integer
 */
export function parsePlutilRawArrayLength(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/**
 * Pull the `keychain-access-groups` string values out of an XML plist (the
 * decoded provisioning profile converted with `plutil -convert xml1 -o -`).
 * Pure text parsing — independent of plutil's json/raw extraction modes.
 *
 * @param {string} xml - XML plist source
 * @returns {string[]|null} the group strings, or null when no
 *   keychain-access-groups array is present
 */
export function parseKeychainAccessGroupsFromXml(xml) {
  // plutil serializes an empty array as self-closing <array/>.
  const arrayMatch = String(xml ?? '').match(
    /<key>keychain-access-groups<\/key>\s*(?:<array\s*\/>|<array>([\s\S]*?)<\/array>)/,
  );
  if (!arrayMatch) return null;
  if (arrayMatch[1] === undefined) return [];
  const groups = [];
  const stringRe = /<string>([^<]*)<\/string>/g;
  let entry;
  while ((entry = stringRe.exec(arrayMatch[1])) !== null) {
    const value = entry[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .trim();
    if (value) groups.push(value);
  }
  return groups;
}

/**
 * Guardrail decision: when REQUIRE_SHARED_KEYCHAIN_GROUP=1 the build must
 * fail unless the resolved entitlements include the shared cross-app group
 * (`TEAMID.dev.intentapp.backends`) — otherwise a release silently ships a
 * helper without keychain sync (intent-hq/intent#3848).
 *
 * @param {string} teamId - 10-char Apple team ID
 * @param {string[]} accessGroups - groups from resolveKeychainAccessGroups
 * @param {string|undefined} requireFlag - value of REQUIRE_SHARED_KEYCHAIN_GROUP
 * @returns {string|null} an error message when the build must fail, else null
 */
export function sharedKeychainGroupGuardrailError(teamId, accessGroups, requireFlag) {
  if (requireFlag !== '1') return null;
  const sharedGroup = `${teamId}.${SHARED_KEYCHAIN_GROUP_SUFFIX}`;
  if (Array.isArray(accessGroups) && accessGroups.includes(sharedGroup)) return null;
  return (
    `REQUIRE_SHARED_KEYCHAIN_GROUP=1 but the resolved keychain-access-groups ` +
    `${JSON.stringify(accessGroups)} do not include the shared group ${sharedGroup}. ` +
    'Either the provisioning profile does not authorize it or extraction failed ' +
    '(see the warnings above) — refusing to ship a helper without keychain sync.'
  );
}

/**
 * Render the helper's entitlements plist for the given team + access groups.
 *
 * @param {string} teamId - 10-char Apple team ID
 * @param {string[]} keychainAccessGroups - groups from resolveKeychainAccessGroups
 * @returns {string} plist XML
 */
export function buildHelperEntitlementsPlist(teamId, keychainAccessGroups) {
  const appIdentifier = `${teamId}.${KEYCHAIN_HELPER_BUNDLE_ID}`;
  const groupEntries = keychainAccessGroups
    .map((group) => `    <string>${group}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.application-identifier</key>
  <string>${appIdentifier}</string>
  <key>com.apple.developer.team-identifier</key>
  <string>${teamId}</string>
  <key>keychain-access-groups</key>
  <array>
${groupEntries}
  </array>
</dict>
</plist>
`;
}

/**
 * Log a failed extraction attempt with the real underlying error (message +
 * any stderr the tool produced) so CI failures are diagnosable from the logs.
 *
 * @param {string} label - which extraction strategy failed
 * @param {unknown} error - the thrown error (execFile errors carry .stderr)
 */
function logExtractionFailure(label, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`  ${label} failed: ${message}`);
  const stderr = error && typeof error === 'object' && 'stderr' in error ? error.stderr : '';
  if (stderr && String(stderr).trim()) {
    console.warn(`  stderr: ${String(stderr).trim()}`);
  }
}

/**
 * Read the keychain-access-groups the decoded provisioning profile authorizes.
 *
 * plutil's json-mode array extraction has failed on hosted macos-15 runners
 * against bytes that extract fine on developer Macs (intent-hq/intent#3848),
 * so this tries three independent strategies in order:
 *   1. `plutil -extract Entitlements.keychain-access-groups json`
 *   2. raw mode per element (raw on an array prints its element count, then
 *      `Entitlements.keychain-access-groups.N raw` reads each entry) — raw
 *      extraction is the mode that keeps working on the runner (TeamIdentifier)
 *   3. `plutil -convert xml1 -o -` on the whole profile, parsed for the
 *      <string> values under the keychain-access-groups key
 * Every failed attempt logs the real error; null means all three failed.
 *
 * @param {string} decodedProfile - path to the decoded profile plist
 * @returns {Promise<string[]|null>} the authorized groups, or null
 */
async function extractProfileKeychainGroups(decodedProfile) {
  const keypath = 'Entitlements.keychain-access-groups';

  try {
    const { stdout: groupsJson } = await execFileAsync('plutil', [
      '-extract',
      keypath,
      'json',
      '-o',
      '-',
      decodedProfile,
    ]);
    const parsed = JSON.parse(groupsJson);
    if (!Array.isArray(parsed)) {
      throw new Error(`json extraction returned a non-array: ${groupsJson.trim()}`);
    }
    return parsed.filter((g) => typeof g === 'string');
  } catch (error) {
    logExtractionFailure(`plutil -extract ${keypath} json`, error);
  }

  try {
    const { stdout: countRaw } = await execFileAsync('plutil', [
      '-extract',
      keypath,
      'raw',
      '-o',
      '-',
      decodedProfile,
    ]);
    const count = parsePlutilRawArrayLength(countRaw);
    if (count === null) {
      throw new Error(`raw extraction printed "${countRaw.trim()}" instead of an element count`);
    }
    const groups = [];
    for (let i = 0; i < count; i++) {
      const { stdout } = await execFileAsync('plutil', [
        '-extract',
        `${keypath}.${i}`,
        'raw',
        '-o',
        '-',
        decodedProfile,
      ]);
      const value = stdout.trim();
      if (value) groups.push(value);
    }
    return groups;
  } catch (error) {
    logExtractionFailure(`plutil -extract ${keypath} raw (per element)`, error);
  }

  try {
    const { stdout: xml } = await execFileAsync(
      'plutil',
      ['-convert', 'xml1', '-o', '-', decodedProfile],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const groups = parseKeychainAccessGroupsFromXml(xml);
    if (groups === null) {
      throw new Error('no keychain-access-groups array found in the xml1 output');
    }
    return groups;
  } catch (error) {
    logExtractionFailure('plutil -convert xml1 + XML parse', error);
  }

  return null;
}

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
    if (process.env.REQUIRE_SHARED_KEYCHAIN_GROUP === '1') {
      throw new Error(
        'REQUIRE_SHARED_KEYCHAIN_GROUP=1 but no keychain-helper provisioning profile is ' +
          'available (KEYCHAIN_HELPER_PROVISIONING_PROFILE unset or missing) — refusing to ' +
          'ship a helper without keychain sync.',
      );
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
      throw new Error(
        `Could not extract a team ID from the provisioning profile (got "${teamId}")`,
      );
    }

    // The shared cross-app group is included only when the profile authorizes
    // it (see resolveKeychainAccessGroups) — signing with an unauthorized
    // group would fail, so an older profile keeps today's single-group setup.
    const profileGroups = await extractProfileKeychainGroups(decodedProfile);
    if (profileGroups === null) {
      console.warn(
        '  Could not read keychain-access-groups from the profile (all extraction ' +
          'strategies failed, see errors above) — signing with the default ' +
          'app-identifier group only.',
      );
    }
    const accessGroups = resolveKeychainAccessGroups(teamId, profileGroups ?? []);
    if (accessGroups.length > 1) {
      console.log(`  Profile authorizes the shared keychain group: ${accessGroups[1]}`);
    } else {
      console.log(
        '  Profile does not authorize the shared keychain group — ' +
          'helper will keep using the default group.',
      );
    }
    const guardrailError = sharedKeychainGroupGuardrailError(
      teamId,
      accessGroups,
      process.env.REQUIRE_SHARED_KEYCHAIN_GROUP,
    );
    if (guardrailError) {
      throw new Error(guardrailError);
    }

    const entitlementsPath = path.join(tmpDir, 'entitlements.plist');
    fs.writeFileSync(entitlementsPath, buildHelperEntitlementsPlist(teamId, accessGroups));

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
  // Optional tailcat tunnel client (scripts/fetch-tailcat.cjs); absent when
  // the staging build skipped it (TAILCAT_SKIP=1).
  const tailcatPath = path.join(appPath, 'Contents', 'Resources', 'tailcat', 'tailcat');
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

    // Sign the tailcat tunnel client when bundled (same seal-ordering constraint)
    if (fs.existsSync(tailcatPath)) {
      await signBinary(tailcatPath, identity);
      await verifySignature(tailcatPath);
    }

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
    } else if (process.env.REQUIRE_SHARED_KEYCHAIN_GROUP === '1') {
      throw new Error(
        `REQUIRE_SHARED_KEYCHAIN_GROUP=1 but the keychain sync helper bundle is missing at ` +
          `${keychainHelperBundlePath} — refusing to ship without keychain sync.`,
      );
    }

    console.log('=== Sidecar signing complete ===');
  } catch (error) {
    console.error('=== Sidecar signing failed ===');
    // The guardrail must never be swallowed by the unsigned-build escape
    // hatch below — with REQUIRE_SHARED_KEYCHAIN_GROUP=1 the build fails.
    if (process.env.REQUIRE_SHARED_KEYCHAIN_GROUP === '1') {
      throw error;
    }
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
