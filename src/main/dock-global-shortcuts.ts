import { BrowserWindow, Menu } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import {
  dockShortcutBindings,
  dockShortcutAccelerator,
  DOCK_SHORTCUT_IDS,
  dockShortcutAction,
  type DockShortcutSettingsSnapshot,
  type DockShortcutIssue,
} from '../shared/dock-shortcut-settings';
import { createDockShortcutPreferences } from './dock-shortcut-preferences';
import {
  getDockShortcutOverridesLocalPref,
  setDockShortcutOverridesLocalPref,
} from './local-prefs';
import { registerDockShortcutSettingsHandlers } from './dock-shortcut-settings-ipc';
import { sampleDockForeground } from './dock-shortcut-foreground';
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

const preferences = createDockShortcutPreferences({
  registrar: registration,
  read: getDockShortcutOverridesLocalPref,
  write: setDockShortcutOverridesLocalPref,
  platform: process.platform,
  additionalIssues(bindings) {
    const accelerators: string[] = [];
    const visit = (items: Electron.MenuItem[]) => {
      for (const item of items) {
        if (item.accelerator) accelerators.push(item.accelerator);
        if (item.submenu) visit(item.submenu.items);
      }
    };
    visit(Menu.getApplicationMenu()?.items ?? []);
    const canonical = (value: string) =>
      dockShortcutAccelerator(
        value.replace(/CommandOrControl|CmdOrCtrl/gi, 'mod').replace(/Command|Cmd/gi, 'mod'),
        process.platform,
      );
    const issues: DockShortcutIssue[] = [];
    for (const id of DOCK_SHORTCUT_IDS) {
      const key = bindings[dockShortcutAction(id)];
      const accelerator = dockShortcutAccelerator(key, process.platform);
      if (accelerator && accelerators.some((value) => canonical(value) === accelerator))
        issues.push({ code: 'app-conflict', id, key });
    }
    return issues;
  },
  changed(snapshot: DockShortcutSettingsSnapshot) {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(IPC_CHANNELS.DOCK_SHORTCUTS.CHANGED, snapshot);
    app.emit('dock-window-state-changed');
  },
});
export async function initializeDockShortcutSettings(): Promise<void> {
  await preferences.load();
  registerDockShortcutSettingsHandlers(preferences);
}
export function dockShortcutMenuKey(action: DockShortcutContext['action']): string {
  const key = dockShortcutBindings(preferences.snapshot().overrides)[action];
  return dockShortcutAccelerator(key, process.platform) ?? key;
}

export async function requestDockShortcut(action: DockShortcutContext['action']): Promise<void> {
  const window = getDockWindow();
  if (!enabled || !window) return;
  const binding = getStrictBackendBindingForWebContents(window.webContents);
  if (!binding) return;
  const request = ++generation;
  const focused = webContents.getFocusedWebContents();
  const focusedOwner =
    focused && !focused.isDestroyed() ? embeddedBrowserCdp.focusedTabOwner(focused.id) : null;
  const reading = await sampleDockForeground(getDesktopNativeAdapter());
  const sample = reading.snapshot;
  logger.debug('Foreground shortcut context read', {
    identityOutcome: reading.identityOutcome,
    urlOutcome: reading.urlOutcome,
    elapsedMs: reading.elapsedMs,
  });
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
    if (
      owner?.backendId === binding.backendId &&
      owner.workspaceId === focusedOwner?.workspaceId &&
      owner.url === focusedOwner.url
    ) {
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
  preferences.enable(enabled);
}
export function dockShortcutAvailable(action: DockShortcutContext['action']): boolean {
  return registration.available(action);
}
app.on('will-quit', () => syncDockGlobalShortcuts(false));
