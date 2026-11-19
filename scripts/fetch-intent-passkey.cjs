#!/usr/bin/env node
/**
 * Stage the `intent-passkey` helper (browser-panel passkeys, Linux only) per
 * packaging target at resources/intent-passkey/linux-<arch>/intent-passkey.
 * electron-builder's linux extraResources entry
 * `resources/intent-passkey/linux-${arch}` ships it as
 * process.resourcesPath/intent-passkey/intent-passkey.
 *
 * Source, in order:
 *   1. INTENT_PASSKEY_BIN=/path/to/intent-passkey — a local build, copied to
 *      the build host's target directory (dev, and until intentd releases it).
 *   2. The pinned intentd release (intentd.version): the cargo-dist app
 *      `intent-passkey`, fetched and sha256-verified by fetch-sidecar.cjs.
 *
 * Flags:
 *   --targets=a,b   node-style Linux targets (linux-x64, linux-arm64); also
 *                   INTENT_PASSKEY_TARGETS; defaults to the build host when it
 *                   is Linux, otherwise nothing.
 *   --force         passed through to fetch-sidecar.cjs.
 *
 * Env:
 *   INTENT_PASSKEY_REQUIRED=1  fail when the helper cannot be staged. Without
 *                              it a missing helper is a warning, and the build
 *                              ships without passkeys (main then keeps
 *                              Electron's own WebAuthn behaviour).
 *
 * Every target directory is created, even when empty, so the extraResources
 * entry always resolves.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FE_DIR = path.resolve(__dirname, '..');
const BINARY = 'intent-passkey';
const TARGET_TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
};

function requestedTargets() {
  const flag = process.argv.find((arg) => arg.startsWith('--targets='));
  const raw = flag ? flag.slice('--targets='.length) : process.env.INTENT_PASSKEY_TARGETS || '';
  if (raw.trim()) return raw.split(',').map((target) => target.trim()).filter(Boolean);
  return process.platform === 'linux' ? [`linux-${process.arch}`] : [];
}

function stage(target) {
  const triple = TARGET_TRIPLES[target];
  if (!triple) throw new Error(`Unsupported intent-passkey target ${target}`);
  const destDir = path.join(FE_DIR, 'resources', BINARY, target);
  fs.mkdirSync(destDir, { recursive: true });

  const local = process.env.INTENT_PASSKEY_BIN?.trim();
  if (local && target === `linux-${process.arch}`) {
    const dest = path.join(destDir, BINARY);
    fs.copyFileSync(local, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`Staged local intent-passkey for ${target} at ${dest}`);
    return true;
  }

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'fetch-sidecar.cjs'), ...process.argv.filter((a) => a === '--force')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        INTENTD_APP_NAME: BINARY,
        INTENTD_TARGET: triple,
        INTENTD_DEST_DIR: destDir,
      },
    },
  );
  return result.status === 0;
}

const required = process.env.INTENT_PASSKEY_REQUIRED === '1';
let failed = false;
for (const target of requestedTargets()) {
  if (stage(target)) continue;
  failed = true;
  const message = `intent-passkey was not staged for ${target}; this build ships without browser-panel passkeys`;
  if (required) console.error(`Error: ${message}`);
  else console.warn(`Warning: ${message}`);
}
if (failed && required) process.exit(1);
