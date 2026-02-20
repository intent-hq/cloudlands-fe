/**
 * Tracked IPC module that wraps electron's ipcMain to track handler registrations
 * This should be imported instead of directly importing from 'electron' when registering handlers
 */

import { ipcMain as originalIpcMain } from 'electron';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';

// Access the global registered handlers set
const registeredHandlers: Set<string> =
  (global as any).__ipcRegisteredHandlers || new Set<string>();

// Create a proxy for ipcMain that tracks handle calls (silently - summary logged in index.ts)
const trackedIpcMain = new Proxy(originalIpcMain, {
  get(target, prop) {
    if (prop === 'handle') {
      return function (channel: string, handler: any) {
        registeredHandlers.add(channel);
        return target.handle(channel, handler);
      };
    }
    return target[prop as keyof IpcMain];
  },
}) as IpcMain;

export { trackedIpcMain as ipcMain };
export type { IpcMainInvokeEvent };
