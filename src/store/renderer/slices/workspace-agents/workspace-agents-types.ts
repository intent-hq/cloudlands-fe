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
  status: 'pending' | 'success' | 'failure' | 'cancelled';
  agentId?: string;
  error?: string;
  completedAt?: string;
}
