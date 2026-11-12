import { describe, expect, it } from 'vitest';
import { BackendError } from '$lib/client/live/backend-transport-types';
import {
  codePanelView,
  isListenerDown,
  isLocalLinkUnsupported,
  mergeCodeUpdate,
} from './local-pairing-model';
import type { LocalPairingCode } from './local-pairing-types';

const CREATED = '2026-11-12T10:00:00.000Z';
const EXPIRES = '2026-11-12T10:10:00.000Z';
const AT_CREATION = Date.parse(CREATED);

function code(overrides: Partial<LocalPairingCode> = {}): LocalPairingCode {
  return {
    codeId: 'code-1',
    state: 'active',
    createdAt: CREATED,
    expiresAt: EXPIRES,
    attemptsRemaining: 5,
    ...overrides,
  };
}

const rpcError = (rpcCode: number, data?: unknown) =>
  new BackendError({ code: 'RPC', message: 'x', rpcCode, ...(data ? { data } : {}) });

describe('mergeCodeUpdate', () => {
  it('ignores updates for another code or when no code is shown', () => {
    const shown = code();
    expect(mergeCodeUpdate(shown, code({ codeId: 'code-2', state: 'redeemed' }))).toBe(shown);
    expect(mergeCodeUpdate(null, code())).toBeNull();
  });

  it('counts wrong tries down and never back up while active', () => {
    const after = mergeCodeUpdate(code(), code({ attemptsRemaining: 3 }));
    expect(after?.attemptsRemaining).toBe(3);
    expect(mergeCodeUpdate(after, code({ attemptsRemaining: 4 }))?.attemptsRemaining).toBe(3);
  });

  it('moves to a terminal state and keeps the first one', () => {
    const locked = mergeCodeUpdate(code(), code({ state: 'locked', attemptsRemaining: 0 }));
    expect(locked?.state).toBe('locked');
    // The daemon reports a locked code as expired after its original expiry.
    expect(mergeCodeUpdate(locked, code({ state: 'expired' }))).toBe(locked);
    const redeemed = mergeCodeUpdate(
      code(),
      code({ state: 'redeemed', appName: 'Intent Alpha', credentialId: 'cred-1' }),
    );
    expect(mergeCodeUpdate(redeemed, code({ state: 'active' }))).toBe(redeemed);
  });
});

describe('codePanelView', () => {
  it('maps the steps before a code exists', () => {
    expect(codePanelView('closed', null, null, AT_CREATION)).toEqual({ kind: 'closed' });
    expect(codePanelView('creating', null, null, AT_CREATION)).toEqual({ kind: 'creating' });
    expect(codePanelView('confirm-listener', null, null, AT_CREATION)).toEqual({
      kind: 'confirm-listener',
    });
    expect(codePanelView('enabling-listener', null, null, AT_CREATION)).toEqual({
      kind: 'enabling-listener',
    });
    expect(codePanelView('open', null, 'listener-failed', AT_CREATION)).toEqual({
      kind: 'failed',
      failure: 'listener-failed',
    });
    expect(codePanelView('open', null, null, AT_CREATION)).toEqual({
      kind: 'failed',
      failure: 'create-failed',
    });
  });

  it('counts an active code down and reads it as expired at its expiry', () => {
    expect(
      codePanelView('open', code({ attemptsRemaining: 2 }), null, AT_CREATION + 18_000),
    ).toEqual({
      kind: 'active',
      codeId: 'code-1',
      remainingMs: 582_000,
      attemptsRemaining: 2,
      cancelFailed: false,
    });
    expect(codePanelView('open', code(), null, Date.parse(EXPIRES))).toEqual({ kind: 'expired' });
  });

  it('keeps showing the active code when cancelling it failed', () => {
    expect(codePanelView('open', code(), 'cancel-failed', AT_CREATION)).toMatchObject({
      kind: 'active',
      cancelFailed: true,
    });
  });

  it('maps every terminal state', () => {
    const at = (overrides: Partial<LocalPairingCode>) =>
      codePanelView('open', code(overrides), null, AT_CREATION);
    expect(at({ state: 'redeemed', appName: 'Intent Alpha' })).toEqual({
      kind: 'connected',
      appName: 'Intent Alpha',
    });
    expect(at({ state: 'redeemed' })).toEqual({ kind: 'connected', appName: null });
    expect(at({ state: 'expired' })).toEqual({ kind: 'expired' });
    expect(at({ state: 'locked', attemptsRemaining: 0 })).toEqual({ kind: 'locked' });
    expect(at({ state: 'cancelled', cancelReason: 'replaced' })).toEqual({
      kind: 'cancelled',
      reason: 'replaced',
    });
    expect(at({ state: 'cancelled' })).toEqual({ kind: 'cancelled', reason: 'user' });
  });
});

describe('expiry edge cases', () => {
  it('reads an unreadable expiry as expired', () => {
    expect(codePanelView('open', code({ expiresAt: 'not a date' }), null, AT_CREATION)).toEqual({
      kind: 'expired',
    });
  });
});

describe('daemon error classification', () => {
  it('recognizes listener-down only as -32603 with that data code', () => {
    expect(isListenerDown(rpcError(-32603, { code: 'listener-down' }))).toBe(true);
    expect(isListenerDown(rpcError(-32603))).toBe(false);
    expect(isListenerDown(rpcError(-32602, { code: 'listener-down' }))).toBe(false);
    expect(isListenerDown(new Error('boom'))).toBe(false);
  });

  it('treats a local-only refusal or a missing method as an unsupported local link', () => {
    expect(isLocalLinkUnsupported(rpcError(-32001))).toBe(true);
    expect(isLocalLinkUnsupported(rpcError(-32601))).toBe(true);
    expect(isLocalLinkUnsupported(rpcError(-32603))).toBe(false);
    expect(isLocalLinkUnsupported(new Error('socket closed'))).toBe(false);
  });
});
