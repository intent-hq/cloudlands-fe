import { describe, expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { readNoteWindow } from './note-window-reader';
import { NoteCanonicalProjection } from './note-canonical-projection';

const identity = {
  scope: { backendId: 'backend', workspaceId: 'ws', noteId: 'note', noteInstanceId: 'instance' },
  sourceRevision: 'rev',
  snapshotId: 'snapshot',
  expiresAt: '2099-01-01T00:00:00Z',
};
const length = 2_000_008;
const owner = {
  kind: 'boundary',
  id: 'document-owner',
  construct: 'markdownDocument',
  profile: 'canonicalNote',
  profileVersion: 1,
  entryPath: 'markdown',
  sourceRange: { start: 0, end: length },
  nativeRef: 'root',
  attributesRef: 'attrs',
};
const occurrence = {
  ...owner,
  sourceMapRef: 'maps',
  continuationBefore: true,
  continuationAfter: false,
};
function context(items: unknown[]) {
  return { ...identity, kind: 'noteContextPage', items, nextCursor: null };
}
async function validate(item: unknown) {
  const reader = new NotePageReader(async () => context([item]));
  return reader.read('ws', 'note', { kind: 'context', contextRef: 'owner' });
}
describe('canonical Markdown document owner wire contract', () => {
  it('accepts a stable direct owner without window fields', async () => {
    await expect(validate(owner)).resolves.toMatchObject({ items: [owner] });
  });
  it('accepts an explicit window occurrence', async () => {
    await expect(validate(occurrence)).resolves.toMatchObject({ items: [occurrence] });
  });
  it.each([
    { profile: 'other' },
    { profileVersion: 2 },
    { entryPath: 'html' },
    { sourceRange: { start: 1, end: length } },
    { nativeRef: '' },
    { attributesRef: '' },
    { parentRef: 'parent' },
    { detailRef: 'detail' },
    { htmlPosition: {} },
    { htmlSource: {} },
    { sourceMapRef: undefined },
    { continuationBefore: undefined },
  ])('rejects a forged document owner %j', async (change) => {
    await expect(validate({ ...occurrence, ...change })).rejects.toThrow();
  });
});

// Controlled bounded provider for consumer validation; not a production Store or
// evidence of native rendering parity. The multimegabyte prefix is never supplied.
function provider(
  change: {
    owner?: object;
    root?: object;
    snapshot?: string;
    directWindow?: boolean;
    map?: object;
    empty?: boolean;
    eof?: boolean;
    slice?: { start: number; end: number };
  } = {},
) {
  const seen: NotePageRequest[] = [];
  const sourceLength = change.empty ? 0 : length;
  const selectedRange =
    change.slice ??
    (change.empty
      ? { start: 0, end: 0 }
      : { start: change.eof ? length : length - 8, end: length });
  let pageRange = selectedRange;
  const selected = { ...owner, sourceRange: { start: 0, end: sourceLength }, ...change.owner };
  const reader = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    seen.push(q);
    if (q.kind === 'source') {
      pageRange =
        q.cursor === 'tail' ? { start: selectedRange.end, end: sourceLength } : selectedRange;
      return {
        ...identity,
        kind: 'noteSourcePage',
        sourceLength,
        range: pageRange,
        text:
          change.empty || change.eof
            ? ''
            : '\r\n\r\n    '.slice(pageRange.start - (length - 8), pageRange.end - (length - 8)),
        contextRef: q.cursor === 'tail' ? 'window-tail' : 'window',
        metadataRef: 'never-read',
        previousCursor: pageRange.start === 0 ? null : 'previous',
        nextCursor: pageRange.end === sourceLength ? null : 'tail',
      };
    }
    if (q.kind === 'metadata')
      return {
        ...identity,
        kind: 'noteMetadataPage',
        nextCursor: null,
        items:
          q.ref === 'attrs'
            ? [{ id: 'attrs', parentId: null, type: 'object', childrenRef: 'empty' }]
            : [],
      };
    if (q.kind !== 'context') throw new Error('Unexpected request');
    if (q.contextRef === 'window' && change.directWindow) return context([selected]);
    if (q.contextRef === 'window' || q.contextRef === 'window-tail')
      return context([
        {
          ...selected,
          sourceMapRef: q.contextRef === 'window-tail' ? 'maps-tail' : 'maps',
          continuationBefore: pageRange.start > 0,
          continuationAfter: pageRange.end < sourceLength,
        },
      ]);
    if (q.contextRef === 'root')
      return {
        ...context([
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
            ...change.root,
          },
        ]),
        snapshotId: change.snapshot ?? identity.snapshotId,
      };
    if (q.contextRef === 'owner') return context([selected]);
    if (q.contextRef === 'wrong-owner') return context([{ ...selected, id: 'other-document' }]);
    if (q.contextRef === 'leaf') return context([textLeaf]);
    if (q.contextRef === 'rendered-text')
      return context([
        {
          kind: 'fragment',
          id: 'rendered-fragment',
          field: 'renderedText',
          offset: 0,
          text: '\r\n\r\n    ',
          nextRef: null,
        },
      ]);
    if (q.contextRef === 'maps' || q.contextRef === 'maps-tail')
      return context(
        change.empty || change.eof
          ? []
          : [
              {
                kind: 'sourceMap',
                id: q.contextRef === 'maps-tail' ? 'omitted-tail' : 'omitted',
                profile: 'canonicalNote',
                profileVersion: 1,
                ownerRef: 'owner',
                sourceRange: pageRange,
                renderedRange: { start: 0, end: 0 },
                mapping: 'omitted',
                textRef: null,
                textNodeId: null,
                textNodeRef: null,
                ...change.map,
              },
            ],
      );
    throw new Error('Unexpected context reference ' + q.contextRef);
  });
  return {
    seen,
    read: () =>
      readNoteWindow((q) => reader.read('ws', 'note', q), { ...identity, at: selectedRange.start }),
  };
}
describe('canonical Markdown document owner assembly', () => {
  it('resolves a far-tail owner and root without a prefix or child directory read', async () => {
    const p = provider();
    const result = await p.read();
    expect(result.text).toBe('\r\n\r\n    ');
    expect(result.context).toContainEqual(owner);
    expect(result.mapBindings).toHaveLength(1);
    expect(p.seen.filter((q) => q.kind === 'source')).toHaveLength(1);
    expect(p.seen).toHaveLength(7);
    expect(result.cost.sourceBytes).toBe(8);
    expect(result.cost.contextBytes).toBeLessThan(8192);
  });
  it('rejects a stable owner substituted for a window occurrence', async () => {
    await expect(provider({ directWindow: true }).read()).rejects.toThrow(/document.*mapping/i);
  });
  it('rejects a truncated document envelope before overlap filtering', async () => {
    await expect(
      provider({ owner: { sourceRange: { start: 0, end: 10 } } }).read(),
    ).rejects.toThrow(/document.*range/i);
  });
  it('rejects an owner that does not span the exact source length', async () => {
    await expect(
      provider({ owner: { sourceRange: { start: 0, end: length + 1 } } }).read(),
    ).rejects.toThrow(/document.*range/i);
  });
  it('rejects a non-document native owner', async () => {
    await expect(
      provider({ root: { nodeType: 'paragraph', parentRef: 'root' } }).read(),
    ).rejects.toThrow(/document.*root/i);
  });
  it('rejects mismatched root attributes', async () => {
    await expect(provider({ root: { attributesRef: 'different' } }).read()).rejects.toThrow(
      /document.*root/i,
    );
  });
  it('rejects a root from the snapshot before a prefix-mode edit', async () => {
    await expect(provider({ snapshot: 'old-snapshot' }).read()).rejects.toThrow(/snapshot/i);
  });
});

// These are consumer admission controls. The daemon public traversal and actual
// transport probe must establish that these intervals are genuine separators.
it('projects an explicitly indexed separator-only window without native descendants', async () => {
  const p = provider();
  const window = await p.read();
  expect(() => new NoteCanonicalProjection(window)).not.toThrow();
  expect(window.context.filter((item) => item.kind === 'nativeNode')).toHaveLength(1);
  expect(p.seen.some((q) => q.kind === 'source' && q.at === 0)).toBe(false);
});
it.each([
  { sourceRange: { start: length - 9, end: length } },
  { sourceRange: { start: length - 8, end: length + 1 } },
  { renderedRange: { start: 1, end: 1 } },
  { textNodeId: 'fake', textNodeRef: 'root' },
])('rejects a document separator map outside its exact contract %j', async (map) => {
  await expect(provider({ map }).read()).rejects.toThrow();
});
it('keeps missing separator coverage invalid', async () => {
  const window = await provider({
    map: { sourceRange: { start: length - 7, end: length } },
  }).read();
  expect(() => new NoteCanonicalProjection(window)).toThrow(/coverage is incomplete/);
});

it('admits only an empty-source root without fabricated positive maps', async () => {
  const p = provider({ empty: true });
  const window = await p.read();
  expect(window.sourceLength).toBe(0);
  expect(window.range).toEqual({ start: 0, end: 0 });
  expect(window.mapBindings).toHaveLength(1);
  expect(window.context.filter((item) => item.kind === 'sourceMap')).toEqual([]);
  expect(window.context.filter((item) => item.kind === 'nativeNode')).toHaveLength(1);
  expect(() => new NoteCanonicalProjection(window)).not.toThrow();
  expect(p.seen.filter((q) => q.kind === 'source')).toHaveLength(1);
});
it('rejects a document occurrence on a nonempty end-of-source zero-width page', async () => {
  await expect(provider({ eof: true }).read()).rejects.toThrow();
});

const textLeaf = {
  kind: 'nativeNode',
  id: 'text-leaf',
  profile: 'canonicalNote',
  profileVersion: 1,
  nodeType: 'text',
  nodeClass: 'text',
  parentRef: 'root',
  childIndex: 0,
  sourceRange: { start: length - 8, end: length },
  provenance: 'explicit',
  attributesRef: 'attrs',
};
const textMap = {
  kind: 'sourceMap',
  id: 'rendered-map',
  profile: 'canonicalNote',
  profileVersion: 1,
  ownerRef: 'owner',
  sourceRange: { start: length - 8, end: length },
  renderedRange: { start: 0, end: 8 },
  mapping: 'identity',
  textRef: 'rendered-text',
  textNodeId: 'text-leaf',
  textNodeRef: 'leaf',
};
it('rejects a document map with otherwise valid rendered text ownership', async () => {
  await expect(validate(textMap)).resolves.toMatchObject({ items: [textMap] });
  await expect(validate(textLeaf)).resolves.toMatchObject({ items: [textLeaf] });
  await expect(provider({ map: textMap }).read()).rejects.toThrow(/document.*map/i);
});
it('rejects a structurally valid omitted map carrying a real text leaf', async () => {
  const map = {
    ...textMap,
    mapping: 'omitted',
    renderedRange: { start: 0, end: 0 },
    textRef: null,
  };
  await expect(validate(map)).resolves.toMatchObject({ items: [map] });
  await expect(provider({ map }).read()).rejects.toThrow(/document.*map/i);
});
it('rejects an exact map reference resolving to the wrong singleton owner', async () => {
  await expect(provider({ map: { ownerRef: 'wrong-owner' } }).read()).rejects.toThrow(
    /owner mismatch/i,
  );
});
it.each([{ childIndex: 1 }, { nodeClass: 'atom' }, { profileVersion: 2 }])(
  'retains native root structural rejection %j',
  async (root) => {
    await expect(provider({ root }).read()).rejects.toThrow();
  },
);

it.each([
  [{ start: length - 8, end: length - 7 }, '\r'],
  [{ start: length - 7, end: length - 6 }, '\n'],
] as const)('preserves exact CRLF separator seam %j', async (slice, text) => {
  const p = provider({ slice });
  const window = await p.read();
  expect(window.range).toEqual({ start: slice.start, end: length });
  expect(window.text).toBe('\r\n\r\n    '.slice(slice.start - (length - 8)));
  expect(window.text.slice(0, 1)).toBe(text);
  expect(window.mapBindings.map((b) => b.range)).toEqual([
    slice,
    { start: slice.end, end: length },
  ]);
  expect(() => new NoteCanonicalProjection(window)).not.toThrow();
  expect(p.seen.filter((q) => q.kind === 'source')).toHaveLength(2);
});
