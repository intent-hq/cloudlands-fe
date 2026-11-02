import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store as appStore } from '$store/renderer/store';
import { agentCreationSaga } from '$store/renderer/slices/workspace-agents/sagas/agent-creation-saga';

type CreateParams = Record<string, unknown> & {
  workspaceId: string;
  name?: string;
  specialistId?: string;
  metadata?: Record<string, unknown>;
};

declare global {
  interface Window {
    __homeAssistantNewChat?: {
      calls: CreateParams[];
      holdNext: () => void;
      release: () => void;
    };
  }
}

/**
 * Scripts the Assistant chat creation reads and `agent.create` (PROTOCOL §5.5),
 * then runs the production creation saga.
 */
export function setupHomeAssistantNewChatFixtures() {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  const calls: CreateParams[] = [];
  let holdNext = false;
  let release = () => {};
  window.__homeAssistantNewChat = {
    calls,
    holdNext: () => {
      holdNext = true;
    },
    release: () => release(),
  };
  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      const request = payload as { method?: string; params?: CreateParams & { id?: string } };
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST || request?.params?.workspaceId !== '__chief__')
        return previous.invoke(channel, payload);
      if (request.method === 'specialist.get')
        return { ok: true, result: { specialist: { id: request.params.id, name: 'Assistant' } } };
      if (request.method === 'workspace.get')
        return { ok: true, result: { workspace: { id: '__chief__', title: 'Assistant' } } };
      if (request.method !== 'agent.create') return previous.invoke(channel, payload);
      const params = request.params;
      calls.push(JSON.parse(JSON.stringify(params)));
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      const now = new Date().toISOString();
      return {
        ok: true,
        result: {
          agent: {
            id: crypto.randomUUID(),
            workspaceId: params.workspaceId,
            name: params.name,
            status: 'idle',
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            notificationsMuted: false,
            metadata: {
              isBackground: false,
              specialist: params.specialistId,
              chiefPromptVersion: params.metadata?.chiefPromptVersion,
            },
          },
        },
      };
    },
  };
  const stopCreation = appStore.runSaga(agentCreationSaga);
  return () => {
    release();
    stopCreation();
    window.electronAPI = previous;
    delete window.__homeAssistantNewChat;
  };
}
