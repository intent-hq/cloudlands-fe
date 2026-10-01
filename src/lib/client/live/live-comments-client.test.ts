import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the backend bridge is mocked so no comment mutation ever
// reaches the user's real daemon. `resolveNoteWorkspaceId` is stubbed so
// note-scoped mutations resolve deterministically; `runMutation` /
// `newIdempotencyKey` stay real so the asserted method + params and the
// success/error folding are the genuine code paths. The notification /
// reconnect handlers are captured so the typed §6.9 channel tests can drive
// `subscription.push` frames deterministically.
let notifyHandler: ((n: { method: string; params?: unknown }) => void) | null = null;
let reconnectHandler: (() => void) | null = null;

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn((handler: (n: { method: string; params?: unknown }) => void) => {
    notifyHandler = handler;
    return () => {
      notifyHandler = null;
    };
  }),
  onBackendReconnected: vi.fn((handler: () => void) => {
    reconnectHandler = handler;
    return () => {
      reconnectHandler = null;
    };
  }),
}));

vi.mock('./live-support', async (importActual) => {
  const actual = await importActual<typeof import('./live-support')>();
  return { ...actual, resolveNoteWorkspaceId: vi.fn(() => Promise.resolve('ws-1')) };
});

import { backendRequest } from './backend-transport';
import { resolveNoteWorkspaceId } from './live-support';
import { LiveCommentsClient } from './live-comments-client';

const mockedRequest = vi.mocked(backendRequest);
const mockedResolve = vi.mocked(resolveNoteWorkspaceId);

describe('LiveCommentsClient mutations (fake transport)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue('ws-1');
  });

  it('add forwards comment.add with the params + an idempotencyKey', async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: 'c-1' });
    const client = new LiveCommentsClient();

    const result = await client.add('note-1', {
      searchContext: 'the quick brown fox',
      commentTarget: 'quick',
      comment: 'hi',
      type: 'comment',
      author: 'User',
      authorType: 'user',
    });

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      'comment.add',
      expect.objectContaining({
        workspaceId: 'ws-1',
        noteId: 'note-1',
        searchContext: 'the quick brown fox',
        commentTarget: 'quick',
        comment: 'hi',
        type: 'comment',
        author: 'User',
        authorType: 'user',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  // Round-5 regression (monorepo "comment-add" dogfood failure): note ids are
  // NOT globally unique — every workspace has a note literally named `spec` —
  // and `resolveNoteWorkspaceId`'s cache is last-writer-wins across workspaces
  // (any other workspace's note:updated refetch overwrites the entry). A
  // caller-supplied `workspaceId` must therefore win over the cache, otherwise
  // comment.add targets another workspace's same-id note and the daemon
  // correctly rejects with "Could not find the search context".
  it("add uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: 'c-1' });
    // Cache poisoned by another workspace that also has a "spec" note.
    mockedResolve.mockResolvedValue('other-workspace');
    const client = new LiveCommentsClient();

    await client.add('spec', {
      workspaceId: 'comment-add',
      searchContext: 'ctx',
      commentTarget: 'target',
      comment: 'hi',
    });

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith(
      'comment.add',
      expect.objectContaining({ workspaceId: 'comment-add', noteId: 'spec' }),
    );
  });

  it("respond and delete use the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValue({ success: true });
    mockedResolve.mockResolvedValue('other-workspace');
    const client = new LiveCommentsClient();

    await client.respond('spec', {
      workspaceId: 'comment-add',
      commentId: 'c-1',
      comment: 'reply',
    });
    await client.delete('spec', 'c-1', 'comment-add');

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenNthCalledWith(
      1,
      'comment.respond',
      expect.objectContaining({ workspaceId: 'comment-add', noteId: 'spec' }),
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      2,
      'comment.delete',
      expect.objectContaining({ workspaceId: 'comment-add', noteId: 'spec' }),
    );
  });

  it("list uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ threads: [] });
    mockedResolve.mockResolvedValue('other-workspace');
    const client = new LiveCommentsClient();

    await client.list('spec', 'comment-add');

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith(
      'comment.list',
      expect.objectContaining({ workspaceId: 'comment-add', noteId: 'spec' }),
    );
  });

  // monorepo#621 (Round 7d): `subscribe`'s typed channel must pin to the
  // caller's workspaceId too — otherwise a poisoned resolver cache routes the
  // channel at another workspace's same-id note (e.g. `spec`).
  it("subscribe's channel uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValue({ subscriptionId: 'chan-1' });
    mockedResolve.mockResolvedValue('other-workspace');
    const client = new LiveCommentsClient();

    const unsubscribe = client.subscribe('spec', () => {}, 'comment-add');
    // The channel registers asynchronously on subscription setup.
    await vi.waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith('comment.subscribe', {
        workspaceId: 'comment-add',
        noteId: 'spec',
      });
    });
    expect(mockedResolve).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('subscribe falls back to the resolver when no workspaceId is supplied', async () => {
    mockedRequest.mockResolvedValue({ subscriptionId: 'chan-1' });
    const client = new LiveCommentsClient();

    const unsubscribe = client.subscribe('note-1', () => {});
    await vi.waitFor(() => {
      expect(mockedResolve).toHaveBeenCalledWith('note-1');
    });
    await vi.waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith('comment.subscribe', {
        workspaceId: 'ws-1',
        noteId: 'note-1',
      });
    });
    unsubscribe();
  });

  it('add omits authorType from the wire params when not provided', async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: 'c-1' });
    const client = new LiveCommentsClient();

    await client.add('note-1', { searchContext: 'a b', commentTarget: 'a', comment: 'hi' });

    expect(mockedRequest.mock.calls[0][1]).not.toHaveProperty('authorType');
  });

  // intentd#514 / PROTOCOL §5.3: `comment.add` accepts an optional client
  // `commentId` (a UUID) used as the canonical id — comment row, threadId,
  // anchor ids, and the embedded note markers — so the FE's optimistic editor
  // anchors converge with the daemon's rewrite instead of ghosting under a
  // daemon-minted id (root cause A of the clobber/ghosting race).
  it("add forwards the caller's commentId on the wire when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: '550e8400-e29b-41d4-a716-446655440000' });
    const client = new LiveCommentsClient();

    await client.add('note-1', {
      searchContext: 'a b',
      commentTarget: 'a',
      comment: 'hi',
      commentId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      'comment.add',
      expect.objectContaining({ commentId: '550e8400-e29b-41d4-a716-446655440000' }),
    );
  });

  it('add omits commentId from the wire params when not provided (older-daemon mint path)', async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: 'c-1' });
    const client = new LiveCommentsClient();

    await client.add('note-1', { searchContext: 'a b', commentTarget: 'a', comment: 'hi' });

    expect(mockedRequest.mock.calls[0][1]).not.toHaveProperty('commentId');
  });

  // FE side of monorepo#638: the daemon echoes the authoritative post-add
  // note rev (`noteRev`) after its anchor rewrite; the seam surfaces it on the
  // MutationResult so rev bookkeeping can consume it instead of inferring +1.
  it("add surfaces the daemon's echoed noteRev on the MutationResult", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: 'c-1', noteRev: 7 });
    const client = new LiveCommentsClient();

    const result = await client.add('note-1', {
      searchContext: 'a b',
      commentTarget: 'a',
      comment: 'hi',
    });

    expect(result).toEqual({ success: true, noteRev: 7 });
  });

  it('add omits noteRev when the daemon does not echo one (older daemons)', async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: 'c-1' });
    const client = new LiveCommentsClient();

    const result = await client.add('note-1', {
      searchContext: 'a b',
      commentTarget: 'a',
      comment: 'hi',
    });

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty('noteRev');
  });

  it('add generates a distinct idempotencyKey per call', async () => {
    mockedRequest.mockResolvedValue({ commentId: 'c-x' });
    const client = new LiveCommentsClient();

    await client.add('note-1', { searchContext: 'a b', commentTarget: 'a', comment: '1' });
    await client.add('note-1', { searchContext: 'a b', commentTarget: 'a', comment: '2' });

    const first = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const second = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(first).not.toEqual(second);
  });

  it('respond forwards comment.respond with commentId + suggestion fields when provided', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveCommentsClient();

    await client.respond('note-1', {
      commentId: 'parent-1',
      comment: 'see diff',
      type: 'suggestion',
      suggestionOriginal: 'old',
      suggestionProposed: 'new',
    });

    expect(mockedRequest).toHaveBeenCalledWith('comment.respond', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'parent-1',
      comment: 'see diff',
      type: 'suggestion',
      suggestionOriginal: 'old',
      suggestionProposed: 'new',
    });
  });

  it('respond forwards authorType when provided and omits it when absent', async () => {
    mockedRequest.mockResolvedValue({ success: true });
    const client = new LiveCommentsClient();

    await client.respond('note-1', {
      commentId: 'parent-1',
      comment: 'from the user',
      authorType: 'user',
    });
    await client.respond('note-1', { commentId: 'parent-1', comment: 'from an agent' });

    expect(mockedRequest.mock.calls[0][1]).toMatchObject({ authorType: 'user' });
    expect(mockedRequest.mock.calls[1][1]).not.toHaveProperty('authorType');
  });

  it('delete forwards comment.delete with the commentId', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveCommentsClient();

    expect(await client.delete('note-1', 'c-1')).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith('comment.delete', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'c-1',
    });
  });

  it('fails a mutation when the workspace cannot be resolved', async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const client = new LiveCommentsClient();

    const result = await client.delete('ghost', 'c-1');
    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('maps a daemon error to a failed MutationResult without throwing', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveCommentsClient();

    expect(await client.delete('note-1', 'c-1')).toEqual({ success: false, error: 'boom' });
  });

  it("folds the BackendError.data detail into a generic 'Internal error'", async () => {
    // The daemon maps Error::Internal to -32603 with the hardcoded message
    // "Internal error" and the real cause as a string in `error.data`; the
    // main-process bridge (json-rpc-errors.ts) normalizes that string onto
    // `data.detail` before it crosses the IPC boundary, so this fixture mirrors
    // the post-normalization shape the renderer actually receives.
    mockedRequest.mockRejectedValueOnce(
      Object.assign(new Error('Internal error'), {
        data: {
          code: 'INTERNAL_ERROR',
          detail: 'Could not find the search context in the document.',
        },
        rpcCode: -32603,
      }),
    );
    const client = new LiveCommentsClient();

    const result = await client.add('note-1', {
      searchContext: 'a b',
      commentTarget: 'a',
      comment: 'hi',
    });

    expect(result).toEqual({
      success: false,
      error: 'Internal error: Could not find the search context in the document.',
    });
  });

  it('folds a raw string data detail for transports that skip main-process normalization', async () => {
    mockedRequest.mockRejectedValueOnce(
      Object.assign(new Error('Internal error'), { data: 'raw cause' }),
    );
    const client = new LiveCommentsClient();

    const result = await client.add('note-1', {
      searchContext: 'a b',
      commentTarget: 'a',
      comment: 'hi',
    });

    expect(result).toEqual({ success: false, error: 'Internal error: raw cause' });
  });

  it("leaves a generic 'Internal error' untouched when no data detail is present", async () => {
    mockedRequest.mockRejectedValueOnce(new Error('Internal error'));
    const client = new LiveCommentsClient();

    const result = await client.add('note-1', {
      searchContext: 'a b',
      commentTarget: 'a',
      comment: 'hi',
    });

    expect(result).toEqual({ success: false, error: 'Internal error' });
  });

  it('does NOT fold data into a specific (non-generic) error message', async () => {
    mockedRequest.mockRejectedValueOnce(
      Object.assign(new Error('commentTarget must not be empty'), { data: 'extra' }),
    );
    const client = new LiveCommentsClient();

    const result = await client.add('note-1', {
      searchContext: 'a b',
      commentTarget: '',
      comment: 'hi',
    });

    expect(result).toEqual({ success: false, error: 'commentTarget must not be empty' });
  });
});

describe('LiveCommentsClient.list (PROTOCOL §5.3 {threads} envelope)', () => {
  afterEach(() => vi.clearAllMocks());

  it('flattens threads[].comments and normalizes §8.7 subtype fields', async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: 't-1',
          comments: [
            {
              id: 'c-1',
              threadId: 't-1',
              type: 'comment',
              content: 'hi',
              anchorContext: { before: 'B', after: 'A' },
            },
          ],
        },
        {
          threadId: 't-2',
          comments: [
            {
              id: 's-1',
              threadId: 't-2',
              type: 'suggestion',
              content: 'swap',
              anchorContext: { before: 'x', after: 'y' },
              suggestionDiff: { original: 'foo', proposed: 'bar' },
            },
          ],
        },
      ],
      totalThreads: 2,
      totalComments: 2,
    });

    const comments = await new LiveCommentsClient().list('note-1');

    expect(mockedRequest).toHaveBeenCalledWith(
      'comment.list',
      expect.objectContaining({ workspaceId: 'ws-1', noteId: 'note-1', includeComments: true }),
    );

    expect(comments).toHaveLength(2);

    const comment = comments.find((c) => c.id === 'c-1')!;
    expect(comment.type).toBe('comment');
    expect(comment.anchorContext).toEqual({ before: 'B', after: 'A' });

    const suggestion = comments.find((c) => c.id === 's-1')!;
    expect(suggestion.type).toBe('suggestion');
    expect(suggestion.anchorContext).toEqual({ before: 'x', after: 'y' });
    expect((suggestion as { suggestionDiff: unknown }).suggestionDiff).toEqual({
      original: 'foo',
      proposed: 'bar',
    });
  });

  // monorepo#749: post-#729 replies carry no anchor/anchorText on the wire
  // (PROTOCOL §5.3 "Reply anchoring") — normalizeComment must not synthesize
  // a `{ type: "point" }` anchor for them, or downstream anchor-health checks
  // treat the reply as a point comment with no anchor node and orphan it.
  it('does not synthesize a point anchor for anchorless replies (monorepo#749)', async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: 't-1',
          comments: [
            {
              id: 'root-1',
              threadId: 't-1',
              type: 'comment',
              content: 'root',
              anchor: { type: 'range', startId: 'root-1:start', endId: 'root-1:end' },
              anchorText: 'hello',
            },
            {
              id: 'reply-1',
              threadId: 't-1',
              parentId: 'root-1',
              type: 'comment',
              content: 'reply',
            },
          ],
        },
      ],
      totalThreads: 1,
      totalComments: 2,
    });

    const comments = await new LiveCommentsClient().list('note-1');

    const root = comments.find((c) => c.id === 'root-1')!;
    expect(root.anchor).toEqual({ type: 'range', startId: 'root-1:start', endId: 'root-1:end' });

    const reply = comments.find((c) => c.id === 'reply-1')!;
    expect(reply.parentId).toBe('root-1');
    expect(reply).not.toHaveProperty('anchor');
  });

  it('keeps the point-anchor fallback for anchorless roots (thread-summary proxies)', async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: 't-1',
          comments: [{ id: 'root-1', threadId: 't-1', type: 'comment', content: 'root' }],
        },
      ],
      totalThreads: 1,
      totalComments: 1,
    });

    const comments = await new LiveCommentsClient().list('note-1');
    expect(comments[0].anchor).toEqual({ type: 'point' });
  });

  it('falls back to the thread summary when comments are absent (no includeComments)', async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: 't-1',
          noteId: 'note-1',
          status: 'open',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivity: '2026-01-01T00:00:00Z',
          latestCommentAuthor: 'User',
          latestCommentAuthorType: 'user',
          latestCommentAt: '2026-01-01T00:00:00Z',
          commentCount: 1,
        },
      ],
      totalThreads: 1,
      totalComments: 1,
    });

    const comments = await new LiveCommentsClient().list('note-1');
    expect(comments).toHaveLength(1);
    expect(comments[0].threadId).toBe('t-1');
  });
});

// Typed per-note comment channel (PROTOCOL §6.9, monorepo#1697): `subscribe`
// registers `comment.subscribe { workspaceId, noteId }` — statically when the
// caller pins the workspace, resolver-backed otherwise — as the sole data
// path; its snapshot/delta `subscription.push` frames reconcile directly.
// When no workspace claims the note, the channel simply never registers.
describe('LiveCommentsClient.subscribe typed comment channel (PROTOCOL §6.9)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const requestsFor = (method: string) =>
    mockedRequest.mock.calls.filter((c) => c[0] === method).map((c) => c[1]);

  // CommentWire rows are nested inside the thread summaries carried by §6.9.
  const wireComment = (id: string, content: string) => ({
    id,
    threadId: id,
    noteId: 'note-1',
    type: 'comment',
    content,
    author: 'User',
    authorType: 'user',
    status: 'open',
    anchor: { type: 'range', startId: `${id}:start`, endId: `${id}:end` },
    anchorText: content,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  const wireThread = (threadId: string, comments: Array<Record<string, unknown>>) => ({
    threadId,
    noteId: 'note-1',
    targetedText: null,
    anchorId: null,
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    lastActivity: '2026-01-01T00:00:00Z',
    latestCommentAuthor: comments.at(-1)?.author ?? '',
    latestCommentAuthorType: comments.at(-1)?.authorType ?? 'user',
    latestCommentAt: '2026-01-01T00:00:00Z',
    commentCount: comments.length,
    comments,
  });

  const pushSnapshot = (subscriptionId: string, seq: number, snapshot: unknown[]) =>
    notifyHandler?.({
      method: 'subscription.push',
      params: { subscriptionId, kind: 'snapshot', seq, snapshot },
    });
  const pushDelta = (subscriptionId: string, seq: number, delta: Record<string, unknown>) =>
    notifyHandler?.({
      method: 'subscription.push',
      params: { subscriptionId, kind: 'delta', seq, delta },
    });

  let chanSeq = 0;

  beforeEach(() => {
    chanSeq = 0;
    mockedResolve.mockResolvedValue('ws-1');
    mockedRequest.mockImplementation((method: string) => {
      if (method === 'comment.subscribe') {
        chanSeq += 1;
        return Promise.resolve({ subscriptionId: `chan-${chanSeq}` });
      }
      if (method === 'comment.unsubscribe') return Promise.resolve({ success: true });
      return Promise.resolve({ threads: [] });
    });
  });

  afterEach(() => {
    notifyHandler = null;
    reconnectHandler = null;
    mockedRequest.mockReset();
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue('ws-1');
  });

  it('replaces canonical attribution from complete thread deltas while retaining untouched threads', async () => {
    const handler = vi.fn();
    const unsubscribe = new LiveCommentsClient().subscribe('note-1', handler, 'ws-A');
    try {
      await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
      await flush();
      const identity = { provider: 'github', host: 'github.com', externalUserId: '42' };
      const creator = {
        ...wireComment('c', 'body'),
        authorPrincipalId: 'creator',
        authorIdentity: identity,
      };
      const untouched = wireComment('other', 'other thread');
      pushSnapshot('chan-1', 0, [wireThread('c', [creator]), wireThread('other', [untouched])]);
      const initial = handler.mock.calls.at(-1)?.[0];
      expect(initial).toHaveLength(2);
      expect(initial[0]).toMatchObject({
        authorPrincipalId: 'creator',
        authorIdentity: identity,
        workspaceId: 'ws-A',
      });
      const changed = {
        ...creator,
        author: 'canonical',
        authorPrincipalId: 'canonical-id',
        authorIdentity: { ...identity, externalUserId: '84' },
      };
      pushDelta('chan-1', 1, { updated: [wireThread('c', [changed])] });
      const updated = handler.mock.calls.at(-1)?.[0];
      expect(updated[0]).toMatchObject({
        author: 'canonical',
        authorPrincipalId: 'canonical-id',
        authorIdentity: changed.authorIdentity,
        content: creator.content,
        updatedAt: creator.updatedAt,
      });
      expect(updated[1]).toEqual(initial[1]);
      pushDelta('chan-1', 2, {
        updated: [wireThread('c', [{ ...wireComment('c', 'body'), author: 'legacy' }])],
      });
      const cleared = handler.mock.calls.at(-1)?.[0];
      expect(cleared[0].author).toBe('legacy');
      expect(cleared[0]).not.toHaveProperty('authorIdentity');
      expect(cleared[0]).not.toHaveProperty('authorPrincipalId');
      expect(cleared[1]).toEqual(initial[1]);
    } finally {
      unsubscribe();
    }
  });

  it('replaces whole threads, removes absent replies, and applies thread-keyed removals and snapshots', async () => {
    const handler = vi.fn();
    const unsubscribe = new LiveCommentsClient().subscribe('note-1', handler, 'ws-A');
    try {
      await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
      await flush();
      const root = { ...wireComment('root', 'root'), threadId: 'thread-1' };
      const reply = {
        ...wireComment('reply', 'reply'),
        threadId: 'thread-1',
        parentId: 'root',
        anchor: undefined,
        noteId: undefined,
      };
      pushSnapshot('chan-1', 0, [
        wireThread('thread-1', [root, reply]),
        wireThread('other', [wireComment('other', 'other')]),
      ]);
      expect(handler.mock.calls.at(-1)?.[0].map((c: { id: string }) => c.id)).toEqual([
        'root',
        'reply',
        'other',
      ]);
      expect(handler.mock.calls.at(-1)?.[0][1]).not.toHaveProperty('anchor');
      expect(handler.mock.calls.at(-1)?.[0][1]).toMatchObject({
        threadId: 'thread-1',
        noteId: 'note-1',
        parentId: 'root',
      });
      pushDelta('chan-1', 1, { updated: [wireThread('thread-1', [root])] });
      expect(handler.mock.calls.at(-1)?.[0].map((c: { id: string }) => c.id)).toEqual([
        'root',
        'other',
      ]);
      // Generic §6.9 removal keys identify the thread, not a nested reply.
      // The retained comment_delta producer currently emits updated threads only.
      pushDelta('chan-1', 2, { removedIds: ['thread-1'] });
      expect(handler.mock.calls.at(-1)?.[0].map((c: { id: string }) => c.id)).toEqual(['other']);
      pushSnapshot('chan-1', 3, [
        wireThread('fresh', [wireComment('fresh', 'replacement snapshot')]),
      ]);
      expect(handler.mock.calls.at(-1)?.[0].map((c: { id: string }) => c.id)).toEqual(['fresh']);
      pushDelta('chan-1', 4, { updated: [wireThread('fresh', [])] });
      expect(handler.mock.calls.at(-1)?.[0]).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('keeps foreign subscriptions and mismatched note/thread payloads out of the scoped collection', async () => {
    const handler = vi.fn();
    const unsubscribe = new LiveCommentsClient().subscribe('note-1', handler, 'ws-A');
    try {
      await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
      await flush();
      pushSnapshot('chan-1', 0, [wireThread('c', [wireComment('c', 'admitted')])]);
      expect(handler.mock.calls.at(-1)?.[0]).toHaveLength(1);
      const before = handler.mock.calls.length;
      pushSnapshot('foreign-channel', 0, [
        wireThread('secret', [wireComment('secret', 'foreign')]),
      ]);
      expect(handler).toHaveBeenCalledTimes(before);
      pushDelta('chan-1', 1, {
        updated: [
          {
            ...wireThread('foreign-note', [wireComment('foreign-note', 'foreign')]),
            noteId: 'other-note',
          },
          wireThread('bad-nested', [
            { ...wireComment('bad-nested', 'foreign'), noteId: 'other-note' },
          ]),
          wireThread('wrong-thread', [wireComment('wrong-parent', 'wrong thread')]),
        ],
      });
      expect(handler.mock.calls.at(-1)?.[0].map((c: { id: string }) => c.id)).toEqual(['c']);
      expect(handler.mock.calls.at(-1)?.[0][0]).toMatchObject({
        noteId: 'note-1',
        workspaceId: 'ws-A',
      });
    } finally {
      unsubscribe();
    }
  });

  it('ignores late frames after disposal of a populated thread subscription', async () => {
    const handler = vi.fn();
    const unsubscribe = new LiveCommentsClient().subscribe('note-1', handler, 'ws-A');
    await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
    await flush();
    pushSnapshot('chan-1', 0, [wireThread('c', [wireComment('c', 'admitted')])]);
    expect(handler.mock.calls.at(-1)?.[0]).toHaveLength(1);
    const retainedListener = notifyHandler;
    unsubscribe();
    const count = handler.mock.calls.length;
    retainedListener?.({
      method: 'subscription.push',
      params: {
        subscriptionId: 'chan-1',
        kind: 'delta',
        seq: 1,
        delta: { updated: [wireThread('c', [wireComment('c', 'late')])] },
      },
    });
    expect(handler).toHaveBeenCalledTimes(count);
    expect(requestsFor('comment.unsubscribe')).toEqual([
      { subscriptionId: 'chan-1', workspaceId: 'ws-A' },
    ]);
  });

  it('drops a held subscribe acknowledgement after disposal and releases its server lease', async () => {
    let acknowledge!: (value: { subscriptionId: string }) => void;
    mockedRequest.mockImplementation((method: string) =>
      method === 'comment.subscribe'
        ? new Promise((resolve) => {
            acknowledge = resolve;
          })
        : Promise.resolve({ success: true }),
    );
    const handler = vi.fn();
    const unsubscribe = new LiveCommentsClient().subscribe('note-1', handler, 'ws-A');
    await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
    pushSnapshot('held', 0, [wireThread('c', [wireComment('c', 'buffered')])]);
    unsubscribe();
    acknowledge({ subscriptionId: 'held' });
    await vi.waitFor(() =>
      expect(requestsFor('comment.unsubscribe')).toEqual([
        { subscriptionId: 'held', workspaceId: 'ws-A' },
      ]),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('registers comment.subscribe with { workspaceId, noteId } when the caller supplies workspaceId', async () => {
    const client = new LiveCommentsClient();
    const unsubscribe = client.subscribe('note-1', () => {}, 'ws-A');

    await vi.waitFor(() => {
      expect(requestsFor('comment.subscribe')).toEqual([{ workspaceId: 'ws-A', noteId: 'note-1' }]);
    });
    expect(mockedResolve).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('resolves the workspace like fetchComments when workspaceId is omitted', async () => {
    const handler = vi.fn();
    const client = new LiveCommentsClient();
    const unsubscribe = client.subscribe('note-1', handler);

    await vi.waitFor(() => {
      expect(requestsFor('comment.subscribe')).toEqual([{ workspaceId: 'ws-1', noteId: 'note-1' }]);
    });
    expect(mockedResolve).toHaveBeenCalledWith('note-1');

    // The push-path normalizer stamps the resolver-provided workspace id.
    await flush();
    pushSnapshot('chan-1', 0, [wireThread('c-1', [wireComment('c-1', 'hello')])]);
    const last = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ id: 'c-1', workspaceId: 'ws-1', noteId: 'note-1' });
    unsubscribe();
  });

  it('never registers the channel when the workspace is unresolvable', async () => {
    mockedResolve.mockResolvedValue(null);
    const handler = vi.fn();
    const client = new LiveCommentsClient();
    const unsubscribe = client.subscribe('ghost', handler);

    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(requestsFor('comment.subscribe')).toEqual([]);
    unsubscribe();
  });

  it('reconciles the seq-0 snapshot and comment:added deltas', async () => {
    const handler = vi.fn();
    const client = new LiveCommentsClient();
    const unsubscribe = client.subscribe('note-1', handler, 'ws-A');
    await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
    await flush();

    pushSnapshot('chan-1', 0, [wireThread('c-1', [wireComment('c-1', 'hello')])]);
    const snapshotted = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(snapshotted).toHaveLength(1);
    expect(snapshotted[0]).toMatchObject({
      id: 'c-1',
      threadId: 'c-1',
      noteId: 'note-1',
      workspaceId: 'ws-A',
      type: 'comment',
      content: 'hello',
      status: 'open',
    });

    pushDelta('chan-1', 1, { updated: [wireThread('c-2', [wireComment('c-2', 'second')])] });
    const afterDelta = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(afterDelta.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    unsubscribe();
  });

  it('resnapshots a sequence gap without dropping accepted threads or accepting stale frames', async () => {
    const handler = vi.fn();
    const unsubscribe = new LiveCommentsClient().subscribe('note-1', handler, 'ws-A');
    try {
      await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
      await flush();
      pushSnapshot('chan-1', 0, [wireThread('c', [wireComment('c', 'accepted')])]);
      const accepted = handler.mock.calls.at(-1)?.[0];
      expect(accepted).toHaveLength(1);
      const count = handler.mock.calls.length;
      pushDelta('chan-1', 2, { updated: [wireThread('c', [wireComment('c', 'gap')])] });
      await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(2));
      await flush();
      expect(handler).toHaveBeenCalledTimes(count);
      pushSnapshot('chan-1', 3, [wireThread('c', [wireComment('c', 'obsolete')])]);
      expect(handler).toHaveBeenCalledTimes(count);
      pushSnapshot('chan-2', 0, [wireThread('fresh', [wireComment('fresh', 'resnapshot')])]);
      expect(handler.mock.calls.at(-1)?.[0].map((c: { id: string }) => c.id)).toEqual(['fresh']);
      expect(requestsFor('comment.subscribe')[1]).toEqual({
        workspaceId: 'ws-A',
        noteId: 'note-1',
      });
    } finally {
      unsubscribe();
    }
  });

  it('sends comment.unsubscribe with the subscriptionId on dispose', async () => {
    const client = new LiveCommentsClient();
    const unsubscribe = client.subscribe('note-1', () => {}, 'ws-A');
    await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
    await flush();

    unsubscribe();
    expect(requestsFor('comment.unsubscribe')).toEqual([
      { subscriptionId: 'chan-1', workspaceId: 'ws-A' },
    ]);
  });

  it('sends comment.unsubscribe on dispose for the resolver-backed registration too', async () => {
    const client = new LiveCommentsClient();
    const unsubscribe = client.subscribe('note-1', () => {});
    await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
    await flush();

    unsubscribe();
    expect(requestsFor('comment.unsubscribe')).toEqual([
      { subscriptionId: 'chan-1', workspaceId: 'ws-1' },
    ]);
  });

  it('re-registers the channel with the same params after reconnect', async () => {
    const handler = vi.fn();
    const client = new LiveCommentsClient();
    const unsubscribe = client.subscribe('note-1', handler, 'ws-A');
    await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(1));
    await flush();
    pushSnapshot('chan-1', 0, [wireThread('c-1', [wireComment('c-1', 'hello')])]);

    reconnectHandler?.();
    await vi.waitFor(() => expect(requestsFor('comment.subscribe')).toHaveLength(2));
    await flush();
    // The restarted daemon dropped its registry: no unsubscribe frame for the
    // dead id, one fresh registration with the identical scope params.
    expect(requestsFor('comment.unsubscribe')).toEqual([]);
    expect(requestsFor('comment.subscribe')[1]).toEqual({
      workspaceId: 'ws-A',
      noteId: 'note-1',
    });

    const beforeOldFrame = handler.mock.calls.length;
    pushSnapshot('chan-1', 1, [wireThread('old', [wireComment('old', 'stale')])]);
    expect(handler).toHaveBeenCalledTimes(beforeOldFrame);

    // The recovery seq-0 snapshot re-populates the collection.
    pushSnapshot('chan-2', 0, [
      wireThread('c-1', [wireComment('c-1', 'hello')]),
      wireThread('c-2', [wireComment('c-2', 'second')]),
    ]);
    const recovered = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(recovered.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    unsubscribe();
  });
});

describe('qualified comment wire projections', () => {
  afterEach(() => vi.clearAllMocks());
  const identity = { provider: 'github', host: 'github.com', externalUserId: '42' };
  it('never forwards output creator fields through live add or respond', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveCommentsClient();
    const extras = { authorPrincipalId: 'not-authority', authorIdentity: identity };
    const add = {
      workspaceId: 'ws-1',
      searchContext: 'context',
      commentTarget: 'context',
      comment: 'body',
      ...extras,
    };
    const reply = { workspaceId: 'ws-1', commentId: 'parent', comment: 'reply', ...extras };
    await client.add('note-1', add);
    await client.respond('note-1', reply);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    for (const [, params] of mockedRequest.mock.calls) {
      expect(params).not.toHaveProperty('authorPrincipalId');
      expect(params).not.toHaveProperty('authorIdentity');
    }
  });
  it('keeps safe output fields and omits invalid identities without borrowing a label identity', async () => {
    const rows = [
      {
        id: 'local',
        author: 'same',
        authorType: 'user',
        authorPrincipalId: 'creator',
        authorIdentity: { ...identity, credential: 'not-a-display-field' },
      },
      {
        id: 'imported',
        author: 'same',
        authorType: 'user',
        authorPrincipalId: null,
        authorIdentity: { ...identity, provider: 'gitlab', host: 'gitlab.example' },
      },
      ...[
        null,
        { ...identity, provider: 'future' },
        { ...identity, host: 'https://github.com' },
        { ...identity, externalUserId: ' ' },
      ].map((authorIdentity, n) => ({
        id: `unknown-${n}`,
        author: 'same',
        authorType: 'user',
        authorIdentity,
      })),
      {
        id: 'agent',
        author: 'agent',
        authorType: 'agent',
        authorPrincipalId: 'spoof',
        authorIdentity: identity,
      },
    ];
    mockedRequest.mockResolvedValueOnce({ threads: [{ comments: rows }] });
    const result = await new LiveCommentsClient().list('note-1', 'ws-1');
    expect(result[0]).toMatchObject({ authorPrincipalId: 'creator', authorIdentity: identity });
    expect(result[0].authorIdentity).toEqual(identity);
    expect(result[1]).toMatchObject({
      authorIdentity: { ...identity, provider: 'gitlab', host: 'gitlab.example' },
    });
    expect(result[1]).not.toHaveProperty('authorPrincipalId');
    for (const row of result.slice(2)) expect(row).not.toHaveProperty('authorIdentity');
    expect(result.at(-1)).not.toHaveProperty('authorPrincipalId');
  });
  it('maps summary attribution from exactly the selected latest comment', async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: 't',
          latestCommentAuthor: 'latest',
          latestCommentAuthorType: 'user',
          latestCommentAuthorIdentity: identity,
          authorPrincipalId: 'root-must-not-win',
        },
        {
          threadId: 'u',
          latestCommentAuthor: 'unknown',
          latestCommentAuthorType: 'user',
          authorIdentity: identity,
        },
      ],
    });
    const result = await new LiveCommentsClient().list('note-1', 'ws-1');
    expect(result[0]).toMatchObject({
      author: 'latest',
      authorType: 'user',
      authorIdentity: identity,
    });
    expect(result[0]).not.toHaveProperty('authorPrincipalId');
    expect(result[1]).toMatchObject({ author: 'unknown' });
    expect(result[1]).not.toHaveProperty('authorIdentity');
  });
});
