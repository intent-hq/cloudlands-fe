// @verify-changed-triggers: src/assets/icons/app-icon/*.png, electron-builder.yml,
//   .github/workflows/release-alpha.yml, .github/workflows/manual-signed-build.yml

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

  it('compiles a native black background and the approved mark without added effects', async () => {
    const outputDirectory = join(temporaryDirectory(), 'output');
    const execute = (command: string, args: string[]) => {
      expect(command).toBe('xcrun');
      if (args[0] === '--find') return '/Applications/Xcode.app/usr/bin/actool';
      if (args[0] === 'xcodebuild') return 'Xcode 26.0.1\nBuild version 17A400';

      const iconPackage = args[1];
      expect(readFileSync(join(iconPackage, 'icon.json'), 'utf8')).toBe(
        `${JSON.stringify(ICON_DOCUMENT, null, 2)}\n`,
      );
      expect(readFileSync(join(iconPackage, 'Assets/Lime-Mark.png')).length).toBeGreaterThan(0);
      expect(args).toEqual(
        expect.arrayContaining(['--app-icon', 'Intent', '--platform', 'macosx']),
      );
      writeFileSync(join(outputDirectory, 'Assets.car'), 'compiled icon');
      return undefined;
    };

    await expect(compileModernMacOSIcon({ execute, outputDirectory })).resolves.toBe(
      join(outputDirectory, 'Assets.car'),
    );
    expect(ICON_DOCUMENT.fill).toEqual({
      solid: 'extended-srgb:0.03137,0.03137,0.03137,1.00000',
    });
    expect(ICON_DOCUMENT.groups[0]).toMatchObject({
      shadow: { kind: 'none', opacity: 0 },
      specular: false,
      translucency: { enabled: false, value: 0 },
    });
    expect(ICON_DOCUMENT.groups[0].layers[0]).toMatchObject({ glass: false });
  });

  it('fails clearly when the required Xcode icon compiler is unavailable', async () => {
    await expect(
      compileModernMacOSIcon({
        execute: () => {
          throw new Error('not found');
        },
        outputDirectory: temporaryDirectory(),
      }),
    ).rejects.toThrow('requires Xcode 26 or newer with actool');
  });

  it('fails clearly when the selected Xcode toolchain is too old', async () => {
    const execute = (_command: string, args: string[]) => {
      if (args[0] === '--find') return '/Applications/Xcode.app/usr/bin/actool';
      if (args[0] === 'xcodebuild') return 'Xcode 16.4\nBuild version 16F6';
      throw new Error('actool must not run with an old Xcode toolchain');
    };

    await expect(
      compileModernMacOSIcon({ execute, outputDirectory: temporaryDirectory() }),
    ).rejects.toThrow(
      'requires Xcode 26 or newer with actool, but the selected toolchain is Xcode 16.4',
    );
  });

  it('selects an installed Xcode 26 toolchain in every hosted macOS packaging job', () => {
    for (const workflow of ['release-alpha.yml', 'manual-signed-build.yml']) {
      const config = readFileSync(join(process.cwd(), '.github/workflows', workflow), 'utf8');
      const selection = config.indexOf('- name: Select Xcode 26');
      expect(selection, workflow).toBeGreaterThan(config.indexOf('build-macos:'));
      expect(selection, workflow).toBeLessThan(config.indexOf('- name: Setup pnpm', selection));
      expect(config, workflow).toContain("-name 'Xcode_26*.app'");
      expect(config, workflow).toContain('echo "DEVELOPER_DIR=$developer_dir" >> "$GITHUB_ENV"');
    }
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
