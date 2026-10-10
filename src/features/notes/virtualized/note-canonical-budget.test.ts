import { expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { readNoteWindow } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';

// Controlled policy boundary, not captured daemon output. Omitted source has no
// rendered text; paginated native attributes consume retained canonical bytes.
function provider(padding: number, continued = false) {
  const identity = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const owner = {
    kind: 'boundary',
    id: 'owner',
    construct: 'markdownDocument',
    profile: 'canonicalNote',
    profileVersion: 1,
    entryPath: 'markdown',
    sourceRange: { start: 0, end: 2 },
    nativeRef: 'root',
    attributesRef: 'attrs',
  };
  const seen: NotePageRequest[] = [];
  let range = { start: 0, end: 2 };
  const context = (items: unknown[]) => ({
    ...identity,
    kind: 'noteContextPage',
    items,
    nextCursor: null,
  });
  const reader = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    seen.push(q);
    if (q.kind === 'source') {
      const start = q.cursor === 'tail' ? 1 : 0;
      range = { start, end: continued ? start + 1 : Math.min(2, q.maxSourceBytes!) };
      return {
        ...identity,
        kind: 'noteSourcePage',
        sourceLength: 2,
        range,
        text: '  '.slice(range.start, range.end),
        contextRef: `window-${start}`,
        metadataRef: 'unused',
        previousCursor: start ? 'previous' : null,
        nextCursor: range.end < 2 ? 'tail' : null,
      };
    }
    if (q.kind === 'metadata') {
      const index = Number(q.cursor ?? 0);
      const length = Math.floor(padding / 5) + (index < padding % 5 ? 1 : 0);
      return {
        ...identity,
        kind: 'noteMetadataPage',
        items:
          q.ref === 'attrs'
            ? [{ id: 'attrs', parentId: null, type: 'object', childrenRef: 'values' }]
            : [
                {
                  id: `value-${index}`,
                  parentId: 'attrs',
                  key: `property-${index}`,
                  type: 'string',
                  value: 'x'.repeat(length),
                },
              ],
        nextCursor: q.ref === 'values' && index < 4 ? String(index + 1) : null,
      };
    }
    if (q.kind !== 'context') throw new Error('Unexpected request');
    if (q.contextRef.startsWith('window-'))
      return context([
        {
          ...owner,
          sourceMapRef: `maps-${range.start}`,
          continuationBefore: range.start > 0,
          continuationAfter: range.end < 2,
        },
      ]);
    if (q.contextRef === 'owner') return context([owner]);
    if (q.contextRef === 'root')
      return context([
        {
          kind: 'nativeNode',
          id: 'doc',
          profile: 'canonicalNote',
          profileVersion: 1,
          nodeType: 'doc',
          nodeClass: 'container',
          parentRef: null,
          childIndex: 0,
          sourceRange: { start: 0, end: 0 },
          provenance: 'implicit',
          attributesRef: 'attrs',
        },
      ]);
    if (q.contextRef.startsWith('maps-'))
      return context([
        {
          kind: 'sourceMap',
          id: `map-${range.start}`,
          profile: 'canonicalNote',
          profileVersion: 1,
          ownerRef: 'owner',
          sourceRange: range,
          renderedRange: { start: 0, end: 0 },
          mapping: 'omitted',
          textRef: null,
          textNodeRef: null,
          textNodeId: null,
        },
      ]);
    throw new Error('Unexpected reference ' + q.contextRef);
  });
  return {
    seen,
    read: () => readNoteWindow((q) => reader.read('w', 'n', q), { ...identity, at: 0 }),
  };
}

it('admits exactly 32 KiB and rejects one byte more without dropping required attributes', async () => {
  const base = await provider(0).read();
  const padding = 32768 - base.cost.canonicalBytes!;
  for (const bytes of [32767, 32768]) {
    const p = provider(padding + bytes - 32768);
    const window = await p.read();
    expect(window.cost.canonicalBytes).toBe(bytes);
    expect(window.range).toEqual({ start: 0, end: 2 });
    expect(
      Object.values(window.native!.attributes.attrs as Record<string, string>).join(''),
    ).toHaveLength(padding + bytes - 32768);
    expect(p.seen.filter((q) => q.kind === 'source')).toHaveLength(1);
    expect(p.seen.every((q) => q.maxWireBytes === 8192)).toBe(true);
    expect(projectNoteWindow(window).content.type).toBe('doc');
  }
  const tooLarge = provider(padding + 1);
  await expect(tooLarge.read()).rejects.toThrow(/retained context.*32769 bytes/);
  expect(tooLarge.seen.filter((q) => q.kind === 'source').map((q) => q.maxSourceBytes)).toEqual([
    4096,
  ]);
});

it('keeps the 4 KiB continuation checkpoint for separator-only canonical pages', async () => {
  const small = provider(0, true);
  const complete = await small.read();
  expect(complete.range).toEqual({ start: 0, end: 2 });
  expect(small.seen.filter((q) => q.kind === 'source')).toHaveLength(2);
  const p = provider(4500, true);
  const window = await p.read();
  expect(window.native!.texts).toEqual({});
  expect(window.cost.canonicalWorkBytes).toBeGreaterThan(4096);
  expect(window.cost.canonicalWorkBytes).toBeLessThan(16384);
  expect(window.range).toEqual({ start: 0, end: 1 });
  expect(window.documentEnd).toBe(false);
  expect(p.seen.filter((q) => q.kind === 'source')).toHaveLength(1);
  expect(projectNoteWindow(window).content.type).toBe('doc');
});
