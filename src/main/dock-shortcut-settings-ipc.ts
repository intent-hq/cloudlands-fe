import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { createValidatedHandler } from './ipc-validation-middleware';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from './window-backend';
import type { createDockShortcutPreferences } from './dock-shortcut-preferences';
const readSchema = z.object({ appOverrides: z.record(z.string()).optional() }).strict();
const writeSchema = z
  .object({
    id: z.string().optional(),
    key: z.string().nullable().optional(),
    resetAll: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative(),
    appOverrides: z.record(z.string()).optional(),
    captureToken: z.string().optional(),
  })
  .strict();
const captureSchema = z.object({ active: z.boolean(), token: z.string().optional() }).strict();
export function registerDockShortcutSettingsHandlers(
  service: ReturnType<typeof createDockShortcutPreferences>,
) {
  let lease: { token: string; sender: WebContents; stop: () => void } | null = null;
  async function endCapture() {
    const current = lease;
    if (!current) return;
    lease = null;
    current.stop();
    await service.capture(false);
  }
  function trusted(event: Electron.IpcMainInvokeEvent) {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !getStrictBackendBindingForWebContents(event.sender)
    )
      throw new Error('Dock shortcut settings require a live app document');
  }
  ipcMain.handle(
    IPC_CHANNELS.DOCK_SHORTCUTS.GET,
    createValidatedHandler(
      readSchema,
      async (event, request) => {
        trusted(event);
        return request.appOverrides ? service.refresh(request.appOverrides) : service.snapshot();
      },
      IPC_CHANNELS.DOCK_SHORTCUTS.GET,
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.DOCK_SHORTCUTS.SET,
    createValidatedHandler(
      writeSchema,
      async (event, request) => {
        trusted(event);
        if (lease) {
          if (lease.sender !== event.sender || lease.token !== request.captureToken)
            throw new Error('Another window is recording a shortcut');
          await endCapture();
        }
        return service.update(request);
      },
      IPC_CHANNELS.DOCK_SHORTCUTS.SET,
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.DOCK_SHORTCUTS.CAPTURE,
    createValidatedHandler(
      captureSchema,
      async (event, request) => {
        trusted(event);
        if (!request.active) {
          if (lease?.sender === event.sender && lease.token === request.token) await endCapture();
          return { snapshot: service.snapshot(), token: null };
        }
        if (lease && lease.sender !== event.sender)
          throw new Error('Another window is recording a shortcut');
        if (lease) return { snapshot: service.snapshot(), token: lease.token };
        const sender = event.sender,
          window = BrowserWindow.fromWebContents(sender),
          token = randomUUID();
        const release = () => void endCapture();
        const timer = setTimeout(release, 30_000);
        timer.unref();
        const retire = onStrictBackendBindingRetired(sender, release);
        window?.on('blur', release);
        sender.once('destroyed', release);
        sender.setIgnoreMenuShortcuts(true);
        lease = {
          token,
          sender,
          stop() {
            if (!sender.isDestroyed()) sender.setIgnoreMenuShortcuts(false);
            clearTimeout(timer);
            retire();
            window?.removeListener('blur', release);
            sender.removeListener('destroyed', release);
          },
        };
        try {
          const snapshot = await service.capture(true);
          if (lease?.token !== token) {
            await service.capture(false);
            return { snapshot: service.snapshot(), token: null };
          }
          return { snapshot, token };
        } catch (error) {
          await endCapture();
          throw error;
        }
      },
      IPC_CHANNELS.DOCK_SHORTCUTS.CAPTURE,
    ),
  );
}
