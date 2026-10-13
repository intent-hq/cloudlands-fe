import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { readNoteWindow } from '../note-window-reader';
// Controlled protocol-shaped provider for reader and real saga lifecycle tests.
const defaultIdentity = {
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: 'r',
  snapshotId: 's',
  expiresAt: '2099-01-01T00:00:00Z',
};
const source = 'First prefix....Second portion..Third portion...Fourth portion..';
export function canonicalGrowthFixture(identity = defaultIdentity, padding = 0) {
  const seen: NotePageRequest[] = [];
  const owner = {
    kind: 'boundary',
    id: 'owner',
    construct: 'htmlDocument',
    profile: 'canonicalNote',
    profileVersion: 1,
    entryPath: 'html',
    sourceRange: { start: 0, end: source.length },
    nativeRef: 'doc',
    attributesRef: 'attrs',
  };
  const context = (items: unknown[]) => ({
    ...identity,
    kind: 'noteContextPage',
    items,
    nextCursor: null,
  });
  const respond = async (_method: string, params: { page: NotePageRequest }) => {
    const q = params.page as NotePageRequest;
    seen.push(q);
    if (q.kind === 'source') {
      const start = q.cursor ? Number(q.cursor) : (q.at ?? 0),
        end = Math.min(source.length, start + 16);
      return {
        ...identity,
        kind: 'noteSourcePage',
        sourceLength: source.length,
        range: { start, end },
        text: source.slice(start, end),
        contextRef: `window:${start}`,
        metadataRef: 'unused',
        previousCursor: start ? String(Math.max(0, start - 16)) : null,
        nextCursor: end < source.length ? String(end) : null,
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
                  childrenRef: padding ? 'padding' : 'empty',
                },
              ]
            : q.ref === 'padding'
              ? [
                  {
                    id: 'pad',
                    parentId: 'attrs',
                    key: 'padding',
                    type: 'string',
                    value: 'x'.repeat(padding),
                  },
                ]
              : [],
        nextCursor: null,
      };
    if (q.kind !== 'context') throw Error('Unexpected request');
    if (q.contextRef === 'owner') return context([owner]);
    if (q.contextRef.startsWith('window:')) {
      const start = Number(q.contextRef.split(':')[1]);
      return context([
        {
          ...owner,
          sourceMapRef: `maps:${start}`,
          continuationBefore: start > 0,
          continuationAfter: start + 16 < source.length,
        },
      ]);
    }
    if (['doc', 'paragraph', 'leaf'].includes(q.contextRef)) {
      const id = q.contextRef;
      return context([
        {
          kind: 'nativeNode',
          id,
          profile: 'canonicalNote',
          profileVersion: 1,
          nodeType: id === 'doc' ? 'doc' : id === 'leaf' ? 'text' : 'paragraph',
          nodeClass: id === 'leaf' ? 'text' : 'container',
          parentRef: id === 'doc' ? null : id === 'paragraph' ? 'doc' : 'paragraph',
          childIndex: 0,
          sourceRange: { start: 0, end: source.length },
          provenance: 'explicit',
          attributesRef: 'attrs',
        },
      ]);
    }
    const start = Number(q.contextRef.split(':')[1]),
      end = Math.min(source.length, start + 16);
    if (q.contextRef.startsWith('maps:'))
      return context([
        {
          kind: 'sourceMap',
          id: `map:${start}`,
          profile: 'canonicalNote',
          profileVersion: 1,
          ownerRef: 'owner',
          sourceRange: { start, end },
          renderedRange: { start, end },
          mapping: 'identity',
          textRef: `text:${start}`,
          textNodeRef: 'leaf',
          textNodeId: 'leaf',
        },
      ]);
    if (q.contextRef.startsWith('text:'))
      return context([
        {
          kind: 'fragment',
          id: `fragment:${start}`,
          field: 'renderedText',
          offset: 0,
          text: source.slice(start, end),
          nextRef: null,
        },
      ]);
    throw Error('Unexpected reference');
  };
  const reader = new NotePageReader((method, params) =>
    respond(method, { page: params.page as NotePageRequest }),
  );
  return {
    seen,
    respond,
    page: (q: NotePageRequest) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
    read: (minimumEnd?: number) =>
      readNoteWindow((q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q), {
        ...identity,
        at: 0,
        ...(minimumEnd === undefined ? {} : { minimumEnd }),
      }),
  };
}
