import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import EnhancedMentionList from '../EnhancedMentionList.svelte';
import { createMentionSuggestionRenderer } from '../mention-suggestion-renderer';
import type { MentionCandidate } from '$lib/services/mentions/types';

const first: MentionCandidate = {
  id: 'first',
  label: 'First file',
  type: 'file',
  uri: 'file:///first',
};
const second: MentionCandidate = {
  id: 'second',
  label: 'Second file',
  type: 'file',
  uri: 'file:///second',
};

afterEach(cleanup);

describe('editor-owned mention results', () => {
  it('navigates groups and returns to the root before dismissing', async () => {
    const command = vi.fn();
    const onClose = vi.fn();
    const { component } = render(EnhancedMentionList, {
      props: { items: [{ id: 'files', label: 'Files', items: [first, second] }], command, onClose },
    });
    const key = async (key: string) => {
      component.onKeyDown({ event: new KeyboardEvent('keydown', { key, cancelable: true }) });
      await tick();
    };
    const rootId = screen.getByRole('option', { name: 'Files' }).id;
    await key('ArrowRight');
    expect(screen.queryByRole('option', { name: 'Files' })).toBeNull();
    await key('ArrowDown');
    expect(screen.getByRole('listbox').getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Second file' }).id,
    );
    await key('Enter');
    expect(command).toHaveBeenCalledExactlyOnceWith(second);
    await key('Escape');
    expect(screen.getByRole('option', { name: 'Files' }).id).toBe(rootId);
    expect(onClose).not.toHaveBeenCalled();
    await key('Escape');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps surviving result identity stable across filtering and selects a pointer result once', async () => {
    const command = vi.fn();
    const view = render(EnhancedMentionList, { props: { items: [first, second], command } });
    const id = screen.getByRole('option', { name: 'Second file' }).id;
    await view.rerender({ items: [second], command });
    expect(screen.getByRole('option', { name: 'Second file' }).id).toBe(id);
    await fireEvent.click(screen.getByRole('option', { name: 'Second file' }));
    expect(command).toHaveBeenCalledExactlyOnceWith(second);
  });

  it('separates same-ID candidates by type within one result group', async () => {
    const note: MentionCandidate = {
      ...first,
      type: 'note',
      label: 'First note',
      uri: 'note://first',
    };
    const command = vi.fn();
    render(EnhancedMentionList, { props: { items: [first, note], command } });
    const fileOption = screen.getByRole('option', { name: 'First file' });
    const noteOption = screen.getByRole('option', { name: 'First note' });
    expect(fileOption.id).not.toBe(noteOption.id);
    await fireEvent.click(noteOption);
    expect(command).toHaveBeenCalledExactlyOnceWith(note);
  });

  it('connects the editor to mounted results and restores its original ARIA on exit', async () => {
    const editor = document.createElement('div');
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-controls', 'previous-controls');
    document.body.append(editor);
    const renderer = createMentionSuggestionRenderer();
    const command = vi.fn();
    const props = { editor: { view: { dom: editor } }, items: [first, second], command };
    try {
      renderer.onBeforeStart(props);
      renderer.onStart(props);
      await waitFor(() =>
        expect(editor.getAttribute('aria-activedescendant')).toBe(
          screen.getByRole('option', { name: 'First file' }).id,
        ),
      );
      expect(
        document.getElementById(editor.getAttribute('aria-controls')!)?.getAttribute('role'),
      ).toBe('listbox');
      renderer.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      });
      await tick();
      expect(editor.getAttribute('aria-activedescendant')).toBe(
        screen.getByRole('option', { name: 'Second file' }).id,
      );
      renderer.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
      });
      expect(command).toHaveBeenCalledExactlyOnceWith(second);
      renderer.onExit();
      await tick();
      expect(editor.getAttribute('aria-controls')).toBe('previous-controls');
      expect(editor.hasAttribute('aria-activedescendant')).toBe(false);
      expect(screen.queryByRole('listbox')).toBeNull();
    } finally {
      renderer.onExit();
      editor.remove();
    }
  });
});
