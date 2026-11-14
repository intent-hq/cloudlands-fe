// @verify-changed-triggers: src/assets/icons/app-icon/*.png, build/macos-icon-pin/*, electron-builder.yml,
//   .github/workflows/release-alpha.yml, .github/workflows/manual-signed-build.yml

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import buildModernMacOSIcon, {
  ACTOOL_TIMEOUT_MS,
  compileModernMacOSIcon,
  ICON_DOCUMENT,
  iconInputsDigest,
  PIN_DIRECTORY,
  pinCompiledIcon,
} from './build-macos-icon.js';

// Smallest file that looks like an actool asset catalog holding the Intent icon.
const VALID_CAR = 'BOMStore\u0000\u0000Intent.iconstack\u0000compiled';

const temporaryDirectories: string[] = [];

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Puts a fake `xcrun` first on PATH. `--find` and `xcodebuild -version` answer
 * like Xcode 26; the first `hangAttempts` `actool` runs start a grandchild that
 * sleeps for 8 s (recording its pid) and wait on it, like the hung actool on
 * WarpBuild runners; later runs write Assets.car to the --compile directory.
 */
function fakeXcrun(hangAttempts: number) {
  const state = temporaryDirectory();
  const bin = join(state, 'bin');
  const script = join(bin, 'xcrun');
  mkdirSync(bin);
  writeFileSync(
    script,
    `#!/bin/sh
case "$1" in
  --find) echo /fake/actool ;;
  xcodebuild) echo 'Xcode 26.0.1' ;;
  actool)
    n=$(( $(cat "${state}/count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "${state}/count"
    if [ "$n" -le ${hangAttempts} ]; then
      sleep 8 &
      echo "$!" > "${state}/grandchild-$n"
      wait
      echo done > "${state}/finished-$n"
      exit 1
    fi
    while [ "$1" != --compile ]; do shift; done
    printf 'BOMStore Intent.iconstack compiled\\n' > "$2/Assets.car"
    ;;
esac
`,
  );
  chmodSync(script, 0o755);
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
  return {
    attempts: () => Number(readFileSync(join(state, 'count'), 'utf8')),
    grandchild: (n: number) => Number(readFileSync(join(state, `grandchild-${n}`), 'utf8')),
    finished: (n: number) => existsSync(join(state, `finished-${n}`)),
  };
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const xcode26 = (_command: string, args: string[]) => {
  if (args[0] === '--find') return '/Applications/Xcode.app/usr/bin/actool';
  if (args[0] === 'xcodebuild') return 'Xcode 26.3\nBuild version 17C529';
  throw new Error(`unexpected synchronous xcrun ${args[0]}`);
};

const actoolMustNotRun = async () => {
  throw new Error('actool must not run when a matching pinned icon exists');
};

/** A pin directory with no pin in it, so compilation goes through actool. */
function noPin() {
  return temporaryDirectory();
}

async function writePin(car: string | Buffer, overrides: Record<string, string> = {}) {
  const pinDirectory = temporaryDirectory();
  writeFileSync(join(pinDirectory, 'Assets.car'), car);
  writeFileSync(
    join(pinDirectory, 'pin.json'),
    JSON.stringify({
      inputsSha256: await iconInputsDigest(),
      assetsSha256: sha256(car),
      xcode: 'Xcode 26.3 (17C529)',
      ...overrides,
    }),
  );
  return pinDirectory;
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'intent-macos-icon-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.unstubAllEnvs();
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
      throw new Error(`unexpected synchronous xcrun ${args[0]}`);
    };
    const runActool = async (command: string, args: string[], options: { timeoutMs: number }) => {
      expect(command).toBe('xcrun');
      expect(args[0]).toBe('actool');
      expect(options.timeoutMs).toBe(ACTOOL_TIMEOUT_MS);
      const iconPackage = args[1];
      expect(readFileSync(join(iconPackage, 'icon.json'), 'utf8')).toBe(
        `${JSON.stringify(ICON_DOCUMENT, null, 2)}\n`,
      );
      expect(readFileSync(join(iconPackage, 'Assets/Lime-Mark.png')).length).toBeGreaterThan(0);
      expect(args).toEqual(
        expect.arrayContaining(['--app-icon', 'Intent', '--platform', 'macosx']),
      );
      const compileDirectory = args[args.indexOf('--compile') + 1];
      expect(compileDirectory).not.toBe(outputDirectory);
      writeFileSync(join(compileDirectory, 'Assets.car'), VALID_CAR);
    };

    await expect(
      compileModernMacOSIcon({ execute, runActool, outputDirectory, pinDirectory: noPin() }),
    ).resolves.toBe(join(outputDirectory, 'Assets.car'));
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
    expect(config).toMatch(/^beforePack: scripts\/desktop-before-pack\.mjs$/m);
    expect(config).toContain('    - from: build/macos-icon/Assets.car\n      to: Assets.car');
    expect(config).toContain('    CFBundleIconName: Intent');
    expect(config).toContain('    CFBundleIconFile: icon.icns');
    expect(config).toContain('  icon: src/assets/icons/icon.icns');
  });

  it('stops a hung actool, kills its process tree, and retries', async () => {
    const xcrun = fakeXcrun(1);
    const outputDirectory = join(temporaryDirectory(), 'output');
    await expect(
      compileModernMacOSIcon({
        outputDirectory,
        pinDirectory: noPin(),
        actoolTimeoutMs: 2_000,
        actoolAttempts: 3,
      }),
    ).resolves.toBe(join(outputDirectory, 'Assets.car'));
    expect(readFileSync(join(outputDirectory, 'Assets.car'), 'utf8')).toBe(
      'BOMStore Intent.iconstack compiled\n',
    );
    expect(xcrun.attempts()).toBe(2);
    // The hung attempt was stopped at its deadline rather than left to finish.
    expect(xcrun.finished(1)).toBe(false);
    expect(alive(xcrun.grandchild(1))).toBe(false);
  });

  it('fails clearly once every actool attempt has hung', async () => {
    const xcrun = fakeXcrun(2);
    await expect(
      compileModernMacOSIcon({
        outputDirectory: join(temporaryDirectory(), 'output'),
        pinDirectory: noPin(),
        actoolTimeoutMs: 2_000,
        actoolAttempts: 2,
      }),
    ).rejects.toThrow(/actool .*did not finish within .* after 2 attempts/);
    expect(xcrun.attempts()).toBe(2);
    expect(alive(xcrun.grandchild(1))).toBe(false);
    expect(alive(xcrun.grandchild(2))).toBe(false);
  });

  it('logs the stuck process tree when an actool attempt hangs', async () => {
    fakeXcrun(1);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await compileModernMacOSIcon({
        outputDirectory: join(temporaryDirectory(), 'output'),
        pinDirectory: noPin(),
        actoolTimeoutMs: 2_000,
        actoolAttempts: 2,
      });
      const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toMatch(/Hung xcrun actool process tree/);
      expect(output).toMatch(/sleep 8/);
    } finally {
      log.mockRestore();
    }
  });
});

describe('pinned macOS icon resource', () => {
  it('uses a pin that matches the icon inputs without running actool', async () => {
    const outputDirectory = join(temporaryDirectory(), 'output');
    const pinDirectory = await writePin(VALID_CAR);
    await expect(
      compileModernMacOSIcon({
        execute: xcode26,
        runActool: actoolMustNotRun,
        outputDirectory,
        pinDirectory,
      }),
    ).resolves.toBe(join(outputDirectory, 'Assets.car'));
    expect(readFileSync(join(outputDirectory, 'Assets.car'), 'utf8')).toBe(VALID_CAR);
  });

  it('compiles with actool when the pin was made from different icon inputs', async () => {
    const outputDirectory = join(temporaryDirectory(), 'output');
    const pinDirectory = await writePin(VALID_CAR, { inputsSha256: '0'.repeat(64) });
    const runActool = vi.fn(async (_command: string, args: string[]) => {
      writeFileSync(join(args[args.indexOf('--compile') + 1], 'Assets.car'), `${VALID_CAR}-fresh`);
    });
    await compileModernMacOSIcon({ execute: xcode26, runActool, outputDirectory, pinDirectory });
    expect(runActool).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(outputDirectory, 'Assets.car'), 'utf8')).toBe(`${VALID_CAR}-fresh`);
  });

  it('refuses a pinned resource whose bytes do not match the pin record', async () => {
    const pinDirectory = await writePin(VALID_CAR, { assetsSha256: sha256('something else') });
    await expect(
      compileModernMacOSIcon({
        execute: xcode26,
        runActool: actoolMustNotRun,
        outputDirectory: join(temporaryDirectory(), 'output'),
        pinDirectory,
      }),
    ).rejects.toThrow(/pinned .*Assets\.car does not match/);
  });

  it('refuses a pinned resource that is not an asset catalog with the Intent icon', async () => {
    const pinDirectory = await writePin('BOMStore without the icon');
    await expect(
      compileModernMacOSIcon({
        execute: xcode26,
        runActool: actoolMustNotRun,
        outputDirectory: join(temporaryDirectory(), 'output'),
        pinDirectory,
      }),
    ).rejects.toThrow(/not a compiled asset catalog containing the Intent icon/);
  });

  it('refuses actool output that is not an asset catalog with the Intent icon', async () => {
    const runActool = async (_command: string, args: string[]) => {
      writeFileSync(join(args[args.indexOf('--compile') + 1], 'Assets.car'), 'garbage');
    };
    await expect(
      compileModernMacOSIcon({
        execute: xcode26,
        runActool,
        outputDirectory: join(temporaryDirectory(), 'output'),
        pinDirectory: noPin(),
      }),
    ).rejects.toThrow(/not a compiled asset catalog containing the Intent icon/);
  });

  it('re-pins with a fresh actool compile that later builds reuse', async () => {
    const pinDirectory = await writePin(VALID_CAR);
    const runActool = vi.fn(async (_command: string, args: string[]) => {
      writeFileSync(join(args[args.indexOf('--compile') + 1], 'Assets.car'), `${VALID_CAR}-new`);
    });
    await pinCompiledIcon({
      execute: xcode26,
      runActool,
      outputDirectory: join(temporaryDirectory(), 'output'),
      pinDirectory,
    });
    expect(runActool).toHaveBeenCalledTimes(1);
    const pin = JSON.parse(readFileSync(join(pinDirectory, 'pin.json'), 'utf8'));
    expect(pin).toEqual({
      inputsSha256: await iconInputsDigest(),
      assetsSha256: sha256(`${VALID_CAR}-new`),
      xcode: 'Xcode 26.3 (17C529)',
    });

    const outputDirectory = join(temporaryDirectory(), 'output');
    await compileModernMacOSIcon({
      execute: xcode26,
      runActool: actoolMustNotRun,
      outputDirectory,
      pinDirectory,
    });
    expect(readFileSync(join(outputDirectory, 'Assets.car'), 'utf8')).toBe(`${VALID_CAR}-new`);
  });

  it('keys the pin on the icon artwork', async () => {
    const changed = join(temporaryDirectory(), 'Icon-1024.png');
    copyFileSync(join(process.cwd(), 'src/assets/icons/app-icon/Icon-1024.png'), changed);
    const sharp = (await import('sharp')).default;
    await sharp(changed).flop().toFile(`${changed}.flopped.png`);
    expect(await iconInputsDigest(`${changed}.flopped.png`)).not.toBe(await iconInputsDigest());
  });

  // Changing the artwork, icon.json document or actool options needs a new pin:
  // on a Mac with Xcode 26 run `node scripts/build-macos-icon.js --pin` and commit
  // build/macos-icon-pin/. Release builds otherwise fall back to actool, which
  // hangs on some WarpBuild runners.
  it('ships a pin that matches the current icon inputs', async () => {
    const pin = JSON.parse(readFileSync(join(PIN_DIRECTORY, 'pin.json'), 'utf8'));
    expect(pin.inputsSha256).toBe(await iconInputsDigest());
    const car = readFileSync(join(PIN_DIRECTORY, 'Assets.car'));
    expect(sha256(car)).toBe(pin.assetsSha256);
    expect(car.subarray(0, 8).toString('latin1')).toBe('BOMStore');
    expect(car.includes('Intent.iconstack')).toBe(true);
  });
});
