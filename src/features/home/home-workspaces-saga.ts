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
  homeRepositoryHidden,
  homeRepositoryRemoved,
  homeRepositoriesUnhidden,
  homeHiddenReposSynced,
} from './home-workspaces-slice';
import { homeSetAsideSaga } from './home-set-aside-saga';
import { onSharedStorageChange } from '$lib/utils/shared-preference';

import {
  getLocalStorageJSON,
  getLocalStorageItem,
  setLocalStorageItem,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  readHomePersistence,
  persistedHomeState,
  normalizeHomeSetAside,
  normalizeHomeHiddenRepos,
  normalizeHomeRemovedRepos,
} from './home-workspaces-persistence';

export function* homeWorkspacesSaga(): SagaGenerator<void> {
  yield* all([
    call(homeWorkspacePersistenceSaga),
    call(homeSetAsideSaga),
    call(homeSetAsideStorageSyncSaga),
  ]);
}

/** View-only writes; they must not replace personal records another window saved. */
const viewActions = new Set<string>([updateHomeWorkspaceView.type, resetHomeWorkspaceView.type]);

const persistedActions = new Set<string>([
  updateHomeWorkspaceView.type,
  resetHomeWorkspaceView.type,
  setHomeWorkspaceAside.type,
  bringBackHomeWorkspace.type,
  homeWorkspaceReturned.type,
  homeSetAsideKnownAttentionRecorded.type,
  workspaceDeleted.type,
  homeRepositoryHidden.type,
  homeRepositoryRemoved.type,
  homeRepositoriesUnhidden.type,
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
          let { setAside, hiddenRepos, removedRepos } = state;
          if (viewActions.has(action.type)) {
            // Another window may have saved newer personal records since our last sync.
            const stored = yield* call(getLocalStorageJSON<unknown>, scope);
            if (stored !== undefined && stored !== null) {
              const fresh = readHomePersistence(stored);
              const freshSetAside = fresh.setAside ?? {};
              const freshHidden = fresh.hiddenRepos ?? {};
              const freshRemoved = fresh.removedRepos ?? [];
              const sameScope = (yield* select(selectHomePersistenceScope.select)) === scope;
              if (
                sameScope &&
                JSON.stringify(freshSetAside) !==
                  JSON.stringify(normalizeHomeSetAside(state.setAside))
              ) {
                yield* put(homeSetAsideSynced(scope, freshSetAside));
              }
              const currentHidden = normalizeHomeHiddenRepos(state.hiddenRepos);
              if (
                sameScope &&
                (JSON.stringify(freshHidden) !== JSON.stringify(currentHidden) ||
                  JSON.stringify(freshRemoved) !==
                    JSON.stringify(normalizeHomeRemovedRepos(state.removedRepos, currentHidden)))
              ) {
                yield* put(homeHiddenReposSynced(scope, freshHidden, freshRemoved));
              }
              setAside = freshSetAside;
              hiddenRepos = freshHidden;
              removedRepos = freshRemoved;
            }
          }
          const serialized = JSON.stringify(
            persistedHomeState({ ...state, setAside, hiddenRepos, removedRepos }),
          );
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

/** Keeps set-aside and hidden-repository records in step across app windows and host views. */
function* homeSetAsideStorageSyncSaga(): SagaGenerator<void> {
  if (typeof window === 'undefined') return;
  const changes = eventChannel<string>(
    (emit) => onSharedStorageChange((key) => emit(key ?? '')),
    buffers.expanding<string>(8),
  );
  try {
    while (true) {
      const key = yield* take(changes);
      const scope = yield* select(selectHomePersistenceScope.select);
      // Only this account/backend's document; '' means storage was cleared.
      if (!scope || (key !== scope && key !== '')) continue;
      const stored = yield* call(getLocalStorageJSON<unknown>, scope);
      if ((yield* select(selectHomePersistenceScope.select)) !== scope) continue;
      const fresh = readHomePersistence(stored);
      yield* put(homeSetAsideSynced(scope, fresh.setAside ?? {}));
      yield* put(homeHiddenReposSynced(scope, fresh.hiddenRepos ?? {}, fresh.removedRepos ?? []));
    }
  } finally {
    changes.close();
  }
}
