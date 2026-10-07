import type { NotePageRequest, NoteSourcePage } from '$lib/client/note-pages';

export function fullNotePageFixture(
  q: NotePageRequest,
  source: string,
  identity: Pick<NoteSourcePage, 'scope' | 'sourceRevision' | 'snapshotId' | 'expiresAt'>,
  options: { chunk?: number; canonicalPadding?: number } = {},
): unknown {
  if (q.kind === 'source') {
    const start = q.cursor ? Number(q.cursor.slice(1)) : (q.at ?? 0);
    const end = Math.min(
      source.length,
      start + Math.min(q.maxSourceBytes ?? 4096, options.chunk ?? 1024),
    );
    return {
      ...identity,
      kind: 'noteSourcePage',
      sourceLength: source.length,
      range: { start, end },
      text: source.slice(start, end),
      previousCursor: start ? 'b' + start : null,
      nextCursor: end < source.length ? 'f' + end : null,
      contextRef: `c:${start}:${end}`,
      metadataRef: 'm',
    };
  }
  const profile = { profile: 'canonicalNote', profileVersion: 1 };
  const owner = {
    ...profile,
    kind: 'boundary',
    id: 'owner',
    construct: 'markdownBlock',
    entryPath: 'markdown',
    sourceRange: { start: 0, end: source.length },
    nativeRef: 'paragraph',
    attributesRef: 'attrs',
  };
  if (q.kind === 'context') {
    const [kind, rawStart, rawEnd] = (q.contextRef ?? '').split(':');
    const start = Number(rawStart),
      end = Number(rawEnd);
    let items: unknown[];
    if (kind === 'c')
      items = [
        {
          ...owner,
          sourceMapRef: `maps:${start}:${end}`,
          continuationBefore: start > 0,
          continuationAfter: end < source.length,
        },
      ];
    else if (kind === 'owner') items = [owner];
    else if (kind === 'maps')
      items = [
        {
          ...profile,
          kind: 'sourceMap',
          id: `map:${start}:${end}`,
          ownerRef: 'owner',
          textNodeId: 'text',
          textNodeRef: 'text',
          sourceRange: { start, end },
          renderedRange: { start, end },
          mapping: 'identity',
          textRef: `rendered:${start}:${end}`,
        },
      ];
    else if (kind === 'rendered')
      items = [
        {
          kind: 'fragment',
          id: 'part',
          field: 'renderedText',
          offset: 0,
          text: source.slice(start, end),
          nextRef: null,
        },
      ];
    else if (['doc', 'paragraph', 'text'].includes(kind))
      items = [
        {
          ...profile,
          kind: 'nativeNode',
          id: kind,
          nodeType: kind,
          nodeClass: kind === 'text' ? 'text' : 'container',
          parentRef: kind === 'doc' ? null : kind === 'text' ? 'paragraph' : 'doc',
          childIndex: 0,
          sourceRange: { start: 0, end: source.length },
          provenance: 'explicit',
          attributesRef: 'attrs',
        },
      ];
    else throw new Error('Unexpected canonical reference ' + kind);
    return { ...identity, kind: 'noteContextPage', items, nextCursor: null };
  }
  if (q.kind === 'metadata')
    return {
      ...identity,
      kind: 'noteMetadataPage',
      items:
        q.ref === 'attrs'
          ? [
              {
                id: 'attribute-root',
                parentId: null,
                type: 'object',
                childrenRef: options.canonicalPadding ? 'padding-attrs' : 'empty-attrs',
              },
            ]
          : q.ref === 'padding-attrs'
            ? [
                {
                  id: 'padding',
                  parentId: 'attribute-root',
                  key: 'padding',
                  type: 'string',
                  value: 'x'.repeat(options.canonicalPadding ?? 0),
                },
              ]
            : [],
      nextCursor: null,
    };
  throw new Error('Unexpected paged method');
}
