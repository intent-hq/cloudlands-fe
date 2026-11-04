import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { DockPlacementCommand, DockPlacementTarget } from '../shared/dock-placement';
import { m } from '../shared/paraglide/messages.js';
import { Logger } from '../shared/logger';
import { updateDockPlacement } from './dock-window';

const logger = new Logger('DockContextMenu');

/**
 * The dock's right-click menu: move it, or hide it. A native menu is not clipped
 * by the dock's small transparent window. Each item runs the same placement
 * command the in-dock controls send, so hiding records the same user hide that
 * Window > Show Intent Dock reverses.
 */
export function buildDockContextMenuTemplate(
  run: (command: DockPlacementCommand) => void,
): MenuItemConstructorOptions[] {
  const move = (label: string, target: DockPlacementTarget): MenuItemConstructorOptions => ({
    label,
    click: () => run({ action: 'move', target }),
  });
  return [
    move(m.dock_moveNotch_label(), 'notch'),
    move(m.dock_moveLeft_label(), 'left'),
    move(m.dock_moveRight_label(), 'right'),
    move(m.dock_moveFloating_label(), 'floating'),
    { type: 'separator' },
    { label: m.dock_contextMenu_hide_label(), click: () => run({ action: 'dismiss' }) },
  ];
}

export function showDockContextMenu(window: BrowserWindow): void {
  const run = (command: DockPlacementCommand) => {
    if (window.isDestroyed()) return;
    void updateDockPlacement(window, command).catch((error: unknown) =>
      logger.warn('Dock menu command failed', { action: command.action, error }),
    );
  };
  Menu.buildFromTemplate(buildDockContextMenuTemplate(run)).popup({ window });
}
