import { describe, expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { readNoteWindow } from './note-window-reader';

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
  construct: 'htmlDocument',
  profile: 'canonicalNote',
  profileVersion: 1,
  entryPath: 'html',
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
describe('canonical HTML document owner wire contract', () => {
  it('accepts a stable direct owner without window fields', async () => {
    await expect(validate(owner)).resolves.toMatchObject({ items: [owner] });
  });
  it('accepts an explicit window occurrence', async () => {
    await expect(validate(occurrence)).resolves.toMatchObject({ items: [occurrence] });
  });
  it.each([
    { profile: 'other' },
    { profileVersion: 2 },
    { entryPath: 'markdown' },
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
  change: { owner?: object; root?: object; snapshot?: string; directWindow?: boolean } = {},
) {
  const seen: NotePageRequest[] = [];
  const selected = { ...owner, ...change.owner };
  const reader = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    seen.push(q);
    if (q.kind === 'source')
      return {
        ...identity,
        kind: 'noteSourcePage',
        sourceLength: length,
        range: { start: length - 8, end: length },
        text: '**Tail**',
        contextRef: 'window',
        metadataRef: 'never-read',
        previousCursor: 'previous',
        nextCursor: null,
      };
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
    if (q.contextRef === 'window')
      return context([
        { ...selected, sourceMapRef: 'maps', continuationBefore: true, continuationAfter: false },
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
            sourceRange: owner.sourceRange,
            provenance: 'explicit',
            attributesRef: 'attrs',
            ...change.root,
          },
        ]),
        snapshotId: change.snapshot ?? identity.snapshotId,
      };
    if (q.contextRef === 'owner') return context([selected]);
    if (q.contextRef === 'maps')
      return context([
        {
          kind: 'sourceMap',
          id: 'omitted',
          profile: 'canonicalNote',
          profileVersion: 1,
          ownerRef: 'owner',
          sourceRange: { start: length - 8, end: length },
          renderedRange: { start: 0, end: 0 },
          mapping: 'omitted',
          textRef: null,
          textNodeId: null,
          textNodeRef: null,
        },
      ]);
    throw new Error('Unexpected context reference ' + q.contextRef);
  });
  return {
    seen,
    read: () =>
      readNoteWindow((q) => reader.read('ws', 'note', q), { ...identity, at: length - 8 }),
  };
}
describe('canonical HTML document owner assembly', () => {
  it('resolves a far-tail owner and root without a prefix or child directory read', async () => {
    const p = provider();
    const result = await p.read();
    expect(result.text).toBe('**Tail**');
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
