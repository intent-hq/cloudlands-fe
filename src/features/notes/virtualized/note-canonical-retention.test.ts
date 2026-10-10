import { noteCanonicalOwnerSteps } from './note-canonical-owner';
import { expect, it } from 'vitest';
import { retainCanonicalRegion } from './note-canonical-retention';
import type { NoteWindow } from './note-window-reader';
import type { NoteCanonicalResources } from './note-canonical-resources';
function fixture() {
  const context: NoteWindow['context'] = [
    {
      kind: 'boundary',
      id: 'table-owner',
      construct: 'htmlTable',
      sourceRange: { start: 0, end: 100 },
      nativeRef: 'native-table-ref',
      detailRef: 'opaque-details',
      htmlSource: {
        provenance: 'explicit',
        openingRange: { start: 0, end: 7 },
        bodyRange: { start: 7, end: 92 },
        closingRange: { start: 92, end: 100 },
        piecesRef: 'raw-pieces',
      },
    },
    {
      kind: 'nativeNode',
      id: 'table',
      profile: 'canonicalNote',
      profileVersion: 1,
      nodeType: 'table',
      nodeClass: 'container',
      parentRef: 'native-root',
      childIndex: 0,
      sourceRange: { start: 0, end: 100 },
      provenance: 'explicit',
      attributesRef: 'table-attrs',
    },
    {
      kind: 'nativeNode',
      id: 'implicit-cell',
      profile: 'canonicalNote',
      profileVersion: 1,
      nodeType: 'tableCell',
      nodeClass: 'container',
      parentRef: 'native-table-ref',
      childIndex: 0,
      sourceRange: { start: 7, end: 92 },
      provenance: 'repaired',
      sourcePiecesRef: 'repaired-pieces',
      attributesRef: 'cell-attrs',
    },
    {
      kind: 'sourceMap',
      id: 'omitted-map',
      profile: 'canonicalNote',
      profileVersion: 1,
      ownerRef: 'exact-owner',
      textNodeId: null,
      textNodeRef: null,
      sourceRange: { start: 60, end: 64 },
      renderedRange: { start: 0, end: 0 },
      mapping: 'omitted',
      textRef: null,
    },
  ];
  const bindings = [
    {
      ownerId: 'table-owner',
      sourceMapRef: 'map-ref',
      contextRef: 'window-one',
      range: { start: 60, end: 64 },
    },
    {
      ownerId: 'table-owner',
      sourceMapRef: 'map-two',
      contextRef: 'window-two',
      range: { start: 64, end: 68 },
    },
  ];
  const native: NoteCanonicalResources = {
    references: {
      'native-table-ref': ['table'],
      'exact-owner': ['table-owner'],
      'map-ref': ['omitted-map'],
    },
    texts: {},
    attributes: {},
  };
  return { context, bindings, native };
}
it('keeps exact opaque source addresses and every occurrence after releasing lexical lookup records', () => {
  const { context, bindings, native } = fixture();
  const retained = retainCanonicalRegion(context, bindings, native, { start: 60, end: 68 });
  expect(retained.context).toEqual(context.slice(1));
  expect(retained.context[1]).toBe(context[2]);
  expect(retained.context[1]).toMatchObject({
    provenance: 'repaired',
    sourcePiecesRef: 'repaired-pieces',
  });
  expect(retained.context[2]).toMatchObject({ mapping: 'omitted', ownerRef: 'exact-owner' });
  expect(retained.owners).toEqual([
    {
      ownerId: 'table-owner',
      nativeRef: 'native-table-ref',
      nativeId: 'table',
      sourceRange: context[0].sourceRange,
      construct: 'htmlTable',
      htmlSource: context[0].kind === 'boundary' ? context[0].htmlSource : undefined,
    },
  ]);
  expect(retained.native.references['exact-owner']).toBeUndefined();
  expect(retained.native.references['native-table-ref']).toEqual(['table']);
  expect(native.references['exact-owner']).toEqual(['table-owner']);
  expect(bindings.map((binding) => binding.contextRef)).toEqual(['window-one', 'window-two']);
});
it('does not drop Markdown context following a canonical HTML table', () => {
  const { context, bindings, native } = fixture();
  context.push({
    kind: 'boundary',
    id: 'markdown',
    construct: 'paragraph',
    sourceRange: { start: 101, end: 120 },
    detailRef: 'markdown-delimiters',
  });
  const retained = retainCanonicalRegion(context, bindings, native, { start: 90, end: 110 });
  expect(retained.context).toBe(context);
  expect(retained.native).toBe(native);
  expect(retained.owners).toBeUndefined();
});
it('does not treat a repaired table hull as canonical semantic coverage', () => {
  const { context, bindings, native } = fixture();
  if (context[1].kind !== 'nativeNode') throw new Error('fixture');
  context[1].provenance = 'repaired';
  const retained = retainCanonicalRegion(context, bindings, native, { start: 60, end: 68 });
  expect(retained.context).toBe(context);
  expect(retained.owners).toBeUndefined();
});

it('resolves a dropped owner only through its captured scoped window, never source or metadata roots', () => {
  const { context, bindings, native } = fixture();
  const retained = retainCanonicalRegion(context, bindings, native, { start: 60, end: 68 });
  const identity = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
  };
  const window = {
    ...identity,
    context: retained.context,
    canonicalOwners: retained.owners,
    mapBindings: bindings,
  } as NoteWindow;
  const steps = noteCanonicalOwnerSteps(window, 'table-owner', () => true);
  expect(steps.next().value).toEqual({
    kind: 'context',
    contextRef: 'window-one',
    maxWireBytes: 8192,
    maxItems: 64,
  });
  expect(
    steps.next({
      ...identity,
      expiresAt: '2099-01-01',
      kind: 'noteContextPage',
      items: [context[0]],
      nextCursor: null,
    }),
  ).toEqual({ done: true, value: context[0] });
});
it('never substitutes a stale owner or a full-note read after an expired owner handle', () => {
  const { context, bindings, native } = fixture();
  const retained = retainCanonicalRegion(context, bindings, native, { start: 60, end: 68 });
  const identity = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
  };
  const window = {
    ...identity,
    context: retained.context,
    canonicalOwners: retained.owners,
    mapBindings: bindings,
  } as NoteWindow;
  const stale = noteCanonicalOwnerSteps(window, 'table-owner', () => true);
  stale.next();
  expect(() =>
    stale.next({
      ...identity,
      sourceRevision: 'new-r',
      expiresAt: '2099-01-01',
      kind: 'noteContextPage',
      items: [context[0]],
      nextCursor: null,
    }),
  ).toThrow('snapshot mismatch');
  expect(stale.next().done).toBe(true);
  const expired = noteCanonicalOwnerSteps(window, 'table-owner', () => true);
  expired.next();
  const failure = new Error('snapshot expired');
  expect(() => expired.throw(failure)).toThrow(failure);
  expect(expired.next().done).toBe(true);
});

it('compacts an entirely indexed Markdown paragraph while preserving code owners and window maps', () => {
  const f = fixture();
  const owner = f.context[0];
  const paragraph = f.context[1];
  if (owner.kind !== 'boundary' || paragraph.kind !== 'nativeNode') throw new Error('fixture');
  owner.construct = 'markdownBlock';
  owner.profile = 'canonicalNote';
  owner.profileVersion = 1;
  owner.entryPath = 'markdown';
  owner.attributesRef = 'table-attrs';
  delete owner.htmlSource;
  delete owner.detailRef;
  paragraph.nodeType = 'paragraph';
  f.context.splice(2, 1);
  const code = {
    kind: 'span' as const,
    id: 'code',
    role: 'code',
    sourceRange: { start: 60, end: 64 },
    nativeRef: 'code-ref',
    codeSource: {
      profile: 'canonicalNote' as const,
      profileVersion: 1 as const,
      openingRange: { start: 60, end: 61 },
      bodyRange: { start: 61, end: 63 },
      closingRange: { start: 63, end: 64 },
    },
  };
  f.context.push(code);
  f.native.references['code-owner'] = ['code'];
  const r = retainCanonicalRegion(f.context, f.bindings, f.native, { start: 60, end: 68 });
  expect(r.owners?.[0]).toMatchObject({
    ownerId: 'table-owner',
    construct: 'markdownBlock',
    nativeId: 'table',
  });
  expect(r.context).toContain(code);
  expect(r.context).toContain(f.context[2]);
  expect(r.native.references['code-owner']).toEqual(['code']);
  expect(f.bindings).toHaveLength(2);
  expect(
    retainCanonicalRegion(f.context, f.bindings, f.native, { start: 90, end: 110 }).context,
  ).toBe(f.context);
});
