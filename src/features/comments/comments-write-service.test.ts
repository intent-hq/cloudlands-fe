import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentV2 } from './comment-types-v2';

const dispatch = vi.hoisted(() => vi.fn());

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch });
});

import { addComment, deleteComment, respondToComment } from './comments-write-service';

const optimistic = { id: 'comment-1', noteId: 'note-1' } as CommentV2;

describe('comments write compatibility façade', () => {
  beforeEach(() => dispatch.mockReset());

  it('returns the correlated add outcome', async () => {
    dispatch.mockImplementation((action) => action?.success?.(true));
    const params = { workspaceId: 'ws-1', comment: 'body' };
    await expect(addComment('note-1', optimistic, params)).resolves.toBe(true);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      asyncActionType: 'workspaceNotes/addCommentRequested',
      payload: ['note-1', optimistic, params],
    });
  });

  it('returns the correlated reply and delete outcomes', async () => {
    dispatch.mockImplementation((action) => {
      if (!action) return action;
      const result = action.asyncActionType.endsWith('deleteCommentRequested')
        ? { existed: true, success: true }
        : true;
      return action.success(result);
    });
    await expect(
      respondToComment('note-1', optimistic, { commentId: 'root', comment: 'body' }),
    ).resolves.toBe(true);
    await expect(deleteComment('note-1', 'comment-1', 'ws-1')).resolves.toEqual({
      existed: true,
      success: true,
    });
    expect(dispatch.mock.calls.map(([action]) => action.asyncActionType)).toEqual([
      'workspaceNotes/respondToCommentRequested',
      'workspaceNotes/deleteCommentRequested',
    ]);
  });
});
