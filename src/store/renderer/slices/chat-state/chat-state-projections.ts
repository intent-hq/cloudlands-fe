import { emptyChatAgentState } from './chat-state-slice';
import { hydratedBlockKey, type ChatAgentState, type ChatStateSlice } from './chat-state-types';

export function getAgentChatState(
  state: { chatState?: ChatStateSlice },
  agentId: string,
): ChatAgentState {
  return state.chatState?.byAgentId[agentId] ?? emptyChatAgentState;
}

export function getHydratedBlock(
  state: { chatState?: ChatStateSlice },
  agentId: string,
  messageId: string,
  blockId: string,
) {
  return getAgentChatState(state, agentId).hydratedBlocks?.[hydratedBlockKey(messageId, blockId)];
}

export const getInitialChatHistoryPending = (
  state: { chatState?: ChatStateSlice },
  agentId: string,
) => getAgentChatState(state, agentId).initialHistoryPending === true;
