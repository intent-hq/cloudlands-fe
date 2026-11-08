import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { deserializePaletteMemory, serializePaletteMemory } from '../palette-normalization';
import { selectPaletteMemorySnapshot } from '../palette-selectors';
import {
  paletteMemoryLoaded,
  recordPaletteFileMru,
  recordPaletteMruItem,
  recordPalettePick,
} from '../palette-slice';

/** Item IDs differ between daemons, so the key is namespaced per backend. */
export const PALETTE_MEMORY_STORAGE_KEY = 'palette-memory';

const PERSIST_ACTIONS = [recordPaletteMruItem, recordPaletteFileMru, recordPalettePick];

type LoadMode = 'merge' | 'replace';

function* loadMemory(backendId: string, mode: LoadMode): SagaGenerator<void> {
  let stored: unknown;
  try {
    stored = yield* call(
      getLocalStorageJSON<unknown>,
      namespaceBackendKey(PALETTE_MEMORY_STORAGE_KEY, backendId),
    );
  } catch {
    stored = undefined;
  }
  yield* put(paletteMemoryLoaded(deserializePaletteMemory(stored, Date.now()), mode));
}

function* persistMemory(): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    const palette = yield* selectPaletteMemorySnapshot.effect();
    yield* call(
      setLocalStorageJSON,
      namespaceBackendKey(PALETTE_MEMORY_STORAGE_KEY, backendId),
      serializePaletteMemory(palette),
    );
  } catch {
    // Storage failures are non-fatal and must not stop the watcher.
  }
}

function* watchBackendSwitch(): SagaGenerator<void> {
  let lastBackendId = yield* selectActiveBackendId();
  while (true) {
    yield* take(connectionsListReceived);
    const backendId = yield* selectActiveBackendId();
    if (backendId === lastBackendId) continue;
    lastBackendId = backendId;
    yield* call(loadMemory, backendId, 'replace' as LoadMode);
  }
}

/** Load palette pick memory and recent items for this daemon, and save them on change. */
export function* paletteMemorySaga(): SagaGenerator<void> {
  yield* call(loadMemory, yield* selectActiveBackendId(), 'merge' as LoadMode);
  yield* fork(watchBackendSwitch);
  yield* takeEvery(PERSIST_ACTIONS, persistMemory);
}
