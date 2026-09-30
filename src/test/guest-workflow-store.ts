import { principalReducer } from '$store/renderer/slices/principal/principal-slice';
import { initialState as daemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { initialState as workspaceEvents } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import type { PrincipalState } from '$store/renderer/slices/principal/principal-types';
import {
  userPreferencesReducer,
  initialState as userPreferences,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { runSaga, stdChannel } from 'redux-saga';
import {
  guestSessionsReducer,
  initialState as guestSessions,
} from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import {
  connectionsReducer,
  initialState as connections,
} from '$store/renderer/slices/connections/connections-slice';
import {
  workspaceReducer,
  initialState as workspace,
} from '$store/renderer/slices/workspace/workspace-slice';

/** Component tests exercise production reducers and root-owned workflow sagas. */
export function createGuestWorkflowTestStore() {
  const freshState = () => ({
    guestSessions,
    connections: { ...connections, hasReceivedList: true },
    workspace,
    userPreferences: { ...userPreferences, labsMultiplayerEnabled: true },
    daemonHealth: { ...daemonHealth, health: 'healthy' as const },
    workspaceEvents: { ...workspaceEvents, subscriptionGeneration: 1 },
    principal: {
      context: JSON.stringify([connections.windowBackendId, daemonHealth.connectionGeneration, 1]),
      status: 'ready',
      boundPrincipalId: 'principal',
      minimumRevision: 0,
      invalidation: 0,
      presentationVersion: 0,
      refreshedPresentationVersion: 0,
      error: null,
      snapshot: {
        principal: {
          id: 'principal',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: true,
        },
        capabilities: {
          hostMembership: false,
          collaborationIdentity: false,
          authenticatedDevices: false,
          personalPairing: false,
        },
      },
    } as PrincipalState,
  });
  let state = freshState();
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const store = {
    get state() {
      return state;
    },
    init() {
      state = freshState();
      listeners.forEach((notify) => notify());
    },
    dispatch(action: { type: string }) {
      state = {
        ...state,
        principal: principalReducer(state.principal, action as never),
        userPreferences: userPreferencesReducer(state.userPreferences, action as never),
        guestSessions: guestSessionsReducer(state.guestSessions, action as never),
        connections: connectionsReducer(state.connections, action as never),
        workspace: workspaceReducer(state.workspace, action as never),
      };
      channel.put(action);
      listeners.forEach((notify) => notify());
      return action;
    },
    createSelector<T, A extends unknown[]>(
      select: (state: ReturnType<typeof freshState>, ...args: A) => T,
    ) {
      return Object.assign(
        (...args: A) => ({
          subscribe(run: (value: T) => void) {
            const update = () => run(select(state, ...args));
            update();
            listeners.add(update);
            return () => listeners.delete(update);
          },
        }),
        {
          select,
          effect: function* (...args: A) {
            return select(state, ...args);
          },
        },
      );
    },
    runSaga(saga: () => Generator) {
      const reduxStore = {
        getState: () => state,
        subscribe(notify: () => void) {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
      };
      const task = runSaga(
        {
          channel,
          dispatch: store.dispatch,
          getState: reduxStore.getState,
          context: { reduxStore },
        },
        saga,
      );
      return () => task.cancel();
    },
  };
  return store;
}
