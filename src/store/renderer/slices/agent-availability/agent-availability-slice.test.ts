import {
  describe,
  expect,
  it,
} from 'vitest';
import type { StoreState } from '../../types';
import { selectManagedInstallStatusByProvider } from './agent-availability-selectors';
import {
  agentAvailabilityReducer,
  checkSingleProviderFailure,
  checkSingleProviderRequested,
  initialState,
  setAllProvidersLoading,
  setManagedInstallStatus,
} from './agent-availability-slice';
import type { AgentAvailabilityState } from './agent-availability-types';

function storeWith(agentAvailability: AgentAvailabilityState): StoreState {
  return { agentAvailability } as unknown as StoreState;
}

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

describe('agentAvailabilityReducer managed install status', () => {
  it('tracks installing then installed managed Codex state', () => {
    const installing = agentAvailabilityReducer(
      initialState,
      setManagedInstallStatus('codex', {
        managedInstallState: 'installing',
        version: '0.16.0',
        downloadProgress: 0.25,
      }),
    );

    expect(installing.providerStatusMap.codex).toMatchObject({
      available: false,
      managedInstallState: 'installing',
      version: '0.16.0',
      downloadProgress: 0.25,
    });

    const installed = agentAvailabilityReducer(
      installing,
      setManagedInstallStatus('codex', {
        managedInstallState: 'installed',
        downloadProgress: 1,
        error: undefined,
      }),
    );

    expect(selectManagedInstallStatusByProvider.select(storeWith(installed), 'codex')).toEqual({
      managedInstallState: 'installed',
      version: '0.16.0',
      downloadProgress: 1,
      error: undefined,
      usingFallback: undefined,
    });
  });

  it('tracks installing then failed managed Codex state', () => {
    const installing = agentAvailabilityReducer(
      initialState,
      setManagedInstallStatus('codex', { managedInstallState: 'installing' }),
    );
    const failed = agentAvailabilityReducer(
      installing,
      setManagedInstallStatus('codex', {
        managedInstallState: 'failed',
        error: 'Integrity mismatch for @agentclientprotocol/codex-acp',
      }),
    );

    expect(failed.providerStatusMap.codex).toMatchObject({
      managedInstallState: 'failed',
      error: 'Integrity mismatch for @agentclientprotocol/codex-acp',
    });
  });

  it('tracks static fallback selection for Codex', () => {
    const state = agentAvailabilityReducer(
      initialState,
      setManagedInstallStatus('codex', {
        managedInstallState: 'failed',
        usingFallback: true,
      }),
    );

    expect(selectManagedInstallStatusByProvider.select(storeWith(state), 'codex')).toMatchObject({
      managedInstallState: 'failed',
      usingFallback: true,
    });
  });
});