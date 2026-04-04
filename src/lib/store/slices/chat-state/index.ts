// Chat State slice — flat, agent-keyed chat state
export { chatStateReducer, emptyChatAgentState, initialState } from './chat-state-slice';
export {
  // Initialization
  chatInitialized,
  chatInitFailed,
  // Send
  chatSendStarted,
  chatSendFailed,
  chatInterrupted,
  // Retry
  chatRetryCleared,
  chatModelRetryCleared,
  chatSmartRetryPrepared,
  chatModelUnavailableSet,
  chatModelUnavailableCleared,
  chatErrorCleared,
  // Stop
  chatStopInitiated,
  chatStopCompleted,
  // Reset
  chatReset,
  chatStreamingReconciled,
  // Streaming events
  streamStarted,
  streamChunkFlushed,
  streamChunkReceived,
  streamCompleted,
  streamErrored,
  streamStatusReceived,
  streamTimedOut,
  // Detection
  chatStallDetected,
  chatStuckStateCleared,
  // Cleanup
  chatAgentRemoved,
  // Rebind tracking
  chatRebindStarted,
  chatRebindEnded,
  chatTrackedWorkspaceSet,
  // Saga triggers
  initializeChatRequested,
  sendMessage,
  // Stream lifecycle saga triggers
  cleanupStreamRequested,
} from './chat-state-slice';

export {
  selectChatAgentState,
  selectChatIsStreaming,
  selectChatIsProcessing,
  selectChatIsInterrupting,
  selectChatStreamingContent,
  selectChatError,
  selectChatIsStalled,
  selectChatStreamingStartTime,
  selectChatLastChunkTime,
  selectChatLastAttemptedMessage,
  selectChatModelUnavailable,
  selectChatStatusEvents,
  selectChatReceivedFirstChunk,
  selectChatStateOrDefault,
  selectChatIsRebinding,
  selectChatTrackedWorkspaceId,
} from './chat-state-selectors';

export type {
  ChatAgentState,
  ChatStateSlice,
  StatusEvent,
  LastAttemptedMessage,
  ModelUnavailableInfo,
  SendMessageOptions,
  SerializableContextItem,
  SendMessagePayload,
  InitializeChatOptions,
} from './chat-state-types';

export { chatStateSaga } from './sagas/chat-state-saga';
export { chatStreamSaga } from './sagas/chat-stream-saga';

