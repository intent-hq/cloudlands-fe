/**
 * Daemon Agent Bridge — the sole persistence surface for agent sessions
 * after the legacy `agent-persistence.ts` / `persistence.ipc.ts` layer was
 * retired.
 *
 * Preserves the `LoadResult` / `SaveResult` return shapes used by
 * `agent-backend-handler.service.ts` and `consolidated-backend.service.ts`.
 * Behaviour notes:
 *
 * - Transcript writes are rejected mid-turn by the daemon with `-32602`;
 *   we downgrade that to a soft `SaveResult` failure with a `debug` log so
 *   the streaming path (which does not depend on the persist landing) keeps
 *   flowing.
 * - `saveAgent` maps to `agent.update` for the whitelisted mutable fields
 *   only (PROTOCOL.md §5.5). Message-array changes must go through the
 *   explicit `replaceMessages` / `appendMessage` helpers.
 */

import type { AgentMessage, AgentSession } from '$shared/types';
import type { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { Logger } from '$shared/logger';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';

const logger = new Logger('DaemonAgentBridge');

export interface DaemonLoadResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DaemonSaveResult {
  success: boolean;
  error?: string;
}

/** PROTOCOL.md §5.5 `agent.update` — whitelisted mutable fields. */
const UPDATABLE_FIELDS = [
  'status',
  'isActive',
  'acpSessionId',
  'backendSessionId',
  'name',
  'nameExplicitlySet',
  'model',
  'provider',
  'systemPrompt',
  'specialist',
  'taskNoteId',
  'skipAutoCommit',
  'completionReport',
  'completionReportTimestamp',
  'delegationDepth',
  'initialMessage',
  'contextReferences',
  'imageBlocks',
  'isBackground',
] as const;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isMidTurnRejection(e: unknown): boolean {
  return e instanceof JsonRpcError && e.rpcCode === -32602;
}

function pickChanges(agent: AgentSession): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const src = agent as unknown as Record<string, unknown>;
  for (const key of UPDATABLE_FIELDS) {
    if (src[key] !== undefined) changes[key] = src[key];
  }
  return changes;
}

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  return (await getBackendClient().request(method, params)) as T;
}

export const daemonAgentBridge = {
  async loadAgent(
    agentId: AgentId,
    workspaceId: WorkspaceId,
    _workspacePath?: string,
  ): Promise<DaemonLoadResult<AgentSession>> {
    try {
      const res = await rpc<{ session: AgentSession }>('agent.getSession', {
        agentId,
        workspaceId,
      });
      return { success: true, data: res.session };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  },

  async loadAgentSummary(
    agentId: AgentId,
    workspaceId: WorkspaceId,
    _workspacePath?: string,
  ): Promise<DaemonLoadResult<AgentSession>> {
    try {
      const res = await rpc<{ agent: AgentSession }>('agent.get', { agentId, workspaceId });
      return { success: true, data: res.agent };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  },

  async saveAgent(agent: AgentSession, _workspacePath?: string): Promise<DaemonSaveResult> {
    try {
      const changes = pickChanges(agent);
      if (Object.keys(changes).length === 0) return { success: true };
      await rpc('agent.update', {
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        changes,
      });
      return { success: true };
    } catch (e) {
      logger.warn('agent.update failed', { agentId: agent.id, error: errMsg(e) });
      return { success: false, error: errMsg(e) };
    }
  },

  async deleteAgent(
    agentId: string,
    workspaceId: string,
    _workspacePath?: string,
  ): Promise<DaemonSaveResult> {
    try {
      await rpc('agent.delete', { agentId, workspaceId });
      return { success: true };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  },

  async listAgents(workspaceId: string, _workspacePath?: string): Promise<string[]> {
    try {
      const res = await rpc<{ agents: Array<{ id: string }> }>('agent.list', { workspaceId });
      return res.agents.map((a) => a.id);
    } catch (e) {
      logger.warn('agent.list failed', { workspaceId, error: errMsg(e) });
      return [];
    }
  },

  async getMessages(agentId: string, workspaceId?: string): Promise<AgentMessage[]> {
    try {
      const params: Record<string, unknown> = { agentId };
      if (workspaceId) params.workspaceId = workspaceId;
      const res = await rpc<{ messages: AgentMessage[] }>('agent.getConversation', params);
      return res.messages ?? [];
    } catch (e) {
      logger.warn('agent.getConversation failed', { agentId, error: errMsg(e) });
      return [];
    }
  },

  async saveMessage(
    agentId: string,
    workspaceId: string,
    message: AgentMessage,
  ): Promise<DaemonSaveResult> {
    const role = (message as { role?: string }).role ?? 'user';
    const contentBlocks = (message as { contentBlocks?: unknown[] }).contentBlocks ?? [];
    const metadata = (message as { metadata?: unknown }).metadata;
    try {
      const params: Record<string, unknown> = { agentId, workspaceId, role, contentBlocks };
      if (metadata !== undefined) params.metadata = metadata;
      await rpc('agent.appendMessage', params);
      return { success: true };
    } catch (e) {
      if (isMidTurnRejection(e)) {
        logger.debug('agent.appendMessage mid-turn rejection; caller must retry post-turn', {
          agentId,
        });
      } else {
        logger.warn('agent.appendMessage failed', { agentId, error: errMsg(e) });
      }
      return { success: false, error: errMsg(e) };
    }
  },

  async replaceMessages(
    agentId: string,
    workspaceId: string,
    messages: AgentMessage[],
  ): Promise<DaemonSaveResult> {
    try {
      await rpc('agent.replaceMessages', { agentId, workspaceId, messages });
      return { success: true };
    } catch (e) {
      if (isMidTurnRejection(e)) {
        logger.debug('agent.replaceMessages mid-turn rejection; caller must retry post-turn', {
          agentId,
        });
      } else {
        logger.warn('agent.replaceMessages failed', { agentId, error: errMsg(e) });
      }
      return { success: false, error: errMsg(e) };
    }
  },
};

export type DaemonAgentBridge = typeof daemonAgentBridge;
