import { emptyChatAgentState } from './chat-state-slice';
import type { ChatAgentState, ChatStateSlice } from './chat-state-types';

export function getAgentChatState(
  state: { chatState?: ChatStateSlice },
  agentId: string,
): ChatAgentState {
  return state.chatState?.byAgentId[agentId] ?? emptyChatAgentState;
}
