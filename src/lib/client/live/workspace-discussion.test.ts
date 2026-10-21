import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceDiscussionClient as client } from './workspace-discussion';
import {
  isDiscussionMessageEvent,
  isDiscussionReactionEvent,
  isDiscussionAgentActivityEvent,
  type DiscussionConversation,
} from '$shared/types/workspace-discussion';
const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./backend-transport', () => ({ backendRequest: wire.request }));
const author = (principalId: string) => ({
  principalId,
  login: null,
  displayName: null,
  avatarUrl: null,
});
const conversation: DiscussionConversation = {
  id: 'c2',
  workspaceId: 'ws',
  kind: 'direct',
  participants: [author('me'), author('other')],
  createdAt: '2026-10-16T00:00:00Z',
};
const message = {
  id: 'server',
  workspaceId: 'ws',
  conversationId: 'c2',
  sequence: 1,
  body: 'hello',
  author: author('me'),
  createdAt: conversation.createdAt,
};
beforeEach(() => wire.request.mockReset());
describe('explicit discussion agent wire contract', () => {
  it.each([undefined, false, true, '1', 0, 2, 1])(
    'requires exact agent capability %s',
    async (value) => {
      wire.request.mockResolvedValue({ discussionAgentMessaging: value });
      expect(await client.supportsAgentMessaging()).toBe(value === 1);
      expect(wire.request).toHaveBeenCalledWith('system.capabilities', {});
    },
  );
  const params = {
    workspaceId: 'ws',
    messageId: 'retry',
    body: 'Review this',
    recipientAgentIds: ['agent-a'],
  };
  const addressed = {
    ...message,
    conversationId: 'default',
    body: params.body,
    recipientAgentIds: ['agent-a'],
  };
  it('blocks old daemons and private targets before touching the wire', async () => {
    await expect(client.send(params)).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    await expect(
      client.send({ ...params, conversationId: 'c2' }, true, false, true),
    ).rejects.toThrow();
    await expect(
      client.send({ ...params, recipientPrincipalIds: ['other'] }, true, false, true),
    ).rejects.toThrow();
    expect(wire.request).not.toHaveBeenCalled();
  });
  it('roundtrips exact recipients and refuses mismatched or absent metadata', async () => {
    wire.request.mockResolvedValue({ message: addressed });
    expect(await client.send(params, false, false, true)).toEqual({ message: addressed });
    expect(wire.request).toHaveBeenCalledWith('discussion.send', params);
    for (const recipientAgentIds of [undefined, [], ['agent-b'], ['agent-a', 'agent-a'], [null]]) {
      wire.request.mockResolvedValue({ message: { ...addressed, recipientAgentIds } });
      await expect(client.send(params, false, false, true)).rejects.toThrow();
    }
  });
  it('accepts agent-authored history, rejects mixed identities and human-send impersonation', async () => {
    const agent = {
      ...addressed,
      author: { ...author('me'), principalId: null, agentId: 'agent-a', displayName: 'Reviewer' },
    };
    wire.request.mockResolvedValue({ messages: [agent], hasMore: false });
    expect((await client.list({ workspaceId: 'ws' }, false, false, true)).messages).toEqual([
      agent,
    ]);
    wire.request.mockResolvedValue({
      messages: [{ ...agent, author: { ...agent.author, principalId: 'me' } }],
      hasMore: false,
    });
    await expect(client.list({ workspaceId: 'ws' }, false, false, true)).rejects.toThrow();
    wire.request.mockResolvedValue({ message: agent });
    await expect(client.send(params, false, false, true)).rejects.toThrow();
  });
});
describe('discussion conversation wire contract', () => {
  it.each([undefined, false, true, '1', 0, 2, 1])(
    'requires the exact capability value %s',
    async (value) => {
      wire.request.mockResolvedValue({ discussionConversations: value });
      expect(await client.supportsConversations()).toBe(value === 1);
      expect(wire.request).toHaveBeenCalledWith('system.capabilities', {});
    },
  );
  it('blocks private requests before touching an older daemon', async () => {
    await expect(
      client.send({
        workspaceId: 'ws',
        messageId: 'key',
        body: 'hello',
        recipientPrincipalIds: ['other'],
      }),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    await expect(client.list({ workspaceId: 'ws', conversationId: 'c2' })).rejects.toThrow();
    await expect(client.conversations({ workspaceId: 'ws' })).rejects.toThrow();
    await expect(client.recipients({ workspaceId: 'ws' })).rejects.toThrow();
    expect(wire.request).not.toHaveBeenCalled();
  });
  it('preserves exact first-send recipients and rejects a default or mismatched success', async () => {
    const params = {
      workspaceId: 'ws',
      messageId: 'retry',
      body: 'hello',
      recipientPrincipalIds: ['other'],
    };
    wire.request.mockResolvedValue({ message, conversation });
    expect(await client.send(params, true)).toEqual({ message, conversation });
    expect(wire.request).toHaveBeenCalledWith('discussion.send', params);
    wire.request.mockResolvedValue({ message: { ...message, conversationId: undefined } });
    await expect(client.send(params, true)).rejects.toThrow();
    wire.request.mockResolvedValue({
      message,
      conversation: { ...conversation, participants: [author('me'), author('stranger')] },
    });
    await expect(client.send(params, true)).rejects.toThrow();
  });
  it('requires matching thread metadata and independently checks history cursors', async () => {
    wire.request.mockResolvedValue({ messages: [message], conversation, hasMore: false });
    expect(
      await client.list({ workspaceId: 'ws', conversationId: 'c2', afterSequence: 0 }, true),
    ).toMatchObject({ conversation });
    await expect(client.list({ workspaceId: 'ws', conversationId: 'c1' }, true)).rejects.toThrow();
    await expect(
      client.list({ workspaceId: 'ws', conversationId: 'c2', afterSequence: 1 }, true),
    ).rejects.toThrow();
    wire.request.mockResolvedValue({ messages: [message], hasMore: false });
    await expect(client.list({ workspaceId: 'ws', conversationId: 'c2' }, true)).rejects.toThrow();
  });
  it('allows a one-row default page and exclusive private continuation', async () => {
    const workspace = { ...conversation, id: 'default', kind: 'workspace', participants: [] };
    wire.request
      .mockResolvedValueOnce({ conversations: [workspace], hasMore: true })
      .mockResolvedValueOnce({ conversations: [conversation], hasMore: false });
    expect(await client.conversations({ workspaceId: 'ws', limit: 1 }, true)).toMatchObject({
      conversations: [workspace],
    });
    expect(
      await client.conversations({ workspaceId: 'ws', beforeId: 'default', limit: 1 }, true),
    ).toMatchObject({ conversations: [conversation] });
    expect(wire.request).toHaveBeenLastCalledWith('discussion.conversations', {
      workspaceId: 'ws',
      beforeId: 'default',
      limit: 1,
    });
    wire.request.mockResolvedValue({ conversations: [conversation], hasMore: true });
    await expect(
      client.conversations({ workspaceId: 'ws', beforeId: 'c2' }, true),
    ).rejects.toThrow();
  });
  it('bounds recipient pages and rejects nonadvancing cursors', async () => {
    wire.request.mockResolvedValue({ members: [author('b')], hasMore: false });
    await client.recipients(
      { workspaceId: 'ws', query: 'b', afterPrincipalId: 'a', limit: 1000 },
      true,
    );
    expect(wire.request).toHaveBeenCalledWith('discussion.recipients', {
      workspaceId: 'ws',
      query: 'b',
      afterPrincipalId: 'a',
      limit: 50,
    });
    await expect(
      client.recipients({ workspaceId: 'ws', afterPrincipalId: 'b' }, true),
    ).rejects.toThrow();
  });
  it('accepts legacy events only for default, never infers the currently selected thread', () => {
    expect(
      isDiscussionMessageEvent({
        workspaceId: 'ws',
        message: { ...message, conversationId: undefined },
      }),
    ).toBe(true);
    expect(isDiscussionMessageEvent({ workspaceId: 'ws', message })).toBe(false);
    expect(
      isDiscussionMessageEvent({ workspaceId: 'ws', conversationId: 'c2', conversation, message }),
    ).toBe(true);
    expect(
      isDiscussionMessageEvent({ workspaceId: 'ws', conversationId: 'c1', conversation, message }),
    ).toBe(false);
  });
});

describe('discussion reply and reaction wire contract', () => {
  const supportedMessage = {
    ...message,
    replyToMessageId: null,
    replyTo: null,
    reactions: [],
    reactionVersion: 0,
  };
  it.each([undefined, false, true, '1', 0, 2, 1])(
    'requires exact message-actions capability %s',
    async (value) => {
      wire.request.mockResolvedValue({ discussionMessageActions: value });
      expect(await client.supportsMessageActions()).toBe(value === 1);
      expect(wire.request).toHaveBeenCalledWith('system.capabilities', {});
    },
  );
  it('blocks replies and reactions before sending to unsupported daemons', async () => {
    await expect(
      client.send({
        workspaceId: 'ws',
        messageId: 'key',
        body: 'reply',
        replyToMessageId: 'original',
      }),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    await expect(
      client.react({ workspaceId: 'ws', messageId: 'original', reaction: '👍', active: true }),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    expect(wire.request).not.toHaveBeenCalled();
  });
  it('sends exact reply targets and rejects a mismatched or stripped acknowledgement', async () => {
    const params = {
      workspaceId: 'ws',
      conversationId: 'c2',
      messageId: 'key',
      body: 'hello',
      replyToMessageId: 'original',
    };
    const reply = {
      ...supportedMessage,
      replyToMessageId: 'original',
      replyTo: { id: 'original', body: 'quote', author: author('other') },
    };
    wire.request.mockResolvedValue({ message: reply, conversation });
    expect(await client.send(params, true, true)).toEqual({ message: reply, conversation });
    expect(wire.request).toHaveBeenCalledWith('discussion.send', params);
    wire.request.mockResolvedValue({ message: supportedMessage, conversation });
    await expect(client.send(params, true, true)).rejects.toThrow();
    wire.request.mockResolvedValue({ message, conversation });
    await expect(
      client.send({ ...params, replyToMessageId: undefined }, true, true),
    ).rejects.toThrow();
  });
  it('accepts legacy history only without the message-actions capability', async () => {
    wire.request.mockResolvedValue({ messages: [message], hasMore: false, conversation });
    await expect(
      client.list({ workspaceId: 'ws', conversationId: 'c2' }, true, false),
    ).resolves.toMatchObject({ messages: [message] });
    await expect(
      client.list({ workspaceId: 'ws', conversationId: 'c2' }, true, true),
    ).rejects.toThrow();
    wire.request.mockResolvedValue({
      messages: [{ ...supportedMessage, reactionVersion: -1 }],
      hasMore: false,
      conversation,
    });
    await expect(
      client.list({ workspaceId: 'ws', conversationId: 'c2' }, true, true),
    ).rejects.toThrow();
  });
  it('validates exact desired reaction payloads and rejects malformed projections', async () => {
    const params = {
      workspaceId: 'ws',
      conversationId: 'c2',
      messageId: 'server',
      reaction: '👍' as const,
      active: false,
    };
    const response = {
      messageId: 'server',
      reactions: [{ reaction: '👍', count: 2, reacted: false }],
      reactionVersion: 4,
    };
    wire.request.mockResolvedValue(response);
    expect(await client.react(params, true)).toEqual(response);
    expect(wire.request).toHaveBeenCalledWith('discussion.react', params);
    for (const invalid of [
      { ...response, messageId: 'wrong' },
      { ...response, reactionVersion: -1 },
      { ...response, reactions: [{ reaction: '🚀', count: 1, reacted: true }] },
      { ...response, reactions: [{ reaction: '👍', count: 0, reacted: false }] },
      { ...response, reactions: [...response.reactions, ...response.reactions] },
    ]) {
      wire.request.mockResolvedValue(invalid);
      await expect(client.react(params, true)).rejects.toThrow();
    }
  });
});

describe('request-correlated discussion activity wire contract', () => {
  const params = { workspaceId: 'ws', messageId: 'server', agentId: 'agent-a', attempt: 1 };
  const activity = {
    agentId: 'agent-a',
    attempt: 1,
    version: 2,
    state: 'working',
    updatedAt: '2026-10-20T00:00:00Z',
    error: null,
  };
  it.each([undefined, false, true, '1', 0, 2, 1])(
    'requires exact activity capability %s',
    async (value) => {
      wire.request.mockResolvedValue({ discussionAgentActivity: value });
      expect(await client.supportsAgentActivity()).toBe(value === 1);
    },
  );
  it('binds both methods to committed message, recipient and attempt without sending a message', async () => {
    wire.request.mockResolvedValue({ activity });
    await expect(client.controlAgent('stop', params)).rejects.toMatchObject({
      code: 'METHOD_NOT_FOUND',
    });
    expect(wire.request).not.toHaveBeenCalled();
    expect(await client.controlAgent('stop', params, true)).toEqual({ activity });
    expect(wire.request).toHaveBeenLastCalledWith('discussion.stopAgent', params);
    const next = { ...activity, attempt: 2, version: 3, state: 'queued' };
    wire.request.mockResolvedValue({ activity: next });
    expect(await client.controlAgent('retry', params, true)).toEqual({ activity: next });
    expect(wire.request).toHaveBeenLastCalledWith('discussion.retryAgent', params);
  });
  it('rejects private and malformed control requests before the wire', async () => {
    for (const extra of [
      { conversationId: 'c2' },
      { agentId: '' },
      { messageId: '' },
      { attempt: 0 },
      { attempt: 1.5 },
    ])
      await expect(client.controlAgent('stop', { ...params, ...extra }, true)).rejects.toThrow();
    expect(wire.request).not.toHaveBeenCalled();
  });
  it.each([
    { agentId: 'other' },
    { attempt: 0 },
    { version: 0 },
    { version: 1.5 },
    { state: 'running' },
    { updatedAt: 'invalid' },
    { error: {} },
  ])('rejects malformed or mismatched activity %j', async (extra) => {
    wire.request.mockResolvedValue({ activity: { ...activity, ...extra } });
    await expect(client.controlAgent('stop', params, true)).rejects.toThrow();
  });
  it('rejects absent advertised activity and accepts an explicit empty legacy array', async () => {
    const row = { ...message, conversationId: 'default', recipientAgentIds: [], agentMentions: [] };
    wire.request.mockResolvedValue({ messages: [row], hasMore: false });
    await expect(client.list({ workspaceId: 'ws' }, false, false, true, true)).rejects.toThrow();
    wire.request.mockResolvedValue({ messages: [{ ...row, agentActivity: [] }], hasMore: false });
    expect(
      (await client.list({ workspaceId: 'ws' }, false, false, true, true)).messages[0]
        .agentActivity,
    ).toEqual([]);
    wire.request.mockResolvedValue({
      messages: [{ ...row, agentActivity: [activity] }],
      hasMore: false,
    });
    await expect(client.list({ workspaceId: 'ws' }, false, false, true, true)).rejects.toThrow();
  });
  it('validates event scope and does not accept global agent status shapes', () => {
    const event = { workspaceId: 'ws', conversationId: 'default', messageId: 'server', activity };
    expect(isDiscussionAgentActivityEvent(event)).toBe(true);
    for (const extra of [
      { conversationId: 'c2' },
      { conversationId: undefined },
      { messageId: '' },
      { activity: { agentId: 'agent-a', status: 'running' } },
    ])
      expect(isDiscussionAgentActivityEvent({ ...event, ...extra })).toBe(false);
  });
});

describe('immutable selected agent mention metadata', () => {
  const params = {
    workspaceId: 'ws',
    messageId: 'retry-key',
    body: '😀 @Reviewer plain @Reviewer',
    recipientAgentIds: ['agent-a'],
    agentMentions: [{ agentId: 'agent-a', name: 'Reviewer', start: 3, end: 12 }],
  };
  const row = {
    ...message,
    conversationId: 'default',
    body: params.body,
    recipientAgentIds: params.recipientAgentIds,
    agentMentions: params.agentMentions,
    agentActivity: [],
  };
  it('roundtrips UTF16 offsets and names exactly, leaving ordinary matching text without metadata', async () => {
    wire.request.mockResolvedValue({ message: row });
    expect((await client.send(params, false, false, true, true)).message.agentMentions).toEqual(
      params.agentMentions,
    );
    expect(wire.request).toHaveBeenLastCalledWith('discussion.send', params);
    wire.request.mockResolvedValue({ messages: [row], hasMore: false });
    expect(
      (await client.list({ workspaceId: 'ws' }, false, false, true, true)).messages[0]
        .agentMentions,
    ).toHaveLength(1);
  });
  it('does not send selected metadata to an unadvertised daemon', async () => {
    await expect(client.send(params, false, false, true, false)).rejects.toMatchObject({
      code: 'METHOD_NOT_FOUND',
    });
    expect(wire.request).not.toHaveBeenCalled();
  });
  it('rejects mutated, overlapping, byte-offset, out-of-target and omitted immutable metadata', async () => {
    for (const agentMentions of [
      undefined,
      [],
      [{ ...params.agentMentions[0], start: 4 }],
      [{ ...params.agentMentions[0], name: 'Renamed' }],
      [{ ...params.agentMentions[0], agentId: 'another' }],
      [params.agentMentions[0], params.agentMentions[0]],
    ]) {
      wire.request.mockResolvedValue({ message: { ...row, agentMentions } });
      await expect(client.send(params, false, false, true, true)).rejects.toThrow();
    }
  });
});

describe('expanded discussion reactions', () => {
  const reactors = [author('me'), { ...author('unused'), principalId: null, agentId: 'agent-a' }];
  const reaction = { reaction: '👀' as const, count: 2, reacted: true, reactors };
  const response = { messageId: message.id, reactionVersion: 2, reactions: [reaction] };
  const params = {
    workspaceId: 'ws',
    messageId: message.id,
    reaction: '👀' as const,
    active: true,
  };
  const full = {
    ...message,
    conversationId: 'default',
    replyToMessageId: null,
    replyTo: null,
    reactionVersion: 2,
    reactions: [reaction],
  };

  it.each([undefined, null, false, true, '1', 0, 2, {}, 1])(
    'requires exact expanded capability %s while retaining readable history',
    async (value) => {
      wire.request.mockResolvedValueOnce({ discussionReactions: value });
      const supported = await client.supportsReactions();
      expect(supported).toBe(value === 1);
      wire.request.mockResolvedValueOnce({ messages: [full], hasMore: false });
      expect(
        (await client.list({ workspaceId: 'ws' }, false, true, false, false, supported)).messages,
      ).toEqual([full]);
    },
  );
  it('fails capability discovery closed and guards new choices and legacy additions before the wire', async () => {
    wire.request.mockRejectedValueOnce(new Error('offline'));
    expect(await client.supportsReactions()).toBe(false);
    wire.request.mockClear();
    await expect(client.react(params, true)).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    await expect(client.react({ ...params, reaction: '🙂' }, true, true)).rejects.toThrow(
      'removal-only',
    );
    expect(wire.request).not.toHaveBeenCalled();
    wire.request.mockResolvedValue(response);
    expect(await client.react(params, true, true)).toEqual(response);
    expect(await client.react({ ...params, reaction: '🙂', active: false }, true, true)).toEqual(
      response,
    );
  });
  it('accepts mixed human and agent samples, caps them at 20, and rejects malformed identities', async () => {
    const event = { ...response, workspaceId: 'ws', conversationId: 'default' };
    expect(isDiscussionReactionEvent(event)).toBe(true);
    const bounded = Array.from({ length: 20 }, (_, i) => author(`person-${i}`));
    wire.request.mockResolvedValue({
      ...response,
      reactions: [{ ...reaction, count: 50, reactors: bounded }],
    });
    await expect(client.react(params, true, true)).resolves.toMatchObject({
      reactions: [{ count: 50, reactors: bounded }],
    });
    for (const invalid of [
      { ...reaction, reactors: undefined },
      { ...reaction, reactors: null },
      { ...reaction, reactors: [{ ...reactors[1], principalId: 'me' }] },
      { ...reaction, reactors: [{ ...reactors[0], principalId: '' }] },
      { ...reaction, reactors: [{ ...reactors[1], agentId: '' }] },
      { ...reaction, reactors: [{ ...reactors[0], displayName: 5 }] },
      { ...reaction, count: 1 },
      { ...reaction, count: 50, reactors: [...bounded, author('overflow')] },
    ]) {
      wire.request.mockResolvedValue({ ...response, reactions: [invalid] });
      await expect(client.react(params, true, true)).rejects.toThrow();
      if (invalid.reactors !== undefined)
        expect(isDiscussionReactionEvent({ ...event, reactions: [invalid] })).toBe(false);
    }
  });
  it('preserves inert imported snapshots with repeated or unknown identity without weakening message authors', async () => {
    const unknown = { principalId: null, login: null, displayName: null, avatarUrl: null };
    const snapshots = [
      reactors[0],
      { ...reactors[0], displayName: 'Imported name' },
      unknown,
      unknown,
    ];
    const imported = {
      ...full,
      reactions: [{ ...reaction, count: 4, reacted: false, reactors: snapshots }],
    };
    wire.request.mockResolvedValue({ messages: [imported], hasMore: false });
    expect(
      (await client.list({ workspaceId: 'ws' }, false, true, false, false, true)).messages,
    ).toEqual([imported]);
    wire.request.mockResolvedValue({ ...response, reactions: imported.reactions });
    await expect(client.react(params, true, true)).resolves.toMatchObject({
      reactions: imported.reactions,
    });
    wire.request.mockResolvedValue({
      messages: [{ ...imported, author: unknown }],
      hasMore: false,
    });
    await expect(
      client.list({ workspaceId: 'ws' }, false, true, false, false, true),
    ).rejects.toThrow();
  });
  it('requires roster metadata on list/send and rejects wrong-message mutation replies', async () => {
    const legacy = { ...full, reactions: [{ reaction: '👍', count: 1, reacted: true }] };
    wire.request.mockResolvedValue({ messages: [legacy], hasMore: false });
    await expect(client.list({ workspaceId: 'ws' }, false, true)).resolves.toMatchObject({
      messages: [legacy],
    });
    await expect(
      client.list({ workspaceId: 'ws' }, false, true, false, false, true),
    ).rejects.toThrow();
    wire.request.mockResolvedValue({ message: legacy });
    await expect(
      client.send(
        { workspaceId: 'ws', messageId: 'retry', body: message.body },
        false,
        true,
        false,
        false,
        true,
      ),
    ).rejects.toThrow();
    wire.request.mockResolvedValue({ ...response, messageId: 'another-conversation-message' });
    await expect(client.react(params, true, true)).rejects.toThrow();
  });
});
