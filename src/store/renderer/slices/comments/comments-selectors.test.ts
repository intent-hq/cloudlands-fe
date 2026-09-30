import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store';
import { clearCommentsAction, loadCommentsAction } from './comments-slice';
import { selectCommentsForNote } from './comments-selectors';
import type { CommentV2 } from '$features/comments/comment-types-v2';

const comment = (id: string, workspaceId?: string, noteId = 'spec'): CommentV2 => ({
  id,
  workspaceId,
  noteId,
  threadId: id,
  type: 'comment',
  content: id,
  author: 'Reviewer',
  authorType: 'user',
  status: 'open',
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
});

describe('comments belonging to a note', () => {
  beforeAll(() => store.init());
  beforeEach(() => store.dispatch(clearCommentsAction()));

  it('requires both workspace and note ownership, including replies', () => {
    store.dispatch(
      loadCommentsAction([
        comment('a', 'workspace-a'),
        { ...comment('reply', 'workspace-a'), parentId: 'a', threadId: 'a' },
        comment('b', 'workspace-b'),
        comment('task', 'workspace-a', 'task'),
        comment('unowned'),
      ]),
    );
    expect(
      selectCommentsForNote.select(store.state, 'workspace-a', 'spec').map((c) => c.id),
    ).toEqual(['a', 'reply']);
    expect(
      selectCommentsForNote.select(store.state, 'workspace-b', 'spec').map((c) => c.id),
    ).toEqual(['b']);
    expect(
      selectCommentsForNote.select(store.state, 'workspace-a', 'task').map((c) => c.id),
    ).toEqual(['task']);
    expect(selectCommentsForNote.select(store.state, '', 'spec')).toEqual([]);
    expect(selectCommentsForNote.select(store.state, 'workspace-a', '')).toEqual([]);
  });
});
