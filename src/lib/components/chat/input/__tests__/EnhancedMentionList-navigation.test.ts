import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
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

  it('keeps the ranked kind order for ungrouped results in display and arrow-key order', async () => {
    const note: MentionCandidate = { id: 'n', label: 'Spec note', type: 'note', uri: 'note:spec' };
    const file: MentionCandidate = { ...first, group: 'Recent files' };
    const script: MentionCandidate = { id: 's', label: 'Build', type: 'script', uri: 'script:b' };
    const specialist: MentionCandidate = {
      id: 'sp',
      label: 'Developer',
      type: 'specialist',
      uri: 'specialist:dev',
      group: 'Specialists',
    };
    const command = vi.fn();
    const { component } = render(EnhancedMentionList, {
      props: { items: [note, file, script, specialist], command },
    });

    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual([
      'Spec note',
      'First file',
      'Build',
      'Developer',
    ]);
    for (const key of ['ArrowDown', 'ArrowDown']) {
      component.onKeyDown({ event: new KeyboardEvent('keydown', { key, cancelable: true }) });
      await tick();
    }
    component.onKeyDown({
      event: new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    });
    expect(command).toHaveBeenCalledExactlyOnceWith(script);
  });

  it('never merges same-label results of different kinds into one bucket', () => {
    const file: MentionCandidate = { ...first, group: 'Shared' };
    const script: MentionCandidate = { id: 's', label: 'Build', type: 'script', uri: 'script:b' };
    const folder: MentionCandidate = {
      id: 'd',
      label: 'src',
      type: 'folder',
      uri: 'folder:src',
      group: 'Shared',
    };
    render(EnhancedMentionList, { props: { items: [file, script, folder], command: vi.fn() } });

    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual([
      'First file',
      'Build',
      'src',
    ]);
  });

  describe('section headers', () => {
    const note: MentionCandidate = { id: 'n', label: 'Spec note', type: 'note', uri: 'note:spec' };
    // Agent rows render a store-backed avatar, so scripts stand in for a
    // middle-ranked kind here.
    const script: MentionCandidate = {
      id: 'sc',
      label: 'Helper',
      type: 'script',
      uri: 'script:sc',
    };
    const file: MentionCandidate = { ...first, group: 'Recent Files' };
    const specialist: MentionCandidate = {
      id: 'sp',
      label: 'Developer',
      type: 'specialist',
      uri: 'specialist:dev',
      group: 'Specialists',
    };

    it('labels one group per kind with a heading, in display order', () => {
      render(EnhancedMentionList, {
        props: { items: [note, script, file, specialist], command: vi.fn() },
      });

      const groups = screen.getAllByRole('group');
      const names = groups.map(
        (g) =>
          document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ??
          '',
      );
      expect(names.every((name) => name.length > 0)).toBe(true);
      expect(new Set(names).size).toBe(groups.length);
      expect(
        groups.map((g) =>
          within(g)
            .getAllByRole('option')
            .map((o) => o.getAttribute('aria-label')),
        ),
      ).toEqual([['Spec note'], ['Helper'], ['First file'], ['Developer']]);
      expect(screen.getAllByRole('option')).toHaveLength(4);
    });

    it('shows no headings when only one kind is listed', () => {
      render(EnhancedMentionList, { props: { items: [first, second], command: vi.fn() } });

      expect(screen.queryAllByRole('group')).toHaveLength(0);
      const optionText = screen
        .getAllByRole('option')
        .map((o) => o.textContent?.trim())
        .join('');
      expect(screen.getByRole('listbox').textContent?.replace(/\s+/g, '')).toBe(
        optionText.replace(/\s+/g, ''),
      );
    });

    it('skips headings during keyboard navigation', async () => {
      const command = vi.fn();
      const { component } = render(EnhancedMentionList, {
        props: { items: [note, file], command },
      });
      const listbox = screen.getByRole('listbox');
      const options = screen.getAllByRole('option').map((o) => o.id);

      expect(listbox.getAttribute('aria-activedescendant')).toBe(options[0]);
      component.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      });
      await tick();
      expect(listbox.getAttribute('aria-activedescendant')).toBe(options[1]);
      component.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
      });
      expect(command).toHaveBeenCalledExactlyOnceWith(file);
    });

    it('drops the inline kind tag next to agent and specialist names', () => {
      render(EnhancedMentionList, { props: { items: [note, specialist], command: vi.fn() } });

      for (const [option, item] of screen
        .getAllByRole('option')
        .map((o, i) => [o, [note, specialist][i]] as const)) {
        if (item.group) expect(within(option).queryByText(item.group)).toBeNull();
      }
    });
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
