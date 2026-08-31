/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
import TipTapEditor from '../TipTapEditor.svelte';

const skills: SkillInfo[] = [
  { name: 'audit', description: 'Review security', location: '/skills/audit' },
  { name: 'research', description: 'Research a topic', location: '/skills/research' },
  { name: 'review', description: 'Review a change', location: '/skills/review' },
];

beforeAll(() => {
  // jsdom lacks the layout APIs ProseMirror's paste scrollIntoView path needs.
  const zeroRect = {
    x: 0,
    y: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  } as DOMRect;
  const emptyRects = () => [] as unknown as DOMRectList;
  for (const proto of [Element.prototype, Range.prototype] as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  }[]) {
    proto.getClientRects ??= emptyRects;
    proto.getBoundingClientRect ??= () => zeroRect;
  }
});

afterEach(cleanup);

async function mountEditor(props: Record<string, unknown> = {}) {
  const view = render(TipTapEditor, { props: { skills, ...props } });
  const editor = await waitFor(() => {
    const element = view.container.querySelector('.ProseMirror') as HTMLElement | null;
    expect(element).toBeTruthy();
    return element!;
  });
  editor.focus();
  return { ...view, editor };
}

function firePaste(target: HTMLElement, text: string) {
  return fireEvent.paste(target, {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
}

describe('TipTapEditor slash skills', () => {
  it('uses the small semantic corner radius for inline command chips', () => {
    const stylesheet = readFileSync(resolve('src/lib/styles/tiptap-editor.css'), 'utf8');
    const chipRule = stylesheet.match(/\.skill-command-chip\s*\{(?<declarations>[^}]*)\}/)?.groups
      ?.declarations;

    expect(chipRule).toContain('border-radius: var(--radius-small)');
    expect(chipRule).not.toContain('9999px');
    expect(chipRule).not.toContain('var(--radius-full)');
  });

  it('activates at any token boundary, filters case-insensitively, and ignores embedded slashes', async () => {
    const command = await mountEditor();
    command.component.insertText('explain /RES');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('research'),
    ]);
    expect(screen.getByRole('option').textContent).not.toContain('/research');
    command.unmount();

    const path = await mountEditor();
    path.component.insertText('open path/to/file');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('preserves a mid-prompt prefix and keeps the caret after the selected command', async () => {
    const onUpdate = vi.fn();
    const { component } = await mountEditor({ onUpdate });
    component.insertText('Please /rev');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    await fireEvent.click(screen.getByRole('option', { name: 'review' }));
    await waitFor(() => expect(component.getTextContent()).toBe('Please /review '));

    const chip = document.querySelector('[data-type="skill-command"]');
    expect(chip?.textContent).toBe('/review');
    expect(chip?.getAttribute('role')).toBe('code');
    expect(chip?.getAttribute('aria-label')).toBe('/review');
    expect(chip?.getAttribute('contenteditable')).toBe('false');
    expect(chip?.classList.contains('skill-command-chip')).toBe(true);
    expect(chip?.classList.contains('type-code')).toBe(true);

    component.insertText('audit this');
    expect(component.getTextContent()).toBe('Please /review audit this');
    expect(onUpdate).toHaveBeenLastCalledWith('Please /review audit this');
  });

  it('restores command chips from draft, history, and external-value text', async () => {
    const onHistoryPrev = vi.fn(() => 'History /audit prompt');
    const view = await mountEditor({ value: 'Draft /review prompt', onHistoryPrev });
    expect(view.editor.querySelector('[data-skill-name="review"]')?.textContent).toBe('/review');
    expect(view.component.getTextContent()).toBe('Draft /review prompt');

    await view.component.setContent('');
    view.component.focusEnd();
    await fireEvent.keyDown(view.editor, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(view.editor.querySelector('[data-skill-name="audit"]')?.textContent).toBe('/audit'),
    );
    expect(view.component.getTextContent()).toBe('History /audit prompt');

    view.editor.blur();
    await view.rerender({ value: 'External /research value', skills, onHistoryPrev });
    await waitFor(() =>
      expect(view.editor.querySelector('[data-skill-name="research"]')?.textContent).toBe(
        '/research',
      ),
    );
    expect(view.component.getTextContent()).toBe('External /research value');
  });

  it('deletes a selected command chip atomically from the keyboard', async () => {
    const { component, editor } = await mountEditor();
    component.insertText('/rev');
    await fireEvent.click(await screen.findByRole('option', { name: 'review' }));
    await waitFor(() => expect(component.getTextContent()).toBe('/review '));

    await fireEvent.keyDown(editor, { key: 'Backspace' });
    await waitFor(() => expect(component.getTextContent()).toBe(''));
    expect(editor.querySelector('[data-type="skill-command"]')).toBeNull();
  });

  it('activates after a newline and replaces only the current command', async () => {
    const { component } = await mountEditor();
    await component.setContent('/audit first\nthen /rev');
    component.focusEnd();
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    await fireEvent.click(screen.getByRole('option', { name: 'review' }));
    await waitFor(() => expect(component.getTextContent()).toBe('/audit first\nthen /review '));
  });

  it('portals an anchored floating menu above the editor without adding inline layout', async () => {
    const view = await mountEditor();
    view.editor.getBoundingClientRect = vi.fn(
      () =>
        ({
          x: 40,
          y: 500,
          top: 500,
          right: 440,
          bottom: 580,
          left: 40,
          width: 400,
          height: 80,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    view.component.insertText('/');

    const menu = await screen.findByTestId('slash-skill-menu');
    await waitFor(() => expect(menu.dataset.side).toBe('top'));
    expect(menu.closest('.tiptap-root')).toBeNull();
    expect(view.container.querySelector('.slash-skill-menu')).toBeNull();
    expect(view.container.querySelector('.tiptap-root')?.children).toHaveLength(1);
    expect(menu.parentElement?.style.position).toBe('absolute');
  });

  it('selects by keyboard before history or submit and preserves force-submit modifiers', async () => {
    const onSubmit = vi.fn();
    const onForceSubmit = vi.fn();
    const onHistoryPrev = vi.fn(() => 'older prompt');
    const onHistoryNext = vi.fn(() => 'newer prompt');
    const onUpdate = vi.fn();
    const { component, editor } = await mountEditor({
      onSubmit,
      onForceSubmit,
      onHistoryPrev,
      onHistoryNext,
      onUpdate,
    });
    component.insertText('/');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));

    await fireEvent.keyDown(editor, { key: 'ArrowDown' });
    expect(onHistoryNext).not.toHaveBeenCalled();
    await fireEvent.keyDown(editor, { key: 'ArrowUp' });
    expect(onHistoryPrev).not.toHaveBeenCalled();

    await fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(onForceSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole('listbox')).toBeTruthy();

    await fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith('/research '));
    expect(component.getTextContent()).toBe('/research ');
    expect(document.activeElement).toBe(editor);
  });

  it('exposes the open listbox and keyboard-driven active option on the focused editor', async () => {
    const { component, editor } = await mountEditor();

    expect(editor.getAttribute('aria-haspopup')).toBe('listbox');
    expect(editor.getAttribute('aria-expanded')).toBe('false');
    expect(editor.hasAttribute('aria-controls')).toBe(false);
    expect(editor.hasAttribute('aria-activedescendant')).toBe(false);

    component.insertText('/');
    const listbox = await screen.findByRole('listbox');
    const options = screen.getAllByRole('option');
    await waitFor(() => {
      expect(editor.getAttribute('aria-expanded')).toBe('true');
      expect(editor.getAttribute('aria-controls')).toBe(listbox.id);
      expect(editor.getAttribute('aria-activedescendant')).toBe(options[0].id);
    });

    await fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await waitFor(() => expect(editor.getAttribute('aria-activedescendant')).toBe(options[1].id));

    await fireEvent.keyDown(editor, { key: 'Escape' });
    expect(editor.getAttribute('aria-expanded')).toBe('false');
    expect(editor.hasAttribute('aria-controls')).toBe(false);
    expect(editor.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('dismisses before the outer Escape action and reopens when the query changes', async () => {
    const onEscape = vi.fn();
    const { component, editor } = await mountEditor({ onEscape });
    component.insertText('/');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    await fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onEscape).not.toHaveBeenCalled();

    component.insertText('r');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    await fireEvent.keyDown(editor, { key: 'Escape' });
    await fireEvent.keyDown(editor, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('reacts to skill prop updates and supports pointer selection', async () => {
    const onUpdate = vi.fn();
    const view = await mountEditor({ onUpdate });
    view.component.insertText('/');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));

    const updatedSkills = [
      { name: 'summarize', description: 'Summarize text', location: '/skills/summarize' },
    ];
    await view.rerender({ skills: updatedSkills, onUpdate });
    const option = await screen.findByRole('option');
    expect(option.textContent?.trim()).toBe('summarize');

    await fireEvent.pointerDown(option);
    await fireEvent.click(option);
    await waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith('/summarize '));
  });

  it('preserves an existing mention node when selecting a skill', async () => {
    const { component, editor } = await mountEditor();
    const mention = {
      id: 'src/lib/review.ts',
      label: 'review.ts',
      type: 'file',
      uri: 'file:///workspace/src/lib/review.ts',
      meta: { path: 'src/lib/review.ts' },
    };
    expect(component.insertMention(mention)).toBe(true);
    component.insertText('/rev');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    await fireEvent.click(screen.getByRole('option', { name: 'review' }));

    expect(component.getTextContent()).toBe('@src/lib/review.ts /review ');
    expect(component.getMentions()).toEqual([mention]);
    expect(editor.querySelector('[data-mention]')?.textContent).toBe('review.ts');
    expect(editor.querySelector('[data-type="skill-command"]')?.textContent).toBe('/review');
  });

  describe('paste handling', () => {
    it('treats a paste chip as an opaque token boundary for slash detection', async () => {
      const { component, editor } = await mountEditor();
      const pasted = 'ps aux\nline two\nline three\nline four\n/sbin/launchd';
      await firePaste(editor, pasted);

      await waitFor(() => expect(editor.querySelector('.paste-chip-pill')).toBeTruthy());
      // Submit serialization still carries the full pasted content.
      expect(component.getTextContent()).toBe(pasted);
      expect(screen.queryByTestId('slash-skill-menu')).toBeNull();

      // The chip stays opaque later: typing right after it must not form a
      // slash token from the chip content (a new context key would bypass a
      // one-shot dismissal).
      component.insertText('x');
      expect(screen.queryByTestId('slash-skill-menu')).toBeNull();

      // A fresh typed slash after the chip still opens the menu.
      component.insertText(' /res');
      await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        expect.stringContaining('research'),
      ]);
    });

    it('does not open the menu for a single-line raw paste ending in a slash token', async () => {
      const { component, editor } = await mountEditor();
      await firePaste(editor, 'run /re');
      await waitFor(() => expect(component.getTextContent()).toBe('run /re'));
      expect(screen.queryByTestId('slash-skill-menu')).toBeNull();

      // Typing afterwards changes the context key and re-enables the menu.
      component.insertText('s');
      await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        expect.stringContaining('research'),
      ]);
    });

    it('does not open the menu for a short multi-line raw paste ending in a slash token', async () => {
      const { component, editor } = await mountEditor();
      await firePaste(editor, 'cd /var\nls /tmp');
      await waitFor(() => expect(component.getTextContent()).toBe('cd /var\nls /tmp'));
      expect(screen.queryByTestId('slash-skill-menu')).toBeNull();
    });
  });
});
