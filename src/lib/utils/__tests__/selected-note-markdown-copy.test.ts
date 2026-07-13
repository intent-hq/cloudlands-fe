/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
    ],
    content,
  });
}

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