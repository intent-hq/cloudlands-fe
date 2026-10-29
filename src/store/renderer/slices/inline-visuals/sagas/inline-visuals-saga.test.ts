import { webcrypto, createHash } from 'node:crypto';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { FilesClient } from '$lib/client/app-client';
import type { FileContentEntry } from '../../files/files-types';
import {
  emptyInlineVisualRecord,
  type InlineVisualSnapshot,
} from '$features/inline-html/inline-visual-types';
import {
  inlineVisualsSaga,
  INLINE_VISUAL_RECORD_MAX_BYTES,
  INLINE_VISUAL_SAVE_DELAY_MS,
} from './inline-visuals-saga';
import { inlineVisualKey } from '../inline-visuals-types';
import {
  initialState,
  inlineVisualsReducer,
  inlineVisualOpened,
  inlineVisualChanged,
  inlineVisualRetryRequested,
  inlineVisualExportRequested,
} from '../inline-visuals-slice';

const identity = {
  workspaceId: 'ws',
  agentId: 'agent',
  messageId: 'message',
  blockKey: '0:12',
  source: '<main>Clamp</main>',
};
const key = inlineVisualKey(identity);
const hash = createHash('sha256').update(key).digest('hex');
const path = `.intent/visuals/${hash}/state.json`;
const snapshot: InlineVisualSnapshot = {
  title: 'Clamp',
  state: 5,
  inputs: { force: 5 },
  results: { pressure: 10 },
};
const record = { ...emptyInlineVisualRecord(), current: snapshot };
const fileEntry = (content: string): FileContentEntry => ({
  kind: 'editable-text',
  originalContent: content,
  localContent: content,
  isBinary: false,
  path,
  absolutePath: null,
  lastUpdated: 0,
  loading: false,
  saving: false,
  error: null,
  truncated: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function harness() {
  const files = {
    read: vi.fn<FilesClient['read']>().mockResolvedValue(null),
    write: vi.fn<FilesClient['write']>().mockResolvedValue({ success: true }),
  };
  let state = initialState;
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof inlineVisualsReducer>[1]) => {
    state = inlineVisualsReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ inlineVisuals: state }) },
    inlineVisualsSaga,
    files,
  );
  return { files, task, dispatch, entry: (id = key) => getItem(state.entries, id)! };
}
const active: ReturnType<typeof harness>[] = [];
function start() {
  const h = harness();
  active.push(h);
  return h;
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  for (const h of active.splice(0)) h.task.cancel();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('root-owned inline visual persistence', () => {
  it('treats only a missing file as empty, reads the fixed path, and restores saved scenarios on reopen', async () => {
    const h = start();
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    expect(h.files.read).toHaveBeenCalledWith('ws', path);
    expect(h.entry().record).toEqual(emptyInlineVisualRecord());
    expect(h.files.write).not.toHaveBeenCalled();
    h.dispatch(inlineVisualChanged(key, record));
    await vi.waitFor(() => expect(h.entry().savedRevision).toBe(1));
    expect(h.files.write).toHaveBeenCalledWith('ws', path, {
      kind: 'editable-text',
      content: JSON.stringify(record),
    });
    const reopened = start();
    reopened.files.read.mockResolvedValue(fileEntry(JSON.stringify(record)));
    reopened.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(reopened.entry().status).toBe('ready'));
    expect(reopened.entry().record).toEqual(record);
  });

  it.each([
    ['malformed', () => fileEntry('{bad json')],
    ['wrong version', () => fileEntry(JSON.stringify({ version: 9 }))],
    ['oversized', () => fileEntry(' '.repeat(INLINE_VISUAL_RECORD_MAX_BYTES + 1))],
    ['truncated', () => ({ ...fileEntry('{}'), truncated: true })],
    [
      'binary',
      () =>
        ({
          ...fileEntry('{}'),
          kind: 'preview-only',
          originalContent: null,
          localContent: null,
          isBinary: true,
        }) as FileContentEntry,
    ],
  ])('does not overwrite %s saved data and requires explicit retry', async (_name, makeFile) => {
    const h = start();
    h.files.read.mockResolvedValue(makeFile());
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('error'));
    h.dispatch(inlineVisualChanged(key, record));
    h.dispatch(inlineVisualOpened(identity));
    expect(h.files.write).not.toHaveBeenCalled();
    expect(h.files.read).toHaveBeenCalledTimes(1);
    h.files.read.mockResolvedValue(fileEntry(JSON.stringify(record)));
    h.dispatch(inlineVisualRetryRequested(key));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    expect(h.entry().record).toEqual(record);
    expect(h.files.write).not.toHaveBeenCalled();
  });

  it('preserves read failures instead of converting them to an empty record', async () => {
    const h = start();
    h.files.read.mockRejectedValue(new Error('permission denied'));
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('error'));
    expect(h.entry()).toMatchObject({ loaded: false, error: 'permission denied' });
    h.dispatch(inlineVisualChanged(key, record));
    expect(h.files.write).not.toHaveBeenCalled();
  });

  it('serializes writes, coalesces queued changes, and never replaces newer edits with late outcomes', async () => {
    const h = start();
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    const first = deferred<Awaited<ReturnType<FilesClient['write']>>>();
    h.files.write.mockImplementationOnce(() => first.promise);
    h.dispatch(inlineVisualChanged(key, record));
    await vi.waitFor(() => expect(h.files.write).toHaveBeenCalledTimes(1));
    h.dispatch(inlineVisualChanged(key, { ...record, current: { ...snapshot, state: 8 } }));
    const latest = { ...record, current: { ...snapshot, state: 12 } };
    h.dispatch(inlineVisualChanged(key, latest));
    expect(h.files.write).toHaveBeenCalledTimes(1);
    expect(h.entry().record).toEqual(latest);
    first.resolve({ success: false, error: 'old write failed' });
    await vi.waitFor(() => expect(h.entry().savedRevision).toBe(3));
    expect(h.files.write).toHaveBeenCalledTimes(2);
    expect(h.files.write.mock.calls[1]).toEqual([
      'ws',
      path,
      { kind: 'editable-text', content: JSON.stringify(latest) },
    ]);
    expect(h.entry()).toMatchObject({ record: latest, status: 'ready' });
  });

  it('retries a rejected write without reloading or losing current state', async () => {
    const h = start();
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    h.files.write.mockRejectedValueOnce(new Error('offline'));
    h.dispatch(inlineVisualChanged(key, record));
    await vi.waitFor(() => expect(h.entry().status).toBe('error'));
    h.dispatch(inlineVisualRetryRequested(key));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    expect(h.files.read).toHaveBeenCalledTimes(1);
    expect(h.files.write).toHaveBeenCalledTimes(2);
    expect(h.entry().record).toEqual(record);
  });

  it('keeps different block/source identities independent and writes only host-derived paths', async () => {
    const h = start();
    const other = { ...identity, blockKey: '../escape', source: '<main>Other</main>' };
    h.dispatch(inlineVisualOpened(identity));
    h.dispatch(inlineVisualOpened(other));
    await vi.waitFor(() => expect(h.entry(inlineVisualKey(other)).status).toBe('ready'));
    const otherHash = createHash('sha256').update(inlineVisualKey(other)).digest('hex');
    expect(h.files.read.mock.calls).toEqual(
      expect.arrayContaining([
        ['ws', path],
        ['ws', `.intent/visuals/${otherHash}/state.json`],
      ]),
    );
    h.dispatch(inlineVisualChanged(inlineVisualKey(other), record));
    await vi.waitFor(() => expect(h.entry(inlineVisualKey(other)).savedRevision).toBe(1));
    expect(h.entry().record).toEqual(emptyInlineVisualRecord());
  });

  it('exports the clicked source and record to the fixed artifact path and reports real failure/success', async () => {
    const h = start();
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    h.files.write.mockResolvedValueOnce({ success: false, error: 'disk full' });
    h.dispatch(inlineVisualExportRequested(key, 'first', record));
    await vi.waitFor(() => expect(h.entry().export?.status).toBe('error'));
    expect(h.entry().export).toMatchObject({ requestId: 'first', error: 'disk full' });
    h.dispatch(inlineVisualExportRequested(key, 'second', record));
    await vi.waitFor(() => expect(h.entry().export?.status).toBe('saved'));
    const exportPath = `.intent/artifacts/visuals/${hash}.json`;
    expect(h.entry().export).toMatchObject({ requestId: 'second', path: exportPath });
    expect(h.files.write.mock.calls[1]).toEqual([
      'ws',
      exportPath,
      {
        kind: 'editable-text',
        content: JSON.stringify({ version: 1, source: identity.source, record }, null, 2),
      },
    ]);
  });
  it('waits 300ms then writes the latest accepted edits even with no mounted preview', async () => {
    const h = start();
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    vi.useFakeTimers();
    for (let index = 1; index <= 60; index++) {
      h.dispatch(inlineVisualChanged(key, { ...record, current: { ...snapshot, state: index } }));
    }
    await vi.advanceTimersByTimeAsync(INLINE_VISUAL_SAVE_DELAY_MS - 1);
    expect(h.files.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(h.entry().savedRevision).toBe(60));
    expect(h.files.write).toHaveBeenCalledTimes(1);
    const content = h.files.write.mock.calls[0][2];
    expect(content.kind).toBe('editable-text');
    expect(JSON.parse('content' in content ? content.content : '{}').current.state).toBe(60);
    await vi.advanceTimersByTimeAsync(INLINE_VISUAL_SAVE_DELAY_MS * 2);
    expect(h.files.write).toHaveBeenCalledTimes(1);
  });

  it('skips republished restored JSON and edits reverted before the write delay', async () => {
    const h = start();
    h.files.read.mockResolvedValue(fileEntry(JSON.stringify(record)));
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    h.dispatch(inlineVisualChanged(key, JSON.parse(JSON.stringify(record))));
    h.dispatch(inlineVisualOpened(identity));
    h.dispatch(inlineVisualChanged(key, { ...record, current: { ...snapshot, state: 12 } }));
    h.dispatch(inlineVisualChanged(key, record));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    expect(h.entry().revision).toBe(2);
    expect(h.entry().savedRevision).toBe(2);
    expect(h.files.write).not.toHaveBeenCalled();
  });

  it('does not retry a failed newest revision for stale queued actions; explicit retry still works', async () => {
    const h = start();
    h.dispatch(inlineVisualOpened(identity));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    h.files.write.mockResolvedValueOnce({ success: false, error: 'offline' });
    for (let index = 1; index <= 5; index++) {
      h.dispatch(inlineVisualChanged(key, { ...record, current: { ...snapshot, state: index } }));
    }
    await vi.waitFor(() => expect(h.entry().status).toBe('error'));
    expect(h.files.write).toHaveBeenCalledTimes(1);
    h.dispatch(inlineVisualRetryRequested(key));
    await vi.waitFor(() => expect(h.entry().status).toBe('ready'));
    expect(h.files.write).toHaveBeenCalledTimes(2);
    expect(h.entry().savedRevision).toBe(5);
  });
});
