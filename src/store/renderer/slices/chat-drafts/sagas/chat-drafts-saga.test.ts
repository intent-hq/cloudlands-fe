import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';

import type { DraftsClient } from '$lib/client/app-client';
import {
  clearDraftCacheForTests,
  getCachedDraft,
  setCachedDraft,
} from '$lib/components/chat/chat-draft-cache';
import {
  chatDraftClearRequested,
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftRestoreRequested,
  chatDraftSaveCancelled,
  chatDraftSaveScheduled,
  chatDraftsReducer,
  initialState,
} from '../chat-drafts-slice';
import type { ChatDraftSaveRequest } from '../chat-drafts-types';
import { CHAT_DRAFT_SAVE_DEBOUNCE_MS, chatDraftsSaga } from './chat-drafts-saga';

const WS = 'ws-1';
const AGENT = 'agent-1';
const OWNER = 'owner-1';
const SAVED = { ok: true as const, updatedAt: '2026-01-01T00:00:00.000Z' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  const drafts = {
    get: vi.fn<DraftsClient['get']>(() => Promise.resolve(null)),
    set: vi.fn<DraftsClient['set']>(() => Promise.resolve(SAVED)),
    clear: vi.fn<DraftsClient['clear']>(() => Promise.resolve({ ok: true as const })),
  };
  let state = initialState;
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof chatDraftsReducer>[1]) => {
    state = chatDraftsReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ chatDrafts: state }) },
    chatDraftsSaga,
    drafts,
  );
  dispatch(chatDraftOwnerOpened(OWNER));
  return { drafts, dispatch, task, owner: () => getItem(state.owners, OWNER) };
}

const request = (text: string, rollback: ChatDraftSaveRequest['rollback'] = null) => ({
  workspaceId: WS,
  agentId: AGENT,
  text,
  attachments: [],
  rollback,
});

describe('chatDraftsSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearDraftCacheForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles a correlated restore with the exact drafts.get request and ignores superseded ones', async () => {
    const { drafts, dispatch, task, owner } = createHarness();
    const first = deferred<Awaited<ReturnType<DraftsClient['get']>>>();
    drafts.get.mockReturnValueOnce(first.promise);
    drafts.get.mockResolvedValueOnce({ text: 'fresh', updatedAt: SAVED.updatedAt });

    dispatch(chatDraftRestoreRequested(OWNER, 'r1', WS, AGENT));
    dispatch(chatDraftRestoreRequested(OWNER, 'r2', WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.get).toHaveBeenNthCalledWith(1, WS, AGENT);
    expect(owner()?.restore).toMatchObject({
      requestId: 'r2',
      status: 'restored',
      draft: { text: 'fresh', attachments: [] },
    });

    first.resolve({ text: 'stale', updatedAt: SAVED.updatedAt });
    await vi.advanceTimersByTimeAsync(0);
    expect(owner()?.restore).toMatchObject({ requestId: 'r2', draft: { text: 'fresh' } });
    task.cancel();
  });

  it('reports a failed restore as a serializable outcome', async () => {
    const { drafts, dispatch, task, owner } = createHarness();
    drafts.get.mockRejectedValueOnce(new Error('offline'));
    dispatch(chatDraftRestoreRequested(OWNER, 'r1', WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(owner()?.restore).toMatchObject({ status: 'failed', draft: null, error: 'offline' });
    task.cancel();
  });

  it('debounces saves to one drafts.set with the latest text and refreshes the cache on commit', async () => {
    const { drafts, dispatch, task, owner } = createHarness();
    dispatch(chatDraftSaveScheduled(OWNER, 's1', request('hel')));
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS - 100);
    dispatch(chatDraftSaveScheduled(OWNER, 's2', request('hello')));
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS - 1);
    expect(drafts.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(drafts.set).toHaveBeenCalledOnce();
    expect(drafts.set).toHaveBeenCalledWith(WS, AGENT, 'hello', undefined);
    expect(getCachedDraft(WS, AGENT)).toEqual({ text: 'hello', attachments: [] });
    await vi.advanceTimersByTimeAsync(0);
    const saves = owner()!.saves;
    expect(getItem(saves, 's1')).toBeUndefined();
    expect(getItem(saves, 's2')).toMatchObject({ status: 'saved', workspaceId: WS });
    task.cancel();
  });

  it('drops a cancelled save and flushes a pending save when the owner is released', async () => {
    const { drafts, dispatch, task, owner } = createHarness();
    dispatch(chatDraftSaveScheduled(OWNER, 's1', request('dropped')));
    dispatch(chatDraftSaveCancelled(OWNER));
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS * 2);
    expect(drafts.set).not.toHaveBeenCalled();

    dispatch(chatDraftSaveScheduled(OWNER, 's2', request('final keystrokes')));
    dispatch(chatDraftOwnerReleased(OWNER));
    expect(getCachedDraft(WS, AGENT)).toEqual({ text: 'final keystrokes', attachments: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.set).toHaveBeenCalledWith(WS, AGENT, 'final keystrokes', undefined);
    expect(owner()).toBeUndefined();
    task.cancel();
  });

  it('writes drafts.clear after an in-flight save and keeps the cleared cache', async () => {
    const { drafts, dispatch, task } = createHarness();
    const inFlight = deferred<typeof SAVED>();
    drafts.set.mockReturnValueOnce(inFlight.promise);
    dispatch(chatDraftSaveScheduled(OWNER, 's1', request('sent prompt')));
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS);
    expect(drafts.set).toHaveBeenCalledOnce();

    dispatch(chatDraftClearRequested(WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.clear).not.toHaveBeenCalled();
    expect(getCachedDraft(WS, AGENT)).toEqual({ text: '', attachments: [] });

    inFlight.resolve(SAVED);
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.clear).toHaveBeenCalledOnce();
    expect(drafts.clear).toHaveBeenCalledWith(WS, AGENT);
    expect(getCachedDraft(WS, AGENT)).toEqual({ text: '', attachments: [] });
    task.cancel();
  });

  it('keeps a post-clear save rollback anchored to the cleared draft', async () => {
    const { drafts, dispatch, task } = createHarness();
    const beforeClear = deferred<typeof SAVED>();
    drafts.set.mockReturnValueOnce(beforeClear.promise).mockRejectedValueOnce(new Error('offline'));

    dispatch(chatDraftSaveScheduled(OWNER, 'before-clear', request('sent prompt')));
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS);
    dispatch(chatDraftClearRequested(WS, AGENT));
    dispatch(
      chatDraftSaveScheduled(
        OWNER,
        'after-clear',
        request('new prompt', { text: '', attachments: [] }),
      ),
    );
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS);

    beforeClear.resolve(SAVED);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(drafts.clear).toHaveBeenCalledWith(WS, AGENT);
    expect(drafts.set).toHaveBeenLastCalledWith(WS, AGENT, 'new prompt', undefined);
    expect(getCachedDraft(WS, AGENT)).toEqual({ text: '', attachments: [] });
    task.cancel();
  });

  it('rolls the cache back and reports a failed save without a clear superseding it', async () => {
    const { drafts, dispatch, task, owner } = createHarness();
    drafts.set.mockRejectedValueOnce(new Error('disk full'));
    const persisted = { text: 'persisted', attachments: [] };
    setCachedDraft(WS, AGENT, persisted);
    dispatch(chatDraftSaveScheduled(OWNER, 's1', request('never accepted', persisted)));
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(getCachedDraft(WS, AGENT)).toEqual(persisted);
    expect(getItem(owner()!.saves, 's1')).toMatchObject({ status: 'failed', error: 'disk full' });
    task.cancel();
  });

  it('keeps writing after a rejected drafts.clear', async () => {
    const { drafts, dispatch, task } = createHarness();
    drafts.clear.mockRejectedValueOnce(new Error('wire down'));
    dispatch(chatDraftClearRequested(WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    dispatch(chatDraftSaveScheduled(OWNER, 's1', request('next draft')));
    await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS);
    expect(drafts.set).toHaveBeenCalledWith(WS, AGENT, 'next draft', undefined);
    expect(task.isRunning()).toBe(true);
    task.cancel();
  });
});
