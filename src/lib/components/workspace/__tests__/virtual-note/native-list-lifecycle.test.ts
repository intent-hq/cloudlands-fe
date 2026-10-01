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
