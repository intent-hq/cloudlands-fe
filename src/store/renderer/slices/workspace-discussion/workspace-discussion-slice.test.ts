import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { DiscussionMessage } from '$shared/types/workspace-discussion';
import {
  initialState,
  discussionAgentActivityCapabilityReceived,
  discussionAgentActivityReceived,
  discussionAgentControlStarted,
  discussionAgentControlFinished,
  discussionAgentSelected,
  discussionPrincipalSelected,
  discussionPrincipalMentionsCapabilityReceived,
  discussionConversationReceived,
  discussionConversationDeleted,
  discussionDirectoryStarted,
  discussionDirectoryReceived,
  discussionAgentRemoved,
  discussionAgentCapabilityReceived,
  workspaceDiscussionReducer as reduce,
  discussionContextChanged,
  discussionWorkspacesChanged,
  discussionReactionReceived,
  discussionReplySelected,
  discussionMessageActionsReceived,
  discussionReactionsCapabilityReceived,
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
  it('keeps explicit person identities through surrounding edits and revokes edited tokens', () => {
    const { target, state: initial } = setup();
    let state = reduce(
      initial,
      discussionPrincipalMentionsCapabilityReceived(target.context, true),
    );
    state = reduce(state, discussionDraftChanged('ws', 'Hi '));
    state = reduce(state, discussionPrincipalSelected('ws', 'alex-id', 'Alex', 3, 3));
    expect(state.byWorkspaceId.ws.default).toMatchObject({
      draft: 'Hi @Alex ',
      principalMentions: [{ principalId: 'alex-id', name: 'Alex', start: 3, end: 8 }],
    });
    state = reduce(state, discussionDraftChanged('ws', '😀 Hi @Alex '));
    expect(state.byWorkspaceId.ws.default.principalMentions).toEqual([
      { principalId: 'alex-id', name: 'Alex', start: 6, end: 11 },
    ]);
    state = reduce(state, discussionDraftChanged('ws', '😀 Hi @Alexandra '));
    expect(state.byWorkspaceId.ws.default.principalMentions).toEqual([]);
    state = reduce(state, discussionDraftChanged('ws', 'Hi @Alex '));
    expect(state.byWorkspaceId.ws.default.principalMentions).toEqual([]);
  });
  it('does not turn person picker selections into notification identities without capability', () => {
    const { state } = setup();
    expect(reduce(state, discussionPrincipalSelected('ws', 'alex-id', 'Alex', 0, 0))).toBe(state);
  });
  it('admits an unopened live conversation and preserves its unread boundary through first history', () => {
    const { state: initial } = setup();
    const conversation = {
      id: 'default',
      workspaceId: 'other',
      kind: 'workspace' as const,
      participants: [],
      createdAt: '2026-10-22T00:00:00Z',
    };
    let state = reduce(initial, discussionConversationReceived('connection-1', conversation));
    const target = {
      context: 'connection-1',
      workspaceId: 'other',
      epoch: state.byWorkspaceId.other.default.epoch,
    };
    const live = { ...message(12), workspaceId: 'other' };
    state = reduce(state, discussionMessageReceived(target, live));
    state = reduce(
      state,
      discussionMessageReceived(target, { ...live, id: 'earlier', sequence: 10 }),
    );
    expect(state.byWorkspaceId.other.default).toMatchObject({
      authorized: true,
      initialized: false,
      readSequence: null,
    });
    state = reduce(state, discussionLoadStarted(target, 'history', false));
    state = reduce(
      state,
      discussionPageReceived(
        target,
        'history',
        { messages: [{ ...live, id: 'old', sequence: 8 }, live], hasMore: false },
        'initial',
      ),
    );
    expect(state.byWorkspaceId.other.default).toMatchObject({
      initialized: true,
      readSequence: 9,
      syncedSequence: 12,
    });
    expect(getItems(state.byWorkspaceId.other.default.messages).map((m) => m.sequence)).toEqual([
      8, 10, 12,
    ]);
    expect(
      reduce(
        state,
        discussionConversationReceived('stale', { ...conversation, workspaceId: 'unknown' }),
      ),
    ).toBe(state);
  });
  it('keeps agent progress independent across messages, recipients and stale control lifetimes', () => {
    const { target, state: initial } = setup();
    let state = initial;
    state = reduce(state, discussionAgentActivityCapabilityReceived(target.context, true));
    const activity = {
      agentId: 'agent-a',
      attempt: 1,
      version: 1,
      state: 'working' as const,
      updatedAt: '2026-10-20T00:00:00Z',
      error: null,
    };
    const first = {
      ...message(1),
      recipientAgentIds: ['agent-a', 'agent-b'],
      agentActivity: [activity, { ...activity, agentId: 'agent-b' }],
    };
    state = reduce(state, discussionMessageReceived(target, first));
    state = reduce(
      state,
      discussionMessageReceived(target, {
        ...message(2),
        recipientAgentIds: ['agent-a'],
        agentActivity: [activity],
      }),
    );
    const key = JSON.stringify([first.id, activity.agentId]);
    const control = {
      key,
      messageId: first.id,
      agentId: activity.agentId,
      requestId: 'first',
      attempt: 1,
    };
    state = reduce(state, discussionAgentControlStarted(target, control));
    state = reduce(
      state,
      discussionAgentActivityReceived(target, first.id, {
        ...activity,
        attempt: 2,
        version: 3,
        state: 'queued',
      }),
    );
    state = reduce(state, discussionAgentControlFinished(target, key, 'first', 'unknown'));
    expect(state.byWorkspaceId.ws.default.agentControlError).toBeNull();
    state = reduce(
      state,
      discussionAgentControlStarted(target, { ...control, requestId: 'second', attempt: 2 }),
    );
    const unchanged = reduce(
      state,
      discussionAgentControlFinished(target, key, 'first', 'forbidden'),
    );
    expect(unchanged).toBe(state);
    const rows = getItems(state.byWorkspaceId.ws.default.messages);
    expect(rows[0].agentActivity?.map((a) => [a.agentId, a.attempt])).toEqual([
      ['agent-a', 2],
      ['agent-b', 1],
    ]);
    expect(rows[1].agentActivity).toEqual([activity]);
    expect(state.byWorkspaceId.ws.default.syncedSequence).toBeNull();
  });
  it('bounds unknown-message activity and rejects events from a prior admission or unaddressed agent', () => {
    const { target, state: initial } = setup();
    let state = initial;
    state = reduce(state, discussionAgentActivityCapabilityReceived(target.context, true));
    const activity = {
      agentId: 'agent-a',
      attempt: 1,
      version: 1,
      state: 'working' as const,
      updatedAt: '2026-10-20T00:00:00Z',
      error: null,
    };
    for (let i = 0; i < 510; i++)
      state = reduce(state, discussionAgentActivityReceived(target, `message-${i}`, activity));
    expect(getItems(state.byWorkspaceId.ws.default.activityUpdates)).toHaveLength(500);
    state = reduce(
      state,
      discussionMessageReceived(target, {
        ...message(1),
        recipientAgentIds: [],
        agentActivity: [],
      }),
    );
    expect(reduce(state, discussionAgentActivityReceived(target, 'server-1', activity))).toBe(
      state,
    );
    state = reduce(state, discussionContextChanged('connection-2', 'owner-1'));
    expect(
      reduce(
        state,
        discussionAgentActivityReceived(target, 'message-509', { ...activity, version: 2 }),
      ),
    ).toBe(state);
  });
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
    expect(state.byWorkspaceId.ws.default.messageKeys).toEqual({});
    state = reduce(state, discussionSendSucceeded(target, pending.id, message(1)));
    expect(getItems(state.byWorkspaceId.ws.default.pending)).toEqual([]);
    expect(getItems(state.byWorkspaceId.ws.default.messages)).toEqual([message(1)]);
    expect(state.byWorkspaceId.ws.default.messageKeys).toEqual({ 'server-1': 'retry-key' });
    expect(state.byWorkspaceId.ws.default.draft).toBe('');
    expect(reduce(state, discussionSendFailed(target, pending.id, 'unknown'))).toBe(state);
    expect(reduce(state, discussionSendSucceeded(target, pending.id, message(1)))).toBe(state);
    state = reduce(state, discussionContextChanged('connection-2', 'owner-2'));
    expect(state.byWorkspaceId).toEqual({});
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
  it('keeps an explicit read acknowledgement when older live messages and the first page arrive', () => {
    const { state: initial, target } = setup();
    let state = reduce(initial, discussionLoadStarted(target, 'read', false));
    state = reduce(state, discussionMessageReceived(target, message(100)));
    state = reduce(state, discussionReadThrough(target, 100));
    state = reduce(state, discussionMessageReceived(target, message(90)));
    state = reduce(
      state,
      discussionPageReceived(target, 'read', { messages: [message(10)], hasMore: true }, 'initial'),
    );
    expect(state.byWorkspaceId.ws.default.readSequence).toBe(100);
  });
});

describe('expanded reaction state', () => {
  it('hydrates equal-version legacy counts once, preserves monotonic snapshots, and resets capability by context', () => {
    const { target, state: initial } = setup();
    const legacy: DiscussionMessage = {
      ...message(1),
      reactionVersion: 2,
      replyTo: null,
      replyToMessageId: null,
      reactions: [{ reaction: '👍', count: 1, reacted: true }],
    };
    let state = reduce(initial, discussionMessageReceived(target, legacy));
    expect(reduce(state, discussionReactionsCapabilityReceived('stale', true))).toBe(state);
    state = reduce(state, discussionReactionsCapabilityReceived(target.context, true));
    const expanded = {
      ...legacy,
      reactions: [{ ...legacy.reactions![0], reactors: [legacy.author] }],
    };
    state = reduce(state, discussionMessageReceived(target, expanded));
    expect(getItems(state.byWorkspaceId.ws.default.messages)[0].reactions).toEqual(
      expanded.reactions,
    );
    for (const wrong of [
      legacy,
      { ...expanded, workspaceId: 'other' },
      { ...expanded, conversationId: 'private' },
      { ...expanded, reactionVersion: 1, reactions: [] },
      { ...expanded, reactions: [{ ...expanded.reactions[0], reacted: false }] },
    ]) {
      const next = reduce(state, discussionMessageReceived(target, wrong));
      expect(getItems(next.byWorkspaceId.ws.default.messages)[0]).toEqual(expanded);
    }
    expect(
      reduce(
        state,
        discussionReactionReceived(target, {
          messageId: legacy.id,
          reactionVersion: 3,
          reactions: legacy.reactions!,
        }),
      ),
    ).toBe(state);
    state = reduce(state, discussionContextChanged('connection-2', 'owner-1'));
    expect(state.reactionsSupported).toBeNull();
    expect(getItems(state.byWorkspaceId.ws.default.messages)[0].reactions).toEqual(
      expanded.reactions,
    );
    state = reduce(state, discussionContextChanged('connection-3', 'owner-2'));
    expect(state.byWorkspaceId).toEqual({});
    expect(state.reactionsSupported).toBeNull();
    expect(reduce(state, discussionMessageReceived(target, expanded))).toBe(state);
  });
});

describe('deleted discussion lifecycle', () => {
  it('rejects delayed messages, pages, directory results and conversation events after deletion', () => {
    const { state: initial, target } = setup();
    const conversation = {
      id: 'default',
      workspaceId: 'ws',
      kind: 'workspace' as const,
      participants: [],
      createdAt: message(1).createdAt,
    };
    let state = reduce(initial, discussionConversationReceived(target.context, conversation));
    state = reduce(state, discussionMessageReceived(target, message(1)));
    state = reduce(state, discussionLoadStarted(target, 'history', false));
    state = reduce(state, discussionDirectoryStarted(target.context, 'ws', 'directory'));
    state = reduce(state, discussionConversationDeleted(target.context, 'ws', 'default'));
    expect(state.byWorkspaceId.ws.default).toBeUndefined();
    expect(getItems(state.directories.ws.conversations)).toEqual([]);
    for (const action of [
      discussionMessageReceived(target, message(2)),
      discussionPageReceived(
        target,
        'history',
        { messages: [message(2)], hasMore: false, conversation },
        'initial',
      ),
      discussionConversationReceived(target.context, conversation),
      discussionRequested('ws'),
      discussionConversationDeleted(target.context, 'ws', 'default'),
    ])
      expect(reduce(state, action)).toBe(state);
    state = reduce(
      state,
      discussionDirectoryReceived(target.context, 'ws', 'directory', {
        conversations: [conversation],
        hasMore: false,
      }),
    );
    expect(getItems(state.directories.ws.conversations)).toEqual([]);
    state = reduce(state, discussionContextChanged(null, null));
    state = reduce(state, discussionContextChanged('reconnected', 'owner-1'));
    expect(reduce(state, discussionRequested('ws'))).toBe(state);
  });
  it('ignores deletion from an old connection or another workspace', () => {
    const { state } = setup();
    expect(reduce(state, discussionConversationDeleted('old', 'ws', 'default'))).toBe(state);
    expect(reduce(state, discussionConversationDeleted('connection-1', 'missing', 'default'))).toBe(
      state,
    );
  });
});
