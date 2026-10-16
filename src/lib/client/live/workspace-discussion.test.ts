import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceDiscussionClient as client } from './workspace-discussion';
import {
  isDiscussionMessageEvent,
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
