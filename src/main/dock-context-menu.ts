import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { DockPlacementCommand, DockPlacementTarget } from '../shared/dock-placement';
import { m } from '../shared/paraglide/messages.js';
import { Logger } from '../shared/logger';
import { updateDockPlacement } from './dock-window';

import type { DockContextMenuRequest, DockContextMenuResult } from '../shared/dock-context-menu';

const logger = new Logger('DockContextMenu');

/**
 * The dock's right-click menu: move it, or hide it. A native menu is not clipped
 * by the dock's small transparent window. Each item runs the same placement
 * command the in-dock controls send, so hiding records the same user hide that
 * Window > Show Intent Dock reverses.
 */
export function buildDockContextMenuTemplate(
  run: (command: DockPlacementCommand) => void,
  state: DockContextMenuRequest = {},
  select: (id: string) => void = () => {},
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
  return [
    ...(devices.length
      ? [{ label: m.dock_machines_label(), submenu: devices }, { type: 'separator' as const }]
      : []),
    move(m.dock_moveNotch_label(), 'notch'),
    move(m.dock_moveLeft_label(), 'left'),
    move(m.dock_moveRight_label(), 'right'),
    move(m.dock_moveFloating_label(), 'floating'),
    { type: 'separator' },
    { label: m.dock_contextMenu_hide_label(), click: () => run({ action: 'dismiss' }) },
  ];
}

const activeMenus = new WeakMap<BrowserWindow, Promise<DockContextMenuResult>>();

export function showDockContextMenu(
  window: BrowserWindow,
  state: DockContextMenuRequest = {},
): Promise<DockContextMenuResult> {
  const active = activeMenus.get(window);
  if (active) return active;
  if (window.isDestroyed()) return Promise.resolve({ shown: false });
  const run = (command: DockPlacementCommand) => {
    if (window.isDestroyed()) return;
    void updateDockPlacement(window, command).catch((error: unknown) =>
      logger.warn('Dock menu command failed', { action: command.action, error }),
    );
  };
  const result = new Promise<DockContextMenuResult>((resolve, reject) => {
    let backendId: string | undefined;
    const finish = () => {
      window.removeListener('closed', finish);
      resolve({ shown: true, ...(backendId ? { backendId } : {}) });
    };
    window.once('closed', finish);
    try {
      Menu.buildFromTemplate(
        buildDockContextMenuTemplate(run, state, (id) => {
          backendId = id;
        }),
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
