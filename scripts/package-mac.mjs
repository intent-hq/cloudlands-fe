#!/usr/bin/env node
/**
 * Native Mac command contract:
 *   pnpm run dist:mac [--x64 | --arm64] [--publish never | always | onTag]
 * Omitted architecture uses the Node host architecture. Use one native macOS
 * runner per architecture; cross-building and universal artifacts are unsupported.
 * Other electron-builder options (including signing overrides) pass through.
 * Prepackaged app inputs are rejected because they skip native/signing hooks.
 * Config files, inheritance and project-root overrides are unsupported: staging
 * uses this repository's electron-builder.yml and native resource directories.
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
  // Existing app inputs skip doPack and therefore every native/signing hook.
  if (parsed.prepackaged !== undefined) {
    throw new Error('Prepackaged apps are unsupported by the native Mac staging entry point.');
  }
  if (parsed.projectDir !== undefined) {
    throw new Error(
      'Alternate project roots are unsupported by the native Mac staging entry point.',
    );
  }
  // A config file/inherited preset can add CPUs after CLI normalization. Restrict
  // this fixed staging pipeline to inline overrides of the repository config.
  // Inspect parsed fields so all config aliases receive the same validation.
  const config = parsed.config;
  if (
    config !== undefined &&
    (config === null ||
      typeof config !== 'object' ||
      Array.isArray(config) ||
      Object.hasOwn(config, '_') ||
      Object.hasOwn(config, 'extends'))
  ) {
    throw new Error(
      'Alternate config files and inheritance are unsupported by native Mac staging.',
    );
  }
  if (
    config?.mac &&
    Object.keys(config.mac).some((key) => /^(?:target(?:$|\[)|defaultArch$)/.test(key))
  ) {
    throw new Error('Select native Mac targets through CLI options, not config overrides.');
  }
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
