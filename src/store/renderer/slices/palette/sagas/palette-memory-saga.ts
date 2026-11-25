import { call, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { getLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import {
  watchSharedPreference,
  type SharedPreferenceSagaOptions,
} from '../../../utils/shared-preference-saga';
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

/** Saves this daemon's memory, and merges what another view of the same daemon saved. */
const paletteMemoryPreference: SharedPreferenceSagaOptions<unknown> = {
  *key() {
    return namespaceBackendKey(PALETTE_MEMORY_STORAGE_KEY, yield* selectActiveBackendId());
  },
  scope: 'host',
  parse: (stored) => stored,
  hydrate: (stored, source) =>
    source === 'storage' && stored !== undefined
      ? paletteMemoryLoaded(deserializePaletteMemory(stored, Date.now()), 'merge')
      : null,
  persistOn: PERSIST_ACTIONS,
  *select() {
    return serializePaletteMemory(yield* selectPaletteMemorySnapshot.effect());
  },
};

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
  yield* watchSharedPreference(paletteMemoryPreference);
}
