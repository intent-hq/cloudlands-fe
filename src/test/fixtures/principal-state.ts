import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import type { StoreState } from '$store/renderer/types';
import { initialState as userPreferences } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { createAdmittedLegacyPrincipal } from './admitted-legacy-principal';

/** An admitted legacy caller for consumer tests that previously assumed a saved window was authority. */
export function withLegacyPrincipal(input: object, role: 'owner' | 'guest' = 'owner'): StoreState {
  const state = input as Partial<StoreState>;
  const { hasReceivedList: _hasReceivedList, ...connections } = state.connections ?? {};
  const { health: _health, ...daemonHealth } = state.daemonHealth ?? {};
  const { subscriptionPending: _subscriptionPending, ...workspaceEvents } =
    state.workspaceEvents ?? {};
  return {
    ...state,
    ...createAdmittedLegacyPrincipal({ connections, daemonHealth, workspaceEvents }, role),
    userPreferences: { ...userPreferences, labsMultiplayerEnabled: true, ...state.userPreferences },
  } as StoreState;
}

/** Admit a caller in component tests using the real store but no transport sagas. */
export function admitLegacyPrincipal(role: 'owner' | 'guest' = 'owner'): void {
  const { connections: current } = store.state;
  store.dispatch(
    connectionsListReceived({
      connections: getItems(current.connections),
      activeId: current.activeId,
      windowBackendId: current.windowBackendId,
    }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  if (!store.state.workspaceEvents.subscriptionGeneration) store.dispatch(daemonEventsSubscribed());
  const { principal } = withLegacyPrincipal(store.state, role);
  store.dispatch(principalContextChanged(principal.context));
  store.dispatch(
    principalReceived(
      { context: principal.context!, invalidation: 0, presentationVersion: 0 },
      principal.snapshot!,
    ),
  );
}

/** Current admitted host roles for consumer tests, without a linked external profile. */
export function withHostPrincipal(
  input: object,
  role: 'owner' | 'member' | 'guest' = 'owner',
): StoreState {
  const state = withLegacyPrincipal(input);
  return {
    ...state,
    principal: {
      ...state.principal,
      snapshot: {
        ...state.principal.snapshot!,
        principal: {
          ...state.principal.snapshot!.principal,
          hostRole: role,
          isAdministrator: role === 'owner',
          hostMembershipRevision: 1,
        },
        capabilities: {
          hostMembership: true,
          collaborationIdentity: true,
          personalPairing: true,
          authenticatedDevices: true,
        },
      },
    },
  };
}
