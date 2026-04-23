import type { AgentSession, AgentMessage } from "$shared/types";
import type { Collection } from "../../utils/collection-utils";

/**
 * Internal storage shape for a single agent session.
 *
 * Mirrors the public `AgentSession` type but stores `messages` as a
 * `Collection<AgentMessage, 'id'>` for O(1) per-message lookups and
 * aligns with `src/lib/store/AGENTS.md` §3 ("Use Collection, Not Arrays").
 *
 * Selectors materialize back to the public `AgentSession` shape (with
 * `messages: AgentMessage[]`), so callers outside the slice are unaffected.
 */
export type StoredAgentSession = Omit<AgentSession, "messages"> & {
  messages: Collection<AgentMessage, "id">;
};

/**
 * Agent Session Slice State
 *
 * Flat, agent-keyed state for all AgentSession data.
 * All Date fields are stored as ISO strings (serializable).
 * Messages are stored as a serializable `Collection` (plain object).
 */
export interface AgentSessionState {
  /** Agent sessions keyed by agentId */
  byAgentId: Record<string, StoredAgentSession>;
  /** Index: workspace ID → array of agent IDs belonging to that workspace */
  agentIdsByWorkspace: Record<string, string[]>;
}

