import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  agentAvailabilityReducer,
  checkSingleProviderFailure,
  checkSingleProviderRequested,
  initialState,
  setAllProvidersLoading,
} from './agent-availability-slice';
import type { AgentAvailabilityState } from './agent-availability-types';

describe('agentAvailabilityReducer status retention during re-checks', () => {
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

  it('checkSingleProviderFailure is a no-op: it does not clear the loading flag', () => {
    // A probe failure (unreachable daemon / RPC error) must not fabricate a
    // terminal "not installed" render. Leaving providerLoadingMap untouched
    // keeps the card in its existing indeterminate state until a fresh
    // probe actually succeeds.
    const loadingState: AgentAvailabilityState = {
      ...initialState,
      providerLoadingMap: { auggie: true },
    };
    const next = agentAvailabilityReducer(loadingState, checkSingleProviderFailure('auggie'));
    expect(next).toBe(loadingState);
    expect(next.providerLoadingMap.auggie).toBe(true);
    expect(next.providerStatusMap.auggie).toBeUndefined();
  });
});
