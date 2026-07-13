// Custom Windows sign hook for electron-builder.
// Uses DigiCert smctl when INTENT_WINDOWS_ENABLE_INTEGRATED_SIGNING=true.
// Silently skips signing for local dev builds.
//
// This file MUST be .cjs — package.json has "type": "module" and electron-builder
// loads this via require(). A .js extension would fail with "require is not defined".
//
// Reference: https://docs.digicert.com/en/digicert-keylocker/code-signing/sign-with-third-party-signing-tools/windows-applications/sign-executables-with-electron-builder-using-ksp-library.html
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

let loggedSkip = false;

exports.default = async function sign(configuration) {
  if (!configuration.path) {
    return;
  }

  const enabled = ['1', 'true'].includes(
    (process.env.INTENT_WINDOWS_ENABLE_INTEGRATED_SIGNING || '').trim().toLowerCase(),
  );

  if (!enabled) {
    if (!loggedSkip) {
      console.log('[windows-sign] Skipping — INTENT_WINDOWS_ENABLE_INTEGRATED_SIGNING is not set to true.');
      loggedSkip = true;
    }
    return;
  }

  const keypairAlias = process.env.INTENT_WINDOWS_SM_KEYPAIR_ALIAS;
  if (!keypairAlias) {
    throw new Error('[windows-sign] INTENT_WINDOWS_SM_KEYPAIR_ALIAS is required for signing but is not set.');
  }

  const filePath = path.resolve(configuration.path);
  const fileName = path.basename(filePath);

  // Only sign the main app exe and the NSIS installer.
  // Skip bundled third-party helpers (e.g. pagent.exe, winpty-agent.exe) and
  // NSIS build artifacts (elevate.exe, __uninstaller-*).
  //
  // Heuristic: sign if the file is directly in win-unpacked (main app) or
  // contains "Setup" in the name (NSIS installer). Everything else is a
  // helper/dependency nested deeper in the tree.
  const isMainApp = filePath.includes('win-unpacked') && path.dirname(filePath).endsWith('win-unpacked');
  const isInstaller = fileName.includes('Setup');

  if (!isMainApp && !isInstaller) {
    console.log(`[windows-sign] Skipping (not installer or main exe): ${fileName}`);
    return;
  }

  console.log(`[windows-sign] Signing: ${filePath}`);

  try {
    // Match the flags used by the DigiCert action internally:
    //   --simple            use simplified signing mode (required for simple-signing-mode setup)
    //   --exit-non-zero-on-fail  actually return non-zero on failure (smctl defaults to exit 0!)
    //   --failfast          stop on first error
    const output = execFileSync('smctl', [
      'sign',
      '--simple',
      '--keypair-alias', keypairAlias,
      '--exit-non-zero-on-fail',
      '--failfast',
      '--input', filePath,
    ], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const combined = (output || '').toString();
    console.log(`[windows-sign] smctl output: ${combined.trim()}`);
    console.log(`[windows-sign] ✅ Signed: ${path.basename(filePath)}`);
  } catch (err) {
    // execFileSync throws on non-zero exit, or we threw above for FAILED
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    console.error(`[windows-sign] ❌ Failed to sign: ${filePath}`);
    console.error(`[windows-sign] Exit code: ${err.status}`);
    if (stdout) console.error(`[windows-sign] stdout: ${stdout}`);
    if (stderr) console.error(`[windows-sign] stderr: ${stderr}`);
    throw err;
  }
};