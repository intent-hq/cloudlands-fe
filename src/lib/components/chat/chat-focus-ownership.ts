export interface ChatFocusRequest {
  tabType?: string;
  agentId?: string;
  workspaceId?: string;
  panelId?: string;
  /**
   * Dictation-flagged requests target the composer that started a dictation,
   * so they bypass the panel-focused guard: the user may have focused another
   * panel mid-dictation, and the transcript must still land in the
   * originating composer. Agent/workspace/active-tab matching is unchanged.
   */
  source?: 'dictation';
}

interface ChatFocusOwner {
  agentId: string;
  workspaceId: string;
  panelId: string | null;
  isActive: boolean;
  isPanelFocused: boolean;
}

/** Prevent delayed global focus events from reaching cached or background chats. */
export function shouldHandleChatFocusRequest(
  request: ChatFocusRequest | null | undefined,
  owner: ChatFocusOwner,
): boolean {
  if (request?.tabType !== 'agent' || request.agentId !== owner.agentId || !owner.isActive) {
    return false;
  }
  if (request.workspaceId && request.workspaceId !== owner.workspaceId) return false;

  if (owner.panelId) {
    if (request.source !== 'dictation' && !owner.isPanelFocused) return false;
    if (request.panelId && request.panelId !== owner.panelId) return false;
  }

  return true;
}
