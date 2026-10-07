import { describe, expect, it } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';

import {
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftRestoreInvalidated,
  chatDraftRestoreRequested,
  chatDraftRestoreSettled,
  chatDraftSaveOutcomesAcknowledged,
  chatDraftSaveSettled,
  chatDraftSaveStarted,
  chatDraftsReducer,
  initialState,
} from './chat-drafts-slice';

const OWNER = 'owner-1';
const request = { workspaceId: 'ws', agentId: 'a', text: 'hi', attachments: [], rollback: null };
const opened = () => chatDraftsReducer(initialState, chatDraftOwnerOpened(OWNER));
const owner = (state: typeof initialState) => getItem(state.owners, OWNER);

describe('chatDraftsReducer', () => {
  it('starts with no owners and opens/releases an owner', () => {
    expect(getItem(initialState.owners, OWNER)).toBeUndefined();
    const state = opened();
    expect(owner(state)).toMatchObject({ id: OWNER, restore: null });
    expect(chatDraftsReducer(state, chatDraftOwnerOpened(OWNER))).toBe(state);
    expect(owner(chatDraftsReducer(state, chatDraftOwnerReleased(OWNER)))).toBeUndefined();
  });

  it('settles only the current restore request', () => {
    let state = chatDraftsReducer(opened(), chatDraftRestoreRequested(OWNER, 'r1', 'ws', 'a'));
    state = chatDraftsReducer(state, chatDraftRestoreRequested(OWNER, 'r2', 'ws', 'a'));
    const stale = chatDraftsReducer(
      state,
      chatDraftRestoreSettled(OWNER, 'r1', 'restored', { text: 'old', attachments: [] }),
    );
    expect(stale).toBe(state);
    state = chatDraftsReducer(state, chatDraftRestoreSettled(OWNER, 'r2', 'failed', null, 'x'));
    expect(owner(state)?.restore).toEqual({
      requestId: 'r2',
      workspaceId: 'ws',
      agentId: 'a',
      status: 'failed',
      draft: null,
      error: 'x',
    });
  });

  it('drops an invalidated restore so its late response is ignored', () => {
    let state = chatDraftsReducer(opened(), chatDraftRestoreRequested(OWNER, 'r1', 'ws', 'a'));
    state = chatDraftsReducer(state, chatDraftRestoreInvalidated(OWNER));
    expect(owner(state)?.restore).toBeNull();
    expect(chatDraftsReducer(state, chatDraftRestoreSettled(OWNER, 'r1', 'restored', null))).toBe(
      state,
    );
  });

  it('tracks save outcomes until acknowledged', () => {
    let state = chatDraftsReducer(opened(), chatDraftSaveStarted(OWNER, 's1', request));
    expect(getItem(owner(state)!.saves, 's1')).toEqual({
      id: 's1',
      workspaceId: 'ws',
      agentId: 'a',
      status: 'pending',
    });
    state = chatDraftsReducer(state, chatDraftSaveSettled(OWNER, 's1', 'failed', 'disk full'));
    expect(getItem(owner(state)!.saves, 's1')).toMatchObject({
      status: 'failed',
      error: 'disk full',
    });
    state = chatDraftsReducer(state, chatDraftSaveOutcomesAcknowledged(OWNER, ['s1']));
    expect(getItem(owner(state)!.saves, 's1')).toBeUndefined();
  });

  it('ignores actions for released or unknown owners', () => {
    const state = initialState;
    expect(chatDraftsReducer(state, chatDraftSaveStarted(OWNER, 's1', request))).toBe(state);
    expect(chatDraftsReducer(state, chatDraftSaveSettled(OWNER, 's1', 'saved'))).toBe(state);
    expect(chatDraftsReducer(state, chatDraftRestoreRequested(OWNER, 'r', 'ws', 'a'))).toBe(state);
  });
});
