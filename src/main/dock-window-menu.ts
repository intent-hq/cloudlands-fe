import type { MenuItemConstructorOptions } from 'electron';

export type DockMenuAction = 'focus' | 'record' | 'capture' | 'dictate';

/**
 * The Window menu's dock items. "Show Intent Dock" is the Notch dock setting itself: it is
 * always present, checked from main's setting, and its click goes through the same setter
 * as Settings and the dock's own Hide. The dock commands exist only while the dock is on
 * and act only while a dock window exists.
 */
export function dockWindowMenuItems(deps: {
  /** The Notch dock setting (main-owned). */
  labEnabled: boolean;
  /** Whether a dock window exists. */
  dockShown: boolean;
  labels: Record<'show' | DockMenuAction | 'unavailable', string>;
  /** Null for a menu command without a global key (no hint shown). */
  hint: (action: DockMenuAction) => { available: boolean; key: string } | null;
  setNotchDock: (enabled: boolean) => Promise<unknown>;
  requestShortcut: (action: DockMenuAction) => void;
  warn: (error: unknown) => void;
  /** Rebuild the menu from main's state (a failed save leaves the native check flipped). */
  refresh: () => void;
}): MenuItemConstructorOptions[] {
  const show: MenuItemConstructorOptions = {
    label: deps.labels.show,
    type: 'checkbox',
    checked: deps.labEnabled,
    // Electron flips the checkbox before calling click: `checked` is the requested state.
    click: (item) =>
      void deps.setNotchDock(item.checked).catch((error: unknown) => {
        deps.warn(error);
        deps.refresh();
      }),
  };
  if (!deps.labEnabled) return [show, { type: 'separator' }];
  const command = (action: DockMenuAction): MenuItemConstructorOptions => {
    const hint = deps.hint(action);
    return {
      label: deps.labels[action],
      // Global shortcuts own these keys; keep menu hints display-only.
      sublabel: !hint ? undefined : hint.available ? hint.key : deps.labels.unavailable,
      enabled: deps.dockShown,
      click: () => deps.requestShortcut(action),
    };
  };
  return [
    show,
    ...(['focus', 'record', 'capture', 'dictate'] as const).map(command),
    { type: 'separator' },
  ];
}
