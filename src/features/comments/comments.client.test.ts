import { afterEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the backend bridge is mocked so no request ever reaches
// the user's real daemon. Each test asserts the JSON-RPC method + params the
// client emits (PROTOCOL.md §5.3 comment.*) and how it maps the daemon result
// into the legacy NoteComment shape.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

// The real loader consults Redux paging ownership before legacy hydration.
// Model an initialized application with no opted-in page session; retain the
// actual loader, paging guard, client and attribution conversion in this test.
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: { notePages: { byWorkspaceId: {} } } });
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { commentsClient } from './comments.client';
import { loadComments } from './comment-loader';
import { convertBackendCommentToV2 } from './comment-types-v2';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.3 `comment.list` response: `{ threads: [...] }` with nested comments. */
const listResponse = {
  threads: [
    {
      threadId: 'thread-1',
      comments: [
        {
          id: 'c1',
          noteId: 'note-1',
          threadId: 'thread-1',
          content: 'root comment',
          author: 'alice',
          authorType: 'user',
          type: 'comment',
          status: 'open',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'c2',
          noteId: 'note-1',
          threadId: 'thread-1',
          parentId: 'c1',
          content: 'agent reply',
          author: 'agent-1',
          authorType: 'agent',
          type: 'question',
          status: 'open',
          createdAt: '2026-01-01T00:01:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    },
  ],
};

describe('commentsClient (daemon comment.* seam, fake transport)', () => {
  afterEach(() => mockedRequest.mockReset());

  it('list sends comment.list and flattens threads into NoteComment[]', async () => {
    mockedRequest.mockResolvedValueOnce(listResponse);

    const result = await commentsClient.list('ws-1', 'note-1');

    expect(mockedRequest).toHaveBeenCalledWith('comment.list', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      includeComments: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id: 'c1',
      noteId: 'note-1',
      threadId: 'thread-1',
      author: 'alice',
      authorType: 'user',
      status: 'open',
    });
    expect(result.data[1]).toMatchObject({ id: 'c2', parentId: 'c1', authorType: 'agent' });
  });

  it('list forwards status to the wire and filters type/author locally', async () => {
    mockedRequest.mockResolvedValueOnce(listResponse);

    const result = await commentsClient.list('ws-1', 'note-1', {
      status: 'open',
      type: 'question',
      author: 'agent-1',
    });

    expect(mockedRequest).toHaveBeenCalledWith('comment.list', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      includeComments: true,
      status: 'open',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((c) => c.id)).toEqual(['c2']);
  });

  it('list surfaces transport errors as Result failures', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('daemon unavailable'));

    const result = await commentsClient.list('ws-1', 'note-1');

    expect(result).toEqual({ ok: false, error: 'daemon unavailable' });
  });

  it('add replies via comment.respond when parentId is present (round-trip echo)', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, commentId: 'c3', threadId: 'thread-1' });

    const result = await commentsClient.add({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      content: 'a reply',
      type: 'comment',
      author: 'alice',
      authorType: 'user',
      parentId: 'c1',
    });

    expect(mockedRequest).toHaveBeenCalledWith('comment.respond', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'c1',
      comment: 'a reply',
      type: 'comment',
      author: 'alice',
      authorType: 'user',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      id: 'c3',
      noteId: 'note-1',
      threadId: 'thread-1',
      parentId: 'c1',
      content: 'a reply',
      status: 'open',
    });
  });

  it('add fails loudly without parentId/threadId instead of writing anywhere', async () => {
    const result = await commentsClient.add({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      content: 'new anchored comment',
      type: 'comment',
      author: 'alice',
      authorType: 'user',
    });

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('updateStatus resolves via comment.resolveThread (resolved: true)', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });

    const result = await commentsClient.updateStatus({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'c1',
      status: 'resolved',
    });

    expect(mockedRequest).toHaveBeenCalledWith('comment.resolveThread', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'c1',
      resolved: true,
    });
    expect(result.ok).toBe(true);
  });

  it('updateStatus maps non-resolved statuses to resolved: false', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });

    const result = await commentsClient.updateStatus({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'c1',
      status: 'open',
    });

    expect(mockedRequest).toHaveBeenCalledWith('comment.resolveThread', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'c1',
      resolved: false,
    });
    expect(result.ok).toBe(true);
  });
});

describe('qualified creator through the real legacy read chain', () => {
  afterEach(() => mockedRequest.mockReset());
  const identity = { provider: 'gitlab', host: 'gitlab.example:8443', externalUserId: '42' };

  it('preserves imported identity-only and local author fields through client, loader and V2 conversion', async () => {
    const original = listResponse.threads[0].comments[0];
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          comments: [
            { ...original, authorPrincipalId: 'local-creator', authorIdentity: identity },
            { ...original, id: 'imported', authorIdentity: { ...identity, host: 'other.example' } },
            { ...original, id: 'legacy' },
          ],
        },
      ],
    });
    const loaded = await loadComments({ workspaceId: 'ws-1', noteId: 'note-1' });
    const converted = loaded.map((c) => convertBackendCommentToV2(c, undefined, 'note-1', 'ws-1'));
    expect(converted[0]).toMatchObject({
      author: 'alice',
      authorPrincipalId: 'local-creator',
      authorIdentity: identity,
    });
    expect(converted[1]).toMatchObject({ authorIdentity: { ...identity, host: 'other.example' } });
    expect(converted[1]).not.toHaveProperty('authorPrincipalId');
    expect(converted[2]).not.toHaveProperty('authorIdentity');
    expect(converted[2]).not.toHaveProperty('authorPrincipalId');
  });

  it('takes a canonical respond.comment creator instead of the editor request, without sending attribution fields', async () => {
    mockedRequest.mockResolvedValueOnce({
      comment: {
        ...listResponse.threads[0].comments[0],
        id: 'canonical',
        author: 'creator',
        authorPrincipalId: 'creator-id',
        authorIdentity: identity,
      },
    });
    const params = {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      parentId: 'root',
      content: 'reply',
      type: 'comment' as const,
      author: 'editor',
      authorType: 'user' as const,
      authorPrincipalId: 'spoof',
      authorIdentity: identity,
    };
    const result = await commentsClient.add(params);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('canonical reply unavailable');
    expect(result.data).toMatchObject({
      id: 'canonical',
      author: 'creator',
      authorPrincipalId: 'creator-id',
      authorIdentity: identity,
    });
    expect(mockedRequest.mock.calls[0][1]).not.toHaveProperty('authorPrincipalId');
    expect(mockedRequest.mock.calls[0][1]).not.toHaveProperty('authorIdentity');
  });
});
