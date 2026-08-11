/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TipTapEditor from '../TipTapEditor.svelte';

afterEach(() => cleanup());

describe('TipTapEditor programmatic content updates', () => {
  it('does not steal focus when a background chat restores its draft', async () => {
    const outsideEditor = document.createElement('textarea');
    document.body.append(outsideEditor);
    const view = render(TipTapEditor, { value: '' });

    await waitFor(() => expect(view.container.querySelector('.ProseMirror')).toBeTruthy());
    outsideEditor.focus();

    await view.component.setContent('background draft');

    expect(document.activeElement).toBe(outsideEditor);
    expect(view.container.querySelector('.ProseMirror')?.textContent).toBe('background draft');
  });

  it('does not replay a stale controlled value over focused local typing', async () => {
    const view = render(TipTapEditor, { value: 'word' });

    const editor = await waitFor(() => {
      const element = view.container.querySelector('.ProseMirror') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    });
    editor.focus();
    expect(document.activeElement).toBe(editor);
    expect(view.component.focusEnd()).toBe(true);
    expect(view.component.insertText(' ')).toBe(true);
    await view.rerender({ value: 'word ' });
    editor.focus();

    await view.rerender({ value: 'word' });

    expect(editor.textContent).toBe('word ');
  });

  it('still applies controlled value changes while the editor is unfocused', async () => {
    const view = render(TipTapEditor, { value: 'initial' });

    await waitFor(() => expect(view.container.querySelector('.ProseMirror')).toBeTruthy());
    await view.rerender({ value: 'external update' });

    expect(view.container.querySelector('.ProseMirror')?.textContent).toBe('external update');
  });
});
