import { expect, it, vi } from 'vitest';
import { streamNoteSource, type NoteSourceSnapshot } from './note-source-stream';
import type { NoteReadPage } from '$lib/client/note-pages';
const snapshot: NoteSourceSnapshot = {
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: '7',
  snapshotId: 's',
  sourceLength: 7,
  expiresAt: '2099-01-01T00:00:00Z',
};
const page = (text: string, start: number, nextCursor: string | null): NoteReadPage => ({
  ...snapshot,
  kind: 'noteSourcePage',
  text,
  range: { start, end: start + text.length },
  nextCursor,
  previousCursor: null,
  contextRef: 'c',
  metadataRef: 'm',
});
const sink = () => ({
  write: vi.fn(async (_text: string) => {}),
  commit: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
});
it('streams the exact pinned complete source with bounded requests', async () => {
  const target = sink(),
    read = vi
      .fn()
      .mockResolvedValueOnce(page('漢\n', 0, 'next'))
      .mockResolvedValueOnce(page('tail ', 2, null));
  await streamNoteSource(snapshot, read, target, () => true);
  expect(read.mock.calls[0][0]).toMatchObject({
    kind: 'source',
    maxSourceBytes: 4096,
    sourceRevision: '7',
    snapshotId: 's',
  });
  expect(read.mock.calls[1][0]).toEqual({
    kind: 'source',
    maxWireBytes: 8192,
    maxSourceBytes: 4096,
    cursor: 'next',
  });
  expect(target.write.mock.calls.map((c) => c[0]).join('')).toBe('漢\ntail ');
  expect(target.commit).toHaveBeenCalledOnce();
  expect(target.abort).not.toHaveBeenCalled();
});
it.each(['revision', 'length', 'gap', 'eof'])(
  'refuses publication on %s mismatch',
  async (kind) => {
    const target = sink();
    const bad = page('漢\n', kind === 'gap' ? 1 : 0, kind === 'eof' ? null : 'next');
    if (kind === 'revision') bad.sourceRevision = '8';
    if (kind === 'length' && bad.kind === 'noteSourcePage') bad.sourceLength = 8;
    await expect(
      streamNoteSource(
        snapshot,
        async () => bad,
        target,
        () => true,
      ),
    ).rejects.toThrow();
    expect(target.commit).not.toHaveBeenCalled();
    expect(target.abort).not.toHaveBeenCalled();
  },
);
it('revokes after a pending read without publishing or another request', async () => {
  const target = sink();
  let current = true;
  const read = vi.fn(async () => {
    current = false;
    return page('漢\n', 0, 'next');
  });
  await expect(streamNoteSource(snapshot, read, target, () => current)).rejects.toThrow();
  expect(read).toHaveBeenCalledOnce();
  expect(target.write).not.toHaveBeenCalled();
  expect(target.abort).not.toHaveBeenCalled();
});
