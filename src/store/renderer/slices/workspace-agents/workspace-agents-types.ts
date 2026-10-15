import type { AgentSessionProjectionState } from '../agent-session/agent-session-projections';
import type { WorkspaceAgentsState } from './workspace-agents-slice';

/** Current subscription completeness, independent of previously cached session records. */
export type WorkspaceAgentMetadataStatus = { context: string } & (
  { status: 'loading' | 'ready' } | { status: 'error'; error: string }
);

/** Mount-scoped consumer identity plus the resource whose creation is single-flight. */
export interface AgentCreationConsumer {
  id: string;
  resourceId: string;
}

/** Serializable UI result; the session itself remains owned by agentSessions. */
export interface AgentCreationOutcome {
  id: string;
  workspaceId: string;
  resourceId: string;
  seq: number;
  status: 'pending' | 'success' | 'failure' | 'cancelled' | 'uncertain';
  agentId?: string;
  error?: string;
  completedAt?: string;
}

/** Shared projection input; canonical slice state remains owned by its existing reducers. */
export type WorkspaceAgentsProjectionState = AgentSessionProjectionState & {
  workspaceAgents: WorkspaceAgentsState;
};
