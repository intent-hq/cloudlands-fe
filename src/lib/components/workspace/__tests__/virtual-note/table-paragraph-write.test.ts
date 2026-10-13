import { expect, it } from 'vitest';
import { patchTableParagraphs, type TableParagraphWrite } from './table-state';
import { SourceJournal } from './source-journal';

const source = '**bold** and _italic_';
const edit: TableParagraphWrite = {
  revision: 0,
  cell: 0,
  body: 0,
  end: source.length,
  nodeType: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: 'right' },
  block: 0,
  lastBlock: 0,
  from: 2,
  to: 2,
  paragraphs: [{ type: 'paragraph' }, { type: 'paragraph' }],
};
it('sends only a paragraph split delta for a dense oversized cell', () => {
  const dense = source + ' **bold** _italic_ `code`'.repeat(1000);
  const service = new SourceJournal(() => dense, 1);
  const write = { ...edit, revision: service.revision, end: dense.length };
  service.atomic(() => service.stageTableParagraphs(write));
  expect(service.region(0)).toBe(dense);
  expect(service.stats.maxTableWriteBytes).toBeLessThan(512);
  expect(service.stats.maxTableParagraphTransientBytes).toBe(service.stats.maxTableWriteBytes * 3);
  expect(service.stats.backingTableMetadataBytes).toBeGreaterThan(16384);
});
it('keeps split marks and rejoins paragraphs without dropping empty blocks or neighbors', () => {
  const split = patchTableParagraphs(source, undefined, edit);
  expect(split.content![0].content).toEqual([
    { type: 'text', text: 'bo', marks: [{ type: 'bold' }] },
  ]);
  expect(split.content![1].content![0]).toEqual({
    type: 'text',
    text: 'ld',
    marks: [{ type: 'bold' }],
  });
  const empty = patchTableParagraphs(source, split, {
    ...edit,
    block: 1,
    lastBlock: 1,
    from: 0,
    to: 0,
  });
  expect(empty.content![1].content).toEqual([]);
  expect(empty.content![2]).toEqual(split.content![1]);
  const joined = patchTableParagraphs(source, empty, {
    ...edit,
    lastBlock: 2,
    to: 0,
    paragraphs: [{ type: 'paragraph' }],
  });
  expect(joined.content![0].content![0]).toEqual({
    type: 'text',
    text: 'bold',
    marks: [{ type: 'bold' }],
  });
  expect(joined.content![0].content!.at(-1)).toEqual({
    type: 'text',
    text: 'italic',
    marks: [{ type: 'italic' }],
  });
  expect(joined.attrs).toEqual(edit.attrs);
});
it('rejects stale paragraph writes and rolls source and metadata back atomically', () => {
  const service = new SourceJournal(() => source, 1),
    revision = service.revision;
  expect(() =>
    service.atomic(() => service.stageTableParagraphs({ ...edit, revision: revision - 1 })),
  ).toThrow('Stale');
  expect(() =>
    service.atomic(() => {
      service.stageTableParagraphs({ ...edit, revision });
      service.stage({ from: 0, to: 0, insert: 'X' });
      throw new Error('abort atomic source admission');
    }),
  ).toThrow('abort atomic');
  expect(service.revision).toBe(revision);
  expect(service.region(0)).toBe(source);
  expect(service.stats.backingTableMetadataBytes).toBe(0);
});
it('rejects malformed ranges and oversized paragraph requests without mutation', () => {
  expect(() => patchTableParagraphs(source, undefined, { ...edit, lastBlock: 1 })).toThrow(
    'Invalid',
  );
  expect(() => patchTableParagraphs(source, undefined, { ...edit, from: 999 })).toThrow('Invalid');
  const service = new SourceJournal(() => source, 1);
  expect(() =>
    service.atomic(() =>
      service.stageTableParagraphs({
        ...edit,
        revision: service.revision,
        paragraphs: [{ type: 'paragraph', content: [{ type: 'text', text: 'X'.repeat(4096) }] }],
      }),
    ),
  ).toThrow('exceeds budget');
  expect(service.region(0)).toBe(source);
  expect(service.stats.backingTableMetadataBytes).toBe(0);
});
