import { describe, expect, it } from 'vitest';
import type { ArtifactDocument } from '$shared/types/visual-artifact';
import {
  createSelectionSnapshot,
  findArtifactDocument,
  isBoundedJson,
  parseArtifactBlock,
  serializeArtifactBlock,
} from './model';

const board: ArtifactDocument = {
  version: 1,
  id: 'design',
  title: 'Design alternatives',
  kind: 'board',
  items: [
    { id: 'a', type: 'card', text: 'Keep this', x: 0, y: 0, width: 180, height: 120 },
    { id: 'b', type: 'card', text: 'Rework this', x: 240, y: 0, width: 180, height: 120 },
  ],
  connections: [{ id: 'edge', from: 'a', to: 'b' }],
  annotations: [],
};

describe('artifact documents and selections', () => {
  it('preserves Unicode and fence-like user content through note serialization', () => {
    const document = {
      ...board,
      title: '设计',
      items: [{ ...board.items[0], text: '</script>\n```\n~~~\n😀' }],
      connections: [],
    };
    const fence = serializeArtifactBlock({ document });
    expect(
      findArtifactDocument('# Other content\n' + fence + '\nKeep this prose', 'design')?.document,
    ).toEqual(document);
    expect(fence).not.toContain('</script>');
  });
  it('rejects dangling edges, duplicate identities, mixed ref/document shapes and malformed JSON', () => {
    expect(
      parseArtifactBlock({
        document: { ...board, connections: [{ id: 'e', from: 'a', to: 'missing' }] },
      }),
    ).toBeNull();
    expect(
      parseArtifactBlock({ document: { ...board, items: [board.items[0], board.items[0]] } }),
    ).toBeNull();
    expect(parseArtifactBlock({ document: board, noteId: 'n', artifactId: 'design' })).toBeNull();
    expect(parseArtifactBlock('{"document":')).toBeNull();
    expect(
      parseArtifactBlock({ noteId: 'n', artifactId: 'design', workspaceId: 'other' }),
    ).toBeNull();
  });
  it('requires unambiguous canonical identity and a complete matching fence', () => {
    const block = serializeArtifactBlock({ document: board });
    expect(findArtifactDocument(block + '\n' + block, 'design')).toBeNull();
    expect(findArtifactDocument(block.slice(0, -3), 'design')).toBeNull();
    expect(findArtifactDocument('````text\n' + block + '\n````', 'design')).toBeNull();
    expect(findArtifactDocument(block.replaceAll('```', '~~~~'), 'design')?.document).toEqual(
      board,
    );
    expect(
      findArtifactDocument(
        serializeArtifactBlock({ noteId: 'other', artifactId: 'design' }),
        'design',
      ),
    ).toBeNull();
  });
  it('captures selected objects immutably without unrelated objects or edges', () => {
    const source = { workspaceId: 'ws', noteId: 'n', artifactId: 'design', revision: 7 };
    const selection = { itemIds: ['a'] };
    const snapshot = createSelectionSnapshot(board, selection, source, 'Use this');
    selection.itemIds.push('b');
    source.revision = 8;
    expect(snapshot.selection.itemIds).toEqual(['a']);
    expect(snapshot.items.map((i) => i.text)).toEqual(['Keep this']);
    expect(snapshot.connections).toEqual([]);
    expect(snapshot.source.revision).toBe(7);
    expect(snapshot.comment).toBe('Use this');
    expect(() => createSelectionSnapshot(board, { itemIds: ['missing'] }, source)).toThrow();
  });
  it('rejects invalid regions and bounds recursive data before validation', () => {
    expect(() =>
      createSelectionSnapshot(
        board,
        { itemIds: [], region: { x: 0.9, y: 0, width: 0.2, height: 0.5 } },
        { workspaceId: 'w', artifactId: 'design' },
      ),
    ).toThrow();
    let deep: unknown = 0;
    for (let n = 0; n < 30; n++) deep = { next: deep };
    expect(isBoundedJson(deep)).toBe(false);
    expect(isBoundedJson({ bad: Infinity })).toBe(false);
    expect(isBoundedJson('😀'.repeat(10), 20)).toBe(false);
    expect(isBoundedJson({ selected: ['a'], value: null })).toBe(true);
  });
  it('rejects external image sources and oversized saved preview state at the document boundary', () => {
    for (const src of ['https://example.org/image.png', 'data:image/svg+xml;base64,AAAA']) {
      expect(
        parseArtifactBlock({ document: { ...board, kind: 'image', image: { src, alt: 'Image' } } }),
      ).toBeNull();
    }
    expect(
      parseArtifactBlock({
        document: {
          ...board,
          kind: 'preview',
          html: '<p>Preview</p>',
          previewState: 'x'.repeat(32769),
        },
      }),
    ).toBeNull();
    expect(
      parseArtifactBlock({
        document: {
          ...board,
          kind: 'image',
          image: { src: 'intent://local/ws/file/screens/shot.png', alt: 'Image' },
        },
      }),
    ).not.toBeNull();
  });
  it('rejects a snapshot attributed to another artifact or a region without an image', () => {
    expect(() =>
      createSelectionSnapshot(board, { itemIds: [] }, { workspaceId: 'ws', artifactId: 'other' }),
    ).toThrow();
    expect(() =>
      createSelectionSnapshot(
        board,
        { itemIds: [], region: { x: 0, y: 0, width: 0.5, height: 0.5 } },
        { workspaceId: 'ws', artifactId: board.id },
      ),
    ).toThrow();
  });
});
