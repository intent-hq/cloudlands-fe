/**
 * pr-monitor-wake-attribution tests: metadata detection (PROTOCOL §5.42
 * `{ type: 'pr_monitor_wake', monitorId, repo, prNumber, reason, url? }`),
 * URL resolution (metadata `url` first, GitHub fallback), chip labeling
 * (`repo #N` same-owner, `owner/repo #N` cross-owner or unknown workspace
 * repo), and display-only stripping of the daemon's literal
 * `[PR monitor <owner/repo>#<n>]` prefix.
 */
import { describe, expect, it } from 'vitest';
import {
  getPrMonitorWakeAttribution,
  getPrMonitorWakeChipLabel,
  getPrMonitorWakeUrl,
  stripPrMonitorWakePrefix,
} from './pr-monitor-wake-attribution';

describe('getPrMonitorWakeAttribution', () => {
  it('extracts monitorId, repo, prNumber, and url from pr_monitor_wake metadata', () => {
    const attr = getPrMonitorWakeAttribution({
      type: 'pr_monitor_wake',
      monitorId: 'mon-1',
      repo: 'intent-hq/intentd',
      prNumber: 42,
      reason: 'checks_failed',
      url: 'https://github.com/intent-hq/intentd/pull/42',
    });
    expect(attr).toEqual({
      monitorId: 'mon-1',
      repo: 'intent-hq/intentd',
      prNumber: 42,
      reason: 'checks_failed',
      url: 'https://github.com/intent-hq/intentd/pull/42',
    });
  });

  it('omits url when absent or blank', () => {
    expect(
      getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: 'o/r', prNumber: 7 }),
    ).toEqual({ monitorId: '', repo: 'o/r', prNumber: 7, reason: '' });
    expect(
      getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: 'o/r', prNumber: 7, url: '  ' }),
    ).toEqual({ monitorId: '', repo: 'o/r', prNumber: 7, reason: '' });
  });

  it('returns null for absent, non-object, or wrong-type metadata', () => {
    expect(getPrMonitorWakeAttribution(undefined)).toBeNull();
    expect(getPrMonitorWakeAttribution(null)).toBeNull();
    expect(getPrMonitorWakeAttribution('pr_monitor_wake')).toBeNull();
    expect(getPrMonitorWakeAttribution({ type: 'hook_wake', hookId: 'h1' })).toBeNull();
    expect(getPrMonitorWakeAttribution({ type: 'agent_message', fromAgentId: 'a' })).toBeNull();
  });

  it('returns null when repo or prNumber is missing or malformed', () => {
    expect(getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', prNumber: 5 })).toBeNull();
    expect(getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: '  ' })).toBeNull();
    expect(getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: 'o/r' })).toBeNull();
    expect(
      getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: 'o/r', prNumber: '42' }),
    ).toBeNull();
    expect(
      getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: 'o/r', prNumber: 0 }),
    ).toBeNull();
    expect(
      getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: 'o/r', prNumber: 1.5 }),
    ).toBeNull();
  });

  it('tolerates a missing monitorId (empty string)', () => {
    const attr = getPrMonitorWakeAttribution({ type: 'pr_monitor_wake', repo: 'o/r', prNumber: 3 });
    expect(attr?.monitorId).toBe('');
  });
});

describe('getPrMonitorWakeUrl', () => {
  it('prefers the metadata url when present', () => {
    expect(
      getPrMonitorWakeUrl({
        monitorId: 'm',
        repo: 'o/r',
        prNumber: 9,
        url: 'https://example.com/pr/9',
      }),
    ).toBe('https://example.com/pr/9');
  });

  it('falls back to the GitHub PR URL built from repo + prNumber', () => {
    expect(getPrMonitorWakeUrl({ monitorId: 'm', repo: 'intent-hq/monorepo', prNumber: 123 })).toBe(
      'https://github.com/intent-hq/monorepo/pull/123',
    );
  });
});

describe('getPrMonitorWakeChipLabel', () => {
  const attr = { monitorId: 'm', repo: 'intent-hq/intentd', prNumber: 42 };

  it('renders "repo #N" when owner and repo match the workspace repo', () => {
    expect(getPrMonitorWakeChipLabel(attr, 'intent-hq/intentd')).toBe('intentd #42');
  });

  it('renders "repo #N" for a same-owner, different-repo PR', () => {
    expect(getPrMonitorWakeChipLabel(attr, 'intent-hq/monorepo')).toBe('intentd #42');
  });

  it('renders "owner/repo #N" for a different-owner PR', () => {
    expect(getPrMonitorWakeChipLabel(attr, 'other/monorepo')).toBe('intent-hq/intentd #42');
  });

  it('renders "owner/repo #N" when the workspace repo is unknown', () => {
    expect(getPrMonitorWakeChipLabel(attr)).toBe('intent-hq/intentd #42');
    expect(getPrMonitorWakeChipLabel(attr, undefined)).toBe('intent-hq/intentd #42');
  });

  it('renders 4+ digit PR numbers without digit grouping', () => {
    const bigAttr = { monitorId: 'm', repo: 'intent-hq/intentd', prNumber: 1182 };
    expect(getPrMonitorWakeChipLabel(bigAttr, 'intent-hq/monorepo')).toBe('intentd #1182');
    expect(getPrMonitorWakeChipLabel(bigAttr, 'other/monorepo')).toBe('intent-hq/intentd #1182');
  });
});

describe('stripPrMonitorWakePrefix', () => {
  it('strips the literal [PR monitor <repo>#<n>] prefix and following whitespace', () => {
    expect(stripPrMonitorWakePrefix('[PR monitor intent-hq/intentd#42] Checks failed')).toBe(
      'Checks failed',
    );
    expect(stripPrMonitorWakePrefix('[PR monitor ] no details')).toBe('[PR monitor ] no details');
  });

  it('returns non-prefixed text unchanged', () => {
    expect(stripPrMonitorWakePrefix('Checks failed')).toBe('Checks failed');
    expect(stripPrMonitorWakePrefix('prefix [PR monitor o/r#1] mid-text')).toBe(
      'prefix [PR monitor o/r#1] mid-text',
    );
  });

  it('only strips the first prefix occurrence at the start', () => {
    expect(stripPrMonitorWakePrefix('[PR monitor o/r#1] [PR monitor o/r#2] tail')).toBe(
      '[PR monitor o/r#2] tail',
    );
  });
});
