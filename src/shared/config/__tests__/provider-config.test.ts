/**
 * Tests for provider-config helpers, in particular the availability-map
 * translation (`getAvailableIdsFromResult` / `PROVIDER_AVAILABILITY_KEY_TO_ID`).
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  getAvailableIdsFromResult,
  PROVIDER_AVAILABILITY_KEY_TO_ID,
} from '../provider-config';

describe('getAvailableIdsFromResult (pi wiring)', () => {
  it('maps the pi availability key to the pi provider id', () => {
    expect(PROVIDER_AVAILABILITY_KEY_TO_ID['pi']).toBe('pi');
  });

  it('includes pi when its availability key is available', () => {
    const ids = getAvailableIdsFromResult({ pi: { available: true } });
    expect(ids).toContain('pi');
  });

  it('excludes pi when unavailable', () => {
    const ids = getAvailableIdsFromResult({ pi: { available: false } });
    expect(ids).not.toContain('pi');
  });

  it('excludes pi when hidden even if available', () => {
    const ids = getAvailableIdsFromResult({ pi: { available: true } }, ['pi']);
    expect(ids).not.toContain('pi');
  });

  it('aggregates pi alongside other available providers', () => {
    const ids = getAvailableIdsFromResult({
      auggie: { available: true },
      pi: { available: true },
    });
    expect(ids).toEqual(expect.arrayContaining(['auggie', 'pi']));
  });
});
