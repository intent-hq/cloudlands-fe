/**
 * Native Plans Slice
 *
 * Canonical renderer state for native ACP `plan` session updates, mirrored
 * from the acp-official `planManager` by `native-plans-saga`. This is the
 * source-priority gate for the workspace-task fallback card (monorepo#3249):
 * when a session has a native plan, the fallback never renders.
 */
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { NativePlanEntry, NativePlansState } from './native-plans-types';

export type { NativePlanEntry, NativePlansState };

export const initialNativePlansState: NativePlansState = {
  bySessionId: {},
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Apply a native ACP plan update for a session (replaces prior entries). */
export const applyNativePlanUpdated = createAction<[sessionId: string, entries: NativePlanEntry[]]>(
  'nativePlans/applyNativePlanUpdated',
);

/** Drop the native plan for a session (plan:cleared). */
export const applyNativePlanCleared = createAction<[sessionId: string]>(
  'nativePlans/applyNativePlanCleared',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const nativePlansReducer = createReducer<NativePlansState>(initialNativePlansState);
nativePlansReducer.with(applyNativePlanUpdated, (state, { payload: [sessionId, entries] }) => ({
  bySessionId: {
    ...state.bySessionId,
    [sessionId]: { entries: createCollection<NativePlanEntry, 'id'>('id', entries) },
  },
}));
nativePlansReducer.with(applyNativePlanCleared, (state, { payload: [sessionId] }) => {
  if (!(sessionId in state.bySessionId)) return state;
  const next = { ...state.bySessionId };
  delete next[sessionId];
  return { bySessionId: next };
});
