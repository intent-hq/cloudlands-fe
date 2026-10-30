import { describe, expect, it } from 'vitest';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  emptyInlineVisualRecord,
  type InlineVisualSnapshot,
} from '$features/inline-html/inline-visual-types';
import { appendInlineVisualDraft } from '$features/inline-html/inline-visual-handoff';
import { inlineVisualKey } from './inline-visuals-types';
import {
  initialState,
  inlineVisualsReducer,
  inlineVisualOpened,
  inlineVisualLoadSettled,
  inlineVisualChanged,
  inlineVisualRetryRequested,
  inlineVisualSaveSettled,
  inlineVisualExportRequested,
  inlineVisualExportSettled,
  inlineVisualDraftRequested,
  inlineVisualDraftConsumed,
  inlineVisualDraftOwnerReleased,
} from './inline-visuals-slice';

const identity = {
  workspaceId: 'ws',
  agentId: 'agent',
  messageId: 'message',
  blockKey: '0:12',
  source: '<div />',
};
const key = inlineVisualKey(identity);
const snapshot: InlineVisualSnapshot = {
  title: 'Clamp',
  state: { force: 12 },
  inputs: { force: 12 },
  results: { pressure: 24 },
};
const record = { ...emptyInlineVisualRecord(), current: snapshot };
const entry = (state: typeof initialState) => getItem(state.entries, key)!;
const opened = () => inlineVisualsReducer(initialState, inlineVisualOpened(identity));
const loaded = () =>
  inlineVisualsReducer(opened(), inlineVisualLoadSettled(key, emptyInlineVisualRecord()));

describe('inline visual state ownership', () => {
  it('starts empty and isolates identical fences by every identity field and source', () => {
    expect(getItems(initialState.entries)).toEqual([]);
    let state = opened();
    expect(entry(state)).toMatchObject({ loaded: false, status: 'loading', revision: 0 });
    expect(inlineVisualsReducer(state, inlineVisualOpened(identity))).toBe(state);
    for (const field of ['workspaceId', 'agentId', 'messageId', 'blockKey', 'source'] as const) {
      state = inlineVisualsReducer(state, inlineVisualOpened({ ...identity, [field]: 'other' }));
    }
    expect(getItems(state.entries)).toHaveLength(6);
  });

  it('blocks changes after a failed load and requires retry before accepting a restored record', () => {
    let state = inlineVisualsReducer(
      opened(),
      inlineVisualLoadSettled(key, null, 'Permission denied'),
    );
    expect(entry(state)).toMatchObject({ status: 'error', loaded: false });
    expect(inlineVisualsReducer(state, inlineVisualChanged(key, record))).toBe(state);
    expect(inlineVisualsReducer(state, inlineVisualLoadSettled(key, record))).toBe(state);
    state = inlineVisualsReducer(state, inlineVisualRetryRequested(key));
    expect(entry(state).status).toBe('loading');
    state = inlineVisualsReducer(state, inlineVisualLoadSettled(key, record));
    expect(entry(state)).toMatchObject({ status: 'ready', loaded: true, record });
    expect(
      inlineVisualsReducer(state, inlineVisualLoadSettled(key, emptyInlineVisualRecord())),
    ).toBe(state);
  });

  it('rejects malformed records and operations for missing entries', () => {
    const malformed = { ...record, version: 2 } as unknown as typeof record;
    expect(
      entry(inlineVisualsReducer(opened(), inlineVisualLoadSettled(key, malformed))).status,
    ).toBe('error');
    const state = loaded();
    expect(inlineVisualsReducer(state, inlineVisualChanged(key, malformed))).toBe(state);
    expect(inlineVisualsReducer(initialState, inlineVisualRetryRequested(key))).toBe(initialState);
  });

  it('keeps newer edits when an older save succeeds or fails and retries failed writes', () => {
    let state = inlineVisualsReducer(loaded(), inlineVisualChanged(key, record));
    const newer = { ...record, current: { ...snapshot, inputs: { force: 20 } } };
    state = inlineVisualsReducer(state, inlineVisualChanged(key, newer));
    state = inlineVisualsReducer(state, inlineVisualSaveSettled(key, 1));
    expect(entry(state)).toMatchObject({
      record: newer,
      status: 'saving',
      savedRevision: 1,
      revision: 2,
    });
    state = inlineVisualsReducer(state, inlineVisualSaveSettled(key, 1, 'old failure'));
    expect(entry(state).status).toBe('saving');
    state = inlineVisualsReducer(state, inlineVisualSaveSettled(key, 2, 'offline'));
    expect(entry(state)).toMatchObject({ record: newer, status: 'error', error: 'offline' });
    state = inlineVisualsReducer(state, inlineVisualRetryRequested(key));
    expect(entry(state).status).toBe('saving');
    state = inlineVisualsReducer(state, inlineVisualSaveSettled(key, 2));
    expect(entry(state)).toMatchObject({ record: newer, status: 'ready', savedRevision: 2 });
    expect(inlineVisualsReducer(state, inlineVisualSaveSettled(key, 1, 'stale'))).toBe(state);
    expect(inlineVisualsReducer(state, inlineVisualSaveSettled(key, 3))).toBe(state);
  });

  it('reports only the latest correlated export outcome', () => {
    let state = inlineVisualsReducer(
      loaded(),
      inlineVisualExportRequested(key, 'export-1', record),
    );
    state = inlineVisualsReducer(state, inlineVisualExportRequested(key, 'export-2', record));
    expect(
      inlineVisualsReducer(state, inlineVisualExportSettled(key, 'export-1', 'old.json')),
    ).toBe(state);
    state = inlineVisualsReducer(
      state,
      inlineVisualExportSettled(key, 'export-2', undefined, 'disk full'),
    );
    expect(entry(state).export).toMatchObject({
      requestId: 'export-2',
      status: 'error',
      error: 'disk full',
    });
    state = inlineVisualsReducer(state, inlineVisualExportRequested(key, 'export-3', record));
    state = inlineVisualsReducer(state, inlineVisualExportSettled(key, 'export-3', 'actual.json'));
    expect(entry(state).export).toMatchObject({
      requestId: 'export-3',
      status: 'saved',
      path: 'actual.json',
    });
  });

  it('keeps draft requests pane-owned, consumes once, and releases only that pane', () => {
    const draft = { id: 'one', ownerId: 'pane-one', workspaceId: 'ws', agentId: 'agent', snapshot };
    let state = inlineVisualsReducer(initialState, inlineVisualDraftRequested(draft));
    state = inlineVisualsReducer(
      state,
      inlineVisualDraftRequested({ ...draft, id: 'two', ownerId: 'pane-two' }),
    );
    const malformed = { ...draft, id: 'bad', snapshot: { ...snapshot, title: '' } };
    expect(inlineVisualsReducer(state, inlineVisualDraftRequested(malformed))).toBe(state);
    state = inlineVisualsReducer(state, inlineVisualDraftOwnerReleased('pane-one'));
    expect(getItems(state.drafts).map((item) => item.id)).toEqual(['two']);
    state = inlineVisualsReducer(state, inlineVisualDraftConsumed('two'));
    expect(getItems(state.drafts)).toEqual([]);
    expect(inlineVisualsReducer(state, inlineVisualDraftConsumed('two'))).toBe(state);
    expect(inlineVisualsReducer(state, inlineVisualDraftOwnerReleased('missing'))).toBe(state);
  });

  it('appends readable inputs and results while preserving the existing draft exactly', () => {
    const draft = 'Keep my existing question.  ';
    const text = appendInlineVisualDraft(draft, snapshot);
    expect(text.startsWith(`${draft}\n\nClamp\n\n`)).toBe(true);
    expect(JSON.parse(text.split('```json\n')[1].split('\n```')[0])).toEqual({
      inputs: snapshot.inputs,
      results: snapshot.results,
    });
    expect(text).not.toContain('"state"');
    expect(appendInlineVisualDraft('', snapshot).startsWith('Clamp')).toBe(true);
  });
  it('does not mark identical published JSON dirty after restoring or reopening', () => {
    const restored = inlineVisualsReducer(opened(), inlineVisualLoadSettled(key, record));
    const equivalent = JSON.parse(JSON.stringify(record));
    expect(inlineVisualsReducer(restored, inlineVisualChanged(key, equivalent))).toBe(restored);
    const reopened = inlineVisualsReducer(restored, inlineVisualOpened(identity));
    expect(inlineVisualsReducer(reopened, inlineVisualChanged(key, equivalent))).toBe(restored);
  });

  it('uses a JSON fence longer than authored backtick runs', () => {
    const authored = { ...snapshot, inputs: { note: 'Use `````` inside this value' } };
    const text = appendInlineVisualDraft('Existing draft', authored);
    const opening = text.split('\n').find((line) => /^`+json$/.test(line))!;
    const fence = opening.slice(0, -4);
    expect(fence.length).toBe(7);
    expect(text.endsWith(`\n${fence}`)).toBe(true);
    expect(JSON.parse(text.split(`${fence}json\n`)[1].split(`\n${fence}`)[0])).toEqual({
      inputs: authored.inputs,
      results: authored.results,
    });
  });
});
