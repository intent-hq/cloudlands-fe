/**
 * IPC for tab windows (TabWindowRegistry, design §3).
 *
 * Only an app renderer bound to a machine may call these. `open` moves a tab
 * of the sender's own window and machine; the calls a tab window makes act
 * on the sender's own tab window only.
 */

import { randomUUID } from 'crypto';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  destroyMainOwnedBrowserPage,
  isMainOwnedBrowserPagesActive,
  mainOwnedBrowserPageOwner,
  moveMainOwnedBrowserPage,
} from '../features/browser/main/browser-view.ipc';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import {
  isTabWindowId,
  tabWindowDisplayMode,
  type TabWindowGetResult,
  type TabWindowIsOpenResult,
  type TabWindowOpenResult,
  type TabWindowTab,
} from '../shared/types/tab-window';
import { frameToShow, rendererFor } from './frames';
import { createSafeValidatedHandler } from './ipc-validation-middleware';
import { isTabWindow, setTabWindowSessions } from './tab-window-identity';
import { TabWindowRegistry } from './tab-windows';
import {
  isWindowSessionTeardown,
  openOrFocusWindowsForBackend,
  openTabWindowFrame,
} from './window';
import { getStrictBackendBindingForWebContents } from './window-backend';

const CHANNELS = IPC_CHANNELS.TAB_WINDOW;

const IdSchema = z.string().min(1).max(256);
/** A panel tab: its id and type are checked; the rest is the renderer's own shape. */
const TabSchema = z
  .object({ id: IdSchema, type: z.string().min(1).max(64), title: z.string().max(4_096) })
  .passthrough()
  .transform((tab) => tab as unknown as TabWindowTab);
const TabWindowIdSchema = z.string().refine(isTabWindowId, 'Not a tab window id');

const Schemas = {
  open: z.object({
    tabWindowId: TabWindowIdSchema,
    workspaceId: IdSchema,
    sourceLayoutId: IdSchema,
    tab: TabSchema,
  }),
  update: z.object({ tab: TabSchema }),
  byId: z.object({ tabWindowId: TabWindowIdSchema }),
};

let registry: TabWindowRegistry | null = null;

/** The sender's window and machine; throws for anything but a bound app renderer's main frame. */
function senderBinding(event: IpcMainInvokeEvent) {
  const binding = getStrictBackendBindingForWebContents(event.sender);
  if (!binding || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Tab windows need a bound app renderer');
  }
  return binding;
}

/** The sender's tab window; throws when the sender is not one. */
function senderTabWindow(event: IpcMainInvokeEvent) {
  const binding = senderBinding(event);
  if (!isTabWindow(binding.window)) throw new Error('The sender is not a tab window');
  return binding.window;
}

function requireRegistry(): TabWindowRegistry {
  if (!registry) throw new Error('Tab windows are not ready');
  return registry;
}

/** Bring a frame of `backendId` up to take a tab back, or null when none opens. */
async function openReturnFrame(backendId: string): Promise<Electron.BrowserWindow | null> {
  await openOrFocusWindowsForBackend(backendId);
  return frameToShow(backendId);
}

/** Start the registry, connect it to saved frames, and register its IPC. Call once at startup. */
export function registerTabWindowHandlers(): void {
  const tabWindows = new TabWindowRegistry({
    openFrame: (backendId, route, mode) =>
      openTabWindowFrame({ machineId: backendId, route, mode }),
    rendererFor,
    returnTarget: (backendId, preferred) => frameToShow(backendId, preferred),
    openReturnFrame,
    moveBrowserPage: moveMainOwnedBrowserPage,
    destroyBrowserPage: destroyMainOwnedBrowserPage,
    browserPageOwner: mainOwnedBrowserPageOwner,
    isQuitting: isWindowSessionTeardown,
    displayMode: tabWindowDisplayMode(process.platform, process.env),
    isMac: process.platform === 'darwin',
    newId: () => randomUUID(),
    send: (target, channel, payload) => target.send(channel, payload),
  });
  registry = tabWindows;
  setTabWindowSessions(tabWindows);

  ipcMain.handle(
    CHANNELS.OPEN,
    createSafeValidatedHandler(
      Schemas.open,
      async (event, request): Promise<TabWindowOpenResult> => {
        const binding = senderBinding(event);
        if (isTabWindow(binding.window)) throw new Error('A tab window cannot open another');
        // Part of the "Browser pages in the main process" Labs setting.
        if (!(await isMainOwnedBrowserPagesActive())) throw new Error('Tab windows are off');
        const tabWindowId = await requireRegistry().open(binding.window, binding.backendId, {
          tabWindowId: request.tabWindowId,
          workspaceId: request.workspaceId,
          sourceLayoutId: request.sourceLayoutId,
          tab: request.tab,
        });
        return { tabWindowId };
      },
      CHANNELS.OPEN,
    ),
  );
  ipcMain.handle(
    CHANNELS.GET,
    createSafeValidatedHandler(
      z.unknown(),
      async (event): Promise<TabWindowGetResult> => {
        const binding = senderBinding(event);
        return { record: requireRegistry().recordFor(binding.window) };
      },
      CHANNELS.GET,
    ),
  );
  ipcMain.handle(
    CHANNELS.UPDATE,
    createSafeValidatedHandler(
      Schemas.update,
      async (event, { tab }) => {
        requireRegistry().update(senderTabWindow(event), tab);
        return { success: true };
      },
      CHANNELS.UPDATE,
    ),
  );
  ipcMain.handle(
    CHANNELS.MOVE_BACK,
    createSafeValidatedHandler(
      z.unknown(),
      async (event) => {
        requireRegistry().moveBack(senderTabWindow(event));
        return { success: true };
      },
      CHANNELS.MOVE_BACK,
    ),
  );
  ipcMain.handle(
    CHANNELS.CLOSE_TAB,
    createSafeValidatedHandler(
      z.unknown(),
      async (event) => {
        requireRegistry().closeTab(senderTabWindow(event));
        return { success: true };
      },
      CHANNELS.CLOSE_TAB,
    ),
  );
  ipcMain.handle(
    CHANNELS.IS_OPEN,
    createSafeValidatedHandler(
      Schemas.byId,
      async (event, { tabWindowId }): Promise<TabWindowIsOpenResult> => {
        senderBinding(event);
        return requireRegistry().status(tabWindowId);
      },
      CHANNELS.IS_OPEN,
    ),
  );
  ipcMain.handle(
    CHANNELS.FOCUS,
    createSafeValidatedHandler(
      Schemas.byId,
      async (event, { tabWindowId }) => {
        senderBinding(event);
        return { focused: requireRegistry().focus(tabWindowId) };
      },
      CHANNELS.FOCUS,
    ),
  );
}
