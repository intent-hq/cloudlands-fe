import { shallowEqual } from 'fast-equals';
import type { AgentSession, AgentMessage, QueuedMessage } from '$shared/types';
import { createAction } from '../../utils/create-action';
import { createReducer } from '../../utils/create-reducer';
import {
  createCollection,
  removeItem,
  updateItem,
  getItem,
  getItems,
  type Collection,
} from '../../utils/collection-utils';
import type { AgentSessionState, StoredAgentSession } from './agent-session-types';
import {
  upsertAgentSession,
  setAgentStreaming,
  addAgentMessage,
  replaceAgentMessages,
  removeAgentMessage,
  replaceAgentMessageById,
  updateAgentMessage,
  updateAgentDigest,
  renameAgent,
} from '../workspace-agents/workspace-agents-slice';
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
} from '../chat-state/chat-state-slice';

// ============================================================================
// Constants
// ============================================================================

const MAX_MESSAGES_PER_AGENT = 500;

// ============================================================================
// Normalization helpers (copied from workspace-agents-slice)
// ============================================================================

type AgentFileChange = NonNullable<AgentSession['fileChanges']>[number];

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
// Content-hash helpers (pure, deterministic)
// ============================================================================

/**
 * Returns true when the message ID uses the canonical backend prefix (`msg_`).
 * These IDs are provider-assigned and should be preferred over renderer-generated UUIDs.
 */
export function hasCanonicalId(id: string): boolean {
  return id.startsWith('msg_');
}

/**
 * Canonical JSON stringify that sorts object keys recursively so that two
 * logically-equal values produce byte-identical output regardless of key
 * insertion order. Used by `computeMessageContentHash` for tool-block
 * payloads where property order may differ between producers.
 *
 * Undefined values are normalized to match standard `JSON.stringify`
 * semantics: omitted from objects and replaced with `null` in arrays. This
 * ensures `{a: undefined, b: 1}` and `{b: 1}` produce identical hashes.
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Fast deterministic non-cryptographic string hash (djb2 variant).
 * Produces an 8-char hex string.  Pure / serializable / no crypto API.
 *
 * This is O(n) in the input length, so callers that may receive very large
 * strings (e.g., multi-MB base64 payloads) should route through
 * `sampledPayloadHash` instead of calling this directly.
 */
function simpleStringHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0; // h * 33 + c, 32-bit
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Bounded-cost fingerprint for media-block `data` payloads.
 *
 * `computeMessageContentHash` runs on the reducer hot path during session
 * load/merge, so iterating a multi-MB base64 string per image/audio/file
 * block would risk UI stalls.  Instead of hashing every byte, we sample a
 * small, fixed-size "signature" of the payload: the first 64 chars, the
 * last 64 chars, and 8 single chars at evenly-spaced interior offsets.
 * The signature is hashed with `simpleStringHash`.
 *
 * Cost is O(1) in `s.length` once the string exceeds the sampling window,
 * so attachment size no longer affects reducer time.
 *
 * Collision resistance: distinct user attachments almost never share both
 * their head and tail bytes (base64-encoded media headers and trailers
 * diverge rapidly), and adding 8 strided interior samples plus the exact
 * length (included separately in the content-hash string) makes a
 * cross-attachment false positive astronomically unlikely in practice.
 */
function sampledPayloadHash(s: string): string {
  const len = s.length;
  // For small strings, sampling buys nothing — just hash the whole thing.
  const HEAD = 64;
  const TAIL = 64;
  const MID_SAMPLES = 8;
  if (len <= HEAD + TAIL + MID_SAMPLES) return simpleStringHash(s);

  const head = s.slice(0, HEAD);
  const tail = s.slice(len - TAIL);
  // Strided interior samples.  Offsets are clamped to the interior region
  // between HEAD and (len - TAIL) so we never re-sample the head/tail.
  const interiorStart = HEAD;
  const interiorEnd = len - TAIL;
  const interiorLen = interiorEnd - interiorStart;
  let mid = '';
  for (let i = 1; i <= MID_SAMPLES; i++) {
    const offset = interiorStart + Math.floor((i * interiorLen) / (MID_SAMPLES + 1));
    mid += s.charCodeAt(offset).toString(16);
  }
  return simpleStringHash(head + mid + tail);
}

/**
 * Compute a stable, deterministic hash string for an AgentMessage based on its
 * `role` and the text content of its `contentBlocks`.  The hash intentionally
 * ignores metadata, timestamps, and IDs so that two copies of the same logical
 * message (one with a local UUID, one with a `msg_*` ID) will produce the same
 * value.
 *
 * Returns `null` when the message has no contentBlocks (or they're all empty),
 * signalling that content-based dedup should not apply to this message.
 *
 * The implementation uses a simple string-concatenation approach that is fast
 * enough for reducer-time use and is fully serializable (no crypto APIs).
 * Tool-block payloads use `stableStringify` so key-order variation between
 * producers does not produce divergent hashes.
 */
export function computeMessageContentHash(message: AgentMessage): string | null {
  const blocks = message.contentBlocks;
  if (!blocks || blocks.length === 0) return null;

  const role = message.role ?? '';
  // Collect only the text-bearing content from blocks in order.
  // Tool-use / tool-result blocks are included via their stringified form so
  // that messages with identical tool sequences also match.
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' || block.type === 'thinking') {
      parts.push(block.text ?? block.content ?? '');
    } else if (block.type === 'tool_use') {
      parts.push(`tool_use:${block.name ?? block.toolName ?? ''}:${stableStringify(block.input ?? {})}`);
    } else if (block.type === 'tool_result') {
      parts.push(`tool_result:${block.tool_use_id ?? ''}:${stableStringify(block.output ?? block.content ?? '')}`);
    } else if (block.type === 'code') {
      parts.push(`code:${block.language ?? ''}:${block.text ?? block.content ?? ''}`);
    } else if (block.type === 'image') {
      // Mime + length + sampled fingerprint of data.  `sampledPayloadHash`
      // is O(1) in payload size (samples head, tail, and a few strided
      // interior bytes) so reducer cost stays bounded even for multi-MB
      // base64 attachments, while still distinguishing distinct payloads.
      const data = block.data ?? '';
      parts.push(`image:${block.mimeType ?? ''}:${data.length}:${sampledPayloadHash(data)}`);
    } else if (block.type === 'audio') {
      const data = block.data ?? '';
      parts.push(`audio:${block.mimeType ?? ''}:${data.length}:${sampledPayloadHash(data)}:${block.transcript ?? ''}`);
    } else if (block.type === 'file') {
      const data = block.data ?? '';
      parts.push(`file:${block.mimeType ?? ''}:${block.fileName ?? ''}:${data.length}:${sampledPayloadHash(data)}`);
    }
  }
  const contentStr = parts.join('\n');
  if (!contentStr) return null; // all blocks were empty
  return `${role}::${contentStr}`;
}

/**
 * Check whether two timestamps are within a tolerance window (default 30 seconds).
 * Used as a secondary guard to avoid false content-hash matches across
 * genuinely different turns that happen to have the same text.
 *
 * Returns false when either timestamp is missing or unparseable
 * (fail-closed guard against collapsing distinct messages).
 */
export function isTimestampClose(
  a: string | Date | undefined,
  b: string | Date | undefined,
  toleranceMs: number = 30_000,
): boolean {
  if (!a || !b) return false; // Missing → fail closed, don't collapse
  const ta = typeof a === 'string' ? new Date(a).getTime() : a.getTime();
  const tb = typeof b === 'string' ? new Date(b).getTime() : b.getTime();
  if (isNaN(ta) || isNaN(tb)) return false; // Unparseable → fail closed
  return Math.abs(ta - tb) <= toleranceMs;
}

function hasExplicitDifferentTurn(a: AgentMessage, b: AgentMessage): boolean {
  if (
    a.turnNumber !== undefined &&
    b.turnNumber !== undefined &&
    a.turnNumber !== b.turnNumber
  ) {
    return true;
  }
  return false;
}

function getAppMessageId(message: AgentMessage): string | undefined {
  return typeof message.appMessageId === 'string' && message.appMessageId.length > 0
    ? message.appMessageId
    : undefined;
}

function canUseLegacyContentFallback(a: AgentMessage, b: AgentMessage): boolean {
  return !getAppMessageId(a) && !getAppMessageId(b);
}

function getPreferredIdentityMessage(existing: AgentMessage, incoming: AgentMessage): AgentMessage {
  if (hasCanonicalId(existing.id) && !hasCanonicalId(incoming.id)) return existing;
  return incoming;
}

function mergeLogicalMessage(existing: AgentMessage, incoming: AgentMessage): AgentMessage {
  const preferredIdentityMessage = getPreferredIdentityMessage(existing, incoming);
  const secondaryMessage = preferredIdentityMessage === existing ? incoming : existing;
  return {
    ...secondaryMessage,
    ...preferredIdentityMessage,
    id: preferredIdentityMessage.id,
    appMessageId: getAppMessageId(incoming) ?? getAppMessageId(existing),
    metadata:
      existing.metadata || incoming.metadata
        ? { ...secondaryMessage.metadata, ...preferredIdentityMessage.metadata }
        : undefined,
  };
}

function isCanonicalAssistantDuplicate(a: AgentMessage, b: AgentMessage): boolean {
  if (hasExplicitDifferentTurn(a, b)) return false;
  if (!canUseLegacyContentFallback(a, b)) return false;
  return (
    a.role === 'assistant' &&
    b.role === 'assistant' &&
    hasCanonicalId(a.id) &&
    hasCanonicalId(b.id)
  );
}

/**
 * Find a local message that matches the incoming message by content hash,
 * role, and timestamp proximity. Returns the index in `messages` or -1.
 */
function findContentMatch(
  messages: AgentMessage[],
  incoming: AgentMessage,
  shouldMatch: (existing: AgentMessage, incoming: AgentMessage) => boolean = () => true,
): number {
  const incomingHash = computeMessageContentHash(incoming);
  if (incomingHash === null) return -1; // no content blocks, skip
  for (let i = 0; i < messages.length; i++) {
    const existing = messages[i];
    if (existing.id === incoming.id) continue; // already same ID, skip
    if (existing.role !== incoming.role) continue;
    if (!canUseLegacyContentFallback(existing, incoming)) continue;
    if (computeMessageContentHash(existing) !== incomingHash) continue;
    if (!isTimestampClose(existing.timestamp, incoming.timestamp)) continue;
    if (!shouldMatch(existing, incoming)) continue;
    return i;
  }
  return -1;
}

// ============================================================================
// Dedup / Prune helpers
// ============================================================================

function deduplicateMessages(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  const appMessageIdToIndex = new Map<string, number>();
  const result: AgentMessage[] = [];

  // First pass: deduplicate by ID (existing behavior), then by stable app-owned
  // logical message ID when present.
  for (const msg of messages) {
    if (seen.has(msg.id)) continue;
    seen.add(msg.id);

    const appMessageId = getAppMessageId(msg);
    if (appMessageId) {
      const existingIdx = appMessageIdToIndex.get(appMessageId);
      if (existingIdx !== undefined) {
        result[existingIdx] = mergeLogicalMessage(result[existingIdx], msg);
        continue;
      }
      appMessageIdToIndex.set(appMessageId, result.length);
    }

    result.push(msg);
  }

  // Second pass: legacy content-hash tiebreaker — when two messages both lack
  // app-owned identity but have different IDs, the same content hash, role, and
  // close timestamps, collapse local ↔ canonical pairs by keeping the canonical
  // `msg_*` prefix. Also collapse canonical assistant ↔ canonical assistant
  // duplicates from the same logical turn, keeping the first canonical copy
  // already present in message order. Messages with appMessageId or explicitly
  // different turnNumbers are never content-collapsed.
  // We track *all* indices per hash so that multiple non-canonical duplicates
  // are all removed when a canonical message arrives (not just the first one).
  const hashMap = new Map<string, number[]>();
  const toRemove = new Set<number>();
  for (let i = 0; i < result.length; i++) {
    const hash = computeMessageContentHash(result[i]);
    if (hash === null) continue; // no content blocks, skip
    const prevIndices = hashMap.get(hash);
    if (prevIndices !== undefined) {
      const curr = result[i];
      const currCanonical = hasCanonicalId(curr.id);
      let currRemoved = false;
      for (const prevIdx of prevIndices) {
        if (toRemove.has(prevIdx)) continue; // already scheduled for removal
        const prev = result[prevIdx];
        // Only merge if timestamps are close (same logical message)
        if (!isTimestampClose(prev.timestamp, curr.timestamp)) continue;
        if (hasExplicitDifferentTurn(prev, curr)) continue;
        if (!canUseLegacyContentFallback(prev, curr)) continue;
        // Collapse when exactly one copy has a canonical `msg_*` ID (local ↔
        // provider-assigned), or when both are canonical assistant messages
        // representing the same logical turn. If both are non-canonical, keep both.
        const prevCanonical = hasCanonicalId(prev.id);
        if (currCanonical && !prevCanonical) {
          result[i] = mergeLogicalMessage(prev, curr);
          toRemove.add(prevIdx);
        } else if (prevCanonical && !currCanonical) {
          result[prevIdx] = mergeLogicalMessage(curr, prev);
          toRemove.add(i);
          currRemoved = true;
          break; // current is dropped, no need to check other priors
        } else if (isCanonicalAssistantDuplicate(prev, curr)) {
          result[prevIdx] = mergeLogicalMessage(curr, prev);
          toRemove.add(i);
          currRemoved = true;
          break; // keep the earlier canonical assistant copy
        }
        // else: both non-canonical, or canonical non-assistant → keep both
      }
      if (!currRemoved) {
        prevIndices.push(i);
      }
    } else {
      hashMap.set(hash, [i]);
    }
  }

  if (toRemove.size === 0) return result;
  return result.filter((_, i) => !toRemove.has(i));
}

function pruneMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_AGENT) return messages;
  return messages.slice(messages.length - MAX_MESSAGES_PER_AGENT);
}

/**
 * Stable sort by timestamp ascending. Normalized timestamps are ISO strings,
 * so lexicographic comparison is correct. Messages with equal timestamps
 * preserve their original relative order (V8 Array.sort is stable).
 */
function sortMessagesByTimestamp(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 1) return messages;
  return [...messages].sort((a, b) => {
    const tsA = typeof a.timestamp === 'string' ? a.timestamp : (a.timestamp?.toISOString?.() ?? '');
    const tsB = typeof b.timestamp === 'string' ? b.timestamp : (b.timestamp?.toISOString?.() ?? '');
    if (tsA < tsB) return -1;
    if (tsA > tsB) return 1;
    return 0;
  });
}

// ============================================================================
// State helpers
// ============================================================================

/** Build a Collection from a normalized, ordered array of messages. */
function buildMessagesCollection(messages: AgentMessage[]): Collection<AgentMessage, 'id'> {
  return createCollection<AgentMessage, 'id'>('id', messages);
}

/** Normalize incoming session + convert its messages to a Collection. */
function toStoredSession(session: AgentSession): StoredAgentSession {
  const normalized = normalizeAgentSession(session);
  const deduped = pruneMessages(sortMessagesByTimestamp(deduplicateMessages(normalized.messages || [])));
  return { ...normalized, messages: buildMessagesCollection(deduped) };
}

function getSession(state: AgentSessionState, agentId: string): StoredAgentSession | undefined {
  return state.byAgentId[agentId];
}

function setSession(
  state: AgentSessionState,
  agentId: string,
  session: StoredAgentSession,
): AgentSessionState {
  return {
    ...state,
    byAgentId: { ...state.byAgentId, [agentId]: session },
  };
}

function updateSessionFields(
  state: AgentSessionState,
  agentId: string,
  partial: Partial<Omit<StoredAgentSession, 'messages'>>,
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

type SessionComparisonSnapshot = Pick<
  StoredAgentSession,
  | 'status'
  | 'name'
  | 'model'
  | 'isStreaming'
  | 'isProcessing'
  | 'isResponding'
  | 'digest'
  | 'backendSessionId'
  | 'acpSessionId'
  | 'createdAt'
  | 'updatedAt'
  | 'lastActivity'
  | 'hasUnread'
  | 'currentTurnNumber'
  | 'isBackground'
  | 'activationState'
> & {
  messageCount: number;
  lastMessageId: AgentMessage['id'] | undefined;
};

function toSessionComparisonSnapshot(session: StoredAgentSession): SessionComparisonSnapshot {
  const ids = session.messages.ids;
  return {
    status: session.status,
    name: session.name,
    model: session.model,
    isStreaming: session.isStreaming,
    isProcessing: session.isProcessing,
    isResponding: session.isResponding,
    digest: session.digest,
    backendSessionId: session.backendSessionId,
    acpSessionId: session.acpSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivity: session.lastActivity,
    hasUnread: session.hasUnread,
    currentTurnNumber: session.currentTurnNumber,
    isBackground: session.isBackground,
    activationState: session.activationState,
    messageCount: ids.length,
    lastMessageId: ids.length === 0 ? undefined : ids[ids.length - 1],
  };
}

/**
 * Shallow equivalence check for upsertSession no-op guard.
 * Compares key scalar fields and message count / last message ID
 * to avoid creating new state references when nothing changed.
 */
function isSessionEquivalent(a: StoredAgentSession, b: StoredAgentSession): boolean {
  return shallowEqual(toSessionComparisonSnapshot(a), toSessionComparisonSnapshot(b));
}

function removeFromWorkspaceIndex(state: AgentSessionState, agentId: string): AgentSessionState {
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
export const upsertSession = createAction<[session: AgentSession]>('agentSessions/upsertSession');

/** Remove a session by agentId (from byAgentId and agentIdsByWorkspace) */
export const removeSession = createAction<[agentId: string]>('agentSessions/removeSession');

/**
 * Set streaming flag for an agent.
 * @deprecated Use `setAgentStreaming` from `workspace-agents-slice` instead.
 * The cross-slice handler automatically updates agent-session state when
 * `setAgentStreaming` is dispatched. This action is kept for edge cases only.
 */
export const setSessionStreaming = createAction<[agentId: string, isStreaming: boolean]>(
  'agentSessions/setSessionStreaming',
);

/** Add a single message (dedup, prune) */
export const addMessage = createAction<[agentId: string, message: AgentMessage]>(
  'agentSessions/addMessage',
);

/** Update a single message by messageId */
export const updateMessage = createAction<
  [agentId: string, messageId: string, updates: Partial<AgentMessage>]
>('agentSessions/updateMessage');

/** Full replacement of messages (with dedup/prune) */
export const replaceMessages = createAction<[agentId: string, messages: AgentMessage[]]>(
  'agentSessions/replaceMessages',
);

/** Atomically remove a single message by ID */
export const removeMessage = createAction<[agentId: string, messageId: string]>(
  'agentSessions/removeMessage',
);

/**
 * Swaps the message at the matched index in place. Does not re-sort — the
 * caller must ensure the new message is semantically close enough to the old
 * one (same logical turn). Used by the saga's content-match dedup to preserve
 * canonical-ID without reordering.
 *
 * If a duplicate message already exists (same ID, or equivalent canonical
 * assistant content from the same turn), that stale entry is dropped so the
 * list never contains duplicate logical messages.
 */
export const replaceMessageById = createAction<[agentId: string, oldId: string, newMessage: AgentMessage]>(
  'agentSessions/replaceMessageById',
);

/** Non-message field updates */
export const updateSession = createAction<[agentId: string, updates: Partial<AgentSession>]>(
  'agentSessions/updateSession',
);

/** Set queued messages for an agent */
export const setQueuedMessages = createAction<[agentId: string, messages: QueuedMessage[]]>(
  'agentSessions/setQueuedMessages',
);

/** Update agent digest */
export const updateDigest = createAction<[agentId: string, digest: string | null]>(
  'agentSessions/updateDigest',
);

/** Rename agent session */
export const renameSession = createAction<[agentId: string, name: string]>(
  'agentSessions/renameSession',
);

/** Bulk upsert sessions (initial load / snapshot reconciliation) */
export const bulkUpsertSessions = createAction<[sessions: AgentSession[]]>(
  'agentSessions/bulkUpsertSessions',
);

/** Remove all sessions for a workspace */
export const removeWorkspaceSessions = createAction<[wsId: string]>(
  'agentSessions/removeWorkspaceSessions',
);

/** Clear all sessions */
export const clearAllSessions = createAction('agentSessions/clearAllSessions');

// ============================================================================
// Reducer
// ============================================================================

export const agentSessionReducer = createReducer<AgentSessionState>(initialState)
  .with(upsertSession, (state, { payload: [session] }) => {
    const finalSession = toStoredSession(session);
    const agentId = String(finalSession.id);
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
    const currentList = getItems(session.messages);
    const appMessageId = getAppMessageId(normalizedMsg);
    if (appMessageId) {
      const appMatchIdx = currentList.findIndex((m) => getAppMessageId(m) === appMessageId);
      if (appMatchIdx !== -1) {
        const newList = currentList.slice();
        newList[appMatchIdx] = mergeLogicalMessage(newList[appMatchIdx], normalizedMsg);
        return setSession(state, agentId, {
          ...session,
          messages: buildMessagesCollection(deduplicateMessages(newList)),
        });
      }
    }
    // Primary guard: exact ID match → skip (O(1) Collection lookup)
    if (getItem(session.messages, normalizedMsg.id)) return state;
    // Content-match guard: if the arriving message has a canonical `msg_*` ID,
    // replace a matching local copy or skip a matching canonical assistant copy.
    if (hasCanonicalId(normalizedMsg.id)) {
      const matchIdx = findContentMatch(
        currentList,
        normalizedMsg,
        (existing, incoming) =>
          !hasCanonicalId(existing.id) && !hasExplicitDifferentTurn(existing, incoming),
      );
      if (matchIdx !== -1 && !hasCanonicalId(currentList[matchIdx].id)) {
        const newList = currentList.slice();
        newList[matchIdx] = mergeLogicalMessage(currentList[matchIdx], normalizedMsg);
        return setSession(state, agentId, {
          ...session,
          messages: buildMessagesCollection(deduplicateMessages(newList)),
        });
      }
      const canonicalAssistantMatchIdx = findContentMatch(
        currentList,
        normalizedMsg,
        isCanonicalAssistantDuplicate,
      );
      if (canonicalAssistantMatchIdx !== -1) {
        return state;
      }
    }
    const appended = currentList.slice();
    appended.push(normalizedMsg);
    const pruned = pruneMessages(appended);
    return setSession(state, agentId, { ...session, messages: buildMessagesCollection(pruned) });
  })
  .with(updateMessage, (state, { payload: [agentId, messageId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    if (!getItem(session.messages, messageId)) return state;
    const nextMessages = updateItem(session.messages, { ...updates, id: messageId });
    if (nextMessages === session.messages) return state;
    return setSession(state, agentId, { ...session, messages: nextMessages });
  })
  .with(replaceMessages, (state, { payload: [agentId, messages] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const deduped = pruneMessages(sortMessagesByTimestamp(deduplicateMessages(messages.map(normalizeAgentMessage))));
    return setSession(state, agentId, { ...session, messages: buildMessagesCollection(deduped) });
  })
  .with(removeMessage, (state, { payload: [agentId, messageId] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const nextMessages = removeItem(session.messages, messageId);
    if (nextMessages === session.messages) return state;
    return setSession(state, agentId, { ...session, messages: nextMessages });
  })
  .with(replaceMessageById, (state, { payload: [agentId, oldId, newMessage] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    if (!getItem(session.messages, oldId)) return state;
    const normalized = normalizeAgentMessage(newMessage);
    const currentList = getItems(session.messages);
    const idx = currentList.findIndex((m) => m.id === oldId);
    if (idx === -1) return state;
    const swapped = currentList.map((m, i) => (i === idx ? normalized : m));
    const newList =
      normalized.id === oldId
        ? swapped
        : swapped.filter((m, i) => i === idx || m.id !== normalized.id);
    return setSession(state, agentId, { ...session, messages: buildMessagesCollection(deduplicateMessages(newList)) });
  })
  .with(updateSession, (state, { payload: [agentId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const { messages, ...otherUpdates } = updates;
    let merged: StoredAgentSession = { ...session, ...otherUpdates };
    if (messages && Array.isArray(messages)) {
      const deduped = pruneMessages(sortMessagesByTimestamp(deduplicateMessages(messages.map(normalizeAgentMessage))));
      merged = { ...merged, messages: buildMessagesCollection(deduped) };
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
      const finalSession = toStoredSession(session);
      const agentId = String(finalSession.id);
      const wsId = String(session.workspaceId);

      // Preserve in-flight isStreaming/isProcessing flags unconditionally.
      // bulkUpsertSessions is used for disk reconciliation; disk data is always
      // stale for ephemeral in-memory flags like streaming/processing state.
      // The factory or saga sets these flags before the bulk upsert runs, so
      // an incoming false from disk must never overwrite an active true.
      const existing = getSession(next, agentId);
      if (existing) {
        if (existing.isStreaming) {
          finalSession.isStreaming = true;
        }
        if (existing.isProcessing) {
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
     
    const { [wsId]: _, ...restWorkspaces } = state.agentIdsByWorkspace;
    return { byAgentId, agentIdsByWorkspace: restWorkspaces };
  })
  .with(clearAllSessions, () => initialState)
  // -----------------------------------------------------------------------
  // Cross-slice: handle workspace-agents actions directly (replaces bridge saga)
  // -----------------------------------------------------------------------
  .with(upsertAgentSession, (state, { payload: [, session] }) => {
    const finalSession = toStoredSession(session);
    const agentId = String(finalSession.id);
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
    const currentList = getItems(session.messages);
    const appMessageId = getAppMessageId(normalizedMsg);
    if (appMessageId) {
      const appMatchIdx = currentList.findIndex((m) => getAppMessageId(m) === appMessageId);
      if (appMatchIdx !== -1) {
        const newList = currentList.slice();
        newList[appMatchIdx] = mergeLogicalMessage(newList[appMatchIdx], normalizedMsg);
        return setSession(state, agentId, {
          ...session,
          messages: buildMessagesCollection(deduplicateMessages(newList)),
        });
      }
    }
    // Primary guard: exact ID match → skip (O(1) Collection lookup)
    if (getItem(session.messages, normalizedMsg.id)) return state;
    // Content-match guard: if the arriving message has a canonical `msg_*` ID,
    // replace a matching local copy or skip a matching canonical assistant copy.
    if (hasCanonicalId(normalizedMsg.id)) {
      const matchIdx = findContentMatch(
        currentList,
        normalizedMsg,
        (existing, incoming) =>
          !hasCanonicalId(existing.id) && !hasExplicitDifferentTurn(existing, incoming),
      );
      if (matchIdx !== -1 && !hasCanonicalId(currentList[matchIdx].id)) {
        const newList = currentList.slice();
        newList[matchIdx] = mergeLogicalMessage(currentList[matchIdx], normalizedMsg);
        return setSession(state, agentId, {
          ...session,
          messages: buildMessagesCollection(deduplicateMessages(newList)),
        });
      }
      const canonicalAssistantMatchIdx = findContentMatch(
        currentList,
        normalizedMsg,
        isCanonicalAssistantDuplicate,
      );
      if (canonicalAssistantMatchIdx !== -1) {
        return state;
      }
    }
    const appended = currentList.slice();
    appended.push(normalizedMsg);
    const pruned = pruneMessages(appended);
    return setSession(state, agentId, { ...session, messages: buildMessagesCollection(pruned) });
  })
  .with(replaceAgentMessages, (state, { payload: [, agentId, messages] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const deduped = pruneMessages(sortMessagesByTimestamp(deduplicateMessages(messages.map(normalizeAgentMessage))));
    return setSession(state, agentId, { ...session, messages: buildMessagesCollection(deduped) });
  })
  .with(removeAgentMessage, (state, { payload: [, agentId, messageId] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const nextMessages = removeItem(session.messages, messageId);
    if (nextMessages === session.messages) return state;
    return setSession(state, agentId, { ...session, messages: nextMessages });
  })
  .with(replaceAgentMessageById, (state, { payload: [, agentId, oldId, newMessage] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    if (!getItem(session.messages, oldId)) return state;
    const normalized = normalizeAgentMessage(newMessage);
    const currentList = getItems(session.messages);
    const idx = currentList.findIndex((m) => m.id === oldId);
    if (idx === -1) return state;
    const swapped = currentList.map((m, i) => (i === idx ? normalized : m));
    const newList =
      normalized.id === oldId
        ? swapped
        : swapped.filter((m, i) => i === idx || m.id !== normalized.id);
    return setSession(state, agentId, { ...session, messages: buildMessagesCollection(deduplicateMessages(newList)) });
  })
  .with(updateAgentMessage, (state, { payload: [, agentId, messageId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    if (!getItem(session.messages, messageId)) return state;
    const nextMessages = updateItem(session.messages, { ...updates, id: messageId });
    if (nextMessages === session.messages) return state;
    return setSession(state, agentId, { ...session, messages: nextMessages });
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
    const placeholder: StoredAgentSession = {
      id: agentId as AgentSession['id'],
      backendSessionId: null,
      workspaceId: wsId as AgentSession['workspaceId'],
      name: '',
      status: 'active' as any,
      messages: buildMessagesCollection([]),
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
