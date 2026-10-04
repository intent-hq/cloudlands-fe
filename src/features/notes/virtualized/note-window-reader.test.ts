import { describe, expect, it } from 'vitest';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { NotePageReader } from '$lib/client/note-page-reader';
import { readNoteWindow, NOTE_WINDOW_LIMITS } from './note-window-reader';

const identity = {
  scope: { backendId: 'backend', workspaceId: 'ws', noteId: 'note', noteInstanceId: 'instance' },
  sourceRevision: 'rev',
  snapshotId: 'snapshot',
  expiresAt: '2099-01-01T00:00:00Z',
};
// Independent wire producer: source is external to the production reader, and every
// request passes through the real transport response validator.
function backend(source: string, chunk = 1024) {
  const requests: NotePageRequest[] = [];
  const transport = new NotePageReader(async (method, params) => {
    expect(method).toBe('note.get');
    expect(params.workspaceId).toBe('ws');
    expect(params.noteId).toBe('note');
    const q = params.page as NotePageRequest;
    requests.push(q);
    if (q.kind === 'source') {
      const start = 'cursor' in q && q.cursor ? Number(q.cursor.slice(1)) : (q.at ?? 0);
      let end = Math.min(source.length, start + chunk);
      while (
        new TextEncoder().encode(source.slice(start, end)).length > (q.maxSourceBytes ?? 16384)
      )
        end--;
      if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1])) end--;
      return {
        ...identity,
        kind: 'noteSourcePage',
        range: { start, end },
        sourceLength: source.length,
        text: source.slice(start, end),
        previousCursor: start ? `b${start}` : null,
        nextCursor: end < source.length ? `f${end}` : null,
        contextRef: `c${start}:${end}`,
        metadataRef: 'metadata',
      };
    }
    if (q.kind === 'context') {
      const [start, end] = q.contextRef.slice(1).split(':').map(Number);
      return {
        ...identity,
        kind: 'noteContextPage',
        items: [
          {
            kind: 'boundary',
            id: 'paragraph',
            construct: 'paragraph',
            sourceRange: { start: 0, end: source.length },
            continuationBefore: start > 0,
            continuationAfter: end < source.length,
          },
        ],
        nextCursor: null,
      };
    }
    throw new Error('Unexpected read');
  });
  return { requests, read: (q: NotePageRequest) => transport.read('ws', 'note', q) };
}

describe('production bounded note window assembly', () => {
  it('seeks into a multimegabyte Unicode paragraph without reading its prefix', async () => {
    const source = 'café 世界 🌍 '.repeat(220_000);
    const b = backend(source);
    const at = 2_000_000;
    const window = await readNoteWindow(b.read, { at, ...identity });
    expect(window.range.start).toBe(at);
    expect(window.text).toBe(source.slice(at, window.range.end));
    expect(window.range.end).toBeGreaterThan(at + 1024);
    expect(window.context.map((c) => c.id)).toEqual(['paragraph']);
    expect(
      b.requests.filter((q) => q.kind === 'source').every((q) => q.cursor || q.at === at),
    ).toBe(true);
    expect(b.requests.length).toBeLessThanOrEqual(NOTE_WINDOW_LIMITS.requests);
    expect(new TextEncoder().encode(window.text).length).toBeLessThanOrEqual(
      NOTE_WINDOW_LIMITS.sourceBytes,
    );
    expect(window.cost.sourceBytes).toBe(new TextEncoder().encode(window.text).length);
    expect(window.cost.wireBytes).toBeGreaterThan(window.cost.sourceBytes);
  });
  it('assembles transport cuts without losing exact CRLF, anchors, or Unicode', async () => {
    const source =
      '# Heading\r\n\r\n**café 🌍** <!-- comment:start:abc -->\r\n```js\r\na()\r\n```\r\n';
    const b = backend(source, 13);
    const window = await readNoteWindow(b.read, { at: 0, ...identity });
    expect(window.text).toBe(source);
    expect(window.range).toEqual({ start: 0, end: source.length });
    expect(window.documentEnd).toBe(true);
  });
  it('rejects mixed snapshot context before exposing a window', async () => {
    const b = backend('word '.repeat(500));
    await expect(
      readNoteWindow(
        async (q) => {
          const page = await b.read(q);
          return q.kind === 'context' ? ({ ...page, snapshotId: 'other' } as NoteReadPage) : page;
        },
        { at: 0, ...identity },
      ),
    ).rejects.toThrow(/snapshot/i);
  });
  it('rejects a source gap instead of concatenating noncontiguous pages', async () => {
    const b = backend('word '.repeat(500));
    await expect(
      readNoteWindow(
        async (q) => {
          const page = await b.read(q);
          if (page.kind === 'noteSourcePage' && page.range.start > 0)
            return { ...page, range: { start: page.range.start + 1, end: page.range.end + 1 } };
          return page;
        },
        { at: 0, ...identity },
      ),
    ).rejects.toThrow(/contiguous/i);
  });
  it('stops stale navigation after the actual outstanding read settles', async () => {
    const b = backend('word '.repeat(500));
    let current = true;
    await expect(
      readNoteWindow(
        async (q) => {
          const page = await b.read(q);
          current = false;
          return page;
        },
        { at: 0, ...identity },
        () => current,
      ),
    ).rejects.toThrow(/superseded/i);
    expect(b.requests).toHaveLength(1);
  });
  it('rejects nonprogressing context cursors under a finite request budget', async () => {
    const b = backend('hello');
    let calls = 0;
    await expect(
      readNoteWindow(
        async (q) => {
          calls++;
          const p = await b.read(q);
          return p.kind === 'noteContextPage' ? { ...p, nextCursor: 'cycle' } : p;
        },
        { at: 0, ...identity },
      ),
    ).rejects.toThrow(/progress|cycle/i);
    expect(calls).toBeLessThan(6);
  });
  it('pages a detail directory and field independently of collection exhaustion', async () => {
    const b = backend('linked');
    const read = async (q: NotePageRequest): Promise<NoteReadPage> => {
      if (q.kind !== 'context') return b.read(q);
      const common = { ...identity, kind: 'noteContextPage' as const, nextCursor: null };
      if (q.contextRef.startsWith('c'))
        return {
          ...common,
          items: [
            {
              kind: 'boundary',
              id: 'link',
              construct: 'link',
              sourceRange: { start: 0, end: 6 },
              continuationBefore: false,
              continuationAfter: false,
              detailRef: 'directory',
            },
          ],
        };
      if (q.contextRef === 'directory')
        return {
          ...common,
          items: [
            {
              kind: 'fragment',
              id: 'entry',
              field: 'destination',
              offset: 0,
              text: '',
              nextRef: 'url0',
            },
          ],
        };
      if (q.contextRef === 'url0')
        return {
          ...common,
          items: [
            {
              kind: 'fragment',
              id: 'u0',
              field: 'destination',
              offset: 0,
              text: 'https://example.',
              nextRef: 'url16',
            },
          ],
        };
      if (q.contextRef === 'url16')
        return {
          ...common,
          items: [
            {
              kind: 'fragment',
              id: 'u1',
              field: 'destination',
              offset: 16,
              text: 'test',
              nextRef: null,
            },
          ],
        };
      throw new Error('Unexpected reference');
    };
    const window = await readNoteWindow(read, { at: 0, ...identity });
    expect(window.details.link.destination).toBe('https://example.test');
    expect(window.cost.requests).toBe(5);
  });
  it('never fetches complete metadata or full-note fallback', async () => {
    const b = backend('hello');
    await readNoteWindow(b.read, { at: 0, ...identity });
    expect(b.requests.map((q) => q.kind)).toEqual(['source', 'context']);
  });
});

it('shrinks source admission for dense short blocks instead of exceeding lexical budgets', async () => {
  const source = 'a\n\n'.repeat(1_000_000);
  const read = async (q: NotePageRequest): Promise<NoteReadPage> => {
    if (q.kind === 'source') {
      const start = q.cursor ? Number(q.cursor) : (q.at ?? 0),
        end = Math.min(source.length, start + (q.maxSourceBytes ?? 4096));
      return {
        ...identity,
        kind: 'noteSourcePage',
        sourceLength: source.length,
        range: { start, end },
        text: source.slice(start, end),
        contextRef: `${start}:${end}`,
        metadataRef: 'm',
        nextCursor: String(end),
        previousCursor: start ? String(start) : null,
      };
    }
    if (q.kind === 'context') {
      const [start, end] = q.contextRef.split(':').map(Number);
      const first = q.cursor ? Number(q.cursor) : Math.floor(start / 3),
        last = Math.ceil(end / 3);
      const until = Math.min(last, first + 32);
      return {
        ...identity,
        kind: 'noteContextPage',
        items: Array.from({ length: until - first }, (_, i) => ({
          kind: 'boundary',
          id: `p${first + i}`,
          construct: 'paragraph',
          sourceRange: { start: (first + i) * 3, end: (first + i) * 3 + 1 },
          continuationBefore: false,
          continuationAfter: false,
        })),
        nextCursor: until < last ? String(until) : null,
      };
    }
    throw new Error('Unexpected request');
  };
  const w = await readNoteWindow(read, { at: 0, ...identity });
  expect(w.text).toBe(source.slice(0, w.range.end));
  expect(w.range.end).toBeGreaterThan(60);
  expect(w.context.length).toBeLessThanOrEqual(128);
  expect(w.cost.contextBytes).toBeLessThanOrEqual(8192);
  expect(w.cost.requests).toBeLessThanOrEqual(96);
});

it('retains every window map separately from immutable HTML owner identity', async () => {
  const at = 2_000_000;
  const sourceLength = at + 8;
  const seen: NotePageRequest[] = [];
  const owner = {
    kind: 'boundary',
    id: 'html-table',
    construct: 'htmlTable',
    sourceRange: { start: 0, end: sourceLength },
    htmlPosition: { profile: 'canonicalNote', profileVersion: 1, tableRef: 'owner' },
    htmlSource: {
      provenance: 'explicit',
      openingRange: { start: 0, end: 7 },
      bodyRange: { start: 7, end: sourceLength - 8 },
      closingRange: { start: sourceLength - 8, end: sourceLength },
    },
    nativeRef: 'native-table',
    attributesRef: 'attrs',
  };
  const transport = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    seen.push(q);
    if (q.kind === 'source') {
      const start = q.cursor ? Number(q.cursor) : q.at!;
      const end = start + 4;
      return {
        ...identity,
        kind: 'noteSourcePage',
        sourceLength,
        range: { start, end },
        text: 'word',
        contextRef: `window-${start}`,
        metadataRef: 'metadata',
        previousCursor: 'previous',
        nextCursor: start === at ? String(end) : null,
      };
    }
    if (q.kind === 'metadata')
      return {
        ...identity,
        kind: 'noteMetadataPage',
        nextCursor: null,
        items:
          q.ref === 'attrs'
            ? [{ id: 'attrs-root', parentId: null, type: 'object', childrenRef: 'attrs-empty' }]
            : [],
      };
    if (q.kind === 'context') {
      if (q.contextRef.startsWith('map-'))
        return { ...identity, kind: 'noteContextPage', nextCursor: null, items: [] };
      if (q.contextRef === 'native-table' || q.contextRef === 'native-root')
        return {
          ...identity,
          kind: 'noteContextPage',
          nextCursor: null,
          items: [
            {
              kind: 'nativeNode',
              id: q.contextRef,
              profile: 'canonicalNote',
              profileVersion: 1,
              nodeType: q.contextRef === 'native-table' ? 'table' : 'doc',
              nodeClass: 'container',
              parentRef: q.contextRef === 'native-table' ? 'native-root' : null,
              childIndex: 0,
              sourceRange: owner.sourceRange,
              provenance: 'explicit',
              attributesRef: 'attrs',
            },
          ],
        };
      const occurrence = q.contextRef.startsWith('window-');
      return {
        ...identity,
        kind: 'noteContextPage',
        nextCursor: null,
        items: [
          occurrence
            ? {
                ...owner,
                continuationBefore: true,
                continuationAfter: true,
                sourceMapRef: `map-${q.contextRef}`,
              }
            : owner,
        ],
      };
    }
    throw new Error('Unexpected resource');
  });
  const result = await readNoteWindow((q) => transport.read('ws', 'note', q), { at, ...identity });
  expect(result.canonicalOwners).toEqual([
    {
      ownerId: owner.id,
      nativeRef: owner.nativeRef,
      nativeId: 'native-table',
      sourceRange: owner.sourceRange,
      construct: owner.construct,
      htmlSource: owner.htmlSource,
    },
  ]);
  expect(result.context.filter((n) => n.kind === 'boundary')).toEqual([]);
  expect(result.mapBindings).toEqual([
    {
      ownerId: 'html-table',
      range: { start: at, end: at + 4 },
      contextRef: `window-${at}`,
      sourceMapRef: `map-window-${at}`,
    },
    {
      ownerId: 'html-table',
      range: { start: at + 4, end: at + 8 },
      contextRef: `window-${at + 4}`,
      sourceMapRef: `map-window-${at + 4}`,
    },
  ]);
  expect(seen.filter((q) => q.kind === 'source')).toHaveLength(2);
  expect(result.cost.contextBytes).toBeGreaterThan(
    new TextEncoder().encode(JSON.stringify(owner)).length,
  );
});
