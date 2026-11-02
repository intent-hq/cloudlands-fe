import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScreenInterimExtension, screenInterimKey } from './screen-interim-extension';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

it('replaces interim words and references without adding them to saved text or undo history', () => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ScreenInterimExtension],
    content: '<p>Typed</p>',
  });
  const setInterim = (text: string) =>
    editor!.view.dispatch(
      editor!.state.tr.setMeta(screenInterimKey, {
        parts: [
          { kind: 'text', text },
          { kind: 'mark', markId: 'mark' },
        ],
        references: [{ id: 'mark', number: 1, label: 'Save' }],
        anchor: 6,
        ariaLabel: 'Listening',
      }),
    );
  setInterim(' first');
  expect(editor.view.dom.querySelector('[data-screen-interim]')?.textContent).toBe(' first1…');
  setInterim(' revised <img onerror=alert(1)>');
  expect(editor.view.dom.querySelectorAll('[data-screen-interim]')).toHaveLength(1);
  // ProseMirror may add its own separator image outside a non-editable widget.
  expect(editor.view.dom.querySelector('[data-screen-interim] img')).toBeNull();
  expect(editor.getText()).toBe('Typed');
  expect(editor.getHTML()).toBe('<p>Typed</p>');
  expect(editor.commands.undo()).toBe(false);
  editor.view.dispatch(editor.state.tr.setMeta(screenInterimKey, null));
  expect(editor.view.dom.querySelector('[data-screen-interim]')).toBeNull();
  expect(editor.getText()).toBe('Typed');
});
