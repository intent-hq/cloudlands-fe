import { expect, it, vi } from 'vitest';
import {
  streamNoteSource,
  noteSourceFitsByteLimit,
  type NoteSourceSnapshot,
} from './note-source-stream';
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

it.each(['a'.repeat(200000), '漢'.repeat(100000), '漢'.repeat(100001), '😀'.repeat(75000) + 'a'])(
  'measures ambiguous sizes with bounded revision-pinned Unicode pages',
  async (source) => {
    const pinned = { ...snapshot, sourceLength: source.length };
    let total = 0;
    const read = vi.fn(
      async (request: import('$lib/client/note-pages').NotePageRequest): Promise<NoteReadPage> => {
        const at = request.at ?? 0;
        let text = '',
          bytes = 0;
        for (const scalar of source.slice(at)) {
          const size = new TextEncoder().encode(scalar).length;
          if (bytes + size > (request.maxSourceBytes ?? 0)) break;
          text += scalar;
          bytes += size;
        }
        total += bytes;
        return { ...page(text, at, at + text.length < source.length ? 'next' : null), ...pinned };
      },
    );
    expect(await noteSourceFitsByteLimit(pinned, read, () => true, 300000)).toBe(
      new TextEncoder().encode(source).length <= 300000,
    );
    expect(total).toBeLessThanOrEqual(300004);
    expect(
      read.mock.calls.every(
        ([request]) =>
          request.sourceRevision === pinned.sourceRevision &&
          request.snapshotId === pinned.snapshotId &&
          request.maxSourceBytes! <= 4096,
      ),
    ).toBe(true);
  },
);
it('rejects changed revisions and revoked size reads', async () => {
  await expect(
    noteSourceFitsByteLimit(
      snapshot,
      async () => ({ ...page('abcdefg', 0, null), sourceRevision: 'other' }),
      () => true,
      300000,
    ),
  ).rejects.toThrow();
  const read = vi.fn();
  await expect(noteSourceFitsByteLimit(snapshot, read, () => false, 300000)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
