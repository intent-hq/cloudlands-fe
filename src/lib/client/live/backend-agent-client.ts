import type { AgentSession } from '$shared/types/agent-session';
import type { AgentModelResult } from '../../../store/renderer/slices/agent-model/agent-model-types';
import type { Unsubscribe } from '../client-types';
import type { BackendRuntime } from './backend-transport-runtime';
import { createDeltaSubscriptionRuntime } from './delta-subscription-runtime';
import { createRunMutation, mutationErrorMessage } from './backend-mutation';
import { normalizeAgent } from './agent-normalization';

type AgentBackend = Pick<
  BackendRuntime,
  'backendRequest' | 'onBackendNotification' | 'onBackendReconnected'
>;

/** Shared wire implementation; callers supply their renderer's real transport. */
export function createBackendAgentClient(backend: AgentBackend) {
  const { backendRequest } = backend;
  const runMutation = createRunMutation(backendRequest);
  return {
    async get(agentId: string, workspaceId?: string): Promise<AgentSession | null> {
      const result = await backendRequest<{ agent?: unknown } | unknown>('agent.get', {
        agentId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
      const raw =
        result && typeof result === 'object' && 'agent' in result
          ? (result as { agent?: unknown }).agent
          : result;
      if (!raw || typeof raw !== 'object') return null;
      return normalizeAgent(raw as Record<string, unknown>);
    },
    subscribeWorkspaces(
      subscribeIds: (handler: (ids: readonly string[]) => void) => Unsubscribe,
      handler: (snapshot: AgentSession[], readyWorkspaceIds?: readonly string[]) => void,
    ): Unsubscribe {
      return createDeltaSubscriptionRuntime(
        {
          channel: {
            subscribeMethod: 'agent.subscribe',
            unsubscribeMethod: 'events.unsubscribe',
            dynamic: { subscribeIds, paramsForId: (workspaceId) => ({ workspaceId }) },
          },
          getId: (raw) => String(raw.id ?? ''),
          normalize: normalizeAgent,
          handler,
        },
        backend,
      );
    },
    async setModel(
      agentId: string,
      modelId: string,
      workspaceId: string,
      providerId?: string,
    ): Promise<AgentModelResult> {
      try {
        const data = await backendRequest<{ success: boolean; modelId?: string; error?: string }>(
          'agent.setModel',
          {
            agentId,
            modelId,
            workspaceId,
            ...(providerId ? { providerId } : {}),
          },
        );
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: mutationErrorMessage(error) };
      }
    },
    setReasoningEffort(params: {
      agentId: string;
      workspaceId: string;
      reasoningEffort: string | null;
    }) {
      return runMutation('agent.update', {
        agentId: params.agentId,
        workspaceId: params.workspaceId,
        changes: { reasoningEffort: params.reasoningEffort },
      });
    },
  };
}
