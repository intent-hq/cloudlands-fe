import { describe, expect, it } from 'vitest';
import { isStaleWebviewGuestError, staleWebviewGuestId } from './webview-error-suppression';

describe('isStaleWebviewGuestError', () => {
  it('suppresses an Error carrying the exact stale-guest message', () => {
    expect(isStaleWebviewGuestError(new Error('Invalid guestInstanceId: 12'))).toBe(true);
  });

  it('suppresses a bare string message', () => {
    expect(isStaleWebviewGuestError('Invalid guestInstanceId: 7')).toBe(true);
  });

  it('suppresses an ErrorEvent-style message with the uncaught prefix', () => {
    expect(
      isStaleWebviewGuestError({ message: 'Uncaught Error: Invalid guestInstanceId: 3' }),
    ).toBe(true);
  });

  it('does not suppress unrelated messages', () => {
    expect(isStaleWebviewGuestError(new Error('Something else went wrong'))).toBe(false);
    expect(isStaleWebviewGuestError('guestInstanceId')).toBe(false);
    expect(isStaleWebviewGuestError(null)).toBe(false);
    expect(isStaleWebviewGuestError(undefined)).toBe(false);
    expect(isStaleWebviewGuestError(42)).toBe(false);
    expect(isStaleWebviewGuestError({})).toBe(false);
  });

  it('does not suppress the guest access-denied error', () => {
    expect(isStaleWebviewGuestError(new Error('Access denied to guestInstanceId: 12'))).toBe(false);
  });

  it('does not suppress a message that merely embeds the pattern', () => {
    expect(isStaleWebviewGuestError('Failed: Invalid guestInstanceId: 12 during attach')).toBe(
      false,
    );
    expect(isStaleWebviewGuestError('Invalid guestInstanceId: abc')).toBe(false);
  });
});

describe('staleWebviewGuestId', () => {
  it('extracts the numeric guest id from a matching error', () => {
    expect(staleWebviewGuestId(new Error('Invalid guestInstanceId: 12'))).toBe(12);
    expect(staleWebviewGuestId('Uncaught Error: Invalid guestInstanceId: 5')).toBe(5);
  });

  it('returns null for non-matching input', () => {
    expect(staleWebviewGuestId(new Error('Access denied to guestInstanceId: 12'))).toBeNull();
    expect(staleWebviewGuestId('')).toBeNull();
  });
});
