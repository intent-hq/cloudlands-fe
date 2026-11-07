import { IPC_CHANNELS } from '$shared/ipc-registry';

interface ActionCall {
  method: string;
  params: Record<string, unknown>;
}

declare global {
  interface Window {
    __homeAssistantActions?: { calls: ActionCall[] };
  }
}

const SCRIPTED = new Set([
  'agent.update',
  'agent.retire',
  'agent.restore',
  'agent.delete',
  'agent.cancelDelete',
]);

/**
 * Scripts the Assistant chat lifecycle writes (PROTOCOL §5.5: `agent.update`
 * pinned, `agent.retire`, `agent.restore`, `agent.delete` with the undo window,
 * `agent.cancelDelete`) and advertises `agentRetire` on `client.hello`.
 */
export function setupHomeAssistantActionsFixtures() {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  const calls: ActionCall[] = [];
  window.__homeAssistantActions = { calls };
  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      const request = payload as { method?: string; params?: Record<string, unknown> };
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST || !request?.method)
        return previous.invoke(channel, payload);
      if (request.method === 'client.hello') {
        const base = (await previous.invoke(channel, payload).catch(() => null)) as {
          result?: { server?: { capabilities?: Record<string, unknown> } };
        } | null;
        const result = base?.result ?? {};
        return {
          ok: true,
          result: {
            ...result,
            server: {
              ...result.server,
              capabilities: { ...result.server?.capabilities, agentRetire: 1 },
            },
          },
        };
      }
      if (!SCRIPTED.has(request.method) || request.params?.workspaceId !== '__chief__')
        return previous.invoke(channel, payload);
      calls.push({ method: request.method, params: { ...request.params } });
      const now = new Date().toISOString();
      switch (request.method) {
        case 'agent.retire':
          return { ok: true, result: { success: true, retiredAt: now } };
        case 'agent.delete':
          return {
            ok: true,
            result: { success: true, scheduled: true, deleteAt: now },
          };
        case 'agent.cancelDelete':
          return { ok: true, result: { cancelled: true } };
        default:
          return { ok: true, result: { success: true } };
      }
    },
  };
  return () => {
    window.electronAPI = previous;
    delete window.__homeAssistantActions;
  };
}
