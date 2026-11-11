import type { BrowserWindow } from 'electron';
import { getActiveContents } from './window-backend';
import type { WorkspaceCommandPayload } from '../shared/ipc/workspace-command-payloads';
import { workspaceCommandPayload } from '../shared/ipc/workspace-command-payloads';

export type WorkspaceCommandWindow = {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: WorkspaceCommandPayload): void;
  };
};

export function sendWorkspaceCommand(
  window: WorkspaceCommandWindow | null | undefined,
  channel: string,
  workspaceId: unknown,
): boolean {
  const payload = workspaceCommandPayload(workspaceId);
  if (!window || window.isDestroyed() || !payload) return false;

  // The visible page: a connection panel when the window shows one.
  const page = getActiveContents(window as unknown as BrowserWindow) as unknown as
    WorkspaceCommandWindow['webContents'] | undefined;
  (page ?? window.webContents).send(channel, payload);
  return true;
}
