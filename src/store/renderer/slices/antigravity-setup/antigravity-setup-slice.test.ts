import { describe, expect, it } from 'vitest';
import {
  antigravitySetupReceived,
  antigravitySetupReducer,
  antigravitySetupRequested,
  antigravitySetupVerified,
  initialState,
} from './antigravity-setup-slice';
import {
  agentAvailabilityReducer,
  checkSingleProviderSuccess,
} from '../agent-availability/agent-availability-slice';
import { selectAntigravitySetupPolicy } from './antigravity-setup-selectors';

const status = {
  operationId: 'one',
  supported: true,
  cliDetected: true,
  runtimeInstalled: false,
  phase: 'checking' as const,
};

describe('Antigravity setup state', () => {
  const policy = (setup: typeof initialState) =>
    selectAntigravitySetupPolicy.select({
      antigravitySetup: setup,
      agentAvailability: {
        providerStatusMap: { antigravity: { available: true, authenticated: true } },
      },
    } as Parameters<typeof selectAntigravitySetupPolicy.select>[0]);

  it('keeps a failed attempt blocked until a retry verifies fresh models', () => {
    let state = antigravitySetupReducer(initialState, antigravitySetupRequested('start'));
    expect(policy(state)).toMatchObject({ hasAttempt: true, canEnable: false });
    state = antigravitySetupReducer(
      state,
      antigravitySetupReceived(state.generation, {
        ok: true,
        status: { ...status, phase: 'failed', code: 'modelsUnavailable' },
      }),
    );
    expect(policy(state)).toMatchObject({ hasAttempt: true, connected: false, canEnable: false });

    // A passive daemon status cannot replace the frontend's failed model check.
    state = antigravitySetupReducer(state, antigravitySetupRequested('status'));
    const connected = {
      ok: true as const,
      status: { ...status, phase: 'connected' as const, modelCount: 1 },
    };
    state = antigravitySetupReducer(state, antigravitySetupReceived(state.generation, connected));
    expect(policy(state)).toMatchObject({ connected: false, canEnable: false });

    state = antigravitySetupReducer(state, antigravitySetupRequested('start'));
    state = antigravitySetupReducer(state, antigravitySetupVerified());
    state = antigravitySetupReducer(state, antigravitySetupReceived(state.generation, connected));
    expect(policy(state)).toMatchObject({ connected: true, canEnable: true });
    state = antigravitySetupReducer(state, antigravitySetupRequested('cancel'));
    expect(policy(state).canEnable).toBe(false);
  });

  it('does not impose guided setup on a pre-existing installation after passive status', () => {
    for (const code of ['remoteHost', 'unsupportedHost', 'updateRequired'] as const) {
      let state = antigravitySetupReducer(initialState, antigravitySetupRequested('status'));
      state = antigravitySetupReducer(
        state,
        antigravitySetupReceived(state.generation, { ok: false, code }),
      );
      expect(policy(state)).toMatchObject({ hasAttempt: false, canEnable: true });
    }
  });

  it('starts empty and coalesces repeat connect and login clicks', () => {
    expect(antigravitySetupReducer(undefined, { type: 'init' })).toEqual(initialState);
    for (const command of ['start', 'login'] as const) {
      const state = antigravitySetupReducer(initialState, antigravitySetupRequested(command));
      expect(state.busy).toBe(true);
      expect(state.generation).toBe(1);
      expect(antigravitySetupReducer(state, antigravitySetupRequested(command))).toBe(state);
    }
  });
  it('rejects late results after cancel, close, or a newer action', () => {
    const started = antigravitySetupReducer(initialState, antigravitySetupRequested('start'));
    const loading = antigravitySetupReducer(
      started,
      antigravitySetupReceived(1, { ok: true, status }),
    );
    for (const command of ['cancel', 'close', 'status'] as const) {
      const next = antigravitySetupReducer(loading, antigravitySetupRequested(command));
      expect(
        antigravitySetupReducer(
          next,
          antigravitySetupReceived(1, {
            ok: true,
            status: { ...status, phase: 'connected', modelCount: 1 },
          }),
        ),
      ).toBe(next);
      if (command === 'close') expect(next.result).toBeNull();
    }
  });
  it('settles failures and sign-in-required without enabling anything', () => {
    const current = { ...initialState, generation: 1, busy: true };
    const failed = antigravitySetupReducer(
      current,
      antigravitySetupReceived(1, { ok: false, code: 'updateRequired' }),
    );
    expect(failed.busy).toBe(false);
    const waiting = antigravitySetupReducer(
      current,
      antigravitySetupReceived(1, { ok: true, status: { ...status, phase: 'signInRequired' } }),
    );
    expect(waiting.busy).toBe(false);
  });
  it('fresh verified setup supersedes a pre-login availability probe', () => {
    const before = agentAvailabilityReducer(undefined, { type: 'init' });
    const verified = agentAvailabilityReducer(before, antigravitySetupVerified());
    expect(verified.providerStatusMap.antigravity).toEqual({
      available: true,
      authenticated: true,
    });
    const stale = agentAvailabilityReducer(
      verified,
      checkSingleProviderSuccess('antigravity', { available: true, authenticated: false }, 0),
    );
    expect(stale).toBe(verified);
  });
});
