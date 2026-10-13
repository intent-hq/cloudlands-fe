import { expect, it, vi } from 'vitest';
import fixture from './fixtures/rendered-hit-detail.contract.json';
import { consumeNoteRenderedSearch } from './note-rendered-search-results';
import type { NoteRenderedSearchCapture } from './note-rendered-search-capture';

// Unchanged docs16929 contract resources test only the bounded decoder. This
// controlled expected shape is not a branded native owner or backend/auth proof.
const capture = {
  rendered: { text: 'Straße😀' },
  sourceRange: { start: 12, end: 20 },
  inline: { sourceRange: { start: 12, end: 20 } },
  paragraph: { sourceRange: { start: 12, end: 20 } },
} as NoteRenderedSearchCapture;
const descriptors = {
  parent: fixture.expected.parent.descriptor,
  leaf: fixture.expected.leaf.descriptor,
};
function replay(mutate?: (result: any) => void) {
  return vi.fn(async (q: { kind: 'search' | 'detail'; ref?: string; cursor?: string }) => {
    if (q.kind === 'search')
      return {
        items: [{ hitId: 'h', sourceRange: { start: 12, end: 18 }, detailRef: fixture.rootRef }],
        nextCursor: null,
        scannedThrough: 50,
        count: { value: 1, exact: true },
      };
    const original = fixture.exchanges.find(
      (x) =>
        x.request.params.ref === q.ref &&
        (x.request.params as { cursor?: string }).cursor === q.cursor,
    );
    if (!original) throw new Error('Unknown contract ref/cursor');
    const result = structuredClone(original.response.result);
    mutate?.(result);
    return result;
  });
}
it('accepts unchanged published metadata and six-field scalar fragments through nextRef', async () => {
  const read = replay(),
    publish = vi.fn(async () => {});
  await consumeNoteRenderedSearch(capture, descriptors, 50, read, () => {}, publish);
  expect(read).toHaveBeenCalledTimes(23);
  expect(publish).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      hits: [
        { hitId: 'h', sourceRange: { start: 12, end: 18 }, renderedRange: { start: 0, end: 6 } },
      ],
    }),
  );
});
for (const fault of ['missing kind', 'changed id', 'surrogate split', 'inline wholeleaf'])
  it('rejects ' + fault + ' in published detail successor', async () => {
    const publish = vi.fn(async () => {});
    const read = replay((p) => {
      for (const x of p.items) {
        if (fault === 'missing kind' && x.field === 'renderedText') delete x.kind;
        if (fault === 'changed id' && x.field === 'renderedText' && x.offset > 0) x.id = 'another';
        if (fault === 'surrogate split' && x.field === 'renderedText' && x.offset === 6)
          x.text = '\ud83d';
        if (fault === 'inline wholeleaf' && x.key === 'renderedText' && x.type === 'string') {
          delete x.valueRef;
          x.value = 'Straße😀';
        }
      }
    });
    await expect(
      consumeNoteRenderedSearch(capture, descriptors, 50, read, () => {}, publish),
    ).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });
it('rejects repeated original spans under different IDs across pages', async () => {
  const base = replay(),
    publish = vi.fn(async () => {});
  const read = vi.fn(async (q: Parameters<ReturnType<typeof replay>>[0]) => {
    if (q.kind === 'detail') return base(q);
    return {
      items: [
        {
          hitId: q.cursor ? 'h2' : 'h1',
          sourceRange: { start: 12, end: 18 },
          detailRef: fixture.rootRef,
        },
      ],
      nextCursor: q.cursor ? null : 'next',
      scannedThrough: 50,
      count: { value: q.cursor ? 2 : 1, exact: !!q.cursor },
    };
  });
  await expect(
    consumeNoteRenderedSearch(capture, descriptors, 50, read, () => {}, publish),
  ).rejects.toThrow('Invalid rendered search hit');
  expect(publish).toHaveBeenCalledOnce();
});
