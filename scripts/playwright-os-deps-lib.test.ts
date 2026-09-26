import { describe, expect, it } from 'vitest';
import {
  nonFontPackagesFromDryRun,
  parseInstallDepsDryRun,
  withoutFontPackages,
} from './playwright-os-deps-lib.mjs';

describe('supplier 1.63 OS dependency reports', () => {
  it('parses missing packages only with the missing-dependency exit code', () => {
    const report = 'Missing system dependencies (3):\n  libnss3\n  fonts-liberation\n  xvfb\n';
    expect(parseInstallDepsDryRun(report, 1)).toEqual(['libnss3', 'fonts-liberation', 'xvfb']);
    expect(nonFontPackagesFromDryRun(report, 1)).toEqual(['libnss3', 'xvfb']);
    expect(() => parseInstallDepsDryRun(report, 0)).toThrow(/Unexpected install-deps/);
  });

  it('accepts a fully installed host or one missing only fonts without requesting apt', () => {
    expect(nonFontPackagesFromDryRun('All system dependencies are installed.\n', 0)).toEqual([]);
    expect(
      nonFontPackagesFromDryRun(
        'Missing system dependencies (2):\n  fonts-liberation\n  xfonts-scalable\n',
        1,
      ),
    ).toEqual([]);
  });

  it.each([
    ['', 0],
    ['All system dependencies are installed.', 1],
    ['Missing system dependencies (2):\n  libnss3', 1],
    ['Missing system dependencies (1):\n  libnss3\n  xvfb', 1],
    ['Missing system dependencies (2):\n  libnss3\n  libnss3', 1],
    ['Missing system dependencies (1):\n  libnss3; touch /tmp/unsafe', 1],
    ['Missing system dependencies (1):\n  libnss3\nwarning', 1],
    ['Missing system dependencies (1):\n  libnss3', 2],
    ['apt-get install -y --no-install-recommends libnss3', 0],
  ])('rejects partial, malformed, stale-format or unsuccessful output %j', (output, status) => {
    expect(() => parseInstallDepsDryRun(output, status)).toThrow(/Unexpected install-deps/);
  });

  it('filters fonts and deduplicates without discarding shared libraries', () => {
    expect(
      withoutFontPackages([
        'libfontconfig1',
        'fonts-liberation',
        'xfonts-scalable',
        'xvfb',
        'xvfb',
      ]),
    ).toEqual(['libfontconfig1', 'xvfb']);
  });
});
