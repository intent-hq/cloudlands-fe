import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_CATEGORIES,
  formatShortcut,
  getShortcutsForContext,
  isMacPlatform,
} from '../shortcuts';

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

  it('lists distinct panel-content and workspace-tab close shortcuts', () => {
    expect(SHORTCUTS.CLOSE_TAB.key).toBe('mod+w');
    expect(SHORTCUTS.CLOSE_WORKSPACE_TAB.key).toBe('mod+shift+w');
    expect(SHORTCUT_CATEGORIES.navigation.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'mod+w' }),
        expect.objectContaining({ key: 'mod+shift+w' }),
      ]),
    );
  });

  it('formats the title-bar shortcut hints for the current platform', () => {
    expect(formatShortcut('mod+o')).toBe(isMacPlatform() ? '⌘O' : 'Ctrl+O');
  });

  it('lists the direct pane and column model without browser-history bindings', () => {
    expect(SHORTCUTS.PREVIOUS_PANE.key).toBe('mod+[');
    expect(SHORTCUTS.NEXT_PANE.key).toBe('mod+]');
    expect(SHORTCUTS.FOCUS_PREVIOUS_COLUMN.key).toBe('mod+shift+[');
    expect(SHORTCUTS.FOCUS_NEXT_COLUMN.key).toBe('mod+shift+]');
    expect(SHORTCUTS.MOVE_PANE_PREVIOUS_COLUMN.key).toBe('mod+alt+pageup');
    expect(SHORTCUTS.MOVE_PANE_NEXT_COLUMN.key).toBe('mod+alt+pagedown');
    expect(SHORTCUTS.CREATE_COLUMN_RIGHT.key).toBe('mod+\\');

    const navigationKeys = SHORTCUT_CATEGORIES.navigation.shortcuts.map((shortcut) => shortcut.key);
    expect(navigationKeys).not.toContain('mod+[');
    expect(navigationKeys).not.toContain('mod+]');
    expect(SHORTCUT_CATEGORIES.panel.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'mod+[', label: 'Previous Pane' }),
        expect.objectContaining({ key: 'mod+]', label: 'Next Pane' }),
        expect.objectContaining({ key: 'mod+shift+[', label: 'Focus Previous Column' }),
        expect.objectContaining({ key: 'mod+shift+]', label: 'Focus Next Column' }),
        expect.objectContaining({ key: 'mod+\\', label: 'Create Column to Right' }),
      ]),
    );
  });

  it('lists global workspace tab movement commands', () => {
    const navigation = SHORTCUT_CATEGORIES.navigation.shortcuts;
    expect(SHORTCUTS.MOVE_SPACE_TAB_LEFT.key).toBe('mod+alt+shift+left');
    expect(SHORTCUTS.MOVE_SPACE_TAB_RIGHT.key).toBe('mod+alt+shift+right');
    expect(navigation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'mod+alt+shift+left', contexts: ['global'] }),
        expect.objectContaining({ key: 'mod+alt+shift+right', contexts: ['global'] }),
      ]),
    );
  });
});
