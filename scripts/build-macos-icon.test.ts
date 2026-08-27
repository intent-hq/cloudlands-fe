import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import buildModernMacOSIcon, {
  compileModernMacOSIcon,
  createReleaseMark,
  ICON_DOCUMENT,
} from './build-macos-icon.js';

const temporaryDirectories: string[] = [];
const approvedReleaseHashes: Record<string, string> = {
  'Icon-32.png': '43c66ef86942ded6c9d1c571a51d9033bcf1523f227257efcdb6e7efc9d5d50d',
  'Icon-64.png': '6c1604960a14c54343778c31f8cfadc84b5ef193d2210c78f8929701e32b0b4d',
  'Icon-128.png': 'a75c9ef3a7a9bab995bed53550704c6f87e3af7f310b4e57d547da9859baa2ae',
  'Icon-256.png': '48f4424865e81f6dcf3347f7a39fea33cb40130415a16bbb53dbaaa8c91456b3',
  'Icon-512.png': '7f044671234348b6fe1c66f1c8b5c3b9d21432bc950c6364280d62b62e1d70dc',
  'Icon-1024.png': 'bb4b11616fc1c3409315334fc1dd040dbe7d642f5e1e84eba235118b35958649',
};

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
  it('pins every approved release PNG input', () => {
    const sourceDirectory = join(process.cwd(), 'src/assets/icons/app-icon');
    for (const [filename, expectedHash] of Object.entries(approvedReleaseHashes)) {
      const actualHash = createHash('sha256')
        .update(readFileSync(join(sourceDirectory, filename)))
        .digest('hex');
      expect(actualHash, filename).toBe(expectedHash);
    }
  });

  it('keeps non-macOS packaging unchanged', () => {
    expect(buildModernMacOSIcon({ electronPlatformName: 'win32' })).toBeUndefined();
  });

  it('extracts the approved lime mark without changing its colors', async () => {
    const approvedSource = join(process.cwd(), 'src/assets/icons/app-icon/Icon-1024.png');
    const [source, mark] = await Promise.all([
      sharp(approvedSource).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      createReleaseMark(approvedSource).then((data) =>
        sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      ),
    ]);

    expect(mark.info).toMatchObject({ width: source.info.width, height: source.info.height });
    let opaquePixels = 0;
    let colorMismatch = false;
    for (let offset = 0; offset < source.data.length; offset += 4) {
      if (mark.data[offset + 3] === 0) continue;
      opaquePixels += 1;
      colorMismatch ||= !mark.data
        .subarray(offset, offset + 3)
        .equals(source.data.subarray(offset, offset + 3));
    }
    expect(opaquePixels).toBeGreaterThan(70_000);
    expect(opaquePixels).toBeLessThan(80_000);
    expect(colorMismatch).toBe(false);
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

  it('keeps manual unsigned macOS packaging free of signing and publishing inputs', () => {
    const config = readFileSync(
      join(process.cwd(), '.github/workflows/manual-signed-build.yml'),
      'utf8',
    );
    expect(config).toContain('if [ "${{ inputs.sign }}" != "true" ]; then');
    expect(config).toContain('unset CSC_LINK CSC_KEY_PASSWORD');
    expect(config).toContain('pnpm run dist:mac --publish never');
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
