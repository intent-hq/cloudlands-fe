import { describe, expect, it } from 'vitest';
import {
  nonFontPackagesFromDryRun,
  parseInstallDepsDryRun,
  withoutFontPackages,
} from './playwright-os-deps-lib.mjs';

// Verbatim `playwright install-deps --dry-run chromium` output from
// playwright 1.58.2 (the CT-aligned runner) on Ubuntu 24.04.
const PLAYWRIGHT_1_58_2_DRY_RUN =
  'sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf"\n';

describe('parseInstallDepsDryRun', () => {
  it('extracts every package from the real playwright 1.58.2 dry-run line', () => {
    const packages = parseInstallDepsDryRun(PLAYWRIGHT_1_58_2_DRY_RUN);
    expect(packages).toHaveLength(33);
    expect(packages.filter((pkg) => /^x?fonts-/.test(pkg))).toHaveLength(9);
    expect(packages[0]).toBe('libasound2t64');
    expect(packages.at(-1)).toBe('fonts-freefont-ttf');
    expect(packages).toContain('xvfb');
    expect(packages).not.toContain('-y');
    expect(packages).not.toContain('--no-install-recommends');
    expect(packages.some((pkg) => pkg.includes('"'))).toBe(false);
  });

  it('rejects a package list that continues on a second line (partial-parse regression)', () => {
    const output = 'apt-get install -y --no-install-recommends libc6\nlibmissing\n';
    expect(() => parseInstallDepsDryRun(output)).toThrow(/unexpected extra install-deps/);
  });

  it('rejects output with no apt-get install command', () => {
    expect(() => parseInstallDepsDryRun('nothing here\n')).toThrow(/found 0/);
    expect(() => parseInstallDepsDryRun('')).toThrow(/found 0/);
  });

  it('rejects output with more than one apt-get install command', () => {
    const output =
      'apt-get install -y --no-install-recommends libnss3\napt-get install -y --no-install-recommends libgbm1\n';
    expect(() => parseInstallDepsDryRun(output)).toThrow(/found 2/);
  });

  it('rejects an install command that carries no packages', () => {
    expect(() => parseInstallDepsDryRun('apt-get install -y --no-install-recommends\n')).toThrow(
      /no packages/,
    );
  });

  it('rejects tokens that are not Debian package names', () => {
    const output = 'sh -c "apt-get install -y libnss3 && rm -rf /tmp/x"\n';
    expect(() => parseInstallDepsDryRun(output)).toThrow(/unexpected tokens/);
  });
});

describe('withoutFontPackages', () => {
  it('drops fonts-* and xfonts-* but keeps font-rendering libraries', () => {
    expect(
      withoutFontPackages([
        'libfreetype6',
        'fonts-liberation',
        'xfonts-cyrillic',
        'libfontconfig1',
        'fonts-noto-color-emoji',
      ]),
    ).toEqual(['libfontconfig1', 'libfreetype6']);
  });

  it('returns a sorted, de-duplicated list', () => {
    expect(withoutFontPackages(['xvfb', 'libnss3', 'xvfb'])).toEqual(['libnss3', 'xvfb']);
  });
});

describe('nonFontPackagesFromDryRun', () => {
  it('yields the 24 non-font Chromium dependencies for playwright 1.58.2', () => {
    const packages = nonFontPackagesFromDryRun(PLAYWRIGHT_1_58_2_DRY_RUN);
    expect(packages).toHaveLength(24);
    expect(packages.filter((pkg) => /^x?fonts-/.test(pkg))).toEqual([]);
    expect(packages).toEqual([...packages].sort());
    expect(packages).toEqual(
      expect.arrayContaining(['libnss3', 'libgbm1', 'xvfb', 'libfontconfig1']),
    );
  });
});
