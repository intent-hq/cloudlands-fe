import type { AgentSession, AgentMessage, QueuedMessage } from "$shared/types";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { AgentSessionState } from "./agent-session-types";
import {
  upsertAgentSession,
  setAgentStreaming,
  addAgentMessage,
  replaceAgentMessages,
  removeAgentMessage,
  updateAgentMessage,
  updateAgentDigest,
  renameAgent,
} from "../workspace-agents/workspace-agents-slice";
import {
  chatSendStarted,
  chatSendFailed,
  chatInterrupted,
  chatStopCompleted,
  chatReset,
  chatStreamingReconciled,
  chatStuckStateCleared,
  chatInitialized,
  streamStarted,
  streamCompleted,
  streamErrored,
  streamTimedOut,
} from "../chat-state/chat-state-slice";

// ============================================================================
// Constants
// ============================================================================

const MAX_MESSAGES_PER_AGENT = 500;

// ============================================================================
// Normalization helpers (copied from workspace-agents-slice)
// ============================================================================

type AgentFileChange = NonNullable<AgentSession["fileChanges"]>[number];

function normalizeDateValue(value: Date | string | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeAgentMessage(message: AgentMessage): AgentMessage {
  return {
    ...message,
    timestamp: normalizeDateValue(message.timestamp) ?? message.timestamp,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      ...toolCall,
      timestamp: normalizeDateValue(toolCall.timestamp),
      startedAt: normalizeDateValue(toolCall.startedAt),
      completedAt: normalizeDateValue(toolCall.completedAt),
    })),
    toolResults: message.toolResults?.map((toolResult) => ({
      ...toolResult,
      timestamp: normalizeDateValue(toolResult.timestamp),
    })),
  };
}

function normalizeAgentFileChange(fileChange: AgentFileChange): AgentFileChange {
  return {
    ...fileChange,
    timestamp: normalizeDateValue(fileChange.timestamp),
  };
}

function normalizeAgentSession(agent: AgentSession): AgentSession {
  return {
    ...agent,
    createdAt: normalizeDateValue(agent.createdAt) ?? agent.createdAt,
    updatedAt: normalizeDateValue(agent.updatedAt) ?? agent.updatedAt,
    lastActivity: normalizeDateValue(agent.lastActivity),
    startedAt: normalizeDateValue(agent.startedAt),
    endedAt: normalizeDateValue(agent.endedAt),
    lastViewedAt: normalizeDateValue(agent.lastViewedAt),
    messages: agent.messages.map(normalizeAgentMessage),
    fileChanges: agent.fileChanges?.map(normalizeAgentFileChange),
  };
}

// ============================================================================
// Dedup / Prune helpers
// ============================================================================

function deduplicateMessages(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  const result: AgentMessage[] = [];
  for (const msg of messages) {
    if (!seen.has(msg.id)) {
      seen.add(msg.id);
      result.push(msg);
    }
  }
  return result;
}

function pruneMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_AGENT) return messages;
  return messages.slice(messages.length - MAX_MESSAGES_PER_AGENT);
}

// ============================================================================
// State helpers
// ============================================================================

function getSession(state: AgentSessionState, agentId: string): AgentSession | undefined {
  return state.byAgentId[agentId];
}

function setSession(
  state: AgentSessionState,
  agentId: string,
  session: AgentSession,
): AgentSessionState {
  return {
    ...state,
    byAgentId: { ...state.byAgentId, [agentId]: session },
  };
}

function updateSessionFields(
  state: AgentSessionState,
  agentId: string,
  partial: Partial<AgentSession>,
): AgentSessionState {
  const existing = getSession(state, agentId);
  if (!existing) return state;
  return setSession(state, agentId, { ...existing, ...partial });
}

function registerInWorkspaceIndex(
  state: AgentSessionState,
  agentId: string,
  wsId: string,
): AgentSessionState {
  const existing = state.agentIdsByWorkspace[wsId] ?? [];
  if (existing.includes(agentId)) return state;
  return {
    ...state,
    agentIdsByWorkspace: {
      ...state.agentIdsByWorkspace,
      [wsId]: [...existing, agentId],
    },
  };
}

/**
 * Shallow equivalence check for upsertSession no-op guard.
 * Compares key scalar fields and message count / last message ID
 * to avoid creating new state references when nothing changed.
 */
function isSessionEquivalent(a: AgentSession, b: AgentSession): boolean {
  return (
    a.status === b.status &&
    a.name === b.name &&
    a.model === b.model &&
    a.isStreaming === b.isStreaming &&
    a.isProcessing === b.isProcessing &&
    a.isResponding === b.isResponding &&
    a.digest === b.digest &&
    a.backendSessionId === b.backendSessionId &&
    a.acpSessionId === b.acpSessionId &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.lastActivity === b.lastActivity &&
    a.hasUnread === b.hasUnread &&
    a.currentTurnNumber === b.currentTurnNumber &&
    a.isBackground === b.isBackground &&
    a.activationState === b.activationState &&
    a.messages.length === b.messages.length &&
    (a.messages.length === 0 ||
      a.messages[a.messages.length - 1].id === b.messages[b.messages.length - 1].id)
  );
}

function removeFromWorkspaceIndex(
  state: AgentSessionState,
  agentId: string,
): AgentSessionState {
  const agentIdsByWorkspace = { ...state.agentIdsByWorkspace };
  for (const wsId of Object.keys(agentIdsByWorkspace)) {
    const agents = agentIdsByWorkspace[wsId];
    const filtered = agents.filter((id) => id !== agentId);
    if (filtered.length !== agents.length) {
      if (filtered.length === 0) {
        delete agentIdsByWorkspace[wsId];
      } else {
        agentIdsByWorkspace[wsId] = filtered;
      }
    }
  }
  return { ...state, agentIdsByWorkspace };
}

// ============================================================================
// Initial State
// ============================================================================

export const initialState: AgentSessionState = {
  byAgentId: {},
  agentIdsByWorkspace: {},
};

// ============================================================================
// Actions
// ============================================================================

/** Upsert a session — normalize dates, dedup messages, prune to 500, register in workspace index */
export const upsertSession = createAction<[session: AgentSession]>(
  "agentSessions/upsertSession",
);

/** Remove a session by agentId (from byAgentId and agentIdsByWorkspace) */
export const removeSession = createAction<[agentId: string]>(
  "agentSessions/removeSession",
);

/**
 * Set streaming flag for an agent.
 * @deprecated Use `setAgentStreaming` from `workspace-agents-slice` instead.
 * The cross-slice handler automatically updates agent-session state when
 * `setAgentStreaming` is dispatched. This action is kept for edge cases only.
 */
export const setSessionStreaming = createAction<[agentId: string, isStreaming: boolean]>(
  "agentSessions/setSessionStreaming",
);

/** Add a single message (dedup, prune) */
export const addMessage = createAction<[agentId: string, message: AgentMessage]>(
  "agentSessions/addMessage",
);

/** Update a single message by messageId */
export const updateMessage = createAction<
  [agentId: string, messageId: string, updates: Partial<AgentMessage>]
>("agentSessions/updateMessage");

/** Full replacement of messages (with dedup/prune) */
export const replaceMessages = createAction<[agentId: string, messages: AgentMessage[]]>(
  "agentSessions/replaceMessages",
);

/** Atomically remove a single message by ID */
export const removeMessage = createAction<[agentId: string, messageId: string]>(
  "agentSessions/removeMessage",
);

/** Non-message field updates */
export const updateSession = createAction<[agentId: string, updates: Partial<AgentSession>]>(
  "agentSessions/updateSession",
);

/** Set queued messages for an agent */
export const setQueuedMessages = createAction<[agentId: string, messages: QueuedMessage[]]>(
  "agentSessions/setQueuedMessages",
);

/** Update agent digest */
export const updateDigest = createAction<[agentId: string, digest: string | null]>(
  "agentSessions/updateDigest",
);

/** Rename agent session */
export const renameSession = createAction<[agentId: string, name: string]>(
  "agentSessions/renameSession",
);

/** Bulk upsert sessions (initial load / snapshot reconciliation) */
export const bulkUpsertSessions = createAction<[sessions: AgentSession[]]>(
  "agentSessions/bulkUpsertSessions",
);

/** Remove all sessions for a workspace */
export const removeWorkspaceSessions = createAction<[wsId: string]>(
  "agentSessions/removeWorkspaceSessions",
);

/** Clear all sessions */
export const clearAllSessions = createAction(
  "agentSessions/clearAllSessions",
);

// ============================================================================
// Reducer
// ============================================================================

export const agentSessionReducer = createReducer<AgentSessionState>(initialState)
  .with(upsertSession, (state, { payload: [session] }) => {
    const normalized = normalizeAgentSession(session);
    const deduped = pruneMessages(deduplicateMessages(normalized.messages || []));
    const finalSession: AgentSession = { ...normalized, messages: deduped };
    const agentId = String(normalized.id);
    const wsId = String(session.workspaceId);

    // No-op guard: if the session already exists with equivalent data
    // and is already registered in the workspace index, return state unchanged.
    const existing = getSession(state, agentId);
    const alreadyIndexed = (state.agentIdsByWorkspace[wsId] ?? []).includes(agentId);
    if (existing && alreadyIndexed && isSessionEquivalent(existing, finalSession)) {
      return state;
    }

    // Preserve in-flight isStreaming/isProcessing flags from a placeholder session
    // created by chatSendStarted before the full session loaded from disk.
    if (existing) {
      if (existing.isStreaming && finalSession.isStreaming === undefined) {
        finalSession.isStreaming = true;
      }
      if (existing.isProcessing && finalSession.isProcessing === undefined) {
        finalSession.isProcessing = true;
      }
    }

    let next = setSession(state, agentId, finalSession);
    next = registerInWorkspaceIndex(next, agentId, wsId);
    return next;
  })
  .with(removeSession, (state, { payload: [agentId] }) => {
    if (!state.byAgentId[agentId]) return state;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _, ...rest } = state.byAgentId;
    let next: AgentSessionState = { ...state, byAgentId: rest };
    next = removeFromWorkspaceIndex(next, agentId);
    return next;
  })
  .with(setSessionStreaming, (state, { payload: [agentId, isStreaming] }) => {
    const session = getSession(state, agentId);
    if (!session || session.isStreaming === isStreaming) return state;
    return updateSessionFields(state, agentId, { isStreaming });
  })
  .with(addMessage, (state, { payload: [agentId, message] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const normalizedMsg = normalizeAgentMessage(message);
    if (session.messages.some((m) => m.id === normalizedMsg.id)) return state;
    const updated = pruneMessages([...session.messages, normalizedMsg]);
    return setSession(state, agentId, { ...session, messages: updated });
  })
  .with(updateMessage, (state, { payload: [agentId, messageId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return state;
    const newMessages = [...session.messages];
    newMessages[idx] = { ...newMessages[idx], ...updates };
    return setSession(state, agentId, { ...session, messages: newMessages });
  })
  .with(replaceMessages, (state, { payload: [agentId, messages] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const deduped = pruneMessages(deduplicateMessages(messages.map(normalizeAgentMessage)));
    return setSession(state, agentId, { ...session, messages: deduped });
  })
  .with(removeMessage, (state, { payload: [agentId, messageId] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const filtered = session.messages.filter((m) => m.id !== messageId);
    if (filtered.length === session.messages.length) return state;
    return setSession(state, agentId, { ...session, messages: filtered });
  })
  .with(updateSession, (state, { payload: [agentId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const { messages, ...otherUpdates } = updates;
    let merged: AgentSession = { ...session, ...otherUpdates };
    if (messages && Array.isArray(messages)) {
      merged = { ...merged, messages: pruneMessages(deduplicateMessages(messages.map(normalizeAgentMessage))) };
    }
    return setSession(state, agentId, merged);
  })
  .with(setQueuedMessages, (state, { payload: [agentId, messages] }) =>
    updateSessionFields(state, agentId, { queuedMessages: messages }),
  )
  .with(updateDigest, (state, { payload: [agentId, digest] }) =>
    updateSessionFields(state, agentId, { digest: digest ?? undefined }),
  )
  .with(renameSession, (state, { payload: [agentId, name] }) => {
    const session = getSession(state, agentId);
    if (!session || session.name === name) return state;
    return setSession(state, agentId, { ...session, name });
  })
  .with(bulkUpsertSessions, (state, { payload: [sessions] }) => {
    let next = state;
    for (const session of sessions) {
      const normalized = normalizeAgentSession(session);
      const deduped = pruneMessages(deduplicateMessages(normalized.messages || []));
      const finalSession: AgentSession = { ...normalized, messages: deduped };
      const agentId = String(normalized.id);
      const wsId = String(session.workspaceId);

      // Preserve in-flight isStreaming/isProcessing flags from a placeholder session
      // created by chatSendStarted before the full session loaded from disk.
      const existing = getSession(next, agentId);
      if (existing) {
        if (existing.isStreaming && finalSession.isStreaming === undefined) {
          finalSession.isStreaming = true;
        }
        if (existing.isProcessing && finalSession.isProcessing === undefined) {
          finalSession.isProcessing = true;
        }
      }

      next = setSession(next, agentId, finalSession);
      next = registerInWorkspaceIndex(next, agentId, wsId);
    }
    return next;
  })
  .with(removeWorkspaceSessions, (state, { payload: [wsId] }) => {
    const agentIds = state.agentIdsByWorkspace[wsId] ?? [];
    if (agentIds.length === 0 && !state.agentIdsByWorkspace[wsId]) return state;
    const byAgentId = { ...state.byAgentId };
    for (const id of agentIds) {
      delete byAgentId[id];
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [wsId]: _, ...restWorkspaces } = state.agentIdsByWorkspace;
    return { byAgentId, agentIdsByWorkspace: restWorkspaces };
  })
  .with(clearAllSessions, () => initialState)
  // -----------------------------------------------------------------------
  // Cross-slice: handle workspace-agents actions directly (replaces bridge saga)
  // -----------------------------------------------------------------------
  .with(upsertAgentSession, (state, { payload: [, session] }) => {
    const normalized = normalizeAgentSession(session);
    const deduped = pruneMessages(deduplicateMessages(normalized.messages || []));
    const finalSession: AgentSession = { ...normalized, messages: deduped };
    const agentId = String(normalized.id);
    const wsId = String(session.workspaceId);

    const existing = getSession(state, agentId);
    const alreadyIndexed = (state.agentIdsByWorkspace[wsId] ?? []).includes(agentId);
    if (existing && alreadyIndexed && isSessionEquivalent(existing, finalSession)) {
      return state;
    }

    // Preserve in-flight isStreaming/isProcessing flags from a placeholder session
    // created by chatSendStarted before the full session loaded from disk.
    if (existing) {
      if (existing.isStreaming && finalSession.isStreaming === undefined) {
        finalSession.isStreaming = true;
      }
      if (existing.isProcessing && finalSession.isProcessing === undefined) {
        finalSession.isProcessing = true;
      }
    }

    let next = setSession(state, agentId, finalSession);
    next = registerInWorkspaceIndex(next, agentId, wsId);
    return next;
  })
  .with(setAgentStreaming, (state, { payload: [, agentId, isStreaming] }) => {
    const session = getSession(state, agentId);
    if (!session || session.isStreaming === isStreaming) return state;
    return updateSessionFields(state, agentId, { isStreaming });
  })
  .with(addAgentMessage, (state, { payload: [, agentId, message] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const normalizedMsg = normalizeAgentMessage(message);
    if (session.messages.some((m) => m.id === normalizedMsg.id)) return state;
    const updated = pruneMessages([...session.messages, normalizedMsg]);
    return setSession(state, agentId, { ...session, messages: updated });
  })
  .with(replaceAgentMessages, (state, { payload: [, agentId, messages] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const deduped = pruneMessages(deduplicateMessages(messages.map(normalizeAgentMessage)));
    return setSession(state, agentId, { ...session, messages: deduped });
  })
  .with(removeAgentMessage, (state, { payload: [, agentId, messageId] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const filtered = session.messages.filter((m) => m.id !== messageId);
    if (filtered.length === session.messages.length) return state;
    return setSession(state, agentId, { ...session, messages: filtered });
  })
  .with(updateAgentMessage, (state, { payload: [, agentId, messageId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return state;
    const newMessages = [...session.messages];
    newMessages[idx] = { ...newMessages[idx], ...updates };
    return setSession(state, agentId, { ...session, messages: newMessages });
  })
  .with(updateAgentDigest, (state, { payload: [, agentId, digest] }) => {
    const session = getSession(state, agentId);
    if (!session || session.digest === digest) return state;
    return setSession(state, agentId, { ...session, digest: digest ?? undefined });
  })
  .with(renameAgent, (state, { payload: [, agentId, name] }) => {
    const session = getSession(state, agentId);
    if (!session || session.name === name) return state;
    return setSession(state, agentId, { ...session, name });
  })
  // -----------------------------------------------------------------------
  // Cross-slice: handle chat-state actions for isStreaming/isProcessing
  // agent-session is the single source of truth for these flags.
  // -----------------------------------------------------------------------
  .with(chatSendStarted, (state, { payload: { agentId, wsId, timestamp } }) => {
    const existing = getSession(state, agentId);
    if (existing) {
      return updateSessionFields(state, agentId, { isStreaming: true, isProcessing: true });
    }
    // Session not yet loaded (e.g. restored workspace where disk load is still in flight).
    // Create a minimal placeholder so the UI can show the processing indicator immediately.
    // The full session will be populated when upsertSession/upsertAgentSession arrives.
    const now = new Date(timestamp).toISOString();
    const placeholder: AgentSession = {
      id: agentId as AgentSession['id'],
      backendSessionId: null,
      workspaceId: wsId as AgentSession['workspaceId'],
      name: '',
      status: 'active' as any,
      messages: [],
      isStreaming: true,
      isProcessing: true,
      createdAt: now,
      updatedAt: now,
    };
    let next = setSession(state, agentId, placeholder);
    next = registerInWorkspaceIndex(next, agentId, wsId);
    return next;
  })
  .with(chatSendFailed, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  )
  .with(chatInterrupted, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  )
  .with(chatStopCompleted, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  )
  .with(chatReset, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  )
  .with(chatStreamingReconciled, (state, { payload: { agentId } }) =>
    updateSessionFields(state, agentId, { isStreaming: true, isProcessing: true }),
  )
  .with(chatInitialized, (state, { payload: [agentId, data] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    // Preserve existing isProcessing if already true and new data says not streaming.
    // This handles the initial-agent case where setAgentStreaming(true) was dispatched
    // during workspace init, and chatInitialized arrives before real streaming starts.
    const isStreaming = data.isStreaming || (session.isStreaming ?? false);
    const isProcessing = data.isStreaming || (session.isProcessing ?? false);
    if (session.isStreaming === isStreaming && session.isProcessing === isProcessing) return state;
    return updateSessionFields(state, agentId, { isStreaming, isProcessing });
  })
  .with(streamStarted, (state, { payload: { agentId } }) =>
    updateSessionFields(state, agentId, { isStreaming: true }),
  )
  .with(streamCompleted, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  )
  .with(streamErrored, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  )
  .with(streamTimedOut, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  )
  .with(chatStuckStateCleared, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false }),
  );

