/** @vitest-environment jsdom */
import { flushSync } from 'svelte';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TipTapEditor from '../TipTapEditor.svelte';
import TipTapEditorDeactivateHarness from './TipTapEditorDeactivateHarness.svelte';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';

afterEach(() => cleanup());

describe('TipTapEditor programmatic content updates', () => {
  it.each(['setContent', 'clear'] as const)(
    'dismisses a removed file mention hover on %s',
    async (command) => {
      const view = render(TipTapEditor, { value: '@README.md' });
      const chip = await waitFor(() => {
        const element = view.container.querySelector('[data-mention]');
        expect(element).toBeTruthy();
        return element!;
      });
      await fireEvent.mouseOver(chip);
      const preview = await screen.findByRole('tooltip');
      expect(preview.textContent).toContain('README.md');
      await fireEvent.mouseOut(chip, { relatedTarget: preview });
      expect(screen.getByRole('tooltip')).toBe(preview);

      if (command === 'setContent') await view.component.setContent('replacement');
      else view.component.clear();

      await waitFor(() => expect(view.container.querySelector('[data-mention]')).toBeNull());
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    },
  );

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

describe('TipTapEditor deferred focus ownership', () => {
  const rangeDescriptors = Object.getOwnPropertyDescriptors(Range.prototype);
  beforeAll(() => {
    // jsdom lacks Range geometry; ProseMirror reads it when scrolling the
    // selection after a genuine deferred focus callback.
    Object.defineProperties(Range.prototype, {
      getClientRects: { configurable: true, value: () => [new DOMRect(0, 0, 1, 1)] },
      getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 1, 1) },
    });
  });
  afterAll(() => {
    for (const key of ['getClientRects', 'getBoundingClientRect']) {
      if (rangeDescriptors[key]) Object.defineProperty(Range.prototype, key, rangeDescriptors[key]);
      else Reflect.deleteProperty(Range.prototype, key);
    }
  });
  it.each(['before request', 'before callback'] as const)(
    'preserves the native caret when the user focuses the editor %s',
    async (when) => {
      const view = render(TipTapEditor, { value: 'draft' });
      const editor = await waitFor(() => {
        const element = view.container.querySelector('.ProseMirror') as HTMLElement | null;
        expect(element).toBeTruthy();
        return element!;
      });
      const frames: FrameRequestCallback[] = [];
      const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      try {
        if (when === 'before request') editor.focus();
        view.component.focus();
        if (when === 'before callback') editor.focus();
        const text = editor.querySelector('p')!.firstChild!;
        // Native mouse/End navigation updates the DOM selection before the
        // asynchronous selectionchange event synchronizes ProseMirror's state.
        const selection = window.getSelection()!;
        selection.setBaseAndExtent(text, 5, text, 5);
        for (const callback of frames.splice(0)) callback(performance.now());
        expect(document.activeElement).toBe(editor);
        expect(selection.anchorNode).toBe(text);
        expect(selection.anchorOffset).toBe(5);
        expect(selection.focusOffset).toBe(5);
      } finally {
        raf.mockRestore();
      }
    },
  );

  it.each(['input', 'textarea', 'contenteditable'] as const)(
    'does not steal %s focus acquired after the composer focus request',
    async (kind) => {
      const view = render(TipTapEditor, { value: 'draft' });
      await waitFor(() => expect(view.container.querySelector('.ProseMirror')).toBeTruthy());
      const outside = document.createElement(kind === 'contenteditable' ? 'div' : kind);
      if (kind === 'contenteditable') {
        outside.setAttribute('contenteditable', 'true');
        outside.tabIndex = 0;
      }
      document.body.append(outside);
      const frames: FrameRequestCallback[] = [];
      const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      try {
        view.component.focus();
        expect(frames.length).toBeGreaterThan(0);
        outside.focus();
        for (const callback of frames.splice(0)) callback(performance.now());
        expect(document.activeElement).toBe(outside);
      } finally {
        raf.mockRestore();
        outside.remove();
      }
    },
  );

  it.each([false, true])(
    'still applies requested focus when ownership has not changed (editable=%s)',
    async (editable) => {
      const view = render(TipTapEditor, { value: 'draft' });
      const editor = await waitFor(() => {
        const element = view.container.querySelector('.ProseMirror');
        expect(element).toBeTruthy();
        return element!;
      });
      const outside = document.createElement('input');
      document.body.append(outside);
      if (editable) outside.focus();
      const frames: FrameRequestCallback[] = [];
      const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      try {
        view.component.focus();
        for (const callback of frames.splice(0)) callback(performance.now());
        expect(document.activeElement).toBe(editor);
      } finally {
        raf.mockRestore();
        outside.remove();
      }
    },
  );
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
