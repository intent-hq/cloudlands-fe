import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn() },
}));

import { appClient } from '$lib/client';
import type { CommentV2 } from '$features/comments/comment-types-v2';
import { commentsClient } from '$features/comments/comments.client';
import {
  addCommentAction,
  addCommentRequested,
  commentsReducer,
  removeCommentAction,
  respondToCommentRequested,
  resolveCommentRequested,
  updateCommentAction,
} from '../comments-slice';
import { commentsWriteSaga } from './comments-write-saga';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function comment(id: string, overrides: Partial<CommentV2> = {}): CommentV2 {
  return {
    id,
    threadId: `thread-${id}`,
    type: 'comment',
    content: 'body',
    author: 'User',
    authorType: 'user',
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    noteId: 'note-1',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

describe('commentsWriteSaga', () => {
  afterEach(() => vi.restoreAllMocks());

  it('optimistically adds a comment and settles the request after comment.add', async () => {
    const add = vi.spyOn(appClient.comments, 'add').mockResolvedValue({ success: true });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action), getState: () => ({ comments: {} }) },
      commentsWriteSaga,
    );
    const optimistic = comment('c-1');
    const request = addCommentRequested('note-1', optimistic, {
      searchContext: 'body',
      commentTarget: 'body',
      comment: 'new comment',
      authorType: 'user',
    });

    channel.put(request);
    await settle();

    expect(add).toHaveBeenCalledWith('note-1', {
      searchContext: 'body',
      commentTarget: 'body',
      comment: 'new comment',
      authorType: 'user',
    });
    expect(actions).toContainEqual(addCommentAction(optimistic));
    expect(actions).toContainEqual(request.success(true));
    task.cancel();
    await task.toPromise();
  });

  it('rolls back a failed reply without leaving the optimistic comment', async () => {
    const respond = vi
      .spyOn(appClient.comments, 'respond')
      .mockResolvedValue({ success: false, error: 'rejected' });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action), getState: () => ({ comments: {} }) },
      commentsWriteSaga,
    );
    const optimistic = comment('reply-1', { parentId: 'root-1', threadId: 'thread-root-1' });
    const request = respondToCommentRequested('note-1', optimistic, {
      commentId: 'root-1',
      comment: 'reply',
      authorType: 'user',
    });

    channel.put(request);
    await settle();

    expect(respond).toHaveBeenCalledWith('note-1', {
      commentId: 'root-1',
      comment: 'reply',
      authorType: 'user',
    });
    expect(actions).toContainEqual(removeCommentAction('reply-1'));
    expect(actions).toContainEqual(request.success(false));
    task.cancel();
    await task.toPromise();
  });

  it('rolls back resolution when the exact thread-status request fails', async () => {
    const updateStatus = vi
      .spyOn(commentsClient, 'updateStatus')
      .mockResolvedValue({ ok: false, error: 'rejected' });
    const existing = comment('c-resolve');
    const state = { comments: commentsReducer(undefined, addCommentAction(existing)) };
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action), getState: () => state },
      commentsWriteSaga,
    );
    const request = resolveCommentRequested('ws-1', existing.id, 'note-1');

    channel.put(request);
    await settle();

    expect(updateStatus).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      commentId: 'c-resolve',
      status: 'resolved',
    });
    expect(actions).toContainEqual(updateCommentAction(existing.id, { status: 'resolved' }));
    expect(actions).toContainEqual(updateCommentAction(existing.id, { status: 'open' }));
    expect(actions).toContainEqual(request.success(false));
    task.cancel();
    await task.toPromise();
  });

  it('rolls back a pending optimistic add when the saga tears down', async () => {
    const pending = deferred<{ success: boolean }>();
    vi.spyOn(appClient.comments, 'add').mockReturnValue(pending.promise);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action), getState: () => ({ comments: {} }) },
      commentsWriteSaga,
    );
    const optimistic = comment('c-cancel');
    const request = addCommentRequested('note-1', optimistic, {
      searchContext: 'body',
      commentTarget: 'body',
      comment: 'new comment',
    });
    void request.promise.catch(() => undefined);

    channel.put(request);
    await settle();
    task.cancel();
    await task.toPromise();

    expect(actions).toContainEqual(addCommentAction(optimistic));
    expect(actions).toContainEqual(removeCommentAction(optimistic.id));
    expect(
      actions.some((action) => (action as { type?: string }).type === request.failure.type),
    ).toBe(true);
    pending.resolve({ success: true });
  });
});
