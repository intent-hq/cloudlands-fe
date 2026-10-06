/** An explicit user click, retained while the selected chat hydrates. */
export interface ChatAttentionFocusRequest {
  requestId: number;
  questionMessageId?: string;
}
interface FocusState {
  active: boolean;
  handledRequestId: number;
  questionMessageId: string | null;
  collapsed: boolean;
  questionReady: boolean;
  promptReady: boolean;
}

export function getChatAttentionFocusAction(
  request: ChatAttentionFocusRequest | undefined,
  state: FocusState,
) {
  if (!request || !state.active || state.handledRequestId === request.requestId) return null;
  if (request.questionMessageId) {
    if (request.questionMessageId !== state.questionMessageId) return null;
    if (state.collapsed) return 'expand-question';
    return state.questionReady ? 'focus-question' : null;
  }
  if (state.questionMessageId && !state.collapsed) return 'collapse-question';
  return state.promptReady ? 'focus-prompt' : null;
}
