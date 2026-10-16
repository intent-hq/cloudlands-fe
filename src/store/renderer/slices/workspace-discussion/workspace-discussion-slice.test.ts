import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { DiscussionMessage } from '$shared/types/workspace-discussion';
import {
  initialState,
  workspaceDiscussionReducer as reduce,
  discussionContextChanged,
  discussionWorkspacesChanged,
  discussionRequested,
  discussionDraftChanged,
  discussionMessageReceived,
  discussionLoadStarted,
  discussionPageReceived,
  discussionSendStarted,
  discussionSendFailed,
  discussionSendSucceeded,
  type DiscussionTarget,
} from './workspace-discussion-slice';

const message = (sequence: number): DiscussionMessage => ({
  id: `server-${sequence}`,
  workspaceId: 'ws',
  sequence,
  body: 'hello',
  author: { principalId: 'me', login: 'sam', displayName: null, avatarUrl: null },
  createdAt: '2026-10-14T10:00:00Z',
});
function setup() {
  let state = reduce(initialState, discussionContextChanged('connection-1', 'owner-1'));
  state = reduce(state, discussionWorkspacesChanged(['ws', 'other']));
  state = reduce(state, discussionRequested('ws'));
  const target: DiscussionTarget = {
    context: 'connection-1',
    workspaceId: 'ws',
    epoch: state.byWorkspaceId.ws.epoch,
  };
  return { state, target };
}
const pending = {
  id: 'retry-key',
  body: 'hello',
  draftVersion: 1,
  status: 'sending' as const,
  error: null,
};

describe('workspace discussion reducer', () => {
  it('merges live messages with a late history page and deduplicates server IDs', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionLoadStarted(target, 'read', false));
    state = reduce(state, discussionMessageReceived(target, message(3)));
    state = reduce(
      state,
      discussionPageReceived(
        target,
        'read',
        { messages: [message(1), message(2)], hasMore: false },
        'initial',
      ),
    );
    state = reduce(state, discussionMessageReceived(target, message(2)));
    expect(getItems(state.byWorkspaceId.ws.messages).map((m) => m.sequence)).toEqual([1, 2, 3]);
  });
  it('settles a retry key separately from the server ID, including echo before acknowledgement', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendStarted(target, pending));
    state = reduce(state, discussionMessageReceived(target, message(1)));
    expect(getItems(state.byWorkspaceId.ws.pending)).toHaveLength(1);
    state = reduce(state, discussionSendSucceeded(target, pending.id, message(1)));
    expect(getItems(state.byWorkspaceId.ws.pending)).toEqual([]);
    expect(getItems(state.byWorkspaceId.ws.messages)).toEqual([message(1)]);
    expect(state.byWorkspaceId.ws.draft).toBe('');
    expect(reduce(state, discussionSendFailed(target, pending.id, 'unknown'))).toBe(state);
  });
  it('keeps edits made after sending, even when changed back to the same body', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendStarted(target, pending));
    state = reduce(state, discussionDraftChanged('ws', 'new draft'));
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendSucceeded(target, pending.id, message(1)));
    expect(state.byWorkspaceId.ws.draft).toBe('hello');
  });
  it('retains failed sends and drafts through a reconnect but clears them for a new owner', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendStarted(target, pending));
    state = reduce(state, discussionContextChanged(null, null));
    expect(state.byWorkspaceId.ws.draft).toBe('hello');
    expect(getItems(state.byWorkspaceId.ws.pending)[0]).toMatchObject({
      id: 'retry-key',
      status: 'failed',
    });
    state = reduce(state, discussionContextChanged('connection-2', 'owner-1'));
    expect(reduce(state, discussionSendSucceeded(target, pending.id, message(1)))).toBe(state);
    state = reduce(state, discussionContextChanged('connection-3', 'owner-2'));
    expect(state.byWorkspaceId).toEqual({});
  });
  it('drops replies from a removed/rejoined workspace lifetime and another workspace', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionWorkspacesChanged(['other']));
    state = reduce(state, discussionWorkspacesChanged(['ws', 'other']));
    state = reduce(state, discussionRequested('ws'));
    expect(reduce(state, discussionMessageReceived(target, message(1)))).toBe(state);
    const current = { ...target, epoch: state.byWorkspaceId.ws.epoch };
    expect(
      reduce(state, discussionMessageReceived(current, { ...message(1), workspaceId: 'other' })),
    ).toBe(state);
  });
  it('keeps synchronized history independent of late older pages, live events, and send replies', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionLoadStarted(target, 'initial', false));
    state = reduce(
      state,
      discussionPageReceived(
        target,
        'initial',
        { messages: [message(10), message(20)], hasMore: true },
        'initial',
      ),
    );
    state = reduce(state, discussionLoadStarted(target, 'older', true));
    state = reduce(state, discussionMessageReceived(target, message(100)));
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendStarted(target, pending));
    state = reduce(state, discussionSendSucceeded(target, pending.id, message(101)));
    state = reduce(
      state,
      discussionPageReceived(target, 'older', { messages: [message(1)], hasMore: false }, 'older'),
    );
    state = reduce(state, discussionMessageReceived(target, message(20)));
    expect(state.byWorkspaceId.ws).toMatchObject({
      syncedSequence: 20,
      beforeSequence: 1,
      hasMore: false,
    });
    expect(getItems(state.byWorkspaceId.ws.messages).map((m) => m.sequence)).toEqual([
      1, 10, 20, 100, 101,
    ]);
  });
  it.each([
    { ...message(1), body: 'different body' },
    { ...message(1), workspaceId: 'other' },
    { ...message(1), sequence: 0 },
  ])('settles an invalid success as a failed retry without losing the original text', (reply) => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendStarted(target, pending));
    state = reduce(state, discussionSendSucceeded(target, pending.id, reply));
    expect(state.byWorkspaceId.ws).toMatchObject({
      sending: false,
      sendError: 'unknown',
      draft: 'hello',
    });
    expect(getItems(state.byWorkspaceId.ws.pending)).toEqual([
      { ...pending, status: 'failed', error: 'unknown' },
    ]);
    expect(getItems(state.byWorkspaceId.ws.messages)).toEqual([]);
  });
  it('ignores history from an overtaken request', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionLoadStarted(target, 'new', false));
    expect(
      reduce(
        state,
        discussionPageReceived(
          target,
          'old',
          { messages: [message(1)], hasMore: false },
          'initial',
        ),
      ),
    ).toBe(state);
  });
});
