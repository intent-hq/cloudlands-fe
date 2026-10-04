import { expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { readNoteWindow } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';
import { NoteCanonicalProjection } from './note-canonical-projection';
const profile = { profile: 'canonicalNote', profileVersion: 1 };
const identity = {
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: 'r',
  snapshotId: 's',
  expiresAt: '2099-01-01T00:00:00Z',
};
function editor(content: string | JSONContent) {
  return new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content,
      editable: false,
      useMarkdown: true,
      workspace: { id: 'w' },
      enableNotePrimitives: true,
      enableMentions: true,
      enableComments: false,
      onUpdate: () => {},
    }),
  );
}

it.each(['td', 'th'])(
  'renders the actual native %s subtree after a multimegabyte earlier cell',
  async (role) => {
    const source =
      '<table><tr><td>' +
      'x'.repeat(2_000_000) +
      '</td><td>SECOND</td><' +
      role +
      '><strong>TARGET</strong></' +
      role +
      '></tr></table>';
    const at = source.indexOf('TARGET');
    const original = editor(
      await processMarkdownToHTML(source, { workspaceId: 'w', preserveAnchors: true }),
    );
    try {
      const root = original.getJSON();
      const table = root.content![0],
        row = table.content![0],
        cell = row.content![2],
        paragraph = cell.content![0],
        text = paragraph.content![0];
      const chain = [root, table, row, cell, paragraph, text];
      const contexts: Record<string, unknown[]> = {};
      const metadata: Record<string, unknown[]> = {};
      let sequence = 0;
      function attributes(value: unknown): string {
        const ref = 'attrs-' + sequence++;
        function entry(
          value: unknown,
          parentId: string | null,
          address: Record<string, unknown>,
        ): Record<string, unknown> {
          const id = 'attr-' + sequence++;
          if (value !== null && typeof value === 'object') {
            const childrenRef = 'children-' + sequence++;
            metadata[childrenRef] = Object.entries(value).map(([key, v]) =>
              entry(v, id, Array.isArray(value) ? { index: Number(key) } : { key }),
            );
            return {
              id,
              parentId,
              ...address,
              type: Array.isArray(value) ? 'array' : 'object',
              childrenRef,
            };
          }
          return { id, parentId, ...address, type: value === null ? 'null' : typeof value, value };
        }
        metadata[ref] = [entry(value, null, {})];
        return ref;
      }
      const tableAttrs = attributes(table.attrs ?? {});
      const owner = {
        kind: 'boundary',
        id: 'table-owner',
        construct: 'htmlTable',
        sourceRange: { start: 0, end: source.length },
        htmlPosition: { ...profile, tableRef: 'owner' },
        htmlSource: {
          provenance: 'explicit',
          openingRange: { start: 0, end: 7 },
          bodyRange: { start: 7, end: source.length - 8 },
          closingRange: { start: source.length - 8, end: source.length },
        },
        attributesRef: tableAttrs,
        nativeRef: 'node-1',
      };
      contexts.owner = [owner];
      contexts.window = [
        { ...owner, sourceMapRef: 'maps', continuationBefore: true, continuationAfter: false },
      ];
      contexts.maps = [
        {
          ...profile,
          kind: 'sourceMap',
          id: 'target-map',
          ownerRef: 'owner',
          textNodeId: 'id-5',
          textNodeRef: 'node-5',
          sourceRange: { start: at, end: at + 6 },
          renderedRange: { start: 0, end: 6 },
          mapping: 'identity',
          textRef: 'text',
        },
        {
          ...profile,
          kind: 'sourceMap',
          id: 'tail-map',
          ownerRef: 'owner',
          textNodeId: null,
          textNodeRef: null,
          sourceRange: { start: at + 6, end: source.length },
          renderedRange: { start: 0, end: 0 },
          mapping: 'omitted',
          textRef: null,
        },
      ];
      contexts.text = [
        {
          kind: 'fragment',
          id: 'text',
          field: 'renderedText',
          offset: 0,
          text: 'TARGET',
          nextRef: null,
        },
      ];
      chain.forEach((node, index) => {
        contexts['node-' + index] = [
          {
            ...profile,
            kind: 'nativeNode',
            id: 'id-' + index,
            nodeType: node.type,
            nodeClass: index === 5 ? 'text' : 'container',
            parentRef: index ? 'node-' + (index - 1) : null,
            childIndex: index === 3 ? 2 : 0,
            sourceRange:
              index === 4
                ? { start: at, end: at }
                : index === 5
                  ? { start: at, end: at + 6 }
                  : index === 3
                    ? {
                        start: source.lastIndexOf('<' + role + '>', at),
                        end: source.indexOf('</' + role + '>', at) + role.length + 3,
                      }
                    : index === 2
                      ? { start: 7, end: source.lastIndexOf('</tr>') + 5 }
                      : { start: 0, end: source.length },
            provenance: index === 4 ? 'implicit' : 'explicit',
            attributesRef: index === 1 ? tableAttrs : attributes(node.attrs ?? {}),
            ...(node.marks ? { marksRef: attributes(node.marks) } : {}),
          },
        ];
      });
      const requests: NotePageRequest[] = [];
      const reader = new NotePageReader(async (_, params) => {
        const q = params.page as NotePageRequest;
        requests.push(q);
        if (q.kind === 'source')
          return {
            ...identity,
            kind: 'noteSourcePage',
            sourceLength: source.length,
            range: { start: at, end: source.length },
            text: source.slice(at),
            previousCursor: 'before',
            nextCursor: null,
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
          return {
            ...identity,
            kind: 'noteMetadataPage',
            items: metadata[q.ref],
            nextCursor: null,
          };
        throw new Error('Unexpected resource');
      });
      const window = await readNoteWindow((q) => reader.read('w', 'n', q), { ...identity, at });
      const projection = projectNoteWindow(window);
      const mounted = editor(projection.content);
      try {
        const projectedCell = mounted.getJSON().content![0].content![0].content![0];
        expect(projectedCell).toEqual(cell);
        expect(mounted.state.doc.textContent).toBe('TARGET');
        expect(projection.sourceAt(4)).toBe(at);
        expect(projection.sourceAt(10)).toBe(at + 6);
        expect(
          (projection as NoteCanonicalProjection).nativeEntries.find((n) => n.id === 'id-3'),
        ).toMatchObject({ childIndex: 2, nodeType: role === 'td' ? 'tableCell' : 'tableHeader' });
        expect(requests.filter((q) => q.kind === 'source')).toHaveLength(1);
        expect(requests.length).toBeLessThan(40);
        expect(window.cost.sourceBytes).toBeLessThan(64);
        expect(window.cost.contextBytes).toBeLessThanOrEqual(8192);
      } finally {
        mounted.destroy();
      }
    } finally {
      original.destroy();
    }
  },
);
