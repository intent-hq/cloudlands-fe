import { describe, expect, it } from 'vitest';
import {
  TARGET_BY_PLATFORM_ARCH,
  assetCandidates,
  checksumAssetName,
  isLinkListingLine,
  isSafeArchiveEntry,
  parseChecksumFile,
  parseVersionPin,
  releaseTag,
  resolveTarget,
  sha256Hex,
  sidecarBinaryName,
} from './fetch-sidecar-lib.mjs';

const HASH = 'a'.repeat(64);

describe('resolveTarget', () => {
  it.each([
    ['darwin', 'arm64', 'aarch64-apple-darwin'],
    ['darwin', 'x64', 'x86_64-apple-darwin'],
    ['linux', 'x64', 'x86_64-unknown-linux-musl'],
    ['linux', 'arm64', 'aarch64-unknown-linux-musl'],
    ['win32', 'x64', 'x86_64-pc-windows-msvc'],
  ])('maps %s/%s to %s', (platform, arch, target) => {
    expect(resolveTarget(platform, arch)).toBe(target);
  });

  it('throws for unsupported combinations, listing supported ones', () => {
    expect(() => resolveTarget('win32', 'arm64')).toThrow(
      /Unsupported platform\/arch "win32-arm64"/,
    );
    expect(() => resolveTarget('freebsd', 'x64')).toThrow(/darwin-arm64/);
  });

  it('covers all five release-pipeline targets', () => {
    expect(Object.values(TARGET_BY_PLATFORM_ARCH).sort()).toEqual([
      'aarch64-apple-darwin',
      'aarch64-unknown-linux-musl',
      'x86_64-apple-darwin',
      'x86_64-pc-windows-msvc',
      'x86_64-unknown-linux-musl',
    ]);
  });
});

describe('assetCandidates', () => {
  it('prefers tar.xz for unix targets', () => {
    expect(assetCandidates('aarch64-apple-darwin')).toEqual([
      'intentd-aarch64-apple-darwin.tar.xz',
      'intentd-aarch64-apple-darwin.tar.gz',
      'intentd-aarch64-apple-darwin.zip',
    ]);
  });

  it('prefers zip for windows targets', () => {
    expect(assetCandidates('x86_64-pc-windows-msvc')).toEqual([
      'intentd-x86_64-pc-windows-msvc.zip',
      'intentd-x86_64-pc-windows-msvc.tar.xz',
      'intentd-x86_64-pc-windows-msvc.tar.gz',
    ]);
  });
});

describe('naming helpers', () => {
  it('derives checksum asset names', () => {
    expect(checksumAssetName('intentd-x86_64-apple-darwin.tar.xz')).toBe(
      'intentd-x86_64-apple-darwin.tar.xz.sha256',
    );
  });

  it('uses .exe only for windows targets', () => {
    expect(sidecarBinaryName('x86_64-pc-windows-msvc')).toBe('intentd.exe');
    expect(sidecarBinaryName('x86_64-unknown-linux-musl')).toBe('intentd');
  });

  it('prefixes release tags with v exactly once', () => {
    expect(releaseTag('0.9.0')).toBe('v0.9.0');
    expect(releaseTag('v0.9.0')).toBe('v0.9.0');
  });
});

describe('parseVersionPin', () => {
  it('parses a bare version with surrounding whitespace and comments', () => {
    expect(parseVersionPin('# comment\n\n0.9.0\n')).toBe('0.9.0');
    expect(parseVersionPin('1.2.3-beta.4')).toBe('1.2.3-beta.4');
  });

  it('rejects empty, multi-line, and malformed pins', () => {
    expect(() => parseVersionPin('# only a comment\n')).toThrow(/exactly one version line/);
    expect(() => parseVersionPin('0.9.0\n1.0.0\n')).toThrow(/exactly one version line/);
    expect(() => parseVersionPin('v0.9.0\n')).toThrow(/Invalid intentd version pin/);
    expect(() => parseVersionPin('latest\n')).toThrow(/Invalid intentd version pin/);
  });
});

describe('parseChecksumFile', () => {
  const asset = 'intentd-x86_64-apple-darwin.tar.xz';

  it('parses a bare single-line hash', () => {
    expect(parseChecksumFile(`${HASH}\n`, asset)).toBe(HASH);
  });

  it('parses sha256sum-style lines and matches the asset name', () => {
    const content = `${'b'.repeat(64)}  other.tar.xz\n${HASH}  ${asset}\n`;
    expect(parseChecksumFile(content, asset)).toBe(HASH);
  });

  it('handles the binary-mode "*" marker and ./ prefixes', () => {
    expect(parseChecksumFile(`${HASH} *${asset}`, asset)).toBe(HASH);
    expect(parseChecksumFile(`${HASH}  ./${asset}`, asset)).toBe(HASH);
  });

  it('parses BSD-style lines', () => {
    expect(parseChecksumFile(`SHA256 (${asset}) = ${HASH}`, asset)).toBe(HASH);
  });

  it('normalizes uppercase digests to lowercase', () => {
    expect(parseChecksumFile(`${HASH.toUpperCase()}  ${asset}`, asset)).toBe(HASH);
  });

  it('returns null when no entry matches', () => {
    expect(parseChecksumFile(`${HASH}  other.tar.xz`, asset)).toBeNull();
    expect(parseChecksumFile('not a checksum file', asset)).toBeNull();
    expect(parseChecksumFile('', asset)).toBeNull();
  });

  it('does not trust a bare hash in a multi-entry file', () => {
    expect(parseChecksumFile(`${HASH}\n${'b'.repeat(64)}\n`, asset)).toBeNull();
  });
});

describe('isSafeArchiveEntry', () => {
  it('accepts relative entry paths', () => {
    expect(isSafeArchiveEntry('intentd')).toBe(true);
    expect(isSafeArchiveEntry('intentd-aarch64-apple-darwin/intentd')).toBe(true);
  });

  it('rejects traversal, absolute, and drive-letter paths', () => {
    expect(isSafeArchiveEntry('../evil')).toBe(false);
    expect(isSafeArchiveEntry('docs/../README.md')).toBe(false);
    expect(isSafeArchiveEntry('a/../../evil')).toBe(false);
    expect(isSafeArchiveEntry('..\\evil')).toBe(false);
    expect(isSafeArchiveEntry('/etc/passwd')).toBe(false);
    expect(isSafeArchiveEntry('\\\\server\\share')).toBe(false);
    expect(isSafeArchiveEntry('C:\\Windows\\evil')).toBe(false);
    expect(isSafeArchiveEntry('')).toBe(false);
  });
});

describe('isLinkListingLine', () => {
  it('flags symlink and hardlink entries in verbose listings', () => {
    expect(isLinkListingLine('lrwxr-xr-x  0 user staff 0 Jan  1 00:00 evil -> /etc/passwd')).toBe(
      true,
    );
    expect(isLinkListingLine('hrw-r--r--  0 user staff 0 Jan  1 00:00 link file')).toBe(true);
  });

  it('passes regular files and directories', () => {
    expect(isLinkListingLine('-rwxr-xr-x  0 user staff 12345 Jan  1 00:00 intentd')).toBe(false);
    expect(isLinkListingLine('drwxr-xr-x  0 user staff 0 Jan  1 00:00 dir/')).toBe(false);
    expect(isLinkListingLine('')).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('computes known digests', () => {
    expect(sha256Hex(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
