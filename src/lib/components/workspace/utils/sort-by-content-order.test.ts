import { describe, expect, it } from 'vitest';
import type { Note } from '$shared/types';
import { sortByContentOrder } from './sort-by-content-order';

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

describe('sortByContentOrder', () => {
  it('prioritizes linked notes in content order without mutating the input', () => {
    const notes = [note('unlinked'), note('second'), note('first')];
    const content = '[First](intent://local/task/first) [Second](intent://local/task/second)';

    const sorted = sortByContentOrder(notes, content);

    expect(sorted.map(({ id }) => id)).toEqual(['first', 'second', 'unlinked']);
    expect(notes.map(({ id }) => id)).toEqual(['unlinked', 'second', 'first']);
    expect(sorted[0]).toBe(notes[2]);
  });

  it('falls back to peer order, then creation time, including legacy timestamps', () => {
    const notes = [
      note('higher-peer-order', { metadata: { task: { status: 'not_started', peerOrder: 1 } } }),
      note('newer'),
      note('legacy', { createdAt: '', created_at: '2026-05-04T00:00:00.000Z' }),
      note('oldest', { createdAt: '2026-05-03T00:00:00.000Z' }),
    ];

    expect(sortByContentOrder(notes, undefined).map(({ id }) => id)).toEqual([
      'oldest',
      'legacy',
      'newer',
      'higher-peer-order',
    ]);
  });
});
