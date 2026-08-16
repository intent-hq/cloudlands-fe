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

  window.webContents.send(channel, payload);
  return true;
}
