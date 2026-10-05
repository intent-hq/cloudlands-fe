import type { SettingsForm } from '$store/renderer/slices/settings-events/settings-events-types';
import { settingsEventsReducer } from '$store/renderer/slices/settings-events/settings-events-slice';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { principalReducer } from '$store/renderer/slices/principal/principal-slice';
import { createAdmittedLegacyPrincipal } from './fixtures/admitted-legacy-principal';
import {
  userPreferencesReducer,
  initialState as userPreferences,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { runSaga, stdChannel } from 'redux-saga';
import {
  guestSessionsReducer,
  initialState as guestSessions,
} from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { connectionsReducer } from '$store/renderer/slices/connections/connections-slice';
import {
  workspaceReducer,
  initialState as workspace,
} from '$store/renderer/slices/workspace/workspace-slice';

/** Component tests exercise production reducers and root-owned workflow sagas. */
export function createGuestWorkflowTestStore() {
  const freshState = () => ({
    guestSessions,
    settingsEvents: { forms: createCollection<SettingsForm, 'formId'>('formId') },
    ...createAdmittedLegacyPrincipal(),
    workspace,
    userPreferences: { ...userPreferences, labsMultiplayerEnabled: true },
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
        settingsEvents: settingsEventsReducer(state.settingsEvents, action as never),
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
