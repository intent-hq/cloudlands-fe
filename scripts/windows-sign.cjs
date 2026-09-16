// Custom Windows sign hook for electron-builder.
// Uses DigiCert smctl when INTENT_WINDOWS_ENABLE_INTEGRATED_SIGNING=true.
// Silently skips signing for local dev builds. Signs the main app exe, the
// NSIS installer and the portable exe; see shouldSign for the selection rule.
//
// This file MUST be .cjs — package.json has "type": "module" and electron-builder
// loads this via require(). A .js extension would fail with "require is not defined".
//
// Reference: https://docs.digicert.com/en/digicert-keylocker/code-signing/sign-with-third-party-signing-tools/windows-applications/sign-executables-with-electron-builder-using-ksp-library.html
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

let loggedSkip = false;

// electron-builder's unpacked app dir: win-unpacked, win-arm64-unpacked, win-ia32-unpacked.
const UNPACKED_DIR = /^win(?:-[a-z0-9_]+)?-unpacked$/i;
// `${version}` as electron-builder expands it: the package.json semver verbatim, with
// optional prerelease (-manual.123) and build metadata (+build.1) as set-version.cjs allows.
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Decide whether electron-builder handed us a shipped executable rather than a
// bundled helper or NSIS internal. Sign:
//   - the main app exe, which is the only exe directly inside win-unpacked
//   - the NSIS installer  `${productName}.Setup.${version}.exe` (nsis.artifactName)
//   - the portable exe    `${productName}.${version}.exe`       (portable.artifactName)
// Skip everything else: helpers nested deeper in the tree (pagent.exe,
// winpty-agent.exe, resources/elevate.exe, intentd.exe) and the NSIS
// uninstaller stub electron-builder writes to the output dir as
// `<installer>.__uninstaller.exe`.
function shouldSign(filePath, productName) {
  const resolved = path.resolve(filePath);
  const fileName = path.basename(resolved);
  if (!/\.exe$/i.test(fileName) || fileName.includes('__uninstaller')) {
    return false;
  }
  if (UNPACKED_DIR.test(path.basename(path.dirname(resolved)))) {
    return true;
  }
  const name = productName ? escapeRegExp(productName) : '[^\\\\/]+?';
  return new RegExp(`^${name}\\.(?:Setup\\.)?${VERSION}\\.exe$`).test(fileName);
}

exports.shouldSign = shouldSign;

exports.default = async function sign(configuration) {
  if (!configuration.path) {
    return;
  }

  const enabled = ['1', 'true'].includes(
    (process.env.INTENT_WINDOWS_ENABLE_INTEGRATED_SIGNING || '').trim().toLowerCase(),
  );

  if (!enabled) {
    if (!loggedSkip) {
      console.log(
        '[windows-sign] Skipping — INTENT_WINDOWS_ENABLE_INTEGRATED_SIGNING is not set to true.',
      );
      loggedSkip = true;
    }
    return;
  }

  const keypairAlias = process.env.INTENT_WINDOWS_SM_KEYPAIR_ALIAS;
  if (!keypairAlias) {
    throw new Error(
      '[windows-sign] INTENT_WINDOWS_SM_KEYPAIR_ALIAS is required for signing but is not set.',
    );
  }

  const filePath = path.resolve(configuration.path);
  const fileName = path.basename(filePath);

  // configuration.name is electron-builder's productName.
  if (!shouldSign(filePath, configuration.name)) {
    console.log(`[windows-sign] Skipping (not installer, portable or main exe): ${fileName}`);
    return;
  }

  console.log(`[windows-sign] Signing: ${filePath}`);

  try {
    // Match the flags used by the DigiCert action internally:
    //   --simple            use simplified signing mode (required for simple-signing-mode setup)
    //   --exit-non-zero-on-fail  actually return non-zero on failure (smctl defaults to exit 0!)
    //   --failfast          stop on first error
    const output = execFileSync(
      'smctl',
      [
        'sign',
        '--simple',
        '--keypair-alias',
        keypairAlias,
        '--exit-non-zero-on-fail',
        '--failfast',
        '--input',
        filePath,
      ],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
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
