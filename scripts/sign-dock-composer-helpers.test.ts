// @vitest-environment node
// @verify-changed-triggers: electron-builder.yml, scripts/macos-native.cjs,
//   build/entitlements.dock-media.plist, scripts/package-mac.mjs,
//   scripts/build-dock-recorder.cjs, scripts/build-dock-speech.cjs,
//   scripts/build-dock-element-pick.cjs
//
// Packaging failures this guards against for the dock composer helpers:
// - a helper missing from, or the wrong CPU in, the packaged app;
// - electron-builder's deep-sign pass replacing a helper's signature with the
//   full app entitlements (or the exclusion swallowing legacy helpers);
// - the element picker gaining a microphone entitlement, or the media
//   entitlements growing beyond audio input;
// - signing without hardened runtime / timestamp, or without verification;
// - dev or dist chains that never build the helpers.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const codesign = vi.hoisted(() => ({
  calls: [] as string[][],
  signed: new Map<string, string>(),
  extraKey: null as string | null,
}));

vi.mock('child_process', () => {
  const reply = (args: unknown[], value: { stdout: string; stderr: string }) =>
    (args.at(-1) as (error: Error | null, value: unknown) => void)(null, value);
  return {
    exec: (...args: unknown[]) => reply(args, { stdout: '', stderr: '' }),
    execFile: (command: string, argv: string[], ...rest: unknown[]) => {
      if (command !== 'codesign') return reply(rest, { stdout: '', stderr: '' });
      codesign.calls.push(argv);
      const file = argv.at(-1)!;
      if (argv[0] === '--force') {
        const plist = argv.includes('--entitlements')
          ? readFileSync(argv[argv.indexOf('--entitlements') + 1], 'utf8')
          : '';
        codesign.signed.set(file, plist);
      }
      if (argv[0] === '-d') {
        const plist = codesign.signed.get(file) ?? '';
        const extra = codesign.extraKey ? `<key>${codesign.extraKey}</key><true/>` : '';
        return reply(rest, {
          stdout: extra ? plist.replace('<dict>', `<dict>${extra}`) : plist,
          stderr: '',
        });
      }
      return reply(rest, { stdout: '', stderr: '' });
    },
  };
});

const { default: native } = await import('./macos-native.cjs');
const {
  default: signSidecar,
  DOCK_COMPOSER_SIGNING,
  entitlementKeysFromXml,
} = await import('./sign-sidecar.js');

const AUDIO_INPUT = 'com.apple.security.device.audio-input';
const RECORDER = 'Contents/Resources/dock-helper/intent-dock-recorder';
const SPEECH = 'Contents/Resources/speech-helper/intent-dock-speech';
const PICKER = 'Contents/Resources/dock-helper/intent-dock-element-pick';
const packaged = [
  'Contents/MacOS/Intent',
  'Contents/Resources/intentd/intentd',
  'Contents/Resources/speech-helper/intent-speech-helper',
  'Contents/Resources/keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper',
  'Contents/Resources/dock-helper/intent-dock-helper',
  RECORDER,
  SPEECH,
  PICKER,
  'Contents/Resources/tailcat/tailcat',
  'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node',
  'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper',
];

const roots: string[] = [];
function binary(arch: string) {
  return readFileSync(`node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`);
}
function packagedApp({ omit, foreign }: { omit?: string; foreign?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dock-sign-'));
  roots.push(root);
  const app = join(root, 'Intent.app');
  for (const file of packaged.filter((file) => file !== omit)) {
    mkdirSync(dirname(join(app, file)), { recursive: true });
    writeFileSync(join(app, file), binary(file === foreign ? 'x64' : 'arm64'));
  }
  return { root, app };
}
function afterPack(root: string) {
  return signSidecar({
    electronPlatformName: 'darwin',
    arch: 3,
    appOutDir: root,
    packager: { appInfo: { productFilename: 'Intent' } },
  });
}
const callsFor = (file: string) => codesign.calls.filter((argv) => argv.at(-1) === file);

beforeEach(() => {
  codesign.calls.length = 0;
  codesign.signed.clear();
  codesign.extraKey = null;
  vi.spyOn(native, 'builderMacArch').mockReturnValue('arm64');
  vi.stubEnv('CSC_NAME', 'Developer ID Application: Test (TEAMID1234)');
  vi.stubEnv('CSC_IDENTITY_AUTO_DISCOVERY', '');
  vi.stubEnv('REQUIRE_SHARED_KEYCHAIN_GROUP', '');
  vi.stubEnv('KEYCHAIN_HELPER_PROVISIONING_PROFILE', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('dock composer helper signing (afterPack)', () => {
  it('signs each helper with hardened runtime, timestamp and only its own entitlements', async () => {
    const { root, app } = packagedApp();
    await afterPack(root);

    for (const helper of [RECORDER, SPEECH, PICKER]) {
      const [sign, verify, display, ...rest] = callsFor(join(app, helper));
      expect(rest).toEqual([]);
      expect(sign.slice(0, 4)).toEqual(['--force', '--options', 'runtime', '--timestamp']);
      expect(sign.slice(-3, -1)).toEqual(['--sign', 'Developer ID Application: Test (TEAMID1234)']);
      expect(verify).toEqual(expect.arrayContaining(['--verify', '--strict']));
      expect(display.slice(0, 4)).toEqual(['-d', '--entitlements', '-', '--xml']);
    }
    expect(entitlementKeysFromXml(codesign.signed.get(join(app, RECORDER)))).toEqual([AUDIO_INPUT]);
    expect(entitlementKeysFromXml(codesign.signed.get(join(app, SPEECH)))).toEqual([AUDIO_INPUT]);
    // The Accessibility picker carries no microphone (or any other) privilege.
    expect(callsFor(join(app, PICKER))[0]).not.toContain('--entitlements');
    expect(codesign.signed.get(join(app, PICKER))).toBe('');
  });

  it('keeps legacy helper signing unchanged', async () => {
    const { root, app } = packagedApp();
    await afterPack(root);
    for (const legacy of [
      'Contents/Resources/speech-helper/intent-speech-helper',
      'Contents/Resources/dock-helper/intent-dock-helper',
      'Contents/Resources/keychain-helper/intent-keychain-helper.app',
    ]) {
      const [sign] = callsFor(join(app, legacy));
      expect(sign).toBeDefined();
      expect(sign).not.toContain('--entitlements');
    }
  });

  it('fails the package when a signed helper carries an unexpected entitlement', async () => {
    const { root } = packagedApp();
    codesign.extraKey = 'com.apple.security.cs.allow-jit';
    await expect(afterPack(root)).rejects.toThrow(/Unexpected entitlements.*intent-dock-recorder/);
  });

  it.each([RECORDER, SPEECH, PICKER])('fails before signing when %s is missing', async (helper) => {
    const { root } = packagedApp({ omit: helper });
    await expect(afterPack(root)).rejects.toThrow(/ENOENT/);
    expect(codesign.calls).toEqual([]);
  });

  it.each([RECORDER, SPEECH, PICKER])('rejects an Intel %s before signing', async (helper) => {
    const { root } = packagedApp({ foreign: helper });
    await expect(afterPack(root)).rejects.toThrow(/Wrong architecture/);
    expect(codesign.calls).toEqual([]);
  });

  it('still validates but never signs unsigned local builds', async () => {
    vi.stubEnv('CSC_NAME', '');
    vi.stubEnv('CSC_IDENTITY_AUTO_DISCOVERY', 'false');
    const { root } = packagedApp();
    await afterPack(root);
    expect(codesign.calls).toEqual([]);
    const missing = packagedApp({ omit: SPEECH });
    await expect(afterPack(missing.root)).rejects.toThrow(/ENOENT/);
  });
});

describe('dock composer packaging contract', () => {
  it('signs exactly the helpers the arch validation requires', () => {
    expect(DOCK_COMPOSER_SIGNING.map((policy) => policy.helper)).toEqual(
      native.DOCK_COMPOSER_HELPERS,
    );
  });

  it('grants the media helpers microphone access and nothing else', () => {
    const plist = readFileSync('build/entitlements.dock-media.plist', 'utf8');
    expect(entitlementKeysFromXml(plist)).toEqual([AUDIO_INPUT]);
  });

  it('excludes only these helpers from the deep-sign pass, which would apply app entitlements', () => {
    const config = load(readFileSync('electron-builder.yml', 'utf8')) as {
      mac: { signIgnore: string[]; entitlementsInherit: string; extraResources: { to: string }[] };
    };
    const ignored = (file: string) =>
      config.mac.signIgnore.some((pattern) => new RegExp(pattern).test(`/out/Intent.app/${file}`));
    for (const helper of [RECORDER, SPEECH, PICKER]) expect(ignored(helper)).toBe(true);
    for (const kept of packaged.filter((file) => ![RECORDER, SPEECH, PICKER].includes(file))) {
      if (!kept.includes('keychain-helper')) expect(ignored(kept)).toBe(false);
    }
    expect(ignored(`${PICKER}.tmp`)).toBe(false);
    const inherited = readFileSync(config.mac.entitlementsInherit, 'utf8');
    expect(entitlementKeysFromXml(inherited).length).toBeGreaterThan(1);
    expect(config.mac.extraResources.map((entry) => entry.to)).toEqual(
      expect.arrayContaining(['dock-helper', 'speech-helper']),
    );
  });

  it('builds every helper in dev, dist and native Mac packaging', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    const canonical: string = scripts['build:dock-composer-helpers'];
    for (const script of [
      'build-dock-recorder.cjs',
      'build-dock-speech.cjs',
      'build-dock-element-pick.cjs',
    ]) {
      expect(canonical).toContain(`node scripts/${script}`);
    }
    for (const chain of ['dev:base', 'dev:cdp:base', 'dist', 'dist:all']) {
      expect(scripts[chain]).toContain('node scripts/pnpm-run.mjs build:dock-composer-helpers');
    }
    expect(readFileSync('scripts/package-mac.mjs', 'utf8')).toContain(
      "['scripts/pnpm-run.mjs', 'build:dock-composer-helpers']",
    );
  });
});
