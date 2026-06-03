import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { testSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';

vi.mock(
  'typed-redux-saga',
  async () => await import('$store/renderer/utils/test-helpers/typed-redux-saga-mock'),
);

import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  hydratePaletteFileMru,
  hydratePaletteMruEntries,
  recordPaletteFileMru,
  recordPaletteMruItem,
} from '../palette-slice';
import {
  selectPaletteFileMru,
  selectPaletteMruEntries,
} from '../palette-selectors';
import {
  hydratePalettePersistence,
  paletteSaga,
  PALETTE_FILE_MRU_STORAGE_KEY,
  PALETTE_MRU_STORAGE_KEY,
  persistPaletteFileMru,
  persistPaletteMruEntries,
} from './palette-saga';

describe('paletteSaga', () => {
  it('hydrates MRU state through safe storage helpers', () => {
    testSaga(hydratePalettePersistence)
      .next()
      .call(getLocalStorageJSON, PALETTE_MRU_STORAGE_KEY)
      .next([
        { type: 'note', id: 'note-1', timestamp: 1 },
        { type: 'agent', id: 'agent-1', timestamp: 3 },
        { type: 'note', id: 'note-1', timestamp: 2 },
        { bad: true },
      ])
      .put(hydratePaletteMruEntries([
        { type: 'agent', id: 'agent-1', timestamp: 3 },
        { type: 'note', id: 'note-1', timestamp: 2 },
      ]))
      .next()
      .call(getLocalStorageJSON, PALETTE_FILE_MRU_STORAGE_KEY)
      .next({ '/a': 1, '/b': 'bad', '/c': 3 })
      .put(hydratePaletteFileMru({ '/c': 3, '/a': 1 }))
      .next()
      .isDone();
  });

  it('persists workspace-object MRU entries', () => {
    const entries = [{ type: 'agent', id: 'agent-1', timestamp: 2 }];
    testSaga(persistPaletteMruEntries)
      .next()
      .select(selectPaletteMruEntries.select)
      .next(entries)
      .call(setLocalStorageJSON, PALETTE_MRU_STORAGE_KEY, entries)
      .next()
      .isDone();
  });

  it('persists file MRU entries', () => {
    testSaga(persistPaletteFileMru)
      .next()
      .select(selectPaletteFileMru.select)
      .next({ '/a': 1 })
      .call(setLocalStorageJSON, PALETTE_FILE_MRU_STORAGE_KEY, { '/a': 1 })
      .next()
      .isDone();
  });

  it('registers MRU persistence watchers', () => {
    const iterator = paletteSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(hydratePalettePersistence),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(recordPaletteMruItem, persistPaletteMruEntries),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(recordPaletteFileMru, persistPaletteFileMru),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});
