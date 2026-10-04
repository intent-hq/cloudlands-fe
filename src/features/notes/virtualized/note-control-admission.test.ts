import { expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { readNoteWindow } from './note-window-reader';

// Complete controlled provider: every attempted smaller read has real bounded
// source/identity maps. This is consumer policy evidence, not a production Store.
function provider(mode: 'shrink' | 'fixed' | 'stale' | 'cancel' = 'shrink') {
  const identity = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const requests: NotePageRequest[] = [];
  let current = true,
    sourceCalls = 0;
  const range = { start: 0, end: 36 };
  const boundary = {
    kind: 'boundary',
    id: 'owner',
    construct: 'htmlDocument',
    profile: 'canonicalNote',
    profileVersion: 1,
    entryPath: 'html',
    sourceRange: range,
    nativeRef: 'paragraph',
    attributesRef: 'attrs',
  };
  // htmlDocument's native root is a doc; the leaf has one direct parent.
  boundary.nativeRef = 'doc';
  const node = (
    id: string,
    type: string,
    cls: string,
    parentRef: string | null,
    childIndex: number,
  ) => ({
    kind: 'nativeNode',
    id,
    profile: 'canonicalNote',
    profileVersion: 1,
    nodeType: type,
    nodeClass: cls,
    parentRef,
    childIndex,
    sourceRange: range,
    provenance: 'explicit',
    attributesRef: 'attrs',
  });
  const context = (items: unknown[]) => ({
    ...identity,
    kind: 'noteContextPage',
    items,
    nextCursor: null,
  });
  const reader = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    if (q.kind === 'source') {
      sourceCalls++;
      const n = Math.min(36, q.maxSourceBytes!);
      if (mode === 'cancel' && sourceCalls === 2) current = false;
      return {
        ...identity,
        snapshotId: mode === 'stale' && sourceCalls === 2 ? 'other' : 's',
        kind: 'noteSourcePage',
        range: { start: 0, end: n },
        sourceLength: 36,
        text: 'x'.repeat(n),
        contextRef: 'window:' + n,
        metadataRef: 'never',
        previousCursor: null,
        nextCursor: n === 36 ? null : 'next',
      };
    }
    if (q.kind === 'metadata')
      return {
        ...identity,
        kind: 'noteMetadataPage',
        items:
          q.ref === 'attrs'
            ? [
                {
                  id: 'attrs',
                  parentId: null,
                  type: 'object',
                  childrenRef: mode === 'fixed' ? 'large-attrs' : 'empty',
                },
              ]
            : q.ref === 'large-attrs'
              ? [
                  {
                    id: 'large',
                    parentId: 'attrs',
                    key: 'example',
                    type: 'string',
                    value: 'y'.repeat(6500),
                  },
                ]
              : [],
        nextCursor: null,
      };
    if (q.kind !== 'context') throw new Error('Unexpected request');
    if (q.contextRef === 'owner') return context([boundary]);
    if (q.contextRef === 'doc') return context([node('doc', 'doc', 'container', null, 0)]);
    if (q.contextRef === 'leaf') return context([node('leaf', 'text', 'text', 'doc', 0)]);
    if (q.contextRef.startsWith('window:'))
      return context([
        {
          ...boundary,
          sourceMapRef: 'maps:' + q.contextRef.split(':')[1],
          continuationBefore: false,
          continuationAfter: true,
        },
      ]);
    if (q.contextRef.startsWith('maps:')) {
      const n = Number(q.contextRef.split(':')[1]);
      const offset = Number(q.cursor ?? 0);
      const items = Array.from({ length: n }, (_, i) => ({
        kind: 'sourceMap',
        id: 'map' + i,
        profile: 'canonicalNote',
        profileVersion: 1,
        ownerRef: 'owner',
        textNodeId: 'leaf',
        textNodeRef: 'leaf',
        sourceRange: { start: i, end: i + 1 },
        renderedRange: { start: i, end: i + 1 },
        mapping: 'identity',
        textRef: 'text:' + i,
      }));
      return {
        ...context(items.slice(offset, offset + 20)),
        nextCursor: offset + 20 < n ? String(offset + 20) : null,
      };
    }
    if (q.contextRef.startsWith('text:'))
      return context([
        {
          kind: 'fragment',
          id: q.contextRef,
          field: 'renderedText',
          offset: 0,
          text: 'x',
          nextRef: null,
        },
      ]);
    throw new Error('Unexpected reference ' + q.contextRef);
  });
  return {
    requests,
    read: () =>
      readNoteWindow(
        (q) => reader.read('w', 'n', q),
        { ...identity, at: 0 },
        () => current,
      ),
  };
}
it('shrinks from the actual short failed extent and counts every physical attempt', async () => {
  const p = provider();
  const w = await p.read();
  const reads = p.requests.filter((q) => q.kind === 'source');
  expect(reads.map((q) => q.maxSourceBytes)).toEqual([4096, 16]);
  expect(reads[1]).toMatchObject({
    snapshotId: 's',
    sourceRevision: 'r',
    noteInstanceId: 'i',
    at: 0,
  });
  expect(w.cost.requests).toBe(p.requests.length);
  expect(w.cost.requests).toBeLessThanOrEqual(96);
  expect(w.cost.canonicalBytes).toBeLessThanOrEqual(8192);
  expect(w.cost.canonicalWorkBytes).toBeGreaterThan(8192);
  expect(w.range).toEqual({ start: 0, end: 16 });
});
it('never resets the shared request budget when a required closure cannot shrink', async () => {
  const p = provider('fixed');
  await expect(p.read()).rejects.toThrow(/request budget|retained context/);
  expect(p.requests.filter((q) => q.kind === 'source').length).toBeGreaterThan(1);
  expect(p.requests.length).toBeLessThanOrEqual(96);
});
it.each(['stale', 'cancel'] as const)('rejects %s ownership on a smaller retry', async (mode) => {
  const p = provider(mode);
  await expect(p.read()).rejects.toThrow(mode === 'stale' ? /snapshot/ : /superseded/);
  expect(p.requests.filter((q) => q.kind === 'source').map((q) => q.maxSourceBytes)).toEqual([
    4096, 16,
  ]);
  expect(p.requests.at(-1)?.kind).toBe('source');
});
