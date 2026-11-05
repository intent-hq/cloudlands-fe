import { describe, expect, it } from 'vitest';
import { isProviderListed } from './provider-visibility';

describe('isProviderListed', () => {
  it.each([
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
  ])('lists Cursor with lab=%s enabled=%s: %s', (cursorLabEnabled, enabled, listed) => {
    expect(isProviderListed('cursor', true, enabled, { cursorLabEnabled })).toBe(listed);
  });

  it('defaults the Cursor lab to off', () => {
    expect(isProviderListed('cursor', true)).toBe(false);
    expect(isProviderListed('cursor', true, true)).toBe(true);
  });

  it('leaves Auggie and other providers independent of the Cursor lab', () => {
    expect(isProviderListed('auggie', false, false, { cursorLabEnabled: true })).toBe(false);
    expect(isProviderListed('auggie', true, false)).toBe(true);
    expect(isProviderListed('codex', false, false)).toBe(true);
    expect(isProviderListed(undefined, undefined)).toBe(true);
  });
});
