import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_CATEGORIES,
  formatShortcut,
  getShortcutChord,
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

  it('uses one workspace-view shortcut definition for registration and the cheat sheet', () => {
    expect(SHORTCUTS.WORKSPACE_VIEW_MODE).toEqual({
      key: 'mod+shift+l',
      label: 'Switch workspace view',
    });
    expect(getShortcutChord('WORKSPACE_VIEW_MODE', true)).toEqual({
      key: 'l',
      meta: true,
      ctrl: false,
      shift: true,
      alt: false,
    });
    expect(getShortcutChord('WORKSPACE_VIEW_MODE', false)).toEqual({
      key: 'l',
      meta: false,
      ctrl: true,
      shift: true,
      alt: false,
    });
    expect(SHORTCUT_CATEGORIES.global.shortcuts).toContainEqual({
      key: SHORTCUTS.WORKSPACE_VIEW_MODE.key,
      label: SHORTCUTS.WORKSPACE_VIEW_MODE.label,
      contexts: ['global'],
    });
  });

  it('lists distinct panel-content and workspace-tab close shortcuts', () => {
    expect(SHORTCUTS.CLOSE_TAB).toEqual({
      key: 'mod+w',
      label: 'Close Active Pane',
    });
    expect(SHORTCUTS.CLOSE_WORKSPACE_TAB).toEqual({
      key: 'mod+shift+w',
      label: 'Close Space Tab',
    });
    expect(SHORTCUT_CATEGORIES.navigation.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'mod+w', label: 'Close Active Pane' }),
        expect.objectContaining({ key: 'mod+shift+w', label: 'Close Space Tab' }),
      ]),
    );
  });

  it('formats the title-bar shortcut hints for the current platform', () => {
    expect(formatShortcut('mod+o')).toBe(isMacPlatform() ? '⌘O' : 'Ctrl+O');
    expect(formatShortcut('mod+shift+l')).toBe(isMacPlatform() ? '⌘⇧L' : 'Ctrl+Shift+L');
  });

  it('lists the direct pane and column model without browser-history bindings', () => {
    expect(SHORTCUTS.PREVIOUS_PANE.key).toBe('mod+pageup');
    expect(SHORTCUTS.NEXT_PANE.key).toBe('mod+pagedown');
    expect(SHORTCUTS.FOCUS_PREVIOUS_COLUMN.key).toBe('mod+shift+pageup');
    expect(SHORTCUTS.FOCUS_NEXT_COLUMN.key).toBe('mod+shift+pagedown');
    expect(SHORTCUTS.MOVE_PANE_PREVIOUS_COLUMN.key).toBe('mod+alt+pageup');
    expect(SHORTCUTS.MOVE_PANE_NEXT_COLUMN.key).toBe('mod+alt+pagedown');
    expect(SHORTCUTS.CREATE_COLUMN_RIGHT.key).toBe('mod+\\');

    const navigationKeys = SHORTCUT_CATEGORIES.navigation.shortcuts.map((shortcut) => shortcut.key);
    expect(navigationKeys).not.toContain('mod+[');
    expect(navigationKeys).not.toContain('mod+]');
    expect(SHORTCUT_CATEGORIES.panel.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'mod+pageup', label: 'Previous Pane' }),
        expect.objectContaining({ key: 'mod+pagedown', label: 'Next Pane' }),
        expect.objectContaining({ key: 'mod+\\', label: 'Create Column to Right' }),
      ]),
    );
  });
});
