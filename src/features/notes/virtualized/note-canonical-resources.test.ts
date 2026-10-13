import { expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { readNoteWindow } from './note-window-reader';
const identity = {
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: 'r',
  snapshotId: 's',
  expiresAt: '2099-01-01T00:00:00Z',
};
const range = { start: 2_000_000, end: 2_000_006 };
const profile = { profile: 'canonicalNote', profileVersion: 1 };
const native = (id: string, nodeType: string, parentRef: string | null, childIndex: number) => ({
  ...profile,
  kind: 'nativeNode',
  id,
  nodeType,
  nodeClass: nodeType === 'text' ? 'text' : 'container',
  parentRef,
  childIndex,
  sourceRange: range,
  provenance: 'explicit',
  attributesRef: 'attrs',
  ...(nodeType === 'text' ? { marksRef: 'marks' } : {}),
});
const owner = {
  kind: 'span',
  id: 'code-owner',
  role: 'code',
  sourceRange: { start: 0, end: 4_000_000 },
  codeSource: {
    ...profile,
    openingRange: { start: 0, end: 100_001 },
    bodyRange: { start: 100_001, end: 3_899_999 },
    closingRange: { start: 3_899_999, end: 4_000_000 },
  },
  nativeRef: 'leaf-ref',
};
function canonicalFixture() {
  const requests: NotePageRequest[] = [];
  const contexts: Record<string, unknown[]> = {
    window: [{ ...owner, sourceMapRef: 'maps' }],
    owner: [owner],
    maps: [
      {
        ...profile,
        kind: 'sourceMap',
        id: 'segment',
        ownerRef: 'owner',
        textNodeId: 'leaf',
        textNodeRef: 'leaf-ref',
        sourceRange: range,
        renderedRange: { start: 1_000_000, end: 1_000_006 },
        mapping: 'identity',
        textRef: 'text',
      },
    ],
    'leaf-ref': [native('leaf', 'text', 'paragraph-ref', 4)],
    'paragraph-ref': [native('paragraph', 'paragraph', 'root-ref', 9)],
    'root-ref': [native('root', 'doc', null, 0)],
    text: [
      {
        kind: 'fragment',
        id: 'text-fragment',
        field: 'renderedText',
        offset: 0,
        text: 'TARGET',
        nextRef: null,
      },
    ],
  };
  const metadata: Record<string, unknown[]> = {
    attrs: [{ id: 'empty', parentId: null, type: 'object', childrenRef: 'empty' }],
    empty: [],
    marks: [{ id: 'marks', parentId: null, type: 'array', childrenRef: 'marks-children' }],
    'marks-children': [
      { id: 'mark', parentId: 'marks', index: 0, type: 'object', childrenRef: 'mark-children' },
    ],
    'mark-children': [
      { id: 'mark-type', parentId: 'mark', key: 'type', type: 'string', value: 'code' },
    ],
  };
  const transport = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    if (q.kind === 'source')
      return {
        ...identity,
        kind: 'noteSourcePage',
        range,
        text: 'TARGET',
        sourceLength: 4_000_000,
        previousCursor: 'before',
        nextCursor: 'after',
        contextRef: 'window',
        metadataRef: 'note-metadata',
      };
    if (q.kind === 'context' && contexts[q.contextRef])
      return {
        ...identity,
        kind: 'noteContextPage',
        items: contexts[q.contextRef],
        nextCursor: null,
      };
    if (q.kind === 'metadata' && metadata[q.ref])
      return { ...identity, kind: 'noteMetadataPage', items: metadata[q.ref], nextCursor: null };
    throw new Error('Unexpected reference ' + JSON.stringify(q));
  });
  return {
    requests,
    contexts,
    metadata,
    read: () =>
      readNoteWindow((q) => transport.read('w', 'n', q), { ...identity, at: range.start }),
  };
}
it('resolves only admitted text segments and direct canonical ancestry on a far seek', async () => {
  const f = canonicalFixture();
  const w = await f.read();
  expect(w.native?.references['leaf-ref']).toEqual(['leaf']);
  expect(w.native?.texts['text']).toBe('TARGET');
  expect(w.native?.attributes['marks']).toEqual([{ type: 'code' }]);
  expect(w.context.filter((n) => n.kind === 'nativeNode').map((n) => n.id)).toEqual([
    'leaf',
    'paragraph',
    'root',
  ]);
  expect(f.requests.filter((q) => q.kind === 'source')).toHaveLength(1);
  expect(f.requests.some((q) => q.kind === 'metadata' && q.ref === 'note-metadata')).toBe(false);
  expect(w.cost.requests).toBeLessThan(20);
  expect(w.cost.contextBytes).toBeLessThan(8192);
});
it('rejects missing canonical text rather than publishing a partial leaf', async () => {
  const f = canonicalFixture();
  f.contexts.text = [];
  await expect(f.read()).rejects.toThrow(/text|fragment/i);
});

it('projects canonical leaf text and marks with exact far-source positions', async () => {
  const f = canonicalFixture();
  const w = await f.read();
  const { projectNoteWindow } = await import('./note-window-projection');
  const p = projectNoteWindow(w);
  expect(p.content).toEqual({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {},
        content: [{ type: 'text', text: 'TARGET', marks: [{ type: 'code' }] }],
      },
    ],
  });
  expect(p.sourceAt(1)).toBe(range.start);
  expect(p.sourceAt(7)).toBe(range.end);
  expect(p.pmAt(range.start + 3)).toBe(4);
});
it('uses declared endpoint affinities for entities instead of inventing raw offsets', async () => {
  const f = canonicalFixture();
  const map = f.contexts.maps[0] as Record<string, unknown>;
  map.mapping = 'entity';
  map.renderedRange = { start: 1_000_000, end: 1_000_001 };
  (f.contexts.text[0] as Record<string, unknown>).text = '&';
  const { projectNoteWindow } = await import('./note-window-projection');
  const p = projectNoteWindow(await f.read());
  expect(p.sourceAt(1)).toBe(range.start);
  expect(p.sourceAt(2)).toBe(range.end);
  expect(p.pmAt(range.start + 2, -1)).toBe(1);
  expect(p.pmAt(range.start + 2, 1)).toBe(2);
});

it('does not silently drop source outside the canonical mapping coverage', async () => {
  const f = canonicalFixture();
  const map = f.contexts.maps[0] as Record<string, unknown>;
  map.sourceRange = { start: range.start + 1, end: range.end };
  map.renderedRange = { start: 0, end: 5 };
  (f.contexts.text[0] as Record<string, unknown>).text = 'ARGET';
  const { projectNoteWindow } = await import('./note-window-projection');
  await expect(f.read().then(projectNoteWindow)).rejects.toThrow(/coverage/i);
});
it('rejects reordered native parent cycles before mounting an editor', async () => {
  const f = canonicalFixture();
  (f.contexts['paragraph-ref'][0] as Record<string, unknown>).parentRef = 'leaf-ref';
  const { projectNoteWindow } = await import('./note-window-projection');
  await expect(f.read().then(projectNoteWindow)).rejects.toThrow(/root|ancestry/i);
});
it('rejects identity mappings whose text disagrees with admitted source', async () => {
  const f = canonicalFixture();
  (f.contexts.text[0] as Record<string, unknown>).text = 'FORGED';
  const { projectNoteWindow } = await import('./note-window-projection');
  await expect(f.read().then(projectNoteWindow)).rejects.toThrow(/identity/i);
});

it('admits canonical payloads incrementally instead of repeatedly overfilling a whole source window', async () => {
  const requests: NotePageRequest[] = [];
  const at = 2_000_000;
  const transport = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    if (q.kind === 'source') {
      const start = q.cursor ? Number(q.cursor) : q.at!;
      const end = start + q.maxSourceBytes!;
      return {
        ...identity,
        kind: 'noteSourcePage',
        range: { start, end },
        text: 'x'.repeat(end - start),
        sourceLength: 4_000_000,
        previousCursor: 'before',
        nextCursor: String(end),
        contextRef: `window:${start}:${end}`,
        metadataRef: 'note-metadata',
      };
    }
    if (q.kind === 'metadata')
      return {
        ...identity,
        kind: 'noteMetadataPage',
        nextCursor: null,
        items:
          q.ref === 'attrs'
            ? [{ id: 'empty', parentId: null, type: 'object', childrenRef: 'empty' }]
            : [],
      };
    if (q.kind === 'context') {
      const [kind, startString, endString] = q.contextRef.split(':');
      const start = Number(startString),
        end = Number(endString);
      const items =
        kind === 'window'
          ? [{ ...owner, sourceMapRef: `maps:${start}:${end}` }]
          : kind === 'maps'
            ? [
                {
                  ...profile,
                  kind: 'sourceMap',
                  id: `segment:${start}:${end}`,
                  ownerRef: 'owner',
                  textNodeId: 'leaf',
                  textNodeRef: 'leaf-ref',
                  sourceRange: { start, end },
                  renderedRange: { start: start - 100_001, end: end - 100_001 },
                  mapping: 'identity',
                  textRef: `text:${start}:${end}`,
                },
              ]
            : kind === 'text'
              ? [
                  {
                    kind: 'fragment',
                    id: `fragment:${start}:${end}`,
                    field: 'renderedText',
                    offset: 0,
                    text: 'x'.repeat(end - start),
                    nextRef: null,
                  },
                ]
              : kind === 'owner'
                ? [owner]
                : kind === 'leaf-ref'
                  ? [{ ...native('leaf', 'text', 'root-ref', 0), marksRef: undefined }]
                  : kind === 'root-ref'
                    ? [native('root', 'doc', null, 0)]
                    : undefined;
      if (items) return { ...identity, kind: 'noteContextPage', nextCursor: null, items };
    }
    throw new Error('Unexpected resource');
  });
  const w = await readNoteWindow((q) => transport.read('w', 'n', q), { ...identity, at });
  expect(w.range.start).toBe(at);
  expect(w.text.length).toBeGreaterThan(0);
  expect(w.cost.contextBytes).toBeLessThanOrEqual(8192);
  expect(requests.length).toBeLessThan(40);
  expect(requests.filter((q) => q.kind === 'source').every((q) => !q.cursor && q.at === at)).toBe(
    true,
  );
});
