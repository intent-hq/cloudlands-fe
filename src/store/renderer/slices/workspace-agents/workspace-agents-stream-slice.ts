import type { ContentBlock } from '$shared/types';
import { createAction } from '@augmentcode/themis/utils/store/create-action';

export interface AgentStreamUpdatePayload {
  workspaceId?: string;
  agentId: string;
  handlerSessionId: string;
  source: 'sendMessage' | 'restored';
  eventType: 'started' | 'chunk' | 'content-blocks' | 'complete' | 'error' | 'timeout';
  timestamp?: number;
  assistantMessageId?: string;
  assistantAppMessageId?: string;
  contentBlocks?: ContentBlock[];
  rawContentBlocks?: ContentBlock[];
  chunk?: string;
  completeMessage?: unknown;
  /**
   * Abnormal finish reason (PROTOCOL §7 `agent:stream:end` optional field,
   * §7.3): `"refusal"` | `"max_tokens"` | `"max_turn_requests"` today (open
   * union); absent on normal `end_turn` completions.
   */
  finishReason?: string;
  error?: string;
  createInitialPlaceholder?: boolean;
  streamId?: string;
  /**
   * Why the stream ended (PROTOCOL §7 `agent:stream:end` optional field).
   * `"interrupted"` when the user stopped the turn; absent on normal
   * completion.
   */
  stopReason?: string;
}

/** Raw stream update from the thin lifecycle adapter; reducers/sagas derive serializable state. */
export const agentStreamUpdateReceived = createAction<
  [payload: AgentStreamUpdatePayload],
  [payload: AgentStreamUpdatePayload & { timestamp: number }]
>('workspaceAgents/agentStreamUpdateReceived', (payload) => [
  { ...payload, timestamp: payload.timestamp ?? Date.now() },
]);
