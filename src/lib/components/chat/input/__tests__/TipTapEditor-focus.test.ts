/** @vitest-environment jsdom */
import { flushSync } from 'svelte';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TipTapEditor from '../TipTapEditor.svelte';
import TipTapEditorDeactivateHarness from './TipTapEditorDeactivateHarness.svelte';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';

afterEach(() => cleanup());

describe('TipTapEditor programmatic content updates', () => {
  it('preserves a workspace video through the comment edit path', async () => {
    const markdown = '![clip](intent://local/file/x.mp4)';
    const html = await processMarkdownToHTML(markdown, { workspaceId: 'workspace-1' });
    const view = render(TipTapEditor, {
      value: html,
      workspace: { id: 'workspace-1' } as any,
    });

    await waitFor(() => expect(view.container.querySelector('video')).toBeTruthy());

    expect(processHTMLToMarkdown(view.component.getHTML(), { workspaceId: 'workspace-1' })).toBe(
      markdown,
    );
  });

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

describe('TipTapEditor synchronous blur reentry', () => {
  it('survives a blur fired from inside a reactive flush and closes the slash menu', async () => {
    const view = render(TipTapEditorDeactivateHarness, {
      skills: [{ name: 'audit', description: 'Review security', location: '/skills/audit' }],
      releaseFocus: () => {
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest('.ProseMirror')) active.blur();
      },
    });
    const editor = await waitFor(() => {
      const element = view.container.querySelector('.ProseMirror') as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    });
    editor.focus();
    view.component.insertText('/');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    // Deactivating the wrapper blurs the editor synchronously from inside the
    // reactive flush (see harness); without untrack() in onBlur this throws
    // state_unsafe_mutation. The throw escapes through the DOM blur listener,
    // so capture it via the window error event rather than expect(...).toThrow.
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error ?? event.message);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      flushSync(() => view.component.deactivate());
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(errors).toEqual([]);
    expect(document.activeElement).not.toBe(editor);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});
