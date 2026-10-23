import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
  upsertItem,
  removeItem,
} from '@themislib/themis/utils/collections/collection-utils';
import {
  emptyInlineVisualRecord,
  isInlineVisualRecord,
  isInlineVisualSnapshot,
  type InlineVisualIdentity,
  type InlineVisualRecord,
} from '$features/inline-html/inline-visual-types';
import {
  inlineVisualKey,
  type InlineVisualDraft,
  type InlineVisualEntry,
  type InlineVisualsState,
} from './inline-visuals-types';

export const initialState: InlineVisualsState = {
  entries: createCollection<InlineVisualEntry, 'id'>('id'),
  drafts: createCollection<InlineVisualDraft, 'id'>('id'),
};
export const inlineVisualOpened =
  createAction<[identity: InlineVisualIdentity]>('inlineVisuals/opened');
export const inlineVisualRetryRequested = createAction<[key: string]>(
  'inlineVisuals/retryRequested',
);
export const inlineVisualLoadSettled = createAction<
  [key: string, record: InlineVisualRecord | null, error?: string]
>('inlineVisuals/loadSettled');
export const inlineVisualChanged =
  createAction<[key: string, record: InlineVisualRecord]>('inlineVisuals/changed');
export const inlineVisualSaveSettled = createAction<
  [key: string, revision: number, error?: string]
>('inlineVisuals/saveSettled');
export const inlineVisualExportRequested = createAction<
  [key: string, requestId: string, record: InlineVisualRecord]
>('inlineVisuals/exportRequested');
export const inlineVisualExportSettled = createAction<
  [key: string, requestId: string, path?: string, error?: string]
>('inlineVisuals/exportSettled');
export const inlineVisualDraftRequested = createAction<[draft: InlineVisualDraft]>(
  'inlineVisuals/draftRequested',
);
export const inlineVisualDraftConsumed = createAction<[id: string]>('inlineVisuals/draftConsumed');
export const inlineVisualDraftOwnerReleased = createAction<[ownerId: string]>(
  'inlineVisuals/draftOwnerReleased',
);

export const inlineVisualsReducer = createReducer<InlineVisualsState>(initialState);
function update(
  state: InlineVisualsState,
  key: string,
  apply: (entry: InlineVisualEntry) => InlineVisualEntry,
): InlineVisualsState {
  const entry = getItem(state.entries, key);
  if (!entry) return state;
  const next = apply(entry);
  return next === entry ? state : { ...state, entries: upsertItem(state.entries, next) };
}

inlineVisualsReducer.with(inlineVisualOpened, (state, { payload: [identity] }) => {
  const id = inlineVisualKey(identity);
  if (getItem(state.entries, id)) return state;
  return {
    ...state,
    entries: upsertItem(state.entries, {
      id,
      identity,
      record: emptyInlineVisualRecord(),
      loaded: false,
      status: 'loading',
      revision: 0,
      savedRevision: 0,
    }),
  };
});
inlineVisualsReducer.with(inlineVisualRetryRequested, (state, { payload: [key] }) =>
  update(state, key, (entry) =>
    entry.status !== 'error'
      ? entry
      : { ...entry, status: entry.loaded ? 'saving' : 'loading', error: undefined },
  ),
);
inlineVisualsReducer.with(inlineVisualLoadSettled, (state, { payload: [key, record, error] }) =>
  update(state, key, (entry) => {
    if (entry.loaded || entry.status !== 'loading') return entry;
    if (error || !record || !isInlineVisualRecord(record))
      return { ...entry, status: 'error', error: error ?? 'Invalid saved visual state.' };
    return { ...entry, record, loaded: true, status: 'ready', error: undefined };
  }),
);
inlineVisualsReducer.with(inlineVisualChanged, (state, { payload: [key, record] }) =>
  update(state, key, (entry) =>
    !entry.loaded ||
    !isInlineVisualRecord(record) ||
    JSON.stringify(entry.record) === JSON.stringify(record)
      ? entry
      : { ...entry, record, revision: entry.revision + 1, status: 'saving', error: undefined },
  ),
);
inlineVisualsReducer.with(inlineVisualSaveSettled, (state, { payload: [key, revision, error] }) =>
  update(state, key, (entry) => {
    if (!entry.loaded || revision > entry.revision || revision < entry.savedRevision) return entry;
    const savedRevision = error ? entry.savedRevision : revision;
    return {
      ...entry,
      savedRevision,
      ...(revision === entry.revision
        ? { status: error ? ('error' as const) : ('ready' as const), error }
        : {}),
    };
  }),
);
inlineVisualsReducer.with(inlineVisualExportRequested, (state, { payload: [key, requestId] }) =>
  update(state, key, (entry) => ({ ...entry, export: { requestId, status: 'saving' } })),
);
inlineVisualsReducer.with(
  inlineVisualExportSettled,
  (state, { payload: [key, requestId, path, error] }) =>
    update(state, key, (entry) =>
      entry.export?.requestId === requestId
        ? { ...entry, export: { requestId, status: error ? 'error' : 'saved', path, error } }
        : entry,
    ),
);
inlineVisualsReducer.with(inlineVisualDraftRequested, (state, { payload: [draft] }) =>
  isInlineVisualSnapshot(draft.snapshot)
    ? { ...state, drafts: upsertItem(state.drafts, draft) }
    : state,
);
inlineVisualsReducer.with(inlineVisualDraftConsumed, (state, { payload: [id] }) =>
  getItem(state.drafts, id) ? { ...state, drafts: removeItem(state.drafts, id) } : state,
);
inlineVisualsReducer.with(inlineVisualDraftOwnerReleased, (state, { payload: [ownerId] }) => {
  const owned = getItems(state.drafts).filter((draft) => draft.ownerId === ownerId);
  return owned.length
    ? {
        ...state,
        drafts: owned.reduce((drafts, draft) => removeItem(drafts, draft.id), state.drafts),
      }
    : state;
});
