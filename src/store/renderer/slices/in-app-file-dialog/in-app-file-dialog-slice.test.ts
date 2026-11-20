import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';

import {
  inAppFileDialogAnswered,
  inAppFileDialogReducer,
  inAppFileDialogRequested,
  initialState,
} from './in-app-file-dialog-slice';

const ids = (state: typeof initialState) => getItems(state.requests).map((request) => request.id);

describe('inAppFileDialogReducer', () => {
  it('queues requests in arrival order and ignores a repeated id', () => {
    let state = inAppFileDialogReducer(
      initialState,
      inAppFileDialogRequested({ id: 'a', kind: 'open' }),
    );
    state = inAppFileDialogReducer(state, inAppFileDialogRequested({ id: 'b', kind: 'save' }));
    const again = inAppFileDialogReducer(
      state,
      inAppFileDialogRequested({ id: 'a', kind: 'open' }),
    );
    expect(ids(state)).toEqual(['a', 'b']);
    expect(again).toBe(state);
  });

  it('drops an answered request (chosen or cancelled)', () => {
    let state = inAppFileDialogReducer(
      initialState,
      inAppFileDialogRequested({ id: 'a', kind: 'open' }),
    );
    state = inAppFileDialogReducer(state, inAppFileDialogRequested({ id: 'b', kind: 'open' }));
    state = inAppFileDialogReducer(state, inAppFileDialogAnswered('a', ['/x']));
    expect(ids(state)).toEqual(['b']);
    state = inAppFileDialogReducer(state, inAppFileDialogAnswered('b', null));
    expect(ids(state)).toEqual([]);
    expect(inAppFileDialogReducer(state, inAppFileDialogAnswered('zz', null))).toBe(state);
  });
});
