import { Editor } from '@tiptap/core';
import { tick } from 'svelte';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';

beforeAll(() => {
  store.init();
});
afterAll(() => store.dispose());

it('native task editor can be destroyed while its Svelte node views are mounting', async () => {
  const content = await processMarkdownToHTML('- [ ] Native task');
  const editor = new Editor({
    ...createEditorConfig({
      element: document.createElement('div'),
      content: '',
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    }),
    content,
  });
  await tick();
  editor.destroy();
  await tick();
  expect(editor.isDestroyed).toBe(true);
});

it('a live native task view places editable content and remains usable after mount', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const content = await processMarkdownToHTML('- [ ] Native task');
  const editor = new Editor({
    ...createEditorConfig({
      element: host,
      content: '',
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    }),
    content,
  });
  try {
    await tick();
    await tick();
    const container = host.querySelector<HTMLElement>('[data-node-view-content]');
    expect(container?.style.whiteSpace).toBe('pre-wrap');
    expect(host.querySelector<HTMLElement>('[data-node-view-wrapper]')?.style.whiteSpace).toBe(
      'normal',
    );
    expect(container?.textContent).toBe('Native task');
    expect(container?.querySelector('p')).not.toBeNull();
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('Edited ');
    expect(container?.textContent).toBe('Edited Native task');
    expect(editor.state.doc.textContent).toBe('Edited Native task');
  } finally {
    editor.destroy();
    host.remove();
  }
});

it('native Mod-Enter cycles ordinary task status without altering selection or other attributes', async () => {
  const editor = new Editor({
    ...createEditorConfig({
      element: document.createElement('div'),
      content: '',
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    }),
    content: await processMarkdownToHTML('- [ ] Native task'),
  });
  try {
    editor.commands.setTextSelection(5);
    editor.commands.updateAttributes('taskItem', { delegatedAgentId: 'agent-preserved' });
    for (const [status, checked] of [
      ['in-progress', false],
      ['done', true],
      ['todo', false],
    ] as const) {
      editor.commands.keyboardShortcut('Mod-Enter');
      expect(editor.state.doc.firstChild!.firstChild!.attrs).toMatchObject({
        status,
        checked,
        delegatedAgentId: 'agent-preserved',
      });
      expect(editor.state.selection.head).toBe(5);
    }
  } finally {
    editor.destroy();
    await tick();
  }
});

it('keeps the existing linked task Mod-Enter path separate from the inline cycle', async () => {
  const editor = new Editor({
    ...createEditorConfig({
      element: document.createElement('div'),
      content: '',
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    }),
    content: await processMarkdownToHTML('- [ ] [Linked task](intent://local/task/note-123)'),
  });
  try {
    editor.commands.setTextSelection(5);
    editor.commands.keyboardShortcut('Mod-Enter');
    const item = editor.state.doc.firstChild!.firstChild!;
    expect(item.attrs).toMatchObject({ status: 'todo', checked: true });
    expect(item.firstChild!.firstChild!.marks[0].attrs.href).toBe('intent://local/task/note-123');
    expect(editor.state.selection.head).toBe(5);
  } finally {
    editor.destroy();
    await tick();
  }
});
