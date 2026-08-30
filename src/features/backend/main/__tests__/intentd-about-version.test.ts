/**
 * Tests for the About-box bundled sidecar intentd version line formatter
 * (`intentd-about-version.ts`): pin-first version selection, probe fallback,
 * and commit attribution rules.
 */
import { describe, expect, it } from 'vitest';

import { formatIntentdAboutVersion } from '../intentd-about-version';

describe('formatIntentdAboutVersion', () => {
  it('shows pin + short commit when the probe matches the pin', () => {
    expect(
      formatIntentdAboutVersion({
        pinnedVersion: '0.8.23',
        probedVersion: '0.8.23',
        buildCommit: 'abc1234def567890',
      }),
    ).toBe('intentd: 0.8.23 (abc1234)');
  });

  it('keeps a commit already 7 chars or shorter as-is', () => {
    expect(
      formatIntentdAboutVersion({
        pinnedVersion: '0.8.23',
        probedVersion: '0.8.23',
        buildCommit: 'abc12',
      }),
    ).toBe('intentd: 0.8.23 (abc12)');
  });

  it('shows the pin alone when no probe result is available', () => {
    expect(formatIntentdAboutVersion({ pinnedVersion: '0.8.23' })).toBe('intentd: 0.8.23');
    expect(
      formatIntentdAboutVersion({
        pinnedVersion: '0.8.23',
        probedVersion: null,
        buildCommit: null,
      }),
    ).toBe('intentd: 0.8.23');
  });

  it('omits the commit when the probed version differs from the pin', () => {
    expect(
      formatIntentdAboutVersion({
        pinnedVersion: '0.8.23',
        probedVersion: '0.9.0',
        buildCommit: 'abc1234',
      }),
    ).toBe('intentd: 0.8.23');
  });

  it('omits the commit when the probe reported no version to attribute it to', () => {
    expect(formatIntentdAboutVersion({ pinnedVersion: '0.8.23', buildCommit: 'abc1234' })).toBe(
      'intentd: 0.8.23',
    );
  });

  it('omits a blank commit', () => {
    expect(
      formatIntentdAboutVersion({
        pinnedVersion: '0.8.23',
        probedVersion: '0.8.23',
        buildCommit: '   ',
      }),
    ).toBe('intentd: 0.8.23');
  });

  it('falls back to the probed version (with commit) when the pin is unreadable', () => {
    expect(
      formatIntentdAboutVersion({
        pinnedVersion: null,
        probedVersion: '0.8.24',
        buildCommit: 'def4567890',
      }),
    ).toBe('intentd: 0.8.24 (def4567)');
  });

  it('falls back to the probed version alone when it has no commit', () => {
    expect(formatIntentdAboutVersion({ pinnedVersion: null, probedVersion: '0.8.24' })).toBe(
      'intentd: 0.8.24',
    );
  });

  it('returns null when both sources are unavailable', () => {
    expect(formatIntentdAboutVersion({ pinnedVersion: null })).toBeNull();
    expect(
      formatIntentdAboutVersion({ pinnedVersion: null, probedVersion: null, buildCommit: 'abc' }),
    ).toBeNull();
  });
});
