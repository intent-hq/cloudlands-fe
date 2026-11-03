import { createDockShortcutRegistration } from './dock-shortcut-registration';
import { app, globalShortcut, webContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { getDockWindow, focusDockWindow } from './dock-window';
import { getStrictBackendBindingForWebContents } from './window-backend';
import { getDesktopNativeAdapter } from '../features/desktop/main/desktop-native';
import { dockServiceAddress } from '../features/browser/main/browser.ipc';
import { embeddedBrowserCdp } from '../features/browser/main/embedded-browser-cdp-service';
import { Logger } from '../shared/logger';
import type { DockShortcutContext } from '../shared/dock-shortcuts';

const logger = new Logger('DockGlobalShortcuts');
let generation = 0;
let enabled = false;
const registration = createDockShortcutRegistration(
  globalShortcut,
  (action) => void requestDockShortcut(action),
  (key) => logger.warn('Global shortcut unavailable', { key }),
);

export async function requestDockShortcut(action: DockShortcutContext['action']): Promise<void> {
  const window = getDockWindow();
  if (!enabled || !window) return;
  const binding = getStrictBackendBindingForWebContents(window.webContents);
  if (!binding) return;
  const request = ++generation;
  const focused = webContents.getFocusedWebContents();
  const sample = await Promise.race([
    getDesktopNativeAdapter()
      .foregroundContext()
      .catch(() => ({})),
    new Promise<Record<string, never>>((resolve) => setTimeout(() => resolve({}), 300)),
  ]);
  if (
    !enabled ||
    generation !== request ||
    getDockWindow() !== window ||
    getStrictBackendBindingForWebContents(window.webContents) !== binding
  )
    return;
  const context: DockShortcutContext = {
    id: randomUUID(),
    backendId: binding.backendId,
    action,
    ...sample,
  };
  // Only a genuinely focused, live embedded tab can contribute preview ownership.
  if ('pid' in sample && sample.pid === process.pid && focused && !focused.isDestroyed()) {
    const owner = embeddedBrowserCdp.focusedTabOwner(focused.id);
    if (owner?.backendId === binding.backendId) {
      context.url = owner.url;
      context.workspaceId = owner.workspaceId;
    }
  }
  if (context.url && !context.workspaceId) {
    const owners = embeddedBrowserCdp.liveUrlOwners(context.url, binding.backendId);
    if (owners.length === 1) context.workspaceId = owners[0];
  }
  if (context.url) context.serviceAddress = dockServiceAddress(context.url, binding.backendId);
  focusDockWindow(context);
}

/** Register only our bindings; a collision stays unavailable and is named in the menu. */
export function syncDockGlobalShortcuts(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  generation++;
  registration.sync(enabled);
}
export function dockShortcutAvailable(action: DockShortcutContext['action']): boolean {
  return registration.available(action);
}
app.on('will-quit', () => syncDockGlobalShortcuts(false));
