/**
 * @vitest-environment jsdom
 */
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
  it('activates only for a leading slash token and filters case-insensitively', async () => {
    const leading = await mountEditor();
    leading.component.insertText('  /RES');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('/research'),
    ]);
    leading.unmount();

    const prose = await mountEditor();
    prose.component.insertText('explain /review');
    expect(screen.queryByRole('listbox')).toBeNull();
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
    expect(option.textContent).toContain('/summarize');

    await fireEvent.pointerDown(option);
    await fireEvent.click(option);
    await waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith('/summarize '));
  });

  it('keeps a real at-mention serializable and discoverable after selecting a skill', async () => {
    const { component, editor } = await mountEditor();
    component.insertText('/rev');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    const reviewOption = screen.getByRole('option', { name: /^\/review\b/ });
    await fireEvent.click(reviewOption);
    await waitFor(() => expect(component.getTextContent()).toBe('/review '));

    const mention = {
      id: 'src/lib/review.ts',
      label: 'review.ts',
      type: 'file',
      uri: 'file:///workspace/src/lib/review.ts',
      meta: { path: 'src/lib/review.ts' },
    };
    expect(component.insertMention(mention)).toBe(true);

    expect(component.getTextContent()).toBe('/review @src/lib/review.ts ');
    expect(component.getMentions()).toEqual([mention]);
    expect(editor.querySelector('[data-mention]')?.textContent).toBe('review.ts');
  });
});
