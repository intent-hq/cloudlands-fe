import { IPC_CHANNELS } from '$shared/ipc-registry';

export interface HomeLifecycleCall {
  method: string;
  workspaceId: string;
}

const SCRIPTED = new Set([
  'workspace.archive',
  'workspace.retire',
  'workspace.delete',
  'workspace.members.list',
  'workspace.list',
  'hook.list',
]);

/**
 * Scripts the Home lifecycle writes (`workspace.archive`, `workspace.retire`,
 * `workspace.delete`) and records them, plus the bulk preflight reads
 * (`workspace.members.list`, `hook.list`). The Archived filter's retired read
 * (`workspace.list { includeRetired }`) finds no extra rows.
 */
export function setupHomeLifecycleBridge(): { calls: HomeLifecycleCall[]; dispose: () => void } {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  const calls: HomeLifecycleCall[] = [];
  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      const request = payload as { method?: string; params?: { workspaceId?: string } };
      if (
        channel !== IPC_CHANNELS.BACKEND.REQUEST ||
        !request?.method ||
        !SCRIPTED.has(request.method)
      )
        return previous.invoke(channel, payload);
      switch (request.method) {
        case 'workspace.members.list':
          return { ok: true, result: { members: [] } };
        case 'hook.list':
          return { ok: true, result: { hooks: [] } };
        case 'workspace.list':
          return { ok: true, result: { workspaces: [] } };
        default:
          calls.push({ method: request.method, workspaceId: request.params?.workspaceId ?? '' });
          return { ok: true, result: { success: true } };
      }
    },
  };
  return {
    calls,
    dispose: () => {
      window.electronAPI = previous;
    },
  };
}
