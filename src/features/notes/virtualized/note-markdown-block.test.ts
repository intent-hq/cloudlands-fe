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
// Controlled validation fixture for the explicit Markdown-entry paragraph owner.
// Native semantics are independently frozen in html-table-entry-oracle.test.ts.
const length = 2_000_008;
const blockRange = { start: 11, end: length };
const owner = {
  kind: 'boundary',
  id: 'markdown-owner',
  construct: 'markdownBlock',
  profile: 'canonicalNote',
  profileVersion: 1,
  entryPath: 'markdown',
  sourceRange: blockRange,
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
describe('canonical Markdown paragraph owner wire contract', () => {
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
    { sourceRange: { start: length, end: length } },
    { nativeRef: '' },
    { attributesRef: '' },
    { parentRef: 'parent' },
    { detailRef: 'detail' },
    { htmlPosition: {} },
    { htmlSource: {} },
    { sourceMapRef: undefined },
    { continuationBefore: undefined },
  ])('rejects a forged paragraph owner %j', async (change) => {
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
            id: 'paragraph',
            profile: 'canonicalNote',
            profileVersion: 1,
            nodeType: 'paragraph',
            nodeClass: 'container',
            parentRef: 'doc-root',
            childIndex: 1,
            sourceRange: owner.sourceRange,
            provenance: 'explicit',
            attributesRef: 'attrs',
            ...change.root,
          },
        ]),
        snapshotId: change.snapshot ?? identity.snapshotId,
      };
    if (q.contextRef === 'doc-root')
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
          sourceRange: { start: 0, end: length },
          provenance: 'explicit',
          attributesRef: 'attrs',
        },
      ]);
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
describe('canonical Markdown paragraph owner assembly', () => {
  it('resolves a far paragraph owner and native ancestors without a prefix or child directory read', async () => {
    const p = provider();
    const result = await p.read();
    expect(result.text).toBe('**Tail**');
    expect(result.canonicalOwners).toContainEqual(
      expect.objectContaining({
        ownerId: owner.id,
        construct: 'markdownBlock',
        nativeRef: 'root',
        nativeId: 'paragraph',
        sourceRange: blockRange,
      }),
    );
    expect(result.mapBindings).toHaveLength(1);
    expect(p.seen.filter((q) => q.kind === 'source')).toHaveLength(1);
    expect(p.seen).toHaveLength(8);
    expect(result.cost.sourceBytes).toBe(8);
    expect(result.cost.contextBytes).toBeLessThan(8192);
  });
  it('rejects a stable owner substituted for a window occurrence', async () => {
    await expect(provider({ directWindow: true }).read()).rejects.toThrow(/markdown.*mapping/i);
  });
  it('rejects a paragraph envelope beyond the source length', async () => {
    await expect(
      provider({ owner: { sourceRange: { start: 11, end: length + 1 } } }).read(),
    ).rejects.toThrow(/markdown.*range/i);
  });
  it('accepts the heading owner emitted by the daemon for a Markdown heading', async () => {
    // Regression from the real 9cb9054f transport: a markdownBlock boundary
    // points to a heading container, with matching range/profile/attributes.
    const result = await provider({ root: { nodeType: 'heading' } }).read();
    expect(result.text).toBe('**Tail**');
    expect(result.context).toContainEqual(
      expect.objectContaining({ kind: 'nativeNode', nodeType: 'heading', sourceRange: blockRange }),
    );
  });
  it.each(['blockquote', 'codeBlock', 'table', 'unknown'])(
    'rejects unsupported %s owners',
    async (nodeType) => {
      await expect(provider({ root: { nodeType } }).read()).rejects.toThrow(/markdown.*owner/i);
    },
  );
  it('rejects mismatched paragraph attributes', async () => {
    await expect(provider({ root: { attributesRef: 'different' } }).read()).rejects.toThrow(
      /markdown.*owner/i,
    );
  });
  it('rejects a root from the snapshot before a prefix-mode edit', async () => {
    await expect(provider({ snapshot: 'old-snapshot' }).read()).rejects.toThrow(/snapshot/i);
  });
});

it.each([{ parentRef: null }, { sourceRange: { start: 12, end: length } }])(
  'rejects a detached or differently scoped native paragraph %j',
  async (root) => {
    await expect(provider({ root }).read()).rejects.toThrow(
      'parentRef' in root ? /Invalid canonical native node/ : /markdown.*owner/i,
    );
  },
);
