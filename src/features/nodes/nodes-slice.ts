import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { NodeAddError, NodesState, PasteSurface } from './nodes-types';

const initialState: NodesState = {
  paste: { phase: 'closed', masked: null, error: null, surface: 'inline' },
  highlightId: null,
};

/** "Paste an intent:// link": read the clipboard, else open the field. */
export const pasteLinkRequested = createAction('nodes/pasteLinkRequested');
/** Open the paste field; the wizard passes `'wizard'` so the inline row stays hidden. */
export const pasteFieldOpened = createAction<[surface?: PasteSurface]>('nodes/pasteFieldOpened');
/** Test and add the link typed in the field (stashed with `stashPastedLink`, never in the action). */
export const pasteLinkSubmitted = createAction('nodes/pasteLinkSubmitted');
/** Test the last submitted link again (kept in the saga, never in state). */
export const pasteLinkRetried = createAction('nodes/pasteLinkRetried');
export const pasteTestingStarted = createAction<[masked: string]>('nodes/pasteTestingStarted');
export const pasteFailed = createAction<[error: NodeAddError]>('nodes/pasteFailed');
/** Cancel: close the paste row and stop the test. */
export const pasteClosed = createAction('nodes/pasteClosed');
/** The link was added: close the paste row. */
export const pasteCompleted = createAction('nodes/pasteCompleted');
/** A node link opened from outside the app: main holds its credential under `pendingId`. */
export const nodeLinkReceived =
  createAction<[link: { pendingId: string; label: string; existingId: string | null }]>(
    'nodes/nodeLinkReceived',
  );
/** An `intent://node` link opened from outside the app: main holds it under `pendingId`. */
export const nodeInviteReceived = createAction<[link: { pendingId: string; label: string }]>(
  'nodes/nodeInviteReceived',
);
/**
 * Opening a saved connection found a node (no window opened). `added` is true
 * when the Add machine dialog just saved it: refused nodes are then removed.
 */
export const nodeConnectionOpened = createAction<[connectionId: string, added: boolean]>(
  'nodes/nodeConnectionOpened',
);
export const rowHighlighted = createAction<[connectionId: string | null]>('nodes/rowHighlighted');

export const nodesReducer = createReducer<NodesState>(initialState);
nodesReducer.with(pasteFieldOpened, (state, { payload: [surface] }) => ({
  ...state,
  paste: {
    phase: 'field',
    masked: null,
    error: null,
    // A retry re-opens the field from the saga: keep the open surface.
    surface: surface ?? (state.paste.phase === 'closed' ? 'inline' : state.paste.surface),
  },
}));
nodesReducer.with(pasteTestingStarted, (state, { payload: [masked] }) => ({
  ...state,
  paste: { phase: 'testing', masked, error: null, surface: state.paste.surface },
}));
nodesReducer.with(pasteFailed, (state, { payload: [error] }) => ({
  ...state,
  paste: { phase: 'field', masked: state.paste.masked, error, surface: state.paste.surface },
}));
nodesReducer.with(pasteClosed, (state) => ({ ...state, paste: initialState.paste }));
nodesReducer.with(pasteCompleted, (state) => ({ ...state, paste: initialState.paste }));
nodesReducer.with(rowHighlighted, (state, { payload: [highlightId] }) => ({
  ...state,
  highlightId,
}));
