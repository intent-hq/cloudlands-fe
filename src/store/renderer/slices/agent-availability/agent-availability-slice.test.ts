import { describe, expect, it } from 'vitest';
import {
  agentAvailabilityReducer,
  checkAllProvidersComplete,
  checkSingleProviderFailure,
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  initialState,
  setAllProvidersLoading,
} from './agent-availability-slice';
import type { AgentAvailabilityState } from './agent-availability-types';

describe('agentAvailabilityReducer status retention during re-checks', () => {
  it('retains the last successful Antigravity status after a failed recheck', () => {
    const known = agentAvailabilityReducer(
      initialState,
      checkSingleProviderSuccess('antigravity', { available: true, authenticated: true }),
    );
    const pending = agentAvailabilityReducer(known, checkSingleProviderRequested('antigravity'));
    const failed = agentAvailabilityReducer(pending, checkSingleProviderFailure('antigravity'));
    expect(failed.providerStatusMap.antigravity).toEqual({ available: true, authenticated: true });
    expect(failed.providerLoadingMap.antigravity).toBe(false);
  });
  // Regression guard for sticky onboarding tiers: ordering in AgentGrid is
  // derived from the last-known providerStatusMap, so re-check actions must
  // not clear it — only checkSingleProviderSuccess may replace an entry.
  const checkedState: AgentAvailabilityState = {
    ...initialState,
    providerStatusMap: {
      auggie: { available: true, authenticated: true },
      codex: { available: true, authenticated: false },
    },
  };

  it('keeps providerStatusMap intact across refresh-lifecycle actions', () => {
    const actions = [
      setAllProvidersLoading({ auggie: true, codex: true }),
      checkSingleProviderRequested('auggie'),
      checkSingleProviderFailure('auggie'),
    ];
    for (const action of actions) {
      const next = agentAvailabilityReducer(checkedState, action);
      expect(next.providerStatusMap).toEqual(checkedState.providerStatusMap);
    }
  });

  it('checkSingleProviderFailure clears the loading flag without touching statuses', () => {
    // A probe failure (unreachable daemon / RPC error) must settle the
    // in-flight flag — a stuck-true flag leaves the card spinner running and
    // its refresh button disabled forever — but must NOT fabricate a status
    // or erase a previously successful one.
    const loadingState: AgentAvailabilityState = {
      ...initialState,
      providerStatusMap: { auggie: { available: true, authenticated: true } },
      providerLoadingMap: { auggie: true, codex: true },
    };
    const next = agentAvailabilityReducer(loadingState, checkSingleProviderFailure('auggie'));
    expect(next.providerLoadingMap).toEqual({ auggie: false, codex: true });
    expect(next.providerStatusMap).toBe(loadingState.providerStatusMap);
    expect(next.providerStatusMap.auggie).toEqual({ available: true, authenticated: true });
  });
});

describe('agentAvailabilityReducer hasCheckedOnce honesty', () => {
  it('does not flip when the sweep landed no statuses (all probes failed)', () => {
    // An all-probes-failed sweep (daemon unreachable) proves nothing about
    // availability — presenting it as "checked" would let ModelPicker read
    // the empty map as "confirmed nothing available".
    const next = agentAvailabilityReducer(initialState, checkAllProvidersComplete());
    expect(next).toBe(initialState);
    expect(next.hasCheckedOnce).toBe(false);
  });

  it('flips once at least one probe landed a status', () => {
    const state: AgentAvailabilityState = {
      ...initialState,
      providerStatusMap: { auggie: { available: false } },
    };
    const next = agentAvailabilityReducer(state, checkAllProvidersComplete());
    expect(next.hasCheckedOnce).toBe(true);
  });

  it('stays true once set', () => {
    const state: AgentAvailabilityState = {
      ...initialState,
      providerStatusMap: { auggie: { available: false } },
      hasCheckedOnce: true,
    };
    const next = agentAvailabilityReducer(state, checkAllProvidersComplete());
    expect(next).toBe(state);
  });
});
