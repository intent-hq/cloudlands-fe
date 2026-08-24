import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import buildModernMacOSIcon, { compileModernMacOSIcon, ICON_DOCUMENT } from './build-macos-icon.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'intent-macos-icon-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('modern macOS icon compiler', () => {
  it('keeps non-macOS packaging unchanged', () => {
    expect(buildModernMacOSIcon({ electronPlatformName: 'win32' })).toBeUndefined();
  });

  it('compiles the approved artwork without adding visual effects', () => {
    const outputDirectory = join(temporaryDirectory(), 'output');
    const approvedSource = join(process.cwd(), 'src/assets/icons/app-icon/Icon-1024.png');
    const execute = (command: string, args: string[]) => {
      expect(command).toBe('xcrun');
      if (args[0] === '--find') return '/Applications/Xcode.app/usr/bin/actool';

      const iconPackage = args[1];
      expect(readFileSync(join(iconPackage, 'icon.json'), 'utf8')).toBe(
        `${JSON.stringify(ICON_DOCUMENT, null, 2)}\n`,
      );
      expect(readFileSync(join(iconPackage, 'Assets/Icon-1024.png'))).toEqual(
        readFileSync(approvedSource),
      );
      expect(args).toEqual(
        expect.arrayContaining(['--app-icon', 'Intent', '--platform', 'macosx']),
      );
      writeFileSync(join(outputDirectory, 'Assets.car'), 'compiled icon');
      return undefined;
    };

    expect(compileModernMacOSIcon({ execute, outputDirectory })).toBe(
      join(outputDirectory, 'Assets.car'),
    );
    expect(ICON_DOCUMENT.groups[0]).toMatchObject({
      shadow: { kind: 'none', opacity: 0 },
      specular: false,
      translucency: { enabled: false, value: 0 },
    });
    expect(ICON_DOCUMENT.groups[0].layers[0]).toMatchObject({ glass: false });
  });

  it('fails clearly when the required Xcode icon compiler is unavailable', () => {
    expect(() =>
      compileModernMacOSIcon({
        execute: () => {
          throw new Error('not found');
        },
        outputDirectory: temporaryDirectory(),
      }),
    ).toThrow('requires Xcode 26 or newer with actool');
  });

  it('packages the modern resource and declares the legacy fallback', () => {
    const config = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8');
    expect(config).toMatch(/^beforePack: scripts\/build-macos-icon\.js$/m);
    expect(config).toContain('    - from: build/macos-icon/Assets.car\n      to: Assets.car');
    expect(config).toContain('    CFBundleIconName: Intent');
    expect(config).toContain('    CFBundleIconFile: icon.icns');
    expect(config).toContain('  icon: src/assets/icons/icon.icns');
  });
});
