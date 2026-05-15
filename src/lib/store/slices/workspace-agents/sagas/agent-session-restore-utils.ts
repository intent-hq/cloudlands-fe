import { persistenceService } from '$features/agent/browser';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
import {
  AgentStatus,
  type AgentSession,
  type Workspace,
} from '$shared/types';
import { AgentId } from '$shared/types/branded-ids';
import { compareMessageCompleteness } from '$shared/utils/message-comparator';
import {
  call,
  put,
} from 'typed-redux-saga';
import { upsertSession } from '../../agent-session/agent-session-slice';
import { selectAllWorkspaceAgents } from '../workspace-agents-selectors';

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return new Date().toISOString();
}

export function* restoreSessionFromDiskWithoutBackend(
  agentId: string,
  workspace: Workspace,
) {
  if (!agentId || !workspace?.id) return null;
  const plainAgentId = String(agentId);
  let session: AgentSession | null = yield* call(
    [persistenceService, persistenceService.loadSession],
    plainAgentId,
    workspace.id,
  );

  const inMemoryAgents: AgentSession[] = yield* selectAllWorkspaceAgents.effect(workspace.id);
  const inMemoryAgent = inMemoryAgents.find((agent) => String(agent.id) === plainAgentId);
  if (inMemoryAgent?.messages?.length) {
    const comparison = compareMessageCompleteness(
      { messages: inMemoryAgent.messages },
      { messages: session?.messages || [] },
    );
    if (comparison > 0) session = inMemoryAgent;
  }

  if (session && !session.workspaceId) session.workspaceId = workspace.id;
  if (session) {
    if (!session.messages?.find((message: any) => message.isStreaming)) session.isStreaming = false;
    if (!session.isInitialAgent && session.metadata?.isInitialAgent) session.isInitialAgent = true;
    if (
      (session.status === AgentStatus.Active || session.status === AgentStatus.Processing) &&
      !session.messages?.find((message: any) => message.isStreaming)
    ) {
      session.status = AgentStatus.Idle;
    }
    yield* put(upsertSession({
      ...session,
      workspaceId: workspace.id as AgentSession['workspaceId'],
    }));
    return session;
  }

  const config = yield* call(
    [persistenceService, persistenceService.loadAgentConfig],
    plainAgentId,
    workspace.id,
  );
  if (!config) return null;

  const pendingSession = {
    id: AgentId(plainAgentId),
    backendSessionId: null,
    workspaceId: workspace.id,
    name: config.name || 'Agent',
    status: AgentStatus.Pending,
    messages: [],
    model: config.model || DEFAULT_AGENT_MODEL,
    isStreaming: false,
    metadata: config.metadata,
    isInitialAgent: config.metadata?.isInitialAgent || false,
    createdAt: normalizeTimestamp(config.createdAt),
    updatedAt: normalizeTimestamp(config.updatedAt),
  } as AgentSession;
  yield* put(upsertSession({
    ...pendingSession,
    workspaceId: workspace.id as AgentSession['workspaceId'],
  }));
  return pendingSession;
}
