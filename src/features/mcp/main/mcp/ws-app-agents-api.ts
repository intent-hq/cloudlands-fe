import { Logger } from '$shared/logger';
import type { AgentMessage, AgentSession, Workspace } from '$shared/types';
import { AgentId, CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';

import { getMainState } from '../../../../store/main/redux-store-bridge';
import { selectAgentStatus } from '../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';
import { agentPersistence } from '../../../agent/main/agent-persistence';

const logger = new Logger('WsAppAgentsApi');
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_READ_LIMIT = 20;
const MAX_READ_LIMIT = 100;

type WorkspaceManagerLike = {
  listAllWorkspaces?(options?: {
    lite?: boolean;
  }): Promise<{ ok: boolean; data?: Workspace[]; error?: string }>;
  listWorkspaces?(): Promise<{ ok: boolean; data?: Workspace[]; error?: string }>;
  getWorkspace(id: string): Promise<Workspace | null>;
};

type AgentThreadListOptions = {
  workspaceId?: string;
  includeCompleted?: boolean;
  limit?: number;
  cursor?: number | string;
};

type AgentThreadReadOptions = {
  lastN?: number;
  startTurn?: number;
  endTurn?: number;
  includeToolCalls?: boolean;
};

function requireWorkspaceManager(workspaceManager?: WorkspaceManagerLike): WorkspaceManagerLike {
  if (!workspaceManager) throw new Error('Workspace manager not available');
  return workspaceManager;
}

async function listReadableWorkspaces(
  manager: WorkspaceManagerLike,
  workspaceId?: string,
): Promise<Workspace[]> {
  if (workspaceId) {
    if (workspaceId === CHIEF_WORKSPACE_ID) throw new Error('Chief workspace has no agent threads');
    const workspace = await manager.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return [workspace];
  }

  const result = manager.listAllWorkspaces
    ? await manager.listAllWorkspaces({ lite: true })
    : await manager.listWorkspaces?.();
  if (!result?.ok) throw new Error(result?.error || 'Failed to list workspaces');

  return (result.data ?? []).filter(
    (workspace) =>
      workspace.id !== CHIEF_WORKSPACE_ID && String(workspace.status).toLowerCase() !== 'deleted',
  );
}

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error('limit must be a positive integer');
  return Math.min(parsed, max);
}

function normalizeOffset(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('cursor must be a non-negative integer offset');
  return parsed;
}

function normalizeTurn(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function getMessageCount(agent: any): number {
  if (Array.isArray(agent.messages)) return agent.messages.length;
  return (
    agent.messageCount ?? agent.metadata?.messageCount ?? agent.agentMetadata?.messageCount ?? 0
  );
}

function getTaskNoteId(agent: any): string | undefined {
  return agent.taskNoteId ?? agent.metadata?.taskNoteId ?? agent.agentMetadata?.taskNoteId;
}

function isTerminalStatus(status: unknown): boolean {
  return ['completed', 'complete', 'failed', 'cancelled', 'canceled'].includes(
    String(status || '').toLowerCase(),
  );
}

function threadTimestamp(thread: {
  lastActivity?: string;
  updatedAt?: string;
  createdAt?: string;
}): number {
  const value = thread.lastActivity ?? thread.updatedAt ?? thread.createdAt;
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function toThreadInfo(agent: any, workspace: Workspace) {
  const status =
    selectAgentStatus.select(getMainState(), String(workspace.id), String(agent.id)) ||
    agent.status;
  return {
    workspaceId: String(workspace.id),
    workspaceTitle: workspace.title || 'Untitled',
    agentId: String(agent.id),
    agentName: agent.name || 'Agent',
    status,
    sessionStatus: agent.status,
    messageCount: getMessageCount(agent),
    taskNoteId: getTaskNoteId(agent),
    createdAt: toOptionalString(agent.createdAt),
    updatedAt: toOptionalString(agent.updatedAt),
    lastActivity: toOptionalString(agent.lastActivity),
  };
}

function filterMessageContent(message: AgentMessage, includeToolCalls: boolean): AgentMessage {
  if (includeToolCalls) return message;

  const { toolCalls: _toolCalls, toolResults: _toolResults, ...rest } = message;
  return {
    ...rest,
    ...(Array.isArray(message.contentBlocks)
      ? {
          contentBlocks: message.contentBlocks.filter(
            (block) => block.type !== 'tool_use' && block.type !== 'tool_result',
          ),
        }
      : {}),
  } as AgentMessage;
}

function hasReturnedContent(message: AgentMessage): boolean {
  return !Array.isArray(message.contentBlocks) || message.contentBlocks.length > 0;
}

function selectMessages(messages: AgentMessage[], opts: AgentThreadReadOptions) {
  const startTurn = normalizeTurn(opts.startTurn, 'startTurn');
  const endTurn = normalizeTurn(opts.endTurn, 'endTurn');

  if (startTurn !== undefined || endTurn !== undefined) {
    const start = (startTurn ?? 1) - 1;
    const end = Math.min(endTurn ?? messages.length, start + MAX_READ_LIMIT);
    if (end < start + 1) throw new Error('endTurn must be greater than or equal to startTurn');
    return { messages: messages.slice(start, end), startTurn: start + 1, endTurn: end };
  }

  const limit = normalizeLimit(opts.lastN, DEFAULT_READ_LIMIT, MAX_READ_LIMIT);
  const start = Math.max(0, messages.length - limit);
  return { messages: messages.slice(start), startTurn: start + 1, endTurn: messages.length };
}

async function loadAgentSession(workspaceId: string, agentId: string): Promise<AgentSession> {
  const { AgentBackendHandler } = await import('../../../agent/main/agent-backend-handler.service');
  const handler = AgentBackendHandler.getInstance();
  const activeAgent = await handler.getAgent(agentId);
  if (
    activeAgent &&
    (!activeAgent.workspaceId || String(activeAgent.workspaceId) === workspaceId)
  ) {
    return activeAgent;
  }

  const loadResult = await agentPersistence.loadAgent(AgentId(agentId), WorkspaceId(workspaceId));
  if (loadResult.success && loadResult.data) return loadResult.data;
  throw new Error(`Agent "${agentId}" not found in workspace "${workspaceId}"`);
}

export function buildWsAppAgentsApi(workspaceManager: WorkspaceManagerLike | undefined) {
  return {
    async list(options: AgentThreadListOptions = {}) {
      logger.debug('ws.app.agents.list', { workspaceId: options.workspaceId });
      const manager = requireWorkspaceManager(workspaceManager);
      const workspaces = await listReadableWorkspaces(manager, options.workspaceId);
      const { AgentBackendHandler } =
        await import('../../../agent/main/agent-backend-handler.service');
      const handler = AgentBackendHandler.getInstance();

      const perWorkspace = await Promise.all(
        workspaces.map(async (workspace) => {
          const agents = await handler.listAllAgents(String(workspace.id));
          return agents
            .map((agent: AgentSession) => toThreadInfo(agent, workspace))
            .filter(
              (thread) => options.includeCompleted !== false || !isTerminalStatus(thread.status),
            );
        }),
      );

      const threads = perWorkspace
        .flat()
        .sort((left, right) => threadTimestamp(right) - threadTimestamp(left));
      const cursor = normalizeOffset(options.cursor);
      const limit = normalizeLimit(options.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const page = threads.slice(cursor, cursor + limit);

      return {
        threads: page,
        total: threads.length,
        returned: page.length,
        ...(cursor + page.length < threads.length
          ? { nextCursor: String(cursor + page.length) }
          : {}),
      };
    },

    async readConversation(
      workspaceId: string,
      agentId: string,
      opts: AgentThreadReadOptions = {},
    ) {
      logger.debug('ws.app.agents.readConversation', { workspaceId, agentId });
      const manager = requireWorkspaceManager(workspaceManager);
      const [workspace, agent] = await Promise.all([
        manager.getWorkspace(workspaceId),
        loadAgentSession(workspaceId, agentId),
      ]);
      if (!workspace || workspace.id === CHIEF_WORKSPACE_ID)
        throw new Error(`Workspace not found: ${workspaceId}`);

      const includeToolCalls = opts.includeToolCalls === true;
      const allMessages = agent.messages ?? [];
      const selected = selectMessages(allMessages, opts);
      const messages = selected.messages
        .map((message) => filterMessageContent(message, includeToolCalls))
        .filter(hasReturnedContent);

      return {
        workspaceId,
        workspaceTitle: workspace.title || 'Untitled',
        agentId,
        agentName: agent.name,
        status: selectAgentStatus.select(getMainState(), workspaceId, agentId) || agent.status,
        sessionStatus: agent.status,
        totalMessages: allMessages.length,
        returnedMessages: messages.length,
        startTurn: selected.startTurn,
        endTurn: selected.endTurn,
        includeToolCalls,
        taskNoteId: getTaskNoteId(agent),
        createdAt: toOptionalString(agent.createdAt),
        updatedAt: toOptionalString(agent.updatedAt),
        lastActivity: toOptionalString(agent.lastActivity),
        messages,
      };
    },
  };
}
