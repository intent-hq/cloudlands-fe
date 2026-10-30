import { actionChannel, all, call, put, select, take, type SagaGenerator } from 'typed-redux-saga';
import { buffers, eventChannel } from 'redux-saga';
import type { Action } from '@redux-saga/types';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
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
  setHomeWorkspaceAside,
  bringBackHomeWorkspace,
  homeWorkspaceReturned,
  homeSetAsideKnownAttentionRecorded,
  homeSetAsideSynced,
} from './home-workspaces-slice';
import { homeSetAsideSaga } from './home-set-aside-saga';

import {
  getLocalStorageJSON,
  getLocalStorageItem,
  setLocalStorageItem,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  readHomePersistence,
  persistedHomeState,
  normalizeHomeSetAside,
} from './home-workspaces-persistence';

export function* homeWorkspacesSaga(): SagaGenerator<void> {
  yield* all([
    call(homeWorkspacePersistenceSaga),
    call(homeSetAsideSaga),
    call(homeSetAsideStorageSyncSaga),
  ]);
}

/** View-only writes; they must not replace set-aside records another window saved. */
const viewActions = new Set<string>([updateHomeWorkspaceView.type, resetHomeWorkspaceView.type]);

const persistedActions = new Set<string>([
  updateHomeWorkspaceView.type,
  resetHomeWorkspaceView.type,
  setHomeWorkspaceAside.type,
  bringBackHomeWorkspace.type,
  homeWorkspaceReturned.type,
  homeSetAsideKnownAttentionRecorded.type,
  workspaceDeleted.type,
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
  let action: Action | undefined;
  try {
    while (true) {
      const scope = yield* select(selectHomePersistenceScope.select);
      if (scope !== currentScope) {
        currentScope = scope;
        const stored = scope ? yield* call(getLocalStorageJSON<unknown>, scope) : undefined;
        // A mocked/asynchronous storage adapter may resolve after identity changes.
        if ((yield* select(selectHomePersistenceScope.select)) !== scope) continue;
        yield* put(hydrateHomeWorkspaceSettings(scope, readHomePersistence(stored)));
      } else if (scope && action) {
        const state = yield* select(selectHomeWorkspaceView.select);
        if (state.persistenceScope === scope && persistedActions.has(action.type)) {
          let setAside = state.setAside;
          if (viewActions.has(action.type)) {
            // Another window may have saved newer set-aside records since our last sync.
            const stored = yield* call(getLocalStorageJSON<unknown>, scope);
            if (stored !== undefined && stored !== null) {
              const fresh = readHomePersistence(stored).setAside ?? {};
              if (
                JSON.stringify(fresh) !== JSON.stringify(normalizeHomeSetAside(state.setAside)) &&
                (yield* select(selectHomePersistenceScope.select)) === scope
              ) {
                yield* put(homeSetAsideSynced(scope, fresh));
              }
              setAside = fresh;
            }
          }
          const serialized = JSON.stringify(persistedHomeState({ ...state, setAside }));
          if (serialized !== (yield* call(getLocalStorageItem, scope))) {
            yield* call(setLocalStorageItem, scope, serialized);
            const observed = yield* call(getLocalStorageItem, scope);
            if ((yield* select(selectHomePersistenceScope.select)) === scope) {
              yield* put(setHomePersistenceError(observed !== serialized));
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

/** Keeps set-aside records in step across app windows sharing this account/backend. */
function* homeSetAsideStorageSyncSaga(): SagaGenerator<void> {
  if (typeof window === 'undefined') return;
  const changes = eventChannel<string>((emit) => {
    const onStorage = (event: StorageEvent) => emit(event.key ?? '');
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, buffers.expanding<string>(8));
  try {
    while (true) {
      const key = yield* take(changes);
      const scope = yield* select(selectHomePersistenceScope.select);
      // Only this account/backend's document; '' means storage was cleared.
      if (!scope || (key !== scope && key !== '')) continue;
      const stored = yield* call(getLocalStorageJSON<unknown>, scope);
      if ((yield* select(selectHomePersistenceScope.select)) !== scope) continue;
      yield* put(homeSetAsideSynced(scope, readHomePersistence(stored).setAside ?? {}));
    }
  } finally {
    changes.close();
  }
}
