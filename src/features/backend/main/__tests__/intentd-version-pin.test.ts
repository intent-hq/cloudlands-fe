/**
 * Tests for the intentd version-pin utilities: pin-file parsing/reading and
 * the semver comparison used against an adopted daemon's reported version.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  compareToPinnedVersion,
  parseVersionPin,
  readPinnedVersion,
  resolvePinFilePath,
} from '../intentd-version-pin';

describe('parseVersionPin', () => {
  it('parses a bare semver line, ignoring comments and blanks', () => {
    expect(parseVersionPin('# comment\n\n0.1.0\n')).toBe('0.1.0');
  });

  it('accepts prerelease versions', () => {
    expect(parseVersionPin('0.2.0-beta.1\n')).toBe('0.2.0-beta.1');
  });

  it('throws on multiple version lines', () => {
    expect(() => parseVersionPin('0.1.0\n0.2.0\n')).toThrow(/exactly one version line/);
  });

  it('throws on empty content', () => {
    expect(() => parseVersionPin('# only comments\n')).toThrow(/exactly one version line/);
  });

  it('throws on a leading v', () => {
    expect(() => parseVersionPin('v0.1.0\n')).toThrow(/no leading "v"/);
  });
});

describe('resolvePinFilePath / readPinnedVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intentd-pin-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves resourcesPath/intentd.version when packaged', () => {
    expect(resolvePinFilePath(true, '/app/resources')).toBe('/app/resources/intentd.version');
  });

  it('resolves the FE-root pin file in dev and reads the real pin', () => {
    const pinPath = resolvePinFilePath(false);
    // Anchor the expectation to this test file's location (5 levels below the
    // FE root) so the assertion holds regardless of the checkout's directory name.
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const feRoot = path.resolve(testDir, '../../../../..');
    expect(pinPath).toBe(path.join(feRoot, 'intentd.version'));
    const pinned = readPinnedVersion();
    expect(pinned).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads a packaged pin file from resourcesPath', () => {
    fs.writeFileSync(path.join(tmpDir, 'intentd.version'), '# pin\n1.2.3\n');
    expect(readPinnedVersion({ isPackaged: true, resourcesPath: tmpDir })).toBe('1.2.3');
  });

  it('returns null when the pin file is missing', () => {
    expect(readPinnedVersion({ isPackaged: true, resourcesPath: tmpDir })).toBeNull();
  });

  it('returns null when the pin file is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, 'intentd.version'), 'not a version\n');
    expect(readPinnedVersion({ isPackaged: true, resourcesPath: tmpDir })).toBeNull();
  });
});

describe('compareToPinnedVersion', () => {
  it('returns equal for identical versions', () => {
    expect(compareToPinnedVersion('0.1.0', '0.1.0')).toBe('equal');
  });

  it('compares core versions', () => {
    expect(compareToPinnedVersion('0.1.0', '0.2.0')).toBe('older');
    expect(compareToPinnedVersion('0.3.0', '0.2.0')).toBe('newer');
    expect(compareToPinnedVersion('1.0.0', '0.9.9')).toBe('newer');
    expect(compareToPinnedVersion('0.1.9', '0.1.10')).toBe('older');
  });

  it('tolerates a leading v on the daemon version', () => {
    expect(compareToPinnedVersion('v0.1.0', '0.1.0')).toBe('equal');
  });

  it('ranks a release above any prerelease of the same core', () => {
    expect(compareToPinnedVersion('0.1.0', '0.1.0-beta.1')).toBe('newer');
    expect(compareToPinnedVersion('0.1.0-beta.1', '0.1.0')).toBe('older');
  });

  it('orders prerelease identifiers per semver §11', () => {
    expect(compareToPinnedVersion('0.1.0-beta.1', '0.1.0-beta.2')).toBe('older');
    expect(compareToPinnedVersion('0.1.0-beta.2', '0.1.0-beta.1')).toBe('newer');
    expect(compareToPinnedVersion('0.1.0-alpha', '0.1.0-beta')).toBe('older');
    expect(compareToPinnedVersion('0.1.0-beta', '0.1.0-beta.1')).toBe('older');
    expect(compareToPinnedVersion('0.1.0-1', '0.1.0-alpha')).toBe('older');
    expect(compareToPinnedVersion('0.1.0-beta.1', '0.1.0-beta.1')).toBe('equal');
  });

  it('ignores build metadata', () => {
    expect(compareToPinnedVersion('0.1.0+abc', '0.1.0')).toBe('equal');
  });

  it('returns unknown for unparsable versions', () => {
    expect(compareToPinnedVersion('garbage', '0.1.0')).toBe('unknown');
    expect(compareToPinnedVersion('0.1.0', 'garbage')).toBe('unknown');
    expect(compareToPinnedVersion('0.1', '0.1.0')).toBe('unknown');
  });
});
