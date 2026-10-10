import { expect, it, vi } from 'vitest';
import { NotePageReader } from './note-page-reader';
import { readNoteTaskLinks } from './note-task-links';
const scope = { backendId: 'db', workspaceId: 'ws', noteId: 'spec', noteInstanceId: 'inc' };
const identity = {
  scope,
  sourceRevision: 'r1',
  snapshotId: 's1',
  expiresAt: '2099-01-01T00:00:00Z',
};
const hello = { server: { capabilities: { notePagingRead: 1, notePagingBackendId: 'db' } } };
const taskPage = {
  kind: 'noteTaskIdsPage',
  ...identity,
  totalItems: 2,
  startIndex: 0,
  items: [{ index: 0, taskNoteIdLength: 1, sourceRange: { start: 10, end: 11 }, taskNoteId: 'b' }],
  nextCursor: 'next',
};
it('uses actual reader for ordered pages and fragmented IDs without requesting source', async () => {
  const long = 'é'.repeat(130);
  const rpc = vi
    .fn()
    .mockResolvedValueOnce(hello)
    .mockResolvedValueOnce(taskPage)
    .mockResolvedValueOnce({
      ...taskPage,
      startIndex: 1,
      items: [
        {
          index: 1,
          sourceRange: { start: 50, end: 180 },
          taskNoteIdLength: 130,
          taskNoteIdRef: 'long',
        },
      ],
      nextCursor: null,
    })
    .mockResolvedValueOnce({
      kind: 'noteContextPage',
      ...identity,
      items: [
        {
          kind: 'fragment',
          id: 'long',
          field: 'taskNoteId',
          offset: 0,
          text: long.slice(0, 100),
          nextRef: 'rest',
        },
      ],
      nextCursor: null,
    })
    .mockResolvedValueOnce({
      kind: 'noteContextPage',
      ...identity,
      items: [
        {
          kind: 'fragment',
          id: 'long',
          field: 'taskNoteId',
          offset: 100,
          text: long.slice(100),
          nextRef: null,
        },
      ],
      nextCursor: null,
    });
  expect(await readNoteTaskLinks(new NotePageReader(rpc), 'ws', 'spec')).toEqual(['b', long]);
  expect(rpc.mock.calls.slice(1).map(([, p]) => p.page.kind)).toEqual([
    'taskIds',
    'taskIds',
    'context',
    'context',
  ]);
});
it.each([
  { ...taskPage, snapshotId: 'other' },
  { ...taskPage, items: [], nextCursor: 'next' },
  {
    ...taskPage,
    items: [
      { index: 1, taskNoteIdLength: 1, sourceRange: { start: 20, end: 21 }, taskNoteId: 'b' },
    ],
    nextCursor: null,
  },
  {
    ...taskPage,
    items: [
      { index: 3, taskNoteIdLength: 1, sourceRange: { start: 20, end: 21 }, taskNoteId: 'a' },
    ],
    nextCursor: null,
  },
])('rejects mixed snapshots, repeated cursors, duplicates or gaps atomically', async (bad) => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce(hello)
    .mockResolvedValueOnce(taskPage)
    .mockResolvedValueOnce(bad);
  await expect(readNoteTaskLinks(new NotePageReader(rpc), 'ws', 'spec')).rejects.toThrow();
});
it('returns explicit legacy only for absent capability; transport errors propagate', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ server: { capabilities: {} } })
    .mockRejectedValueOnce(new Error('offline'));
  expect(await readNoteTaskLinks(new NotePageReader(rpc), 'ws', 'spec')).toBeNull();
  await expect(readNoteTaskLinks(new NotePageReader(rpc), 'ws', 'spec')).rejects.toThrow('offline');
  expect(rpc).toHaveBeenCalledTimes(2);
});

import vectors from './mock/fixtures/note-pages-contract.json';
import { extractOrderedSpecTaskIds } from '$shared/utils/task-stats';
it('consumes approved ordered-link vectors through the production reader and matches legacy order', async () => {
  const v = vectors.orderedTaskIds;
  const rpc = vi.fn().mockResolvedValueOnce({
    server: { capabilities: { notePagingRead: 1, notePagingBackendId: 'db-a' } },
  });
  for (const frame of [...v.pages, ...v.longIdFragments]) rpc.mockResolvedValueOnce(frame.result);
  expect(await readNoteTaskLinks(new NotePageReader(rpc), 'ws-a', 'spec')).toEqual(v.expected);
  expect(extractOrderedSpecTaskIds(v.source)).toEqual(v.expected);
});
