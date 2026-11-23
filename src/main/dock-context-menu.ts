import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { DockPlacementCommand, DockPlacementTarget } from '../shared/dock-placement';
import { m } from '../shared/paraglide/messages.js';
import { Logger } from '../shared/logger';
import { updateDockPlacement } from './dock-window';
import { isIntentOs } from '../shared/intent-os';

import type { DockContextMenuRequest, DockContextMenuResult } from '../shared/dock-context-menu';

const logger = new Logger('DockContextMenu');

/**
 * The dock's menu: open Intent, switch machines, move it, or turn it off. A native menu is not clipped
 * by the dock's small transparent window. Each item runs the same placement
 * command the in-dock controls send, so hiding records the same user hide that
 * Window > Show Intent Dock reverses. On Intent OS the dock cannot move
 * (lockedDockPlacement), so the move items are left out.
 */
export function buildDockContextMenuTemplate(
  run: (command: DockPlacementCommand) => void,
  state: DockContextMenuRequest = {},
  select: (id: string) => void = () => {},
  selectAction: (action: NonNullable<DockContextMenuResult['action']>) => void = () => {},
  movable: boolean = !isIntentOs(),
): MenuItemConstructorOptions[] {
  const move = (label: string, target: DockPlacementTarget): MenuItemConstructorOptions => ({
    label,
    click: () => run({ action: 'move', target }),
  });
  const devices: MenuItemConstructorOptions[] = (state.machines ?? []).map((machine) => ({
    type: 'radio',
    label:
      state.pending === machine.id
        ? m.dock_machineConnecting_label({ machine: machine.label })
        : machine.label,
    checked: machine.id === state.currentId,
    enabled: !state.pending && machine.id !== state.currentId,
    click: () => select(machine.id),
  }));
  if (state.error) devices.push({ label: m.dock_machineSwitchFailed_error(), enabled: false });
  const canTurnOff = state.canTurnOff !== false && !state.pending;
  return [
    { label: m.dock_logo_open_label(), click: () => selectAction('open-intent') },
    { type: 'separator' },
    ...(devices.length
      ? [{ label: m.dock_machines_label(), submenu: devices }, { type: 'separator' as const }]
      : []),
    ...(movable
      ? [
          move(m.dock_moveNotch_label(), 'notch'),
          move(m.dock_moveLeft_label(), 'left'),
          move(m.dock_moveRight_label(), 'right'),
          move(m.dock_moveFloating_label(), 'floating'),
          { type: 'separator' as const },
        ]
      : []),
    {
      label: m.dock_menu_turnOff_label(),
      enabled: canTurnOff,
      click: () => {
        if (canTurnOff) run({ action: 'dismiss' });
      },
    },
  ];
}

const activeMenus = new WeakMap<BrowserWindow, Promise<DockContextMenuResult>>();

export function showDockContextMenu(
  window: BrowserWindow,
  state: DockContextMenuRequest = {},
): Promise<DockContextMenuResult> {
  const active = activeMenus.get(window);
  // A second document must never inherit the first document's menu selection.
  if (active) return Promise.resolve({ shown: false });
  if (window.isDestroyed()) return Promise.resolve({ shown: false });
  const run = (command: DockPlacementCommand) => {
    if (window.isDestroyed()) return;
    void updateDockPlacement(window, command).catch((error: unknown) =>
      logger.warn('Dock menu command failed', { action: command.action, error }),
    );
  };
  const result = new Promise<DockContextMenuResult>((resolve, reject) => {
    let backendId: string | undefined;
    let action: DockContextMenuResult['action'];
    const finish = () => {
      window.removeListener('closed', finish);
      resolve({ shown: true, ...(backendId ? { backendId } : {}), ...(action ? { action } : {}) });
    };
    window.once('closed', finish);
    try {
      Menu.buildFromTemplate(
        buildDockContextMenuTemplate(
          run,
          state,
          (id) => {
            backendId = id;
          },
          (selected) => {
            action = selected;
          },
        ),
      ).popup({ window, callback: finish });
    } catch (error) {
      window.removeListener('closed', finish);
      reject(error);
    }
  });
  activeMenus.set(window, result);
  void result.then(
    () => activeMenus.delete(window),
    () => activeMenus.delete(window),
  );
  return result;
}
