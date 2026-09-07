import type { AgentMessage } from '$shared/types';

export interface ChatTranscriptStructure {
  latestAuggieSessionId?: string;
  userTurnCount: number;
  hasUserMessage: boolean;
  assistantMessageIds: readonly string[];
  lastAssistantMessageIndex: number;
  messageIndexById: ReadonlyMap<string, number>;
  assistantTurnNumberById: ReadonlyMap<string, number>;
  hasUniqueMessageIds: boolean;
  recomputeCount: number;
}

export interface ChatTranscriptStructureInput {
  messages: readonly AgentMessage[];
  isStreaming: boolean;
  isActive: boolean;
  snapshotSequence?: number;
}

const EMPTY_STRUCTURE: ChatTranscriptStructure = {
  userTurnCount: 0,
  hasUserMessage: false,
  assistantMessageIds: [],
  lastAssistantMessageIndex: -1,
  messageIndexById: new Map(),
  assistantTurnNumberById: new Map(),
  hasUniqueMessageIds: true,
  recomputeCount: 0,
};

function sameTailStructure(previous: AgentMessage, current: AgentMessage): boolean {
  return (
    previous.id === current.id &&
    previous.role === current.role &&
    previous.metadata?.auggieSessionId === current.metadata?.auggieSessionId
  );
}

function isTailContentOnlyUpdate(
  previous: readonly AgentMessage[],
  current: readonly AgentMessage[],
  isStreaming: boolean,
): boolean {
  if (!isStreaming || previous.length === 0 || previous.length !== current.length) return false;
  const lastIndex = current.length - 1;
  if (previous[lastIndex] === current[lastIndex]) return false;
  if (!sameTailStructure(previous[lastIndex], current[lastIndex])) return false;
  for (let index = 0; index < lastIndex; index++) {
    if (previous[index] !== current[index]) return false;
  }
  return true;
}

function rebuildStructure(
  messages: readonly AgentMessage[],
  recomputeCount: number,
): ChatTranscriptStructure {
  const messageIndexById = new Map<string, number>();
  const assistantTurnNumberById = new Map<string, number>();
  const assistantMessageIds: string[] = [];
  let latestAuggieSessionId: string | undefined;
  let userTurnCount = 0;
  let lastAssistantMessageIndex = -1;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    messageIndexById.set(message.id, index);
    if (message.role === 'user') userTurnCount++;
    if (message.role !== 'assistant') continue;
    assistantMessageIds.push(message.id);
    lastAssistantMessageIndex = index;
    assistantTurnNumberById.set(message.id, assistantMessageIds.length);
    if (message.metadata?.auggieSessionId) {
      latestAuggieSessionId = message.metadata.auggieSessionId;
    }
  }

  return {
    latestAuggieSessionId,
    userTurnCount,
    hasUserMessage: userTurnCount > 0,
    assistantMessageIds,
    lastAssistantMessageIndex,
    messageIndexById,
    assistantTurnNumberById,
    hasUniqueMessageIds: messageIndexById.size === messages.length,
    recomputeCount,
  };
}

export function createChatTranscriptStructureProjector() {
  let previousMessages: readonly AgentMessage[] | null = null;
  let previousSnapshotSequence: number | undefined;
  let structure = EMPTY_STRUCTURE;
  let inactiveUpdatePending = false;

  return (input: ChatTranscriptStructureInput): ChatTranscriptStructure => {
    const { messages, isStreaming, isActive, snapshotSequence } = input;
    const snapshotReplaced = snapshotSequence !== previousSnapshotSequence;
    if (!isActive) {
      inactiveUpdatePending ||= messages !== previousMessages || snapshotReplaced;
      previousMessages = messages;
      previousSnapshotSequence = snapshotSequence;
      return structure;
    }
    if (messages === previousMessages && !inactiveUpdatePending && !snapshotReplaced)
      return structure;
    if (
      !inactiveUpdatePending &&
      !snapshotReplaced &&
      previousMessages &&
      isTailContentOnlyUpdate(previousMessages, messages, isStreaming)
    ) {
      previousMessages = messages;
      return structure;
    }
    structure = rebuildStructure(messages, structure.recomputeCount + 1);
    previousMessages = messages;
    previousSnapshotSequence = snapshotSequence;
    inactiveUpdatePending = false;
    return structure;
  };
}

export function getLiveStreamingAssistantMessage(
  messages: readonly AgentMessage[],
  structure: ChatTranscriptStructure,
  isStreaming: boolean,
): AgentMessage | undefined {
  if (!isStreaming || structure.lastAssistantMessageIndex < 0) return undefined;
  const message = messages[structure.lastAssistantMessageIndex];
  return message?.role === 'assistant' ? message : undefined;
}
