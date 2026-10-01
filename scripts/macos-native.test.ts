// @vitest-environment node
// @verify-changed-triggers: electron-builder.yml, scripts/build-speech-helper.cjs,
//   scripts/build-keychain-helper.cjs, scripts/ensure-native-deps.cjs

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import native from './macos-native.cjs';
import signSidecar from './sign-sidecar.js';
import buildModernMacOSIcon from './build-macos-icon.js';

const directories: string[] = [];
function temporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'mac-native-'));
  directories.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Real Mach-O binaries from the pinned dependency provide the independent CPU oracle.
function binary(arch: string) {
  return readFileSync(`node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`);
}
function put(root: string, name: string, data: Buffer) {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}
const staged = [
  'resources/sidecar/intentd',
  'resources/speech-helper/intent-speech-helper',
  'resources/keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper',
  'resources/tailcat/mac-ARCH/tailcat',
  'node_modules/node-pty/build/Release/pty.node',
  'node_modules/node-pty/build/Release/spawn-helper',
];
const packaged = [
  'Contents/Resources/intentd/intentd',
  'Contents/Resources/speech-helper/intent-speech-helper',
  'Contents/Resources/keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper',
  'Contents/Resources/tailcat/tailcat',
  'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node',
  'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper',
];

describe('Mac native binary validation', () => {
  it('rejects unsupported hosts at the beforePack hook before invoking Xcode', () => {
    expect(() => buildModernMacOSIcon({ electronPlatformName: 'darwin', arch: 4 })).toThrow(
      /cross-building and universal builds are unsupported/,
    );
  });

  it('rejects a wrong copied binary at afterPack even when signing is disabled', async () => {
    const root = temporaryDirectory();
    const app = join(root, 'Intent.app');
    for (const file of packaged) put(app, file, binary('x64'));
    put(app, 'Contents/Resources/intentd/intentd', binary('arm64'));
    vi.spyOn(native, 'builderMacArch').mockReturnValue('x64');
    vi.stubEnv('CSC_IDENTITY_AUTO_DISCOVERY', 'false');
    vi.stubEnv('CSC_NAME', '');
    await expect(
      signSidecar({
        electronPlatformName: 'darwin',
        arch: 1,
        appOutDir: root,
        packager: { appInfo: { productFilename: 'Intent' } },
      }),
    ).rejects.toThrow(/Wrong architecture.*intentd/);
  });
  it.each(['x64', 'arm64'])('reads the CPU of real %s Mach-O files', (arch) => {
    const file = put(temporaryDirectory(), 'helper', binary(arch));
    expect(native.binaryArchitectures(file)).toEqual([arch]);
    expect(native.binaryMatchesArchitecture(file, arch)).toBe(true);
    expect(native.binaryMatchesArchitecture(file, arch === 'x64' ? 'arm64' : 'x64')).toBe(false);
  });

  for (const arch of ['x64', 'arm64']) {
    it(`accepts all six staged ${arch} executable types`, () => {
      const root = temporaryDirectory();
      for (const file of staged) put(root, file.replace('ARCH', arch), binary(arch));
      expect(() => native.validateStagedMacBinaries(root, arch)).not.toThrow();
    });
    it.each(staged)(`rejects a stale foreign binary in a ${arch} staging tree: %s`, (wrongFile) => {
      const root = temporaryDirectory();
      for (const file of staged) put(root, file.replace('ARCH', arch), binary(arch));
      put(root, wrongFile.replace('ARCH', arch), binary(arch === 'x64' ? 'arm64' : 'x64'));
      expect(() => native.validateStagedMacBinaries(root, arch)).toThrow(/Wrong architecture/);
    });
    it.each(staged)(`requires every staged ${arch} executable: %s`, (missingFile) => {
      const root = temporaryDirectory();
      for (const file of staged.filter((file) => file !== missingFile)) {
        put(root, file.replace('ARCH', arch), binary(arch));
      }
      expect(() => native.validateStagedMacBinaries(root, arch)).toThrow(/ENOENT/);
    });
    it(`checks the assembled ${arch} app, including Electron and transitive helpers`, () => {
      const root = temporaryDirectory();
      for (const file of packaged) put(root, file, binary(arch));
      put(root, 'Contents/MacOS/Intent', binary(arch));
      put(root, 'Contents/Resources/readme.txt', Buffer.from('not executable'));
      expect(() => native.validatePackagedMacBinaries(root, arch)).not.toThrow();
      put(root, 'Contents/Frameworks/Another Helper', binary(arch === 'x64' ? 'arm64' : 'x64'));
      expect(() => native.validatePackagedMacBinaries(root, arch)).toThrow(/Wrong architecture/);
    });
  }

  it('rejects an ELF native addon in a Mac app', () => {
    const root = temporaryDirectory();
    for (const file of packaged) put(root, file, binary('x64'));
    put(
      root,
      'Contents/Resources/app.asar.unpacked/node_modules/other/addon.node',
      Buffer.from('\x7fELF'),
    );
    expect(() => native.validatePackagedMacBinaries(root, 'x64')).toThrow(/Not a Mach-O/);
  });

  it('accepts a universal dependency containing the target and rejects truncated headers', () => {
    const fat = Buffer.alloc(48);
    fat.writeUInt32BE(0xcafebabe, 0);
    fat.writeUInt32BE(2, 4);
    fat.writeUInt32BE(0x01000007, 8);
    fat.writeUInt32BE(0x0100000c, 28);
    const file = put(temporaryDirectory(), 'universal', fat);
    expect(native.binaryArchitectures(file)).toEqual(['x64', 'arm64']);
    writeFileSync(file, fat.subarray(0, 12));
    expect(() => native.binaryArchitectures(file)).toThrow(/Invalid Mach-O/);
    expect(native.binaryMatchesArchitecture(file, 'arm64')).toBe(false);
  });
});
