import { persistenceService } from '$features/agent/browser';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
import {
  AgentStatus,
  type AgentSession,
  type Workspace,
} from '$shared/types';
import { AgentId } from '$shared/types/branded-ids';
import { compareMessageCompleteness } from '$shared/utils/message-comparator';
import { normalizeStreamingState } from '$shared/utils/agent-streaming-state';
import {
  call,
  put,
} from 'typed-redux-saga';
import { upsertSession } from '../../agent-session/agent-session-slice';
import { selectAllWorkspaceAgents } from '../workspace-agents-selectors';

/**
 * Re-export of the shared streaming-state normalizer under its historical name
 * so existing renderer importers keep working. The implementation now lives in
 * `$shared/utils/agent-streaming-state` so the main-process persistence funnel
 * can share the exact same predicate without crossing the renderer boundary.
 */
export { normalizeStreamingState as normalizeRestoredStreamingState } from '$shared/utils/agent-streaming-state';

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return new Date().toISOString();
}

export function* restoreSessionFromDiskWithoutBackend(
  agentId: string,
  workspace: Workspace,
  options?: { bypassCache?: boolean },
) {
  if (!agentId || !workspace?.id) return null;
  const plainAgentId = String(agentId);
  let session: AgentSession | null = yield* call(
    [persistenceService, persistenceService.loadSession],
    plainAgentId,
    workspace.id,
    options?.bypassCache ? { bypassCache: true } : undefined,
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
    normalizeStreamingState(session);
    if (!session.isInitialAgent && session.metadata?.isInitialAgent) session.isInitialAgent = true;
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
