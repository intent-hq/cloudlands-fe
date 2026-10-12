import { describe, expect, it } from 'vitest';
import {
  closePalette,
  initialState,
  openGoToLine,
  openPalette,
  paletteReducer,
  paletteNoteSearchAuthorityCaptured,
  paletteNoteSearchFinished,
  paletteNoteSearchReleased,
  paletteNoteSearchRequested,
  recordPaletteMruItem,
  togglePalette,
} from './palette-slice';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';

describe('paletteReducer', () => {
  it('returns the initial state', () => {
    expect(paletteReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('updates open and query state', () => {
    expect(paletteReducer(initialState, openPalette())).toMatchObject({ isOpen: true, query: '' });
    expect(
      paletteReducer({ ...initialState, isOpen: true, query: 'abc' }, closePalette()),
    ).toMatchObject({
      isOpen: false,
      query: '',
    });
    expect(paletteReducer(initialState, openGoToLine())).toMatchObject({
      isOpen: true,
      query: ':',
    });
    expect(paletteReducer(initialState, togglePalette()).isOpen).toBe(true);
  });

  it('opens a recovery search without changing recent entries, and clears it for a normal open', () => {
    const before = { ...initialState, fileMru: { 'notes/context.ts': 123 } };
    const opened = paletteReducer(before, openPalette('GitLab'));
    expect(opened).toEqual({ ...before, isOpen: true, query: 'GitLab' });
    expect(paletteReducer(opened, openPalette())).toEqual({ ...before, isOpen: true, query: '' });
    expect(paletteReducer(opened, closePalette())).toEqual(before);
  });

  it('correlates note search outcomes by consumer, request and authority', () => {
    const first = paletteReducer(
      initialState,
      paletteNoteSearchRequested('palette', 'request-1', 'old', 'workspace-a'),
    );
    expect(getItem(first.noteSearches, 'palette')).toMatchObject({
      requestId: 'request-1',
      query: 'old',
      preferWorkspaceId: 'workspace-a',
      loading: true,
    });
    const bound = paletteReducer(
      first,
      paletteNoteSearchAuthorityCaptured('palette', 'request-1', 'authority-a'),
    );
    const newer = paletteReducer(bound, paletteNoteSearchRequested('palette', 'request-2', 'new'));
    expect(
      paletteReducer(
        newer,
        paletteNoteSearchFinished('palette', 'request-1', 'authority-a', {
          items: [],
          loading: false,
          capability: 'indexed',
          fallback: false,
        }),
      ),
    ).toBe(newer);
    const current = paletteReducer(
      newer,
      paletteNoteSearchAuthorityCaptured('palette', 'request-2', 'authority-b'),
    );
    const finished = paletteReducer(
      current,
      paletteNoteSearchFinished('palette', 'request-2', 'authority-b', {
        items: [],
        loading: false,
        capability: 'indexed',
        fallback: false,
      }),
    );
    expect(getItem(finished.noteSearches, 'palette')).toMatchObject({
      requestId: 'request-2',
      loading: false,
      capability: 'indexed',
    });
    expect(
      getItem(
        paletteReducer(finished, paletteNoteSearchReleased('palette')).noteSearches,
        'palette',
      ),
    ).toBeUndefined();
  });
});

it('persists composite note MRU IDs independently while retaining old entries', () => {
  let state = paletteReducer(initialState, recordPaletteMruItem('note', 'spec', 1));
  state = paletteReducer(state, recordPaletteMruItem('note', JSON.stringify(['a', 'spec']), 2));
  state = paletteReducer(state, recordPaletteMruItem('note', JSON.stringify(['b', 'spec']), 3));
  expect(Object.values(state.mruEntriesByKey).map((entry) => entry.id)).toEqual(
    expect.arrayContaining(['spec', JSON.stringify(['a', 'spec']), JSON.stringify(['b', 'spec'])]),
  );
  expect(state.mruEntryIds).toHaveLength(3);
});
