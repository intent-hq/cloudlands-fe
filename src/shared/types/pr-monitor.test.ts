import { describe, expect, it } from 'vitest';
import {
  MonitorAvailabilitySchema,
  MonitorResourceSchema,
  supportsReviewMonitoring,
} from './pr-monitor';

describe('review monitor wire additions', () => {
  it.each([undefined, null, false, true, '1', 0, -1, 1.5, Infinity, NaN])(
    'keeps malformed/missing support %s disabled',
    (value) => {
      expect(supportsReviewMonitoring(value)).toBe(false);
    },
  );
  it.each([1, 2])('accepts integer capability version %s', (value) =>
    expect(supportsReviewMonitoring(value)).toBe(true),
  );
  it('retains nested case-sensitive projects, instance prefixes and resource kind', () => {
    const value = {
      repository: {
        provider: 'gitlab',
        instanceBaseUrl: 'https://forge.test:8443/install',
        projectPath: 'Team/Sub/Repo',
      },
      kind: 'merge-request',
      number: 42,
    };
    expect(MonitorResourceSchema.parse(value)).toEqual(value);
    expect(MonitorResourceSchema.safeParse({ ...value, kind: 'pull-request' }).success).toBe(false);
    expect(MonitorResourceSchema.safeParse({ ...value, kind: 'issue' }).success).toBe(false);
  });
  it('fails unknown or malformed health closed without fabricating availability', () => {
    expect(MonitorAvailabilitySchema.parse({ state: 'future-ready' })).toEqual({
      state: 'unknown',
    });
    expect(MonitorAvailabilitySchema.parse({ state: 'backoff' })).toEqual({ state: 'unknown' });
    expect(MonitorAvailabilitySchema.parse({ state: 'unresolved', reason: 'future' })).toEqual({
      state: 'unresolved',
      reason: 'unknown',
    });
  });
});
