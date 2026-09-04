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

const status = {
  operationId: 'one',
  supported: true,
  cliDetected: true,
  runtimeInstalled: false,
  phase: 'checking' as const,
};

describe('Antigravity setup state', () => {
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
