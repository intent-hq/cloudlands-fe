import { describe, expect, it } from 'vitest';
import type { NoteWindow } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';
const identity = {
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: 'opaque-rev',
  snapshotId: 's',
};
function window(text: string, start = 0): NoteWindow {
  return {
    ...identity,
    text,
    range: { start, end: start + text.length },
    sourceLength: 3_000_000,
    context: [],
    mapBindings: [],
    details: {},
    documentEnd: false,
    cost: {
      requests: 2,
      wireBytes: text.length + 100,
      sourceBytes: new TextEncoder().encode(text).length,
      contextBytes: 0,
      assemblyPeakBytes: text.length * 2,
    },
  };
}
const boundary = (id: string, construct: string, start: number, end: number) => ({
  kind: 'boundary' as const,
  id,
  construct,
  sourceRange: { start, end },
  continuationBefore: true,
  continuationAfter: true,
});
describe('wire context to bounded native projection', () => {
  it('retains bold and link identity when both delimiters are outside a giant paragraph window', () => {
    const w = window('visible café 🌍', 1_000_000);
    w.context = [
      boundary('p', 'paragraph', 0, w.sourceLength),
      boundary('bold', 'strong', 500, 2_000_000),
      boundary('link', 'link', 900, 1_900_000),
    ];
    w.details = {
      bold: { openingSource: '**', closingSource: '**' },
      link: {
        openingSource: '[',
        closingSource: '](https://example.test)',
        destination: 'https://example.test',
        linkType: 'Inline',
      },
    };
    const p = projectNoteWindow(w);
    expect(p.content.content?.[0].content?.[0]).toMatchObject({
      type: 'text',
      text: 'visible café 🌍',
      marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.test' } }],
    });
    expect(p.sourceAt(1)).toBe(1_000_000);
    expect(p.sourceAt(1 + w.text.length)).toBe(1_000_000 + w.text.length);
  });
  it('renders an unloaded fence as code without interpreting Markdown in its body', () => {
    const w = window('**raw**\nconst café = 1;', 200_000);
    w.context = [boundary('f', 'codeBlock', 0, w.sourceLength)];
    w.details = {
      f: {
        openingSource: '```typescript\n',
        closingSource: '\n```',
        codeStyle: 'fenced',
        info: 'typescript',
      },
    };
    const p = projectNoteWindow(w);
    expect(p.content.content?.[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: w.text }],
    });
    expect(p.sourceAt(1)).toBe(w.range.start);
  });
  it('retains nested task ancestors without loading preceding siblings', () => {
    const w = window('child café', 500);
    w.context = [
      boundary('list', 'list', 0, 2000),
      boundary('parent', 'listItem', 0, 1800),
      boundary('nested', 'list', 400, 1700),
      boundary('item', 'listItem', 450, 1600),
    ];
    w.details = {
      list: { listStart: 'unordered' },
      parent: { openingSource: '- ', closingSource: '\n' },
      nested: { listStart: 'unordered' },
      item: { openingSource: '  - [x] ', closingSource: '\n' },
    };
    const p = projectNoteWindow(w);
    expect(p.content.content?.[0].type).toBe('bulletList');
    expect(JSON.stringify(p.content)).toContain('taskItem');
    expect(p.pmAt(500)).toBeGreaterThan(1);
  });
  it('refuses unknown syntax explicitly rather than silently omitting source', () => {
    const w = window('new grammar');
    w.context = [boundary('new', 'futureConstruct', 0, 11)];
    expect(() => projectNoteWindow(w)).toThrow(/Unsupported note construct: futureConstruct/);
  });
  it('rejects missing structural details rather than guessing a giant fence', () => {
    const w = window('code', 1000);
    w.context = [boundary('f', 'codeBlock', 0, 3000000)];
    expect(() => projectNoteWindow(w)).toThrow(/Missing.*codeBlock/);
  });
});

it('renders a distant table cell at its absolute address and local alignment without preceding cells', () => {
  const w = window('visible cell', 2_000_000);
  w.context = [
    boundary('table', 'table', 0, 3_000_000),
    {
      ...boundary('row', 'tableRow', 1_999_000, 2_001_000),
      tablePosition: { tableRef: 'table-owner', rowIndex: 100001 },
    },
    {
      ...boundary('cell', 'tableCell', 2_000_000, 2_000_012),
      tablePosition: {
        tableRef: 'table-owner',
        rowIndex: 100001,
        columnIndex: 2,
        alignment: 'right',
      },
    },
  ];
  w.details = { cell: { openingSource: '', closingSource: '' } };
  const p = projectNoteWindow(w);
  const table = p.content.content![0];
  expect(table.type).toBe('table');
  expect(table.content).toHaveLength(1);
  expect(table.content![0].content).toHaveLength(1);
  expect(table.content![0].content![0]).toMatchObject({
    type: 'tableCell',
    attrs: { align: 'right' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'visible cell' }] }],
  });
  expect(p.table!.window.cells[0]).toMatchObject({
    row: 100001,
    column: 2,
    first: 2_000_000,
    last: 2_000_012,
  });
  expect(p.sourceAt(p.pmAt(2_000_000))).toBe(2_000_000);
});

it('renders inline code, strike and underscore bold with exact source positions', () => {
  const w = window('`a ** b` ~~gone~~ __bold__');
  w.context = [
    boundary('p', 'paragraph', 0, w.text.length),
    boundary('s', 'strikethrough', 9, 17),
    boundary('b', 'strong', 18, 26),
  ];
  w.details = {
    s: { openingSource: '~~', closingSource: '~~' },
    b: { openingSource: '__', closingSource: '__' },
  };
  const p = projectNoteWindow(w);
  const text = p.content.content![0].content!;
  expect(text.some((n) => n.text === 'a ** b' && n.marks?.some((m) => m.type === 'code'))).toBe(
    true,
  );
  expect(text.some((n) => n.text === 'gone' && n.marks?.some((m) => m.type === 'strike'))).toBe(
    true,
  );
  expect(text.some((n) => n.text === 'bold' && n.marks?.some((m) => m.type === 'bold'))).toBe(true);
  expect(p.sourceAt(p.pmAt(2))).toBe(2);
});

it('retains inherited strike inside a giant table cell without its delimiters', () => {
  const w = window('far cell', 1_000_000);
  w.context = [
    boundary('t', 'table', 0, 3_000_000),
    {
      ...boundary('c', 'tableCell', 100, 2_000_000),
      tablePosition: { tableRef: 't-owner', rowIndex: 900, columnIndex: 2, alignment: 'left' },
    },
    boundary('s', 'strikethrough', 200, 1_900_000),
  ];
  w.details = {
    c: { openingSource: ' ', closingSource: ' ' },
    s: { openingSource: '~~', closingSource: '~~' },
  };
  const p = projectNoteWindow(w);
  expect(p.table!.window.cells[0].runs.every((r) => r.marks.some((m) => m.type === 'strike'))).toBe(
    true,
  );
});

it('keeps heading identity on a far window and does not expose unloaded heading markers', () => {
  const w = window('distant title', 2_000_000);
  w.context = [boundary('heading', 'heading', 0, 3_000_000)];
  w.details = { heading: { openingSource: '## ', closingSource: '\n', level: 'h2' } };
  const p = projectNoteWindow(w);
  expect(p.content.content).toEqual([
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'distant title', marks: [] }],
    },
  ]);
  expect(p.sourceAt(1)).toBe(2_000_000);
  expect(p.sourceAt(p.pmAt(2_000_005))).toBe(2_000_005);
});
it('preserves heading/prose boundaries and source coordinates in a mixed source window', () => {
  const w = window('## Title\n\nBody');
  w.context = [boundary('h', 'heading', 0, 9), boundary('p', 'paragraph', 10, 14)];
  w.details = { h: { openingSource: '## ', closingSource: '\n', level: 'h2' } };
  const p = projectNoteWindow(w);
  expect(p.content.content?.map((n) => n.type)).toEqual(['heading', 'paragraph']);
  expect(p.content.content?.[0].content?.[0].text).toBe('Title');
  expect(p.sourceAt(p.pmAt(3))).toBe(3);
  expect(p.sourceAt(p.pmAt(10))).toBe(10);
});
