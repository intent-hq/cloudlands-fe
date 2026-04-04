import type { AgentSession } from "$shared/types";

/**
 * Agent Session Slice State
 *
 * Flat, agent-keyed state for all AgentSession data.
 * All Date fields are stored as ISO strings (serializable).
 */
export interface AgentSessionState {
  /** Agent sessions keyed by agentId */
  byAgentId: Record<string, AgentSession>;
  /** Index: workspace ID → array of agent IDs belonging to that workspace */
  agentIdsByWorkspace: Record<string, string[]>;
}

