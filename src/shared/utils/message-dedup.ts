import type { AgentMessage } from '$shared/types';
import {
  getContentBlockFingerprint,
  getContentBlocksRichness,
} from './content-block-helpers';

const DEFAULT_TIMESTAMP_TOLERANCE_MS = 30_000;
const NEAR_DUPLICATE_MIN_CONTENT_LENGTH = 200;
const NEAR_DUPLICATE_MIN_PREFIX_LENGTH = 120;
const NEAR_DUPLICATE_MIN_PREFIX_RATIO = 0.9;

export type AgentSessionMessageMergeReason =
  | 'accepted'
  | 'stale-would-drop-user-message'
  | 'stale-fewer-messages'
  | 'stale-less-content'
  | 'streaming-fewer-messages'
  | 'streaming-fewer-content-blocks'
  | 'streaming-less-content'
  | 'streaming-message-count-regression'
  | 'streaming-content-block-regression';

export type AgentSessionMessageMergeResult = {
  accepted: boolean;
  messages: AgentMessage[];
  reason: AgentSessionMessageMergeReason;
};

export function normalizeDateValue(value: Date | string | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

export function normalizeAgentMessage(message: AgentMessage): AgentMessage {
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

export function hasCanonicalId(id: string): boolean {
  return id.startsWith('msg_');
}

export function computeMessageContentHash(message: AgentMessage): string | null {
  const blocks = message.contentBlocks;
  if (!blocks || blocks.length === 0) return null;

  const role = message.role ?? '';
  const parts: string[] = [];
  for (const block of blocks) {
    const fingerprint = getContentBlockFingerprint(block);
    if (fingerprint !== null) parts.push(fingerprint);
  }
  const contentStr = parts.join('\n');
  if (!contentStr) return null;
  return `${role}::${contentStr}`;
}

export function isTimestampClose(
  a: string | Date | undefined,
  b: string | Date | undefined,
  toleranceMs: number = DEFAULT_TIMESTAMP_TOLERANCE_MS,
): boolean {
  if (!a || !b) return false;
  const ta = typeof a === 'string' ? new Date(a).getTime() : a.getTime();
  const tb = typeof b === 'string' ? new Date(b).getTime() : b.getTime();
  if (isNaN(ta) || isNaN(tb)) return false;
  return Math.abs(ta - tb) <= toleranceMs;
}

function hasExplicitDifferentTurn(a: AgentMessage, b: AgentMessage): boolean {
  return a.turnNumber !== undefined && b.turnNumber !== undefined && a.turnNumber !== b.turnNumber;
}

function hasExplicitSameTurn(a: AgentMessage, b: AgentMessage): boolean {
  return a.turnNumber !== undefined && b.turnNumber !== undefined && a.turnNumber === b.turnNumber;
}

function getAppMessageId(message: AgentMessage): string | undefined {
  return typeof message.appMessageId === 'string' && message.appMessageId.length > 0
    ? message.appMessageId
    : undefined;
}

function hasSameAppMessageId(a: AgentMessage, b: AgentMessage): boolean {
  const aAppMessageId = getAppMessageId(a);
  return aAppMessageId !== undefined && aAppMessageId === getAppMessageId(b);
}

/**
 * Content-hash matching is a FALLBACK for pairs where id-based matching is
 * impossible: at least one side lacks an `appMessageId` (echo-less paths like
 * `agent.forceMessage`, or rows from older daemons that do not echo
 * `userAppMessageId` — PROTOCOL §5.5). When BOTH sides carry an appMessageId,
 * the id comparison is authoritative: equal ids merge via the appMessageId
 * paths, and differing ids are distinct logical messages even with identical
 * content, so content fallback must never collapse them.
 */
function canUseLegacyContentFallback(a: AgentMessage, b: AgentMessage): boolean {
  return getAppMessageId(a) === undefined || getAppMessageId(b) === undefined;
}

function isStreamingFinalizationDuplicate(a: AgentMessage, b: AgentMessage): boolean {
  if (hasExplicitDifferentTurn(a, b)) return false;
  if (a.role !== 'assistant' || b.role !== 'assistant') return false;
  return (
    (a.isStreaming === true && b.isStreaming !== true) ||
    (b.isStreaming === true && a.isStreaming !== true)
  );
}

function isAssistantContentDuplicate(a: AgentMessage, b: AgentMessage): boolean {
  if (hasExplicitDifferentTurn(a, b)) return false;
  if (a.role !== 'assistant' || b.role !== 'assistant') return false;
  if (isStreamingFinalizationDuplicate(a, b)) return true;
  return hasSameAppMessageId(a, b) || hasExplicitSameTurn(a, b);
}

function isAssistantFinalizationIdentityMismatch(a: AgentMessage, b: AgentMessage): boolean {
  if (hasExplicitDifferentTurn(a, b)) return false;
  if (a.role !== 'assistant' || b.role !== 'assistant') return false;
  return (
    isStreamingFinalizationDuplicate(a, b) ||
    hasExplicitSameTurn(a, b)
  );
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export function hasNearDuplicateAssistantContent(a: AgentMessage, b: AgentMessage): boolean {
  if (!isAssistantFinalizationIdentityMismatch(a, b)) return false;
  if (!isTimestampClose(a.timestamp, b.timestamp)) return false;
  const aContent = computeMessageContentHash(a)?.trim();
  const bContent = computeMessageContentHash(b)?.trim();
  if (!aContent || !bContent || aContent === bContent) return false;

  const shorterLength = Math.min(aContent.length, bContent.length);
  const longerLength = Math.max(aContent.length, bContent.length);
  if (shorterLength < NEAR_DUPLICATE_MIN_CONTENT_LENGTH) return false;

  const prefixLength = commonPrefixLength(aContent, bContent);
  return (
    prefixLength >= NEAR_DUPLICATE_MIN_PREFIX_LENGTH &&
    prefixLength / shorterLength >= NEAR_DUPLICATE_MIN_PREFIX_RATIO &&
    prefixLength / longerLength >= NEAR_DUPLICATE_MIN_PREFIX_RATIO
  );
}

function getMessageContentRichness(message: AgentMessage | undefined): number {
  return getContentBlocksRichness(message?.contentBlocks ?? []);
}

function deduplicateAgentMessagesById(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  const deduplicated: AgentMessage[] = [];
  let changed = false;
  for (const message of messages) {
    if (seen.has(message.id)) {
      changed = true;
      continue;
    }
    seen.add(message.id);
    deduplicated.push(message);
  }
  return changed ? deduplicated : messages;
}

function rejectSessionMessageMerge(
  messages: AgentMessage[],
  reason: AgentSessionMessageMergeReason,
): AgentSessionMessageMergeResult {
  return { accepted: false, messages, reason };
}

function acceptSessionMessageMerge(
  messages: AgentMessage[],
  reason: AgentSessionMessageMergeReason = 'accepted',
): AgentSessionMessageMergeResult {
  return { accepted: true, messages, reason };
}

export function mergeAgentSessionMessagesWithPolicy({
  currentMessages,
  incomingMessages,
  currentIsStreaming,
  nextIsStreaming,
}: {
  currentMessages: AgentMessage[];
  incomingMessages: AgentMessage[];
  currentIsStreaming: boolean;
  nextIsStreaming: boolean;
}): AgentSessionMessageMergeResult {
  if (currentIsStreaming && currentMessages.length > 0) {
    const lastCurrent = currentMessages[currentMessages.length - 1];
    const lastIncoming = incomingMessages[incomingMessages.length - 1];
    const wouldDropLastUserMessage =
      incomingMessages.length < currentMessages.length ||
      (incomingMessages.length === currentMessages.length && lastIncoming?.id !== lastCurrent?.id);
    if (lastCurrent?.role === 'user' && wouldDropLastUserMessage) {
      return rejectSessionMessageMerge(currentMessages, 'stale-would-drop-user-message');
    }
  }

  if (!currentIsStreaming && currentMessages.length > 0) {
    if (incomingMessages.length < currentMessages.length) {
      return rejectSessionMessageMerge(currentMessages, 'stale-fewer-messages');
    }
    if (incomingMessages.length === currentMessages.length) {
      const lastCurrent = currentMessages[currentMessages.length - 1];
      const lastIncoming = incomingMessages[incomingMessages.length - 1];
      if (
        lastCurrent?.id === lastIncoming?.id &&
        getMessageContentRichness(lastIncoming) < getMessageContentRichness(lastCurrent)
      ) {
        return rejectSessionMessageMerge(currentMessages, 'stale-less-content');
      }
    }
  }

  if (currentIsStreaming && nextIsStreaming && currentMessages.length > 0) {
    if (incomingMessages.length < currentMessages.length) {
      return rejectSessionMessageMerge(currentMessages, 'streaming-fewer-messages');
    }
    if (incomingMessages.length === currentMessages.length) {
      const lastCurrent = currentMessages[currentMessages.length - 1];
      const lastIncoming = incomingMessages[incomingMessages.length - 1];
      if (lastCurrent?.id === lastIncoming?.id) {
        const currentBlockCount = lastCurrent?.contentBlocks?.length ?? 0;
        const incomingBlockCount = lastIncoming?.contentBlocks?.length ?? 0;
        if (incomingBlockCount < currentBlockCount && currentBlockCount > 0) {
          return rejectSessionMessageMerge(currentMessages, 'streaming-fewer-content-blocks');
        }
        if (
          incomingBlockCount === currentBlockCount &&
          currentBlockCount > 0 &&
          getMessageContentRichness(lastIncoming) < getMessageContentRichness(lastCurrent)
        ) {
          return rejectSessionMessageMerge(currentMessages, 'streaming-less-content');
        }
      }
    }
  }

  let merged = deduplicateAgentMessagesById(incomingMessages);

  if (currentIsStreaming && nextIsStreaming) {
    if (merged.length < currentMessages.length) {
      return acceptSessionMessageMerge(currentMessages, 'streaming-message-count-regression');
    }
    if (merged.length > 0 && currentMessages.length > 0) {
      const lastCurrent = currentMessages[currentMessages.length - 1];
      const lastNext = merged[merged.length - 1];
      const currentBlockCount = lastCurrent?.contentBlocks?.length ?? 0;
      const nextBlockCount = lastNext?.contentBlocks?.length ?? 0;
      if (lastCurrent?.id === lastNext?.id && nextBlockCount < currentBlockCount && currentBlockCount > 0) {
        merged = [...merged.slice(0, -1), { ...lastNext, contentBlocks: lastCurrent.contentBlocks }];
        return acceptSessionMessageMerge(merged, 'streaming-content-block-regression');
      }
    }
  }

  return acceptSessionMessageMerge(merged);
}

function getPreferredIdentityMessage(existing: AgentMessage, incoming: AgentMessage): AgentMessage {
  // Canonical daemon identity wins: an echoed/persisted `msg_` row replaces
  // the optimistic message it merges with. `mergeLogicalMessage` preserves the
  // appMessageId from either side, so preferring the canonical id never drops
  // the logical id.
  if (hasCanonicalId(existing.id) && !hasCanonicalId(incoming.id)) return existing;
  if (hasCanonicalId(incoming.id) && !hasCanonicalId(existing.id)) return incoming;
  const existingAppMessageId = getAppMessageId(existing);
  const incomingAppMessageId = getAppMessageId(incoming);
  if (existingAppMessageId && !incomingAppMessageId) return existing;
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

function mergeStreamingFinalizationDuplicate(
  existing: AgentMessage,
  incoming: AgentMessage,
): AgentMessage {
  const finalizedMessage = existing.isStreaming === true ? incoming : existing;
  const streamingMessage = finalizedMessage === existing ? incoming : existing;
  return {
    ...streamingMessage,
    ...finalizedMessage,
    id: finalizedMessage.id,
    appMessageId: getAppMessageId(finalizedMessage) ?? getAppMessageId(streamingMessage),
    isStreaming: false,
    metadata:
      existing.metadata || incoming.metadata
        ? { ...streamingMessage.metadata, ...finalizedMessage.metadata }
        : undefined,
  };
}

function shouldPreferExistingCanonicalAssistantDuplicate(
  existing: AgentMessage,
  incoming: AgentMessage,
): boolean {
  return (
    hasExplicitSameTurn(existing, incoming) &&
    canUseLegacyContentFallback(existing, incoming) &&
    existing.role === 'assistant' &&
    incoming.role === 'assistant' &&
    hasCanonicalId(existing.id) &&
    hasCanonicalId(incoming.id)
  );
}

function mergeAssistantContentDuplicate(
  existing: AgentMessage,
  incoming: AgentMessage,
): AgentMessage {
  if (isStreamingFinalizationDuplicate(existing, incoming)) {
    return mergeStreamingFinalizationDuplicate(existing, incoming);
  }
  if (shouldPreferExistingCanonicalAssistantDuplicate(existing, incoming)) {
    return mergeLogicalMessage(incoming, existing);
  }
  return mergeLogicalMessage(existing, incoming);
}

function isCanonicalAssistantDuplicate(a: AgentMessage, b: AgentMessage): boolean {
  if (hasExplicitDifferentTurn(a, b)) return false;
  if (!hasExplicitSameTurn(a, b)) return false;
  if (!canUseLegacyContentFallback(a, b)) return false;
  return (
    a.role === 'assistant' && b.role === 'assistant' && hasCanonicalId(a.id) && hasCanonicalId(b.id)
  );
}

function findContentMatch(
  messages: AgentMessage[],
  incoming: AgentMessage,
  shouldMatch: (existing: AgentMessage, incoming: AgentMessage) => boolean = () => true,
): number {
  const incomingHash = computeMessageContentHash(incoming);
  if (incomingHash === null) return -1;
  for (let i = 0; i < messages.length; i++) {
    const existing = messages[i];
    if (existing.id === incoming.id) continue;
    if (existing.role !== incoming.role) continue;
    if (!canUseLegacyContentFallback(existing, incoming)) continue;
    if (computeMessageContentHash(existing) !== incomingHash) continue;
    if (!isTimestampClose(existing.timestamp, incoming.timestamp)) continue;
    if (!shouldMatch(existing, incoming)) continue;
    return i;
  }
  return -1;
}

function isAssistantSafeFinalizationDuplicate(
  existing: AgentMessage,
  incoming: AgentMessage,
): boolean {
  if (hasExplicitDifferentTurn(existing, incoming)) return false;
  if (existing.role !== 'assistant' || incoming.role !== 'assistant') return false;
  const existingHash = computeMessageContentHash(existing);
  const incomingHash = computeMessageContentHash(incoming);
  if (existingHash === null || incomingHash === null) return false;
  if (existingHash === incomingHash) {
    return (
      isAssistantContentDuplicate(existing, incoming) ||
      isAssistantFinalizationIdentityMismatch(existing, incoming)
    );
  }
  return hasNearDuplicateAssistantContent(existing, incoming);
}

function findAssistantContentDuplicateMatch(
  messages: AgentMessage[],
  incoming: AgentMessage,
): number {
  for (let i = 0; i < messages.length; i++) {
    const existing = messages[i];
    if (existing.id === incoming.id) continue;
    if (!isAssistantSafeFinalizationDuplicate(existing, incoming)) continue;
    if (!isTimestampClose(existing.timestamp, incoming.timestamp)) continue;
    return i;
  }
  return -1;
}

function mergeDuplicateAtIndices(
  result: AgentMessage[],
  toRemove: Set<number>,
  prevIdx: number,
  currIdx: number,
): boolean {
  const prev = result[prevIdx];
  const curr = result[currIdx];
  const merged = mergeAssistantContentDuplicate(prev, curr);
  if (merged.id === curr.id) {
    result[currIdx] = merged;
    toRemove.add(prevIdx);
    return false;
  }
  result[prevIdx] = merged;
  toRemove.add(currIdx);
  return true;
}

export function deduplicateAgentMessages(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  const appMessageIdToIndex = new Map<string, number>();
  const result: AgentMessage[] = [];

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

  const hashMap = new Map<string, number[]>();
  const toRemove = new Set<number>();
  for (let i = 0; i < result.length; i++) {
    const hash = computeMessageContentHash(result[i]);
    if (hash === null) continue;
    const prevIndices = hashMap.get(hash);
    if (prevIndices !== undefined) {
      const curr = result[i];
      const currCanonical = hasCanonicalId(curr.id);
      let currRemoved = false;
      for (const prevIdx of prevIndices) {
        if (toRemove.has(prevIdx)) continue;
        const prev = result[prevIdx];
        if (!isTimestampClose(prev.timestamp, curr.timestamp)) continue;
        if (hasExplicitDifferentTurn(prev, curr)) continue;
        if (
          isAssistantContentDuplicate(prev, curr) ||
          isAssistantFinalizationIdentityMismatch(prev, curr)
        ) {
          currRemoved = mergeDuplicateAtIndices(result, toRemove, prevIdx, i);
          if (currRemoved) break;
          continue;
        }
        if (!canUseLegacyContentFallback(prev, curr)) continue;
        const prevCanonical = hasCanonicalId(prev.id);
        if (currCanonical && !prevCanonical) {
          result[i] = mergeLogicalMessage(prev, curr);
          toRemove.add(prevIdx);
        } else if (prevCanonical && !currCanonical) {
          result[prevIdx] = mergeLogicalMessage(curr, prev);
          toRemove.add(i);
          currRemoved = true;
          break;
        } else if (isCanonicalAssistantDuplicate(prev, curr)) {
          result[prevIdx] = mergeLogicalMessage(curr, prev);
          toRemove.add(i);
          currRemoved = true;
          break;
        }
      }
      if (!currRemoved) {
        prevIndices.push(i);
      }
    } else {
      hashMap.set(hash, [i]);
    }
  }

  for (let i = 0; i < result.length; i++) {
    if (toRemove.has(i)) continue;
    for (let prevIdx = 0; prevIdx < i; prevIdx++) {
      if (toRemove.has(prevIdx)) continue;
      if (!hasNearDuplicateAssistantContent(result[prevIdx], result[i])) continue;
      const currRemoved = mergeDuplicateAtIndices(result, toRemove, prevIdx, i);
      if (currRemoved) break;
    }
  }

  if (toRemove.size === 0) return result;
  return result.filter((_, i) => !toRemove.has(i));
}

export function insertAgentMessageWithDedup(
  currentList: AgentMessage[],
  incomingMessage: AgentMessage,
): AgentMessage[] {
  const normalizedMsg = normalizeAgentMessage(incomingMessage);
  const appMessageId = getAppMessageId(normalizedMsg);
  if (appMessageId) {
    const appMatchIdx = currentList.findIndex((m) => getAppMessageId(m) === appMessageId);
    if (appMatchIdx !== -1) {
      const newList = currentList.slice();
      newList[appMatchIdx] = mergeLogicalMessage(newList[appMatchIdx], normalizedMsg);
      return deduplicateAgentMessages(newList);
    }
  }

  if (currentList.some((m) => m.id === normalizedMsg.id)) return currentList;

  const assistantDuplicateMatchIdx = findAssistantContentDuplicateMatch(currentList, normalizedMsg);
  if (assistantDuplicateMatchIdx !== -1) {
    const newList = currentList.slice();
    newList[assistantDuplicateMatchIdx] = mergeAssistantContentDuplicate(
      currentList[assistantDuplicateMatchIdx],
      normalizedMsg,
    );
    return deduplicateAgentMessages(newList);
  }

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
      return deduplicateAgentMessages(newList);
    }
    const canonicalAssistantMatchIdx = findContentMatch(
      currentList,
      normalizedMsg,
      isCanonicalAssistantDuplicate,
    );
    if (canonicalAssistantMatchIdx !== -1) return currentList;
  }

  return [...currentList, normalizedMsg];
}

export function replaceAgentMessageByIdWithDedup(
  currentList: AgentMessage[],
  oldId: string,
  newMessage: AgentMessage,
): AgentMessage[] {
  const idx = currentList.findIndex((m) => m.id === oldId);
  if (idx === -1) return currentList;
  const normalized = normalizeAgentMessage(newMessage);
  const swapped = currentList.map((m, i) => (i === idx ? normalized : m));
  const newList =
    normalized.id === oldId
      ? swapped
      : swapped.filter((m, i) => i === idx || m.id !== normalized.id);
  return deduplicateAgentMessages(newList);
}
