// Agent Session slice — flat, agent-keyed agent session data
export { agentSessionReducer, initialState } from "./agent-session-slice";
export {
  upsertSession,
  removeSession,
  setSessionStreaming,
  addMessage,
  updateMessage,
  replaceMessages,
  updateSession,
  setQueuedMessages,
  updateDigest,
  renameSession,
  bulkUpsertSessions,
  removeWorkspaceSessions,
  clearAllSessions,
} from "./agent-session-slice";

export {
  selectAgentSession,
  selectAgentMessages,
  selectAgentSessionsByWorkspace,
  selectAllAgentSessions,
  selectAgentIsStreaming,
  selectAgentQueuedMessages,
  selectAllStreamingAgents,
} from "./agent-session-selectors";

export type { AgentSessionState } from "./agent-session-types";

