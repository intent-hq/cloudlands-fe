import { describe, expect, it } from 'vitest';
import {
  cancelLinearAuth,
  connectLinear,
  consumeLinearAuth,
  linearAuthReducer,
  logoutLinear,
  setLinearAuthState,
  setLinearError,
  setLinearIsAuthenticating,
  settleLinearAuth,
} from './linear-auth-slice';
import {
  selectLinearAuthConsumerOperation,
  selectLinearIsDisconnecting,
} from './linear-auth-selectors';
import type { StoreState } from '../../types';

describe('linear auth reducer request ownership', () => {
  it('isolates consumer results and ignores stale settlement, cancellation, and consumption', () => {
    const first = connectLinear('fixture-key', { requestId: 'first', consumerId: 'settings' });
    const second = connectLinear('another-fixture', { requestId: 'second', consumerId: 'picker' });
    const state = linearAuthReducer(linearAuthReducer.initialState, first);
    expect(state).toMatchObject({ isAuthenticating: true, operation: { status: 'pending' } });
    expect(JSON.stringify(state)).not.toContain('fixture-key');
    const next = linearAuthReducer(state, second);
    expect(linearAuthReducer(next, settleLinearAuth('first', 'succeeded'))).toBe(next);
    expect(linearAuthReducer(next, cancelLinearAuth('first'))).toBe(next);
    expect(linearAuthReducer(next, consumeLinearAuth('first'))).toBe(next);
    const root = { linearAuth: next } as StoreState;
    expect(selectLinearAuthConsumerOperation.select(root, 'settings')).toBeNull();
    expect(selectLinearAuthConsumerOperation.select(root, 'picker')?.requestId).toBe('second');
    const cancelled = linearAuthReducer(next, cancelLinearAuth('second'));
    expect(cancelled).toMatchObject({
      isAuthenticating: false,
      operation: { status: 'cancelled' },
    });
    expect(linearAuthReducer(cancelled, settleLinearAuth('second', 'succeeded'))).toBe(cancelled);
    expect(linearAuthReducer(cancelled, consumeLinearAuth('second')).operation).toBeNull();
  });

  it('derives disconnect pending state from real operation settlement', () => {
    const state = linearAuthReducer(
      linearAuthReducer.initialState,
      logoutLinear({ requestId: 'logout', consumerId: null }),
    );
    expect(selectLinearIsDisconnecting.select({ linearAuth: state } as StoreState)).toBe(true);
    const done = linearAuthReducer(state, settleLinearAuth('logout', 'failed'));
    expect(selectLinearIsDisconnecting.select({ linearAuth: done } as StoreState)).toBe(false);
  });

  it('preserves public state-setting actions', () => {
    let state = linearAuthReducer(
      linearAuthReducer.initialState,
      setLinearAuthState(true, false, null),
    );
    state = linearAuthReducer(state, setLinearError('rejected'));
    state = linearAuthReducer(state, setLinearIsAuthenticating(true));
    expect(state).toMatchObject({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      error: 'rejected',
      isAuthenticating: true,
    });
  });
});
