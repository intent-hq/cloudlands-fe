import { call, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import { getLocalStorageJSON, setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import {
  hydratePaletteFileMru,
  hydratePaletteMruEntries,
  recordPaletteFileMru,
  recordPaletteMruItem,
} from "../palette-slice";
import { selectPaletteFileMru, selectPaletteMruEntries } from "../palette-selectors";
import { normalizePaletteFileMru, normalizePaletteMruEntryList } from "../palette-normalization";

export const PALETTE_MRU_STORAGE_KEY = "palette-mru-all";
export const PALETTE_FILE_MRU_STORAGE_KEY = "palette-mru-files";

export function* hydratePalettePersistence(): SagaGenerator<void> {
  const entries = yield* call(getLocalStorageJSON<unknown>, PALETTE_MRU_STORAGE_KEY);
  yield* put(hydratePaletteMruEntries(normalizePaletteMruEntryList(entries)));

  const fileMru = yield* call(getLocalStorageJSON<unknown>, PALETTE_FILE_MRU_STORAGE_KEY);
  yield* put(hydratePaletteFileMru(normalizePaletteFileMru(fileMru)));
}

export function* persistPaletteMruEntries(): SagaGenerator<void> {
  const entries = yield* selectPaletteMruEntries.effect();
  yield* call(setLocalStorageJSON, PALETTE_MRU_STORAGE_KEY, entries);
}

export function* persistPaletteFileMru(): SagaGenerator<void> {
  const fileMru = yield* selectPaletteFileMru.effect();
  yield* call(setLocalStorageJSON, PALETTE_FILE_MRU_STORAGE_KEY, fileMru);
}

export function* paletteSaga(): SagaGenerator<void> {
  yield* call(hydratePalettePersistence);
  yield* takeEvery(recordPaletteMruItem, persistPaletteMruEntries);
  yield* takeEvery(recordPaletteFileMru, persistPaletteFileMru);
}
