// @verify-changed-triggers: electron-builder.yml, .github/workflows/release-alpha.yml

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { validateReleaseAssetNames } from './validate-release-asset-names.mjs';

// Resolve electron-builder's own config parser and macro expander so this test
// exercises the packaging configuration without building a Windows executable.
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const { expandMacro } = builderRequire('app-builder-lib/out/util/macroExpander');

const directories: string[] = [];

function assets(names: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'intent-release-assets-'));
  directories.push(directory);
  for (const name of names) writeFileSync(join(directory, name), 'release asset');
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('release asset filename validation', () => {
  it.each(['2.145.1', '2.153.0', '2.153.0-manual.123'])(
    'generates GitHub-compatible Windows names from the packaging config for %s',
    (version) => {
      const config = load(readFileSync('electron-builder.yml', 'utf8'));
      const appInfo = {
        productName: config.productName,
        sanitizedProductName: config.productName,
        version,
      };
      const installer = expandMacro(config.nsis.artifactName, 'x64', appInfo, { ext: 'exe' });
      const portable = expandMacro(config.portable.artifactName, 'x64', appInfo, { ext: 'exe' });
      expect(installer).toBe(`Intent.Setup.${version}.exe`);
      expect(portable).toBe(`Intent.${version}.exe`);
      expect(() =>
        validateReleaseAssetNames(assets([installer, `${installer}.blockmap`, portable])),
      ).not.toThrow();
    },
  );

  it('accepts published filenames for every platform and updater feeds', () => {
    const directory = assets([
      'Intent.Setup.2.145.1.exe',
      'Intent.Setup.2.145.1.exe.blockmap',
      'Intent.2.145.1.exe',
      'Intent-2.145.1-arm64-mac.zip',
      'Intent-2.145.1-arm64.dmg',
      'Intent-2.145.1.AppImage',
      'intent_2.145.1_amd64.deb',
      'latest.yml',
      'latest-mac.yml',
      'latest-linux.yml',
      'latest-linux-arm64.yml',
    ]);
    expect(() => validateReleaseAssetNames(directory)).not.toThrow();
    expect(() =>
      execFileSync(process.execPath, ['scripts/validate-release-asset-names.mjs', directory]),
    ).not.toThrow();
  });

  it.each([
    'Intent Setup 2.145.1.exe',
    'Intent Setup 2.145.1.exe.blockmap',
    'Intent 2.145.1.exe',
    'Intent%20Setup%202.145.1.exe',
    'Intent+Setup.exe',
    '.Intent.exe',
    'Intent.exe.',
  ])('rejects an asset GitHub would rename: %s', (name) => {
    expect(() => validateReleaseAssetNames(assets([name]))).toThrow(name);
  });

  it('fails the publishing command for the original Windows installer name', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/validate-release-asset-names.mjs', assets(['Intent Setup 2.145.1.exe'])],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Intent Setup 2.145.1.exe');
  });

  it('rejects missing or empty artifact collections', () => {
    const empty = assets([]);
    expect(() => validateReleaseAssetNames(empty)).toThrow('No release assets');
    expect(() => validateReleaseAssetNames(join(empty, 'missing'))).toThrow();
  });
});
