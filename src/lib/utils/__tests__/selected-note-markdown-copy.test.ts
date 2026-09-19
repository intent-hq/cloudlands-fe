/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { CellSelection } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it, vi } from 'vitest';
import {
  handleNoteEditorCopyAsMarkdown,
  serializeSelectionToMarkdown,
} from '../selected-note-markdown-copy';

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false, renderWrapper: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
  });
}

function findText(editor: Editor, text: string): { from: number; to: number } {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from !== -1 || !node.isText) {
      return from === -1;
    }
    const index = node.text?.indexOf(text) ?? -1;
    if (index !== -1) {
      from = pos + index;
    }
    return false;
  });
  expect(from).toBeGreaterThan(-1);
  return { from, to: from + text.length };
}

function selectText(editor: Editor, startText: string, endText: string = startText): void {
  const { from } = findText(editor, startText);
  const { to } = findText(editor, endText);
  editor.commands.setTextSelection({ from, to });
}

function selectCells(editor: Editor, anchorIndex: number, headIndex: number): void {
  const cellPositions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      cellPositions.push(pos);
      return false;
    }
    return true;
  });
  const selection = CellSelection.create(
    editor.state.doc,
    cellPositions[anchorIndex]!,
    cellPositions[headIndex]!,
  );
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

const TABLE_HTML = `
  <table>
    <tbody>
      <tr><th><p>Header one</p></th><th><p>Header two</p></th></tr>
      <tr><td><p>過去，工作是寫程式碼。</p><p>Second paragraph</p></td><td><p>Other cell</p></td></tr>
    </tbody>
  </table>
`;

describe('selected note markdown copy', () => {
  it('serializes selected rich note content to markdown', () => {
    const editor = createEditor(`
      <h2>Heading</h2>
      <p><strong>Bold</strong> and <em>em</em> with <code>code</code> and <a href="https://example.com">link</a></p>
      <blockquote><p>Quoted text</p></blockquote>
      <ul><li><p>Bullet item</p></li></ul>
      <ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Done task</p></div></li></ul>
      <pre><code class="language-ts">const value = 1;</code></pre>
    `);

    editor.commands.selectAll();
    const markdown = serializeSelectionToMarkdown(editor.view);

    expect(markdown).toContain('## Heading');
    expect(markdown).toContain('**Bold** and *em* with `code` and [link](https://example.com)');
    expect(markdown).toContain('> Quoted text');
    expect(markdown).toContain('- Bullet item');
    expect(markdown).toContain('- [x] Done task');
    expect(markdown).toContain('```');
    expect(markdown).toContain('const value = 1;');

    editor.destroy();
  });

  it('copies text selected inside a single table cell as plain text', () => {
    const editor = createEditor(TABLE_HTML);
    selectText(editor, '過去，工作是寫程式碼。');

    expect(serializeSelectionToMarkdown(editor.view)).toBe('過去，工作是寫程式碼。');

    editor.destroy();
  });

  it('copies text selected inside a single table header cell as plain text', () => {
    const editor = createEditor(TABLE_HTML);
    selectText(editor, 'Header one');

    expect(serializeSelectionToMarkdown(editor.view)).toBe('Header one');

    editor.destroy();
  });

  it('copies two paragraphs selected inside one cell without table syntax', () => {
    const editor = createEditor(TABLE_HTML);
    selectText(editor, '過去，工作是寫程式碼。', 'Second paragraph');

    expect(serializeSelectionToMarkdown(editor.view)).toBe(
      '過去，工作是寫程式碼。\n\nSecond paragraph',
    );

    editor.destroy();
  });

  it('copies a single-cell cell selection as plain text', () => {
    const editor = createEditor(TABLE_HTML);
    selectCells(editor, 3, 3);

    expect(serializeSelectionToMarkdown(editor.view)).toBe('Other cell');

    editor.destroy();
  });

  it('keeps a markdown table for a cell selection spanning two cells in one row', () => {
    const editor = createEditor(TABLE_HTML);
    selectCells(editor, 0, 1);
    const markdown = serializeSelectionToMarkdown(editor.view);

    expect(markdown).toContain('| Header one | Header two |');
    expect(markdown).toMatch(/\|\s*-+\s*\|\s*-+\s*\|/);

    editor.destroy();
  });

  it('keeps a markdown table for a cell selection spanning two rows', () => {
    const editor = createEditor(TABLE_HTML);
    selectCells(editor, 0, 2);
    const markdown = serializeSelectionToMarkdown(editor.view);

    expect(markdown).toContain('| Header one |');
    expect(markdown).toMatch(/\|\s*-+\s*\|/);
    expect(markdown).toContain('過去，工作是寫程式碼。');

    editor.destroy();
  });

  it('keeps heading syntax for a partial selection inside a heading', () => {
    const editor = createEditor('<h2>Partial heading text</h2><p>Body</p>');
    selectText(editor, 'heading');

    expect(serializeSelectionToMarkdown(editor.view)).toBe('## heading');

    editor.destroy();
  });

  it('copies a partial selection inside a list item or blockquote as plain text', () => {
    const editor = createEditor(
      '<ul><li><p>Bullet item text</p></li></ul><blockquote><p>Quoted text here</p></blockquote>',
    );

    selectText(editor, 'item');
    expect(serializeSelectionToMarkdown(editor.view)).toBe('item');

    selectText(editor, 'Quoted text');
    expect(serializeSelectionToMarkdown(editor.view)).toBe('Quoted text');

    editor.destroy();
  });

  it('keeps block syntax when a whole single-item list or table is selected', () => {
    const editor = createEditor('<ul><li><p>Only item</p></li></ul>');
    editor.commands.selectAll();
    expect(serializeSelectionToMarkdown(editor.view)).toBe('- Only item');
    editor.destroy();

    const tableEditor = createEditor(
      '<table><tbody><tr><td><p>Only cell</p></td></tr></tbody></table>',
    );
    tableEditor.commands.selectAll();
    expect(serializeSelectionToMarkdown(tableEditor.view)).toContain('| Only cell |');
    tableEditor.destroy();
  });

  it('writes markdown to text/plain and prevents the native copy when conversion succeeds', () => {
    const editor = createEditor('<h1>Selected heading</h1>');
    editor.commands.selectAll();
    const event = {
      clipboardData: { setData: vi.fn() },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    const handled = handleNoteEditorCopyAsMarkdown(editor.view, event);

    expect(handled).toBe(true);
    expect(event.clipboardData?.setData).toHaveBeenCalledWith('text/plain', '# Selected heading');
    expect(event.preventDefault).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('falls back to native copy for empty selections or clipboard failures', () => {
    const editor = createEditor('<p>Nothing selected</p>');
    const emptyEvent = {
      clipboardData: { setData: vi.fn() },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    expect(handleNoteEditorCopyAsMarkdown(editor.view, emptyEvent)).toBe(false);
    expect(emptyEvent.preventDefault).not.toHaveBeenCalled();

    editor.commands.selectAll();
    const throwingEvent = {
      clipboardData: {
        setData: vi.fn(() => {
          throw new Error('clipboard denied');
        }),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    expect(handleNoteEditorCopyAsMarkdown(editor.view, throwingEvent)).toBe(false);
    expect(throwingEvent.preventDefault).not.toHaveBeenCalled();

    editor.destroy();
  });
});
