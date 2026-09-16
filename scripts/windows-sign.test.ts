// @vitest-environment node
// @verify-changed-triggers: scripts/windows-sign.cjs, electron-builder.yml

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { shouldSign } = createRequire(import.meta.url)('./windows-sign.cjs') as {
  shouldSign: (filePath: string, productName?: string) => boolean;
};

// Resolve electron-builder's own config parser and macro expander so the
// accepted names come from the packaging configuration, not from a copy of it.
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const { expandMacro } = builderRequire('app-builder-lib/out/util/macroExpander');

const config = load(readFileSync('electron-builder.yml', 'utf8'));
const productName: string = config.productName;

function artifactName(pattern: string, version: string) {
  return expandMacro(
    pattern,
    null,
    { productName, sanitizedProductName: productName, version },
    { ext: 'exe' },
  );
}

const OUT = join('C:', 'a', 'cloudlands-fe', 'dist-electron');

describe('windows-sign shouldSign', () => {
  it.each([
    '2.153.0',
    '2.153.0-manual.123',
    '3.0.0-alpha.7',
    '1.2.3+build.1',
    '1.2.3-rc.1+sha.abc',
  ])(
    'signs the NSIS installer and the portable exe named by electron-builder.yml for %s',
    (version) => {
      const installer = artifactName(config.nsis.artifactName, version);
      const portable = artifactName(config.portable.artifactName, version);
      expect(installer).not.toBe(portable);
      expect(shouldSign(join(OUT, installer), productName)).toBe(true);
      expect(shouldSign(join(OUT, portable), productName)).toBe(true);
    },
  );

  it.each(['win-unpacked', 'win-arm64-unpacked', 'win-ia32-unpacked'])(
    'signs the main app exe directly inside %s',
    (dir) => {
      expect(shouldSign(join(OUT, dir, `${productName}.exe`), productName)).toBe(true);
    },
  );

  it.each([
    join('win-unpacked', 'resources', 'elevate.exe'),
    join('win-unpacked', 'resources', 'intentd', 'intentd.exe'),
    join(
      'win-unpacked',
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'pagent.exe',
    ),
    join(
      'win-unpacked',
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'winpty-agent.exe',
    ),
  ])('skips the bundled helper %s', (relative) => {
    expect(shouldSign(join(OUT, relative), productName)).toBe(false);
  });

  it('skips the NSIS uninstaller stub electron-builder writes next to the installer', () => {
    const installer = artifactName(config.nsis.artifactName, '2.153.0');
    const stub = `${installer.slice(0, -'exe'.length)}__uninstaller.exe`;
    expect(shouldSign(join(OUT, stub), productName)).toBe(false);
    expect(shouldSign(join(OUT, `__uninstaller-nsis-${productName}.exe`), productName)).toBe(false);
  });

  it('skips top-level output files that are not versioned artifacts of this product', () => {
    expect(shouldSign(join(OUT, `${productName}.exe`), productName)).toBe(false);
    expect(shouldSign(join(OUT, 'Other.2.153.0.exe'), productName)).toBe(false);
    expect(shouldSign(join(OUT, `${productName}.2.153.0.exe.blockmap`), productName)).toBe(false);
    expect(shouldSign(join(OUT, 'latest.yml'), productName)).toBe(false);
  });

  it('falls back to any product prefix when electron-builder passes no name', () => {
    expect(shouldSign(join(OUT, 'Other.2.153.0.exe'))).toBe(true);
    expect(shouldSign(join(OUT, 'Other.Setup.2.153.0.exe'))).toBe(true);
    expect(shouldSign(join(OUT, 'pagent.exe'))).toBe(false);
  });
});
