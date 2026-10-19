import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { DiscussionMessage } from '$shared/types/workspace-discussion';
import {
  initialState,
  discussionAgentSelected,
  discussionAgentRemoved,
  discussionAgentCapabilityReceived,
  workspaceDiscussionReducer as reduce,
  discussionContextChanged,
  discussionWorkspacesChanged,
  discussionReactionReceived,
  discussionReplySelected,
  discussionMessageActionsReceived,
  discussionReadThrough,
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
    epoch: state.byWorkspaceId.ws.default.epoch,
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
  it('keeps explicit selections per conversation and removes them with edited tokens or account changes', () => {
    let { state } = setup();
    state = reduce(state, discussionAgentCapabilityReceived('connection-1', true));
    state = reduce(state, discussionDraftChanged('ws', 'Review '));
    state = reduce(state, discussionAgentSelected('ws', 'agent-a', 'Reviewer', 7, 7));
    expect(state.byWorkspaceId.ws.default.agentMentions).toEqual([
      { agentId: 'agent-a', name: 'Reviewer', start: 7, end: 16 },
    ]);
    state = reduce(state, discussionRequested('other'));
    expect(state.byWorkspaceId.other.default.agentMentions).toEqual([]);
    state = reduce(state, discussionContextChanged(null, null));
    expect(state.byWorkspaceId.ws.default.agentMentions).toHaveLength(1);
    state = reduce(state, discussionContextChanged('connection-2', 'owner-1'));
    state = reduce(state, discussionDraftChanged('ws', 'Review @Review '));
    expect(state.byWorkspaceId.ws.default.agentMentions).toEqual([]);
    state = reduce(state, discussionAgentCapabilityReceived('connection-2', true));
    state = reduce(state, discussionAgentSelected('ws', 'agent-b', 'Builder', 0, 0));
    state = reduce(state, discussionContextChanged('connection-3', 'owner-2'));
    expect(state.byWorkspaceId).toEqual({});
  });
  it('requires agent capability and default discussion, while chip removal deletes only its tracked token', () => {
    let { state } = setup();
    expect(reduce(state, discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0))).toBe(state);
    state = reduce(state, discussionAgentCapabilityReceived('connection-1', true));
    state = reduce(state, discussionRequested('ws', 'new'));
    expect(reduce(state, discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0, 'new'))).toBe(
      state,
    );
    state = reduce(state, discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0));
    state = reduce(state, discussionAgentRemoved('ws', 'agent-a'));
    expect(state.byWorkspaceId.ws.default).toMatchObject({
      draft: '',
      agentMentions: [],
    });
  });
  it('removes only the chosen chip token and keeps later targets and ordinary references', () => {
    let { state } = setup();
    state = reduce(state, discussionAgentCapabilityReceived('connection-1', true));
    state = reduce(state, discussionDraftChanged('ws', 'Plain @Reviewer '));
    state = reduce(state, discussionAgentSelected('ws', 'agent-a', 'Reviewer', 16, 16));
    state = reduce(state, discussionAgentSelected('ws', 'agent-b', 'Builder', 26, 26));
    state = reduce(state, discussionAgentRemoved('ws', 'agent-a'));
    expect(state.byWorkspaceId.ws.default).toMatchObject({
      draft: 'Plain @Reviewer @Builder ',
      agentMentions: [{ agentId: 'agent-b', name: 'Builder', start: 16, end: 24 }],
    });
  });
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
    expect(getItems(state.byWorkspaceId.ws.default.messages).map((m) => m.sequence)).toEqual([
      1, 2, 3,
    ]);
  });
  it('settles a retry key separately from the server ID, including echo before acknowledgement', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendStarted(target, pending));
    state = reduce(state, discussionMessageReceived(target, message(1)));
    expect(getItems(state.byWorkspaceId.ws.default.pending)).toHaveLength(1);
    state = reduce(state, discussionSendSucceeded(target, pending.id, message(1)));
    expect(getItems(state.byWorkspaceId.ws.default.pending)).toEqual([]);
    expect(getItems(state.byWorkspaceId.ws.default.messages)).toEqual([message(1)]);
    expect(state.byWorkspaceId.ws.default.draft).toBe('');
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
    expect(state.byWorkspaceId.ws.default.draft).toBe('hello');
  });
  it('retains failed sends and drafts through a reconnect but clears them for a new owner', () => {
    const setupState = setup();
    let state = setupState.state;
    const target = setupState.target;
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    state = reduce(state, discussionSendStarted(target, pending));
    state = reduce(state, discussionContextChanged(null, null));
    expect(state.byWorkspaceId.ws.default.draft).toBe('hello');
    expect(getItems(state.byWorkspaceId.ws.default.pending)[0]).toMatchObject({
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
    const current = { ...target, epoch: state.byWorkspaceId.ws.default.epoch };
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
    expect(state.byWorkspaceId.ws.default).toMatchObject({
      syncedSequence: 20,
      beforeSequence: 1,
      hasMore: false,
    });
    expect(getItems(state.byWorkspaceId.ws.default.messages).map((m) => m.sequence)).toEqual([
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
    expect(state.byWorkspaceId.ws.default).toMatchObject({
      sending: false,
      sendError: 'unknown',
      draft: 'hello',
    });
    expect(getItems(state.byWorkspaceId.ws.default.pending)).toEqual([
      { ...pending, status: 'failed', error: 'unknown' },
    ]);
    expect(getItems(state.byWorkspaceId.ws.default.messages)).toEqual([]);
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

describe('discussion presentation state', () => {
  const full = (sequence: number): DiscussionMessage => ({
    ...message(sequence),
    replyToMessageId: null,
    replyTo: null,
    reactions: [],
    reactionVersion: 0,
  });
  it('merges a reaction event before history and resists stale pages and echoed snapshots', () => {
    const initial = setup();
    const target = initial.target;
    let state = initial.state;
    state = reduce(state, discussionLoadStarted(target, 'read', false));
    state = reduce(
      state,
      discussionReactionReceived(target, {
        messageId: 'server-1',
        reactions: [{ reaction: '👍', count: 3, reacted: true }],
        reactionVersion: 3,
      }),
    );
    state = reduce(
      state,
      discussionPageReceived(target, 'read', { messages: [full(1)], hasMore: false }, 'initial'),
    );
    expect(getItems(state.byWorkspaceId.ws.default.messages)[0]).toMatchObject({
      reactionVersion: 3,
      reactions: [{ count: 3 }],
    });
    state = reduce(state, discussionMessageReceived(target, full(1)));
    state = reduce(
      state,
      discussionReactionReceived(target, {
        messageId: 'server-1',
        reactions: [],
        reactionVersion: 1,
      }),
    );
    expect(getItems(state.byWorkspaceId.ws.default.messages)[0].reactionVersion).toBe(3);
    expect(state.byWorkspaceId.ws.default).toMatchObject({ syncedSequence: 1, readSequence: 1 });
    state = reduce(state, discussionContextChanged('new-owner', 'new-owner'));
    expect(
      reduce(
        state,
        discussionReactionReceived(target, {
          messageId: 'server-1',
          reactions: [],
          reactionVersion: 4,
        }),
      ),
    ).toBe(state);
  });
  it('retains a newly selected reply and unchanged draft while the prior reply acknowledgement settles', () => {
    const initial = setup();
    const target = initial.target;
    let state = initial.state;
    state = reduce(state, discussionMessageActionsReceived('connection-1', true));
    state = reduce(state, discussionMessageReceived(target, full(1)));
    state = reduce(state, discussionMessageReceived(target, full(2)));
    state = reduce(state, discussionReplySelected('ws', 'server-1'));
    state = reduce(state, discussionDraftChanged('ws', 'hello'));
    const replyPending = {
      ...pending,
      replyToMessageId: 'server-1',
      replyVersion: state.byWorkspaceId.ws.default.replyVersion,
    };
    state = reduce(state, discussionSendStarted(target, replyPending));
    state = reduce(state, discussionReplySelected('ws', 'server-2'));
    const ack = {
      ...full(3),
      replyToMessageId: 'server-1',
      replyTo: { id: 'server-1', author: message(1).author, body: 'hello' },
    };
    state = reduce(state, discussionSendSucceeded(target, pending.id, ack));
    expect(state.byWorkspaceId.ws.default).toMatchObject({
      draft: 'hello',
      replyToMessageId: 'server-2',
      sending: false,
    });
  });
  it('initializes read history separately from a live arrival racing the initial page and fences read acknowledgements', () => {
    const initial = setup();
    const target = initial.target;
    let state = initial.state;
    state = reduce(state, discussionLoadStarted(target, 'read', false));
    state = reduce(state, discussionMessageReceived(target, message(100)));
    state = reduce(
      state,
      discussionPageReceived(target, 'read', { messages: [message(10)], hasMore: true }, 'initial'),
    );
    expect(state.byWorkspaceId.ws.default.readSequence).toBe(10);
    state = reduce(state, discussionLoadStarted(target, 'old', true));
    state = reduce(
      state,
      discussionPageReceived(target, 'old', { messages: [message(1)], hasMore: false }, 'older'),
    );
    expect(state.byWorkspaceId.ws.default.readSequence).toBe(10);
    expect(reduce(state, discussionReadThrough({ ...target, context: 'stale' }, 100))).toBe(state);
    state = reduce(state, discussionReadThrough(target, 100));
    expect(state.byWorkspaceId.ws.default.readSequence).toBe(100);
  });
});
