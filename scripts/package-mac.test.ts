// @vitest-environment node
// @verify-changed-triggers: package.json, electron-builder.yml

import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { packageMac, resolveMacArguments } from './package-mac.mjs';

const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const { expandMacro } = builderRequire('app-builder-lib/out/util/macroExpander');
const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher');
// Builder loads its config through jiti; keep this read-only unit test off the disk cache.
vi.stubEnv('JITI_FS_CACHE', 'false');
const { normalizeOptions, createYargs, configureBuildCommand } = builderRequire('./builder.js');
const { Platform } = builderRequire('app-builder-lib');
vi.unstubAllEnvs();

describe('native Mac packaging entry point', () => {
  const parseBuilder = (args: string[]) =>
    configureBuildCommand(createYargs()).exitProcess(false).strict().parseSync(args);

  it.each([
    { args: ['--arm64=true'], targets: [['mac', [1, 3]]] },
    { args: ['--macos=zip:arm64'], targets: [['mac', [3]]] },
    {
      args: ['--windows'],
      targets: [
        ['mac', [1]],
        ['win', [1]],
      ],
    },
    {
      args: ['-mwl'],
      targets: [
        ['mac', [1]],
        ['linux', [1]],
        ['win', [1]],
      ],
    },
  ])('rejects builder alias $args before staging anything', ({ args, targets }) => {
    // Independent oracle: these exact forwarded arguments select a foreign CPU/platform
    // in the installed electron-builder CLI, even though none uses our primary spellings.
    const parsed = normalizeOptions(parseBuilder(['--mac', '--x64', ...args]));
    expect(
      [...parsed.targets].map(
        ([platform, arches]: [typeof Platform.MAC, Map<number, string[]>]) => [
          platform.buildConfigurationKey,
          [...arches.keys()],
        ],
      ),
    ).toEqual(targets);
    const execute = vi.fn();
    expect(() =>
      packageMac(args, { platform: 'darwin', hostArch: 'x64', env: {}, execute }),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['x64', 'arm64'])(
    'preserves native %s target aliases, publish and signing options',
    (arch) => {
      const execute = vi.fn();
      packageMac(
        [
          `--${arch}=true`,
          `--macos=zip:${arch}`,
          '-p',
          'never',
          '-c.mac.identity=null',
          '-c.mac.notarize=false',
        ],
        {
          platform: 'darwin',
          hostArch: arch,
          env: {},
          execute,
        },
      );
      const finalCommand = execute.mock.calls.at(-1)![1];
      const parsed = normalizeOptions(parseBuilder(finalCommand));
      expect([...parsed.targets.get(Platform.MAC)]).toEqual([[arch === 'x64' ? 1 : 3, ['zip']]]);
      expect(parsed.publish).toBe('never');
      expect(parsed.config.mac).toMatchObject({ identity: null, notarize: 'false' });
      expect(execute.mock.calls.some((call) => call[1].includes(`--targets=darwin-${arch}`))).toBe(
        true,
      );
    },
  );

  it.each([
    ['x64', ['-o', 'zip:arm64']],
    ['arm64', ['--x64=true']],
    ['arm64', ['-m', 'dmg:x64']],
    ['arm64', ['--universal=true']],
    ['x64', ['-lw']],
    ['x64', ['--win=zip']],
  ])('rejects other foreign CLI forms on %s: %j', (hostArch, args) => {
    const execute = vi.fn();
    expect(() =>
      packageMac(args as string[], { platform: 'darwin', hostArch, env: {}, execute }),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('excludes fallback native modules but retains the rebuilt release payload', () => {
    const config = load(readFileSync('electron-builder.yml', 'utf8'));
    const matcher = new FileMatcher(process.cwd(), '/unused', (value: string) => value, [
      '**/*',
      ...config.mac.files,
    ]);
    const filter = matcher.createFilter();
    const stats = statSync('node_modules/node-pty/package.json');
    for (const arch of ['x64', 'arm64']) {
      expect(
        filter(resolve(`node_modules/node-pty/prebuilds/darwin-${arch}/pty.node`), stats),
      ).toBe(false);
      expect(
        filter(resolve(`node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`), stats),
      ).toBe(false);
    }
    expect(filter(resolve('node_modules/node-pty/build/Debug/pty.node'), stats)).toBe(false);
    expect(filter(resolve('node_modules/node-pty/build/Release/pty.node'), stats)).toBe(true);
    expect(filter(resolve('node_modules/node-pty/build/Release/spawn-helper'), stats)).toBe(true);
  });
  it.each(['x64', 'arm64'])('stages and packages the selected native %s architecture', (arch) => {
    const execute = vi.fn();
    packageMac([`--${arch}`, '--publish', 'never'], {
      platform: 'darwin',
      hostArch: arch,
      env: {},
      execute,
    });
    const calls = execute.mock.calls;
    expect(calls.map((call) => call[1])).toEqual([
      ['scripts/pnpm-run.mjs', 'build'],
      ['scripts/ensure-native-deps.cjs'],
      ['scripts/copy-sidecar.cjs'],
      ['scripts/fetch-tailcat.cjs', `--targets=darwin-${arch}`],
      ['scripts/build-speech-helper.cjs'],
      ['scripts/build-keychain-helper.cjs'],
      ['scripts/validate-macos-native.cjs', arch],
      ['--mac', `--${arch}`, '--publish', 'never'],
    ]);
    for (const call of calls) expect(call[2].env.INTENT_MAC_ARCH).toBe(arch);
  });

  it.each(['x64', 'arm64'])('defaults to the %s host and preserves builder arguments', (arch) => {
    expect(
      resolveMacArguments(['--', '--publish=always', '-c.mac.identity=null'], 'darwin', arch),
    ).toEqual({ arch, builderArgs: ['--publish=always', '-c.mac.identity=null'] });
  });

  it.each([
    ['linux', 'x64', []],
    ['darwin', 'x64', ['--arm64']],
    ['darwin', 'arm64', ['--x64']],
    ['darwin', 'arm64', ['--x64', '--arm64']],
    ['darwin', 'arm64', ['--universal']],
    ['darwin', 'x64', ['--ia32']],
    ['darwin', 'x64', ['--arch=arm64']],
    ['darwin', 'x64', ['--mac', 'zip:arm64']],
    ['darwin', 'x64', ['-c.mac.target[0].arch=arm64']],
  ])('rejects unsupported build %s/%s %j before doing work', (platform, hostArch, args) => {
    const execute = vi.fn();
    expect(() => packageMac(args as string[], { platform, hostArch, env: {}, execute })).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a conflicting daemon target override before building', () => {
    const execute = vi.fn();
    expect(() =>
      packageMac(['--x64'], {
        platform: 'darwin',
        hostArch: 'x64',
        env: { INTENTD_TARGET: 'aarch64-apple-darwin' },
        execute,
      }),
    ).toThrow(/INTENTD_TARGET/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not invoke electron-builder when native validation fails', () => {
    const execute = vi.fn((_command, args) => {
      if (args[0] === 'scripts/validate-macos-native.cjs') throw new Error('wrong sidecar');
    });
    expect(() => packageMac([], { platform: 'darwin', hostArch: 'x64', env: {}, execute })).toThrow(
      'wrong sidecar',
    );
    expect(execute.mock.calls.some((call) => call[1][0] === '--mac')).toBe(false);
  });

  it.each(['x64', 'arm64'])('names %s DMG and ZIP distinctly using the builder macros', (arch) => {
    const config = load(readFileSync('electron-builder.yml', 'utf8'));
    const appInfo = { productName: 'Intent', sanitizedProductName: 'Intent', version: '2.200.0' };
    expect(expandMacro(config.dmg.artifactName, arch, appInfo, { ext: 'dmg' })).toBe(
      `Intent-2.200.0-${arch}.dmg`,
    );
    expect(expandMacro(config.mac.artifactName, arch, appInfo, { ext: 'zip' })).toBe(
      `Intent-2.200.0-${arch}-mac.zip`,
    );
    // Run builder's target normalizer: neither configured target can override the CPU.
    const { targets } = normalizeOptions({ mac: config.mac.target, [arch]: true });
    expect([...targets.get(Platform.MAC).entries()]).toEqual([
      [arch === 'x64' ? 1 : 3, ['dmg', 'zip']],
    ]);
  });
});
