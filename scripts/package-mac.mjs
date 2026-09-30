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
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import native from './macos-native.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));

export function resolveMacArguments(argv, platform = process.platform, hostArch = process.arch) {
  const architectures = argv.filter((arg) => ['--x64', '--arm64'].includes(arg));
  if (architectures.length > 1) throw new Error('Select exactly one native Mac architecture.');
  // Target overrides in config are applied after the CLI target map. Keep those
  // out of this entry point; native --mac targets are validated below instead.
  if (argv.some((arg) => /^(?:--config\.|-c\.).*(?:arch|target)/i.test(arg.split('=')[0]))) {
    throw new Error('Use only --x64 or --arm64 to select a native Mac target.');
  }
  const arch = native.assertNativeMacArch(
    architectures[0]?.slice(2) || hostArch,
    platform,
    hostArch,
  );
  const builderArgs = argv.filter((arg) => arg !== '--' && !architectures.includes(arg));
  // Use exactly the installed builder's parsing and alias expansion. Validate the
  // full command we will execute, so boolean values, aliases and short-option
  // clusters cannot add another CPU/platform after native staging has started.
  const { createYargs, configureBuildCommand, normalizeOptions } = builderRequire('./builder.js');
  const parsed = configureBuildCommand(createYargs())
    .exitProcess(false)
    .strict()
    .fail((message, error) => {
      throw error || new Error(message);
    })
    .parseSync(['--mac', `--${arch}`, ...builderArgs]);
  if (parsed._.length) throw new Error('Only native Mac build options are supported.');
  const { targets } = normalizeOptions(parsed);
  const expectedArch = arch === 'x64' ? 1 : 3;
  if (
    targets.size !== 1 ||
    [...targets].some(
      ([targetPlatform, targetArches]) =>
        targetPlatform.buildConfigurationKey !== 'mac' ||
        targetArches.size !== 1 ||
        !targetArches.has(expectedArch),
    )
  ) {
    throw new Error(`Mac packaging supports only the native ${arch} Mac target.`);
  }
  return { arch, builderArgs };
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
