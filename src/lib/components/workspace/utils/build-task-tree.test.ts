import { describe, expect, it } from 'vitest';
import type { Note } from '$shared/types';
import { buildTaskTree } from './build-task-tree';

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id: id as Note['id'],
    workspaceId: 'ws-1' as Note['workspaceId'],
    title: id,
    content: '',
    contentType: 'markdown',
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: 'private',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  };
}

const task = (status: 'not_started' | 'in_progress' | 'cancelled' = 'not_started') => ({
  task: { status },
});

describe('buildTaskTree', () => {
  it('orders linked roots and nested children while computing leaf weights', () => {
    const notes = [
      note('spec', {
        isDefault: true,
        content: '[Second](intent://local/task/second) [First](intent://local/task/first)',
      }),
      note('first', {
        parentId: 'spec' as Note['id'],
        content: '[Child B](intent://local/task/child-b) [Child A](intent://local/task/child-a)',
        metadata: task(),
      }),
      note('second', { parentId: 'spec' as Note['id'], metadata: task('in_progress') }),
      note('child-a', { parentId: 'first' as Note['id'], metadata: task() }),
      note('child-b', { parentId: 'first' as Note['id'], metadata: task() }),
    ];

    const tree = buildTaskTree(notes);

    expect(tree.map(({ note: root }) => root.id)).toEqual(['second', 'first']);
    expect(tree[0]).toMatchObject({ weight: 1, isLeaf: true });
    expect(tree[1]).toMatchObject({ weight: 2, isLeaf: false });
    expect(tree[1].children.map(({ note: child }) => child.id)).toEqual(['child-b', 'child-a']);
  });

  it('excludes cancelled, duplicate, unlinked-root, and unrelated task notes', () => {
    const linked = note('linked', { parentId: 'spec' as Note['id'], metadata: task() });
    const tree = buildTaskTree([
      note('spec', {
        isDefault: true,
        content: '[Linked](intent://local/task/linked)',
      }),
      linked,
      { ...linked, title: 'duplicate' },
      note('cancelled', {
        parentId: 'linked' as Note['id'],
        metadata: task('cancelled'),
      }),
      note('unlinked-root', { parentId: 'spec' as Note['id'], metadata: task() }),
      note('unrelated', { parentId: 'elsewhere' as Note['id'], metadata: task() }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].note).toBe(linked);
    expect(tree[0]).toMatchObject({ children: [], weight: 1, isLeaf: true });
  });
});
