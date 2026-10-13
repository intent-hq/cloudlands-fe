import { expect, it } from 'vitest';
import { patchTableInline, type TableInlineWrite } from './table-state';
import { SourceJournal } from './source-journal';

const source = '**bold** and _italic_';
const edit: TableInlineWrite = {
  revision: 0,
  cell: 0,
  body: 0,
  end: source.length,
  nodeType: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: 'right' },
  block: 0,
  from: 2,
  to: 2,
  content: [{ type: 'text', text: 'Z', marks: [{ type: 'bold' }] }],
};
it('applies a small native edit without transmitting the surrounding dense cell', () => {
  const dense = source + ' **bold** _italic_ `code` \\| \\\\ '.repeat(1500);
  const write = { ...edit, end: dense.length };
  const result = patchTableInline(dense, undefined, write);
  expect(result.content![0].content![0]).toEqual({
    type: 'text',
    text: 'boZld',
    marks: [{ type: 'bold' }],
  });
  expect(result.content![0].content!.slice(1)).toEqual(
    patchTableInline(dense, undefined, { ...write, content: [] }).content![0].content!.slice(1),
  );
  expect(result.attrs).toEqual(edit.attrs);
  const backing = new SourceJournal(() => dense, 1);
  write.revision = backing.revision;
  backing.atomic(() => backing.stageTableInline(write));
  expect(backing.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
  expect(backing.stats.backingTableMetadataBytes).toBeGreaterThan(16384);
  expect(backing.region(0)).toBe(dense);
});
it('keeps native empty paragraphs and marks outside the edited block', () => {
  const original = {
    type: 'tableCell',
    attrs: edit.attrs,
    content: [
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'code', marks: [{ type: 'code' }] }] },
      { type: 'paragraph' },
    ],
  };
  const result = patchTableInline('', original, {
    ...edit,
    block: 1,
    from: 1,
    to: 3,
    content: [{ type: 'text', text: 'X', marks: [{ type: 'code' }] }],
  });
  expect(result).toEqual({
    ...original,
    content: [
      original.content[0],
      { type: 'paragraph', content: [{ type: 'text', text: 'cXe', marks: [{ type: 'code' }] }] },
      original.content[2],
    ],
  });
  expect(original.content[1].content![0].text).toBe('code');
});
it('rejects stale writes and rolls back admitted metadata on transaction failure', () => {
  const backing = new SourceJournal(() => source, 1);
  const revision = backing.revision;
  expect(() =>
    backing.atomic(() => backing.stageTableInline({ ...edit, revision: revision - 1 })),
  ).toThrow('Stale');
  expect(() =>
    backing.atomic(() => {
      backing.stageTableInline({ ...edit, revision });
      throw new Error('abort source admission');
    }),
  ).toThrow('abort source admission');
  expect(backing.revision).toBe(revision);
  expect(backing.stats.backingTableMetadataBytes).toBe(0);
  expect(backing.region(0)).toBe(source);
  expect(() => patchTableInline(source, undefined, { ...edit, to: 9999 })).toThrow('Invalid');
});
