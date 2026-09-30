#!/usr/bin/env node
/**
 * Native Mac command contract:
 *   pnpm run dist:mac [--x64 | --arm64] [--publish never | always | onTag]
 * Omitted architecture uses the Node host architecture. Use one native macOS
 * runner per architecture; cross-building and universal artifacts are unsupported.
 * Other electron-builder options (including signing overrides) pass through.
 * INTENTD_BIN retains copy-sidecar's local/pre-fetched sidecar contract.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import native from './macos-native.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveMacArguments(argv, platform = process.platform, hostArch = process.arch) {
  const architectures = argv.filter((arg) => ['--x64', '--arm64'].includes(arg));
  if (architectures.length > 1) throw new Error('Select exactly one native Mac architecture.');
  // A second target/config architecture selector must not bypass native staging.
  if (
    argv.some(
      (arg) =>
        /^(--(?:universal|ia32|armv7l|arch|mac|win|linux|platform)(?:=|$)|-[mwl]$)/.test(arg) ||
        /^(?:--config\.|-c\.).*(?:arch|target)/i.test(arg.split('=')[0]) ||
        /^(?:dmg|zip|mas|dir):/.test(arg),
    )
  ) {
    throw new Error('Use only --x64 or --arm64 to select a native Mac target.');
  }
  const arch = native.assertNativeMacArch(
    architectures[0]?.slice(2) || hostArch,
    platform,
    hostArch,
  );
  return { arch, builderArgs: argv.filter((arg) => arg !== '--' && !architectures.includes(arg)) };
}

export function packageMac(
  argv,
  {
    platform = process.platform,
    hostArch = process.arch,
    env = process.env,
    execute = execFileSync,
  } = {},
) {
  const { arch, builderArgs } = resolveMacArguments(argv, platform, hostArch);
  const sidecarTarget = arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin';
  if (env.INTENTD_TARGET?.trim() && env.INTENTD_TARGET.trim() !== sidecarTarget) {
    throw new Error(`INTENTD_TARGET must be ${sidecarTarget} for this native Mac build.`);
  }
  const options = { cwd: ROOT, stdio: 'inherit', env: { ...env, INTENT_MAC_ARCH: arch } };
  for (const args of [
    ['scripts/pnpm-run.mjs', 'build'],
    ['scripts/ensure-native-deps.cjs'],
    ['scripts/copy-sidecar.cjs'],
    ['scripts/fetch-tailcat.cjs', `--targets=darwin-${arch}`],
    ['scripts/build-speech-helper.cjs'],
    ['scripts/build-keychain-helper.cjs'],
    ['scripts/validate-macos-native.cjs', arch],
  ])
    execute(process.execPath, args, options);
  execute(
    path.join(ROOT, 'node_modules/.bin/electron-builder'),
    ['--mac', `--${arch}`, ...builderArgs],
    options,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    packageMac(process.argv.slice(2));
  } catch (error) {
    console.error(`Mac packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
