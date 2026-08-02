/**
 * hook-wake-attribution tests: metadata detection (PROTOCOL §5.40
 * `{ type: 'hook_wake', hookId, hookName, reason }`) and display-only
 * stripping of the daemon's literal `[Background hook "<name>"]` prefix.
 */
import { describe, expect, it } from 'vitest';
import { getHookWakeAttribution, stripHookWakePrefix } from './hook-wake-attribution';

describe('getHookWakeAttribution', () => {
  it('extracts hookId and hookName from hook_wake metadata', () => {
    const attr = getHookWakeAttribution({
      type: 'hook_wake',
      hookId: 'hook-1',
      hookName: 'ci-watch',
      reason: 'dispatched',
    });
    expect(attr).toEqual({ hookId: 'hook-1', displayName: 'ci-watch' });
  });

  it('returns null for absent, non-object, or wrong-type metadata', () => {
    expect(getHookWakeAttribution(undefined)).toBeNull();
    expect(getHookWakeAttribution(null)).toBeNull();
    expect(getHookWakeAttribution('hook_wake')).toBeNull();
    expect(getHookWakeAttribution({ type: 'agent_message', fromAgentId: 'a' })).toBeNull();
    expect(getHookWakeAttribution({ type: 'event_notification' })).toBeNull();
  });

  it('falls back to "Hook" when hookName is missing or blank', () => {
    expect(getHookWakeAttribution({ type: 'hook_wake', hookId: 'h1' })?.displayName).toBe('Hook');
    expect(
      getHookWakeAttribution({ type: 'hook_wake', hookId: 'h1', hookName: '   ' })?.displayName,
    ).toBe('Hook');
  });

  it('truncates long hook names to ~20 chars with an ellipsis', () => {
    const attr = getHookWakeAttribution({
      type: 'hook_wake',
      hookId: 'h1',
      hookName: 'a-very-long-hook-name-that-overflows',
    });
    expect(attr?.displayName.length).toBe(20);
    expect(attr?.displayName.endsWith('…')).toBe(true);
  });

  it('tolerates a missing hookId (empty string)', () => {
    const attr = getHookWakeAttribution({ type: 'hook_wake', hookName: 'watcher' });
    expect(attr).toEqual({ hookId: '', displayName: 'watcher' });
  });
});

describe('stripHookWakePrefix', () => {
  it('strips the literal [Background hook "<name>"] prefix and following whitespace', () => {
    expect(stripHookWakePrefix('[Background hook "dispatcher"] CI is red')).toBe('CI is red');
    expect(stripHookWakePrefix('[Background hook ""] no name')).toBe('no name');
  });

  it('returns non-prefixed text unchanged', () => {
    expect(stripHookWakePrefix('CI is red')).toBe('CI is red');
    expect(stripHookWakePrefix('prefix [Background hook "x"] mid-text')).toBe(
      'prefix [Background hook "x"] mid-text',
    );
  });

  it('only strips the first prefix occurrence at the start', () => {
    expect(stripHookWakePrefix('[Background hook "a"] [Background hook "b"] tail')).toBe(
      '[Background hook "b"] tail',
    );
  });
});
