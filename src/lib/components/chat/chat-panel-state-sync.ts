import type { ChatState } from '$lib/store/slices/chat-state/chat-state-types';

interface ChatStateSyncOptions {
  isStreaming?: boolean;
  isProcessing?: boolean;
  preserveTransientState?: boolean;
}

function preserveNullableField<T>(
  currentValue: T | null,
  incomingValue: T | null,
  preserveTransientState: boolean,
): T | null {
  if (preserveTransientState && incomingValue === null) {
    return currentValue;
  }

  return incomingValue;
}

export function hasChatServiceStateChanged(
  currentState: ChatState,
  incomingState: ChatState,
): boolean {
  const currentMessages = currentState.messages;
  const incomingMessages = incomingState.messages;

  const messagesChanged =
    incomingMessages.length !== currentMessages.length ||
    incomingMessages[incomingMessages.length - 1]?.id !==
      currentMessages[currentMessages.length - 1]?.id ||
    incomingMessages[incomingMessages.length - 1]?.contentBlocks?.length !==
      currentMessages[currentMessages.length - 1]?.contentBlocks?.length;

  const streamingChanged =
    incomingState.isStreaming !== currentState.isStreaming ||
    incomingState.isProcessing !== currentState.isProcessing ||
    incomingState.isInterrupting !== currentState.isInterrupting ||
    incomingState.streamingStartTime !== currentState.streamingStartTime ||
    incomingState.lastChunkTime !== currentState.lastChunkTime ||
    incomingState.isStalled !== currentState.isStalled;

  const sessionChanged = incomingState.session?.id !== currentState.session?.id;
  const errorChanged = incomingState.error !== currentState.error;
  const retryChanged = incomingState.lastAttemptedMessage !== currentState.lastAttemptedMessage;
  const modelUnavailableChanged = incomingState.modelUnavailable !== currentState.modelUnavailable;
  const statusEventsChanged = incomingState.statusEvents !== currentState.statusEvents;

  return (
    messagesChanged ||
    streamingChanged ||
    sessionChanged ||
    errorChanged ||
    retryChanged ||
    modelUnavailableChanged ||
    statusEventsChanged
  );
}

export function syncChatStateFromService(
  currentState: ChatState,
  incomingState: ChatState,
  {
    isStreaming,
    isProcessing,
    preserveTransientState = false,
  }: ChatStateSyncOptions = {},
): ChatState {
  return {
    ...currentState,
    ...incomingState,
    isStreaming: isStreaming ?? incomingState.isStreaming,
    isProcessing: isProcessing ?? incomingState.isProcessing,
    streamingStartTime:
      preserveTransientState && incomingState.streamingStartTime === null
        ? currentState.streamingStartTime
        : incomingState.streamingStartTime,
    lastChunkTime:
      preserveTransientState && incomingState.lastChunkTime === null
        ? currentState.lastChunkTime
        : incomingState.lastChunkTime,
    isStalled:
      preserveTransientState && incomingState.lastChunkTime === null
        ? currentState.isStalled
        : incomingState.isStalled,
    lastAttemptedMessage: preserveNullableField(
      currentState.lastAttemptedMessage,
      incomingState.lastAttemptedMessage,
      preserveTransientState,
    ),
    modelUnavailable: preserveNullableField(
      currentState.modelUnavailable,
      incomingState.modelUnavailable,
      preserveTransientState,
    ),
  };
}