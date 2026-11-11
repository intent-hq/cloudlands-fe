/**
 * The dock does capture, record and dictate (Annotate was removed from the dock): its
 * global shortcuts, their Settings rows and their bindings are exactly open, capture,
 * record and dictate. A saved binding for the old Annotate shortcut is ignored.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCK_SHORTCUT_IDS,
  dockShortcutBindings,
  isDockShortcutId,
} from './dock-shortcut-settings';
import { SHORTCUT_DEFAULTS } from './keyboard-shortcut-bindings';

describe('dock global shortcuts', () => {
  it('are open, capture, record, dictate and open related only', () => {
    expect([...DOCK_SHORTCUT_IDS]).toEqual([
      'dock.focus',
      'dock.capture',
      'dock.record',
      'dock.dictate',
      'dock.related',
    ]);
    expect(Object.keys(dockShortcutBindings())).toEqual([
      'focus',
      'capture',
      'record',
      'dictate',
      'related',
    ]);
    expect(Object.keys(SHORTCUT_DEFAULTS).filter((id) => id.startsWith('dock.'))).toEqual([
      'dock.focus',
      'dock.capture',
      'dock.record',
      'dock.dictate',
      'dock.related',
    ]);
    expect(SHORTCUT_DEFAULTS['dock.related']).toBe('ctrl+shift+a');
  });

  it('ignore a saved binding for the removed Annotate shortcut', () => {
    expect(isDockShortcutId('dock.annotate')).toBe(false);
    expect(
      Object.keys(dockShortcutBindings({ 'dock.annotate': 'ctrl+shift+a' } as never)),
    ).not.toContain('annotate');
  });
});
