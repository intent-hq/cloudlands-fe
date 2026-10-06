import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { AgentSession } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { setupAgentMutationPreview } from '../../test/agent-mutation-preview';

interface RenameCall {
  agentId: string;
  workspaceId: string;
  name: string;
  skipIfExplicitlySet?: boolean;
}

declare global {
  interface Window {
    __homeAssistantRename?: {
      calls: RenameCall[];
      holdNext: () => void;
      failNext: () => void;
      release: () => void;
      hydrate: (agentId: string, patch?: Partial<AgentSession>) => void;
    };
  }
}

export function setupHomeAssistantRenameFixtures() {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  const calls: RenameCall[] = [];
  const saved = new Map<string, AgentSession>();
  let holdNext = false;
  let failNext = false;
  let release = () => {};
  window.__homeAssistantRename = {
    calls,
    holdNext: () => {
      holdNext = true;
    },
    failNext: () => {
      failNext = true;
    },
    release: () => release(),
    hydrate: (agentId, patch) => {
      const session = saved.get(agentId) ?? selectAgentSession.select(appStore.state, agentId);
      if (session) appStore.dispatch(bulkUpsertSessions([{ ...session, ...patch }]));
    },
  };
  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      const request = payload as { method?: string; params?: RenameCall };
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST || request?.method !== 'agent.rename') {
        return previous.invoke(channel, payload);
      }
      if (!request.params) throw new Error('Missing rename parameters');
      const params = request.params;
      calls.push(params);
      const shouldFail = failNext;
      failNext = false;
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (shouldFail)
        return { ok: false, error: { code: 'RENAME_UNAVAILABLE', message: 'Rename unavailable' } };
      const session = selectAgentSession.select(appStore.state, params.agentId);
      if (session)
        saved.set(params.agentId, { ...session, name: params.name, nameExplicitlySet: true });
      return { ok: true, result: { success: true } };
    },
  };
  const stopMutations = setupAgentMutationPreview();
  return () => {
    release();
    stopMutations();
    window.electronAPI = previous;
    delete window.__homeAssistantRename;
  };
}
