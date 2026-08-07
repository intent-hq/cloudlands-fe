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
});
