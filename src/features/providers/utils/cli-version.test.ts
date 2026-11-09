import { describe, expect, it } from 'vitest';
import { displayCliVersion } from './cli-version';

describe('displayCliVersion', () => {
  it.each([
    ['2.1.303 (Claude Code)', '2.1.303'],
    ['codex-cli 0.165.0', '0.165.0'],
    ['unsloth 2026.8.18', '2026.8.18'],
    ['0.35.0 (commit 9a7f3836)', '0.35.0'],
    ['1.18.18', '1.18.18'],
    ['v0.79.0', '0.79.0'],
    ['2026.11.05-86047df', '2026.11.05-86047df'],
    ['  opencode version 1.2.3-beta.1  ', '1.2.3-beta.1'],
  ])('extracts the version from %j', (raw, expected) => {
    expect(displayCliVersion(raw)).toBe(expected);
  });

  it.each([undefined, '', '   ', 'unknown build', 'pi 7'])(
    'hides output without a dotted version: %j',
    (raw) => {
      expect(displayCliVersion(raw)).toBeUndefined();
    },
  );
});
