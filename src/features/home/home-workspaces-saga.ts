import { actionChannel, call, put, select, take, type SagaGenerator } from 'typed-redux-saga';
import { buffers } from 'redux-saga';
import type { Action } from '@redux-saga/types';
import {
  setLabsMultiplayerEnabled,
  toggleLabsMultiplayer,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectHomePersistenceScope, selectHomeWorkspaceView } from './home-workspaces-selectors';
import {
  hydrateHomeWorkspaceSettings,
  setHomePersistenceError,
  updateHomeWorkspaceView,
  resetHomeWorkspaceView,
} from './home-workspaces-slice';

import {
  getLocalStorageJSON,
  getLocalStorageItem,
  setLocalStorageItem,
} from '$store/renderer/utils/safe-local-storage-saga';
import { readHomePersistence, persistedHomeState } from './home-workspaces-persistence';

export function* homeWorkspacesSaga(): SagaGenerator<void> {
  yield* call(homeWorkspacePersistenceSaga);
}

const persistedActions = new Set<string>([
  updateHomeWorkspaceView.type,
  resetHomeWorkspaceView.type,
]);

/** Serial storage work keeps identity changes and rapid configuration edits ordered. */
export function* homeWorkspacePersistenceSaga(): SagaGenerator<void> {
  // Only preferences and the identity/connection owners can change this storage scope.
  const actions = yield* actionChannel<Action>(
    (action: Action) =>
      persistedActions.has(action.type) ||
      action.type.startsWith('principal/') ||
      action.type.startsWith('connections/') ||
      action.type.startsWith('daemonHealth/') ||
      action.type === 'workspaceEvents/daemonEventsSubscribed' ||
      action.type === 'workspace-lifecycle/backendReconnected' ||
      action.type === setLabsMultiplayerEnabled.type ||
      action.type === toggleLabsMultiplayer.type,
    buffers.expanding<Action>(16),
  );
  let currentScope: string | null | undefined;
  let lastWritten: string | undefined;
  let action: Action | undefined;
  try {
    while (true) {
      const scope = yield* select(selectHomePersistenceScope.select);
      if (scope !== currentScope) {
        currentScope = scope;
        lastWritten = undefined;
        const stored = scope ? yield* call(getLocalStorageJSON<unknown>, scope) : undefined;
        // A mocked/asynchronous storage adapter may resolve after identity changes.
        if ((yield* select(selectHomePersistenceScope.select)) !== scope) continue;
        yield* put(hydrateHomeWorkspaceSettings(scope, readHomePersistence(stored)));
      } else if (scope && action) {
        const state = yield* select(selectHomeWorkspaceView.select);
        if (state.persistenceScope === scope && persistedActions.has(action.type)) {
          const serialized = JSON.stringify(persistedHomeState(state));
          if (serialized !== lastWritten) {
            yield* call(setLocalStorageItem, scope, serialized);
            const observed = yield* call(getLocalStorageItem, scope);
            if ((yield* select(selectHomePersistenceScope.select)) === scope) {
              yield* put(setHomePersistenceError(observed !== serialized));
              if (observed === serialized) lastWritten = serialized;
            }
          }
        }
      }
      action = yield* take(actions);
    }
  } finally {
    actions.close();
  }
}
