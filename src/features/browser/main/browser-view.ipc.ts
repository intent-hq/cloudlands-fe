/**
 * IPC for main-owned browser views (BrowserViewService, Labs: off by default).
 *
 * Only an app renderer bound to a machine may call these, and only for its own
 * window and machine: a page is created in the sender's window, and later calls
 * must come from the renderer of the window and machine that own the page.
 */

import { app, ipcMain, View, WebContentsView, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import { MACHINE_RAIL_SHOWN_CHANGED_EVENT } from '../../../main/machine-rail-state';
import { rendererFor, shownMachine } from '../../../main/frames';
import {
  buildBrowserViewWebPreferences,
  isBrowserGuestNavigationAllowed,
  secureMainOwnedBrowserContents,
} from '../../../main/webview-security';
import { getStrictBackendBindingForWebContents } from '../../../main/window-backend';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { Logger } from '../../../shared/logger';
import { BrowserViewService } from './browser-view-service';
import { embeddedBrowserCdp } from './embedded-browser-cdp-service';

const logger = new Logger('BrowserViewIPC');
const CHANNELS = IPC_CHANNELS.BROWSER_VIEW;

const TabIdSchema = z.string().min(1).max(256);
const RectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});

const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string().min(1).max(32_768) }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('forward') }),
  z.object({ type: z.literal('reload'), ignoreCache: z.boolean().optional() }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('set-zoom'), factor: z.number().finite().positive() }),
  z.object({
    type: z.literal('find'),
    text: z.string().max(1_000),
    forward: z.boolean().optional(),
    findNext: z.boolean().optional(),
    matchCase: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('stop-find'),
    action: z.enum(['clearSelection', 'keepSelection', 'activateSelection']),
  }),
  z.object({ type: z.literal('open-devtools') }),
  z.object({ type: z.literal('toggle-devtools') }),
  z.object({ type: z.literal('focus') }),
  z.object({ type: z.literal('set-audio-muted'), muted: z.boolean() }),
  z.object({ type: z.literal('execute-javascript'), code: z.string().min(1).max(262_144) }),
  z.object({ type: z.literal('capture'), rect: RectSchema.optional() }),
]);

const BrowserViewSchemas = {
  setLab: z.object({ enabled: z.boolean() }),
  create: z.object({
    tabId: TabIdSchema,
    workspaceId: z.string().min(1).max(256),
    url: z.string().min(1).max(32_768),
    pinned: z.boolean().optional(),
  }),
  tab: z.object({ tabId: TabIdSchema }),
  workspace: z.object({ workspaceId: z.string().min(1).max(256) }),
  placement: z.object({ tabId: TabIdSchema, rect: RectSchema.nullable(), visible: z.boolean() }),
  command: z.object({ tabId: TabIdSchema, command: CommandSchema }),
};

let labEnabled = false;
/**
 * The setting as it was when the app started. The renderer picks the
 * `<webview>` or main-owned path once per run, so a change applies after a
 * restart and pages are only created while the run's value is on.
 */
let labActive = false;
let service: BrowserViewService | null = null;

/** The sender's window and machine; throws for anything but a bound app renderer's main frame. */
function senderBinding(event: IpcMainInvokeEvent) {
  const binding = getStrictBackendBindingForWebContents(event.sender);
  if (!binding || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Browser views need a bound app renderer');
  }
  return binding;
}

/** Throws unless the sender is the renderer of the window and machine that own the page. */
function requireOwner(event: IpcMainInvokeEvent, views: BrowserViewService, tabId: string): void {
  const binding = senderBinding(event);
  const key = views.keyOf(tabId);
  if (!key) throw new Error('This browser tab is closed');
  if (key.backendId !== binding.backendId || views.windowOf(tabId) !== binding.window) {
    throw new Error('This browser tab belongs to another window');
  }
}

function requireService(): BrowserViewService {
  if (!service) throw new Error('Browser views are not ready');
  return service;
}

/** Read the saved Labs setting. A read failure keeps it off. */
async function loadBrowserViewLab(): Promise<void> {
  try {
    labEnabled = (await getLocalPref<boolean>('browserViewsInMainEnabled')) === true;
  } catch {
    labEnabled = false;
  }
  labActive = labEnabled;
}

/**
 * Start the service, connect it to the CDP registry, and register its IPC.
 * The Labs setting gates only creating new pages; it is off until read.
 */
export function registerBrowserViewHandlers(): void {
  const labLoaded = loadBrowserViewLab();

  const views = new BrowserViewService({
    createView: (webPreferences) => new WebContentsView({ webPreferences }),
    createParkingHolder: () => new View(),
    webPreferences: buildBrowserViewWebPreferences,
    secureContents: secureMainOwnedBrowserContents,
    isNavigationAllowed: isBrowserGuestNavigationAllowed,
    machineViewFor: rendererFor,
    shownMachine,
    cdp: embeddedBrowserCdp,
    send: (target, message) => target.send(CHANNELS.EVENT, message),
  });
  service = views;
  embeddedBrowserCdp.setMainOwnedBrowserViews(views);
  const appEvents: NodeJS.EventEmitter = app;
  appEvents.on(MACHINE_RAIL_SHOWN_CHANGED_EVENT, (window: Electron.BrowserWindow) => {
    views.handleShownMachineChanged(window);
  });

  ipcMain.handle(
    CHANNELS.GET_LAB,
    createSafeValidatedHandler(
      z.unknown(),
      async () => {
        await labLoaded;
        return { enabled: labEnabled, active: labActive };
      },
      CHANNELS.GET_LAB,
    ),
  );
  ipcMain.handle(
    CHANNELS.SET_LAB,
    createSafeValidatedHandler(
      BrowserViewSchemas.setLab,
      async (event, request) => {
        senderBinding(event);
        await labLoaded;
        await setLocalPref('browserViewsInMainEnabled', request.enabled);
        labEnabled = request.enabled;
        logger.info('Browser views in main (Labs) changed', { enabled: labEnabled });
        return { enabled: labEnabled, active: labActive };
      },
      CHANNELS.SET_LAB,
    ),
  );
  ipcMain.handle(
    CHANNELS.CREATE,
    createSafeValidatedHandler(
      BrowserViewSchemas.create,
      async (event, request) => {
        await labLoaded;
        if (!labActive) throw new Error('Browser views in main are off');
        const binding = senderBinding(event);
        return requireService().create(
          {
            backendId: binding.backendId,
            workspaceId: request.workspaceId,
            tabId: request.tabId,
          },
          binding.window,
          request.url,
          request.pinned === undefined ? {} : { pinned: request.pinned },
        );
      },
      CHANNELS.CREATE,
    ),
  );
  ipcMain.handle(
    CHANNELS.STATE,
    createSafeValidatedHandler(
      BrowserViewSchemas.tab,
      async (event, { tabId }) => {
        const views = requireService();
        if (!views.keyOf(tabId)) return { state: null };
        requireOwner(event, views, tabId);
        return { state: views.stateOf(tabId) ?? null };
      },
      CHANNELS.STATE,
    ),
  );
  ipcMain.handle(
    CHANNELS.DESTROY,
    createSafeValidatedHandler(
      BrowserViewSchemas.tab,
      async (event, { tabId }) => {
        const views = requireService();
        if (!views.keyOf(tabId)) return { success: true };
        requireOwner(event, views, tabId);
        views.destroy(tabId);
        return { success: true };
      },
      CHANNELS.DESTROY,
    ),
  );
  ipcMain.handle(
    CHANNELS.DESTROY_WORKSPACE,
    createSafeValidatedHandler(
      BrowserViewSchemas.workspace,
      async (event, { workspaceId }) => {
        const binding = senderBinding(event);
        requireService().destroyWorkspace(binding.backendId, workspaceId);
        return { success: true };
      },
      CHANNELS.DESTROY_WORKSPACE,
    ),
  );
  ipcMain.handle(
    CHANNELS.SET_PLACEMENT,
    createSafeValidatedHandler(
      BrowserViewSchemas.placement,
      async (event, { tabId, rect, visible }) => {
        const views = requireService();
        requireOwner(event, views, tabId);
        views.setPlacement(tabId, rect, visible);
        return { placement: views.placementOf(tabId) };
      },
      CHANNELS.SET_PLACEMENT,
    ),
  );
  ipcMain.handle(
    CHANNELS.DETACH,
    createSafeValidatedHandler(
      BrowserViewSchemas.tab,
      async (event, { tabId }) => {
        const views = requireService();
        if (!views.keyOf(tabId)) return { success: true };
        requireOwner(event, views, tabId);
        views.detach(tabId);
        return { success: true };
      },
      CHANNELS.DETACH,
    ),
  );
  ipcMain.handle(
    CHANNELS.COMMAND,
    createSafeValidatedHandler(
      BrowserViewSchemas.command,
      async (event, { tabId, command }) => {
        const views = requireService();
        requireOwner(event, views, tabId);
        return await views.command(tabId, command);
      },
      CHANNELS.COMMAND,
    ),
  );
}
