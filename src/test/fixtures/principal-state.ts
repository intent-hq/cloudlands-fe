import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import type { StoreState } from '$store/renderer/types';
import { initialState as connections } from '$store/renderer/slices/connections/connections-slice';
import { initialState as daemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { initialState as workspaceEvents } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { initialState as userPreferences } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  initialState,
  principalContextChanged,
  principalReceived,
  principalReducer,
} from '$store/renderer/slices/principal/principal-slice';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';

/** An admitted legacy caller for consumer tests that previously assumed a saved window was authority. */
export function withLegacyPrincipal(input: object, role: 'owner' | 'guest' = 'owner'): StoreState {
  const state = input as Partial<StoreState>;
  const bound = {
    ...state,
    connections: { ...connections, ...state.connections, hasReceivedList: true },
    daemonHealth: { ...daemonHealth, ...state.daemonHealth, health: 'healthy' as const },
    workspaceEvents: {
      ...workspaceEvents,
      ...state.workspaceEvents,
      subscriptionGeneration: state.workspaceEvents?.subscriptionGeneration || 1,
    },
    userPreferences: { ...userPreferences, labsMultiplayerEnabled: true, ...state.userPreferences },
  } as StoreState;
  const context = selectPrincipalConnectionContext.select(bound)!;
  return {
    ...bound,
    principal: principalReducer(
      principalReducer(initialState, principalContextChanged(context)),
      principalReceived(
        { context, invalidation: 0, presentationVersion: 0 },
        {
          principal: {
            id: 'principal',
            login: null,
            displayName: null,
            avatarUrl: null,
            isAdministrator: role === 'owner',
          },
          capabilities: {
            hostMembership: false,
            personalPairing: false,
            authenticatedDevices: false,
            collaborationIdentity: false,
          },
        },
      ),
    ),
  };
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

/** Borrow an isolated preview's admission without resetting the caller's lifetime counters. */
export function installPreviewPrincipal(): () => void {
  const previous = store.state.principal;
  const read =
    previous.context !== null && previous.refreshedPresentationVersion !== null
      ? {
          context: previous.context,
          invalidation: previous.invalidation,
          presentationVersion: previous.refreshedPresentationVersion,
        }
      : null;
  if (
    previous.status === 'ready' &&
    previous.snapshot &&
    read &&
    previous.refreshedPresentationVersion === previous.presentationVersion &&
    previous.context === selectPrincipalConnectionContext.select(store.state)
  ) {
    store.dispatch(
      principalReceived(read, {
        ...previous.snapshot,
        principal: { ...previous.snapshot.principal, hostRole: 'owner', isAdministrator: true },
      }),
    );
  } else if (
    Object.entries(initialState).every(
      ([key, value]) => previous[key as keyof typeof previous] === value,
    )
  ) {
    admitLegacyPrincipal();
  } else {
    // A pending, stale or revoked caller must not gain fixture authority.
    return () => {};
  }
  const installed = store.state.principal;
  return () => {
    // Never replace an admission changed by the parent while the preview was mounted.
    if (store.state.principal !== installed) return;
    if (read && previous.snapshot) store.dispatch(principalReceived(read, previous.snapshot));
    else store.dispatch(principalContextChanged(previous.context));
  };
}
