/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
import TipTapEditor from '../TipTapEditor.svelte';

const skills: SkillInfo[] = [
  { name: 'audit', description: 'Review security', location: '/skills/audit' },
  { name: 'research', description: 'Research a topic', location: '/skills/research' },
  { name: 'review', description: 'Review a change', location: '/skills/review' },
];

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
});
