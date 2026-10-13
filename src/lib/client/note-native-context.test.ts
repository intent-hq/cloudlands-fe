import { expect, it } from 'vitest';
import { NotePageReader } from './note-page-reader';
const identity = {
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: 'r',
  snapshotId: 's',
  expiresAt: '2099-01-01T00:00:00Z',
};
const node = {
  kind: 'nativeNode',
  id: 'text-3',
  profile: 'canonicalNote',
  profileVersion: 1,
  nodeType: 'text',
  nodeClass: 'text',
  parentRef: 'paragraph-parent',
  childIndex: 3,
  sourceRange: { start: 2_000_000, end: 2_000_010 },
  provenance: 'explicit',
  attributesRef: 'empty-attrs',
};
const map = {
  kind: 'sourceMap',
  id: 'map-3',
  profile: 'canonicalNote',
  profileVersion: 1,
  ownerRef: 'cell-owner',
  textNodeId: 'text-3',
  textNodeRef: 'text-ref',
  sourceRange: { start: 2_000_000, end: 2_000_010 },
  renderedRange: { start: 500_000, end: 500_010 },
  mapping: 'identity',
  textRef: 'segment-text',
};
function read(items: unknown[]) {
  return new NotePageReader(async () => ({
    ...identity,
    kind: 'noteContextPage',
    items,
    nextCursor: null,
  })).read('w', 'n', { kind: 'context', contextRef: 'admitted-window', maxWireBytes: 8192 });
}
it('retains canonical native ancestry and absolute leaf offsets in bounded context frames', async () => {
  const p = await read([node, map]);
  expect(p).toMatchObject({ items: [node, map] });
});
it.each([
  { ...node, profileVersion: 2 },
  { ...node, childIndex: -1 },
  { ...node, parentRef: null },
  { ...node, nodeClass: 'invented' },
  { ...node, provenance: 'implicit' },
  { ...node, provenance: 'repaired' },
  { ...map, mapping: 'omitted' },
  { ...map, textNodeId: null },
  { ...map, mapping: 'identity', renderedRange: { start: 0, end: 9 } },
  { ...map, profileVersion: 2 },
  { ...map, textNodeRef: null },
])('rejects inconsistent canonical context before publishing %#', async (item) => {
  await expect(read([item])).rejects.toThrow();
});

const htmlOwner = {
  kind: 'boundary',
  id: 'cell',
  construct: 'htmlTableCell',
  sourceRange: { start: 0, end: 3_000_000 },
  parentRef: 'row',
  htmlPosition: {
    profile: 'canonicalNote',
    profileVersion: 1,
    tableRef: 'table',
    rowIndex: 100_001,
    columnIndex: 2,
    cellRole: 'data',
  },
  htmlSource: {
    provenance: 'explicit',
    openingRange: { start: 0, end: 4 },
    bodyRange: { start: 4, end: 2_999_995 },
    closingRange: { start: 2_999_995, end: 3_000_000 },
  },
  nativeRef: 'native-cell',
  attributesRef: 'attrs',
};
it('accepts stable HTML owners without inventing a source window', async () => {
  await expect(read([htmlOwner])).resolves.toMatchObject({ items: [htmlOwner] });
});
it.each([
  { ...htmlOwner, sourceMapRef: 'map' },
  { ...htmlOwner, continuationBefore: true, continuationAfter: false },
  { ...htmlOwner, sourceMapRef: 'map', continuationBefore: true },
])('rejects incomplete window-specific HTML bindings %#', async (item) => {
  await expect(read([item])).rejects.toThrow();
});

const codeOwner = {
  kind: 'span',
  id: 'code-owner',
  role: 'code',
  sourceRange: { start: 0, end: 200_008 },
  codeSource: {
    profile: 'canonicalNote',
    profileVersion: 1,
    openingRange: { start: 0, end: 100_001 },
    bodyRange: { start: 100_001, end: 100_007 },
    closingRange: { start: 100_007, end: 200_008 },
  },
  nativeRef: 'code-text',
  sourceMapRef: 'code-window-map',
};
it('validates canonical code delimiters as scalar addresses, without fetching delimiter text', async () => {
  await expect(read([codeOwner])).resolves.toMatchObject({ items: [codeOwner] });
});
it.each([
  { ...codeOwner, codeSource: undefined },
  { ...codeOwner, nativeRef: undefined },
  {
    ...codeOwner,
    codeSource: { ...codeOwner.codeSource, bodyRange: { start: 100_002, end: 100_007 } },
  },
  {
    ...codeOwner,
    codeSource: { ...codeOwner.codeSource, closingRange: { start: 100_007, end: 200_007 } },
  },
  { ...codeOwner, codeSource: { ...codeOwner.codeSource, profileVersion: 2 } },
])('rejects malformed canonical inline code ownership %#', async (item) => {
  await expect(read([item])).rejects.toThrow();
});
