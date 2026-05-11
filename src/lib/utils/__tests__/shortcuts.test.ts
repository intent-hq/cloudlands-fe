import { describe, expect, it } from 'vitest';
import { SHORTCUTS, SHORTCUT_CATEGORIES, getShortcutsForContext } from '../shortcuts';

describe('shortcut registry', () => {
  it('lists the task list shortcut in the editor cheat sheet', () => {
    expect(SHORTCUTS.TOGGLE_TASK_LIST).toEqual({
      key: 'mod+shift+9',
      label: 'Toggle Task List',
    });

    expect(SHORTCUT_CATEGORIES.editor.shortcuts).toContainEqual({
      key: 'mod+shift+9',
      label: 'Toggle Task List',
      contexts: ['editor'],
    });
  });

  it('does not expose the task list shortcut as a global shortcut', () => {
    const globalKeys = Object.entries(SHORTCUT_CATEGORIES)
      .filter(([category]) => category !== 'editor')
      .flatMap(([, data]) => data.shortcuts.map((shortcut) => shortcut.key));

    expect(globalKeys).not.toContain(SHORTCUTS.TOGGLE_TASK_LIST.key);
    expect(getShortcutsForContext('global').editor?.shortcuts ?? []).not.toContainEqual(
      expect.objectContaining({ key: SHORTCUTS.TOGGLE_TASK_LIST.key }),
    );
  });
});