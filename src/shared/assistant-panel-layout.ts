import { CHIEF_WORKSPACE_ID } from './types/branded-ids';

const PREFIX = `${CHIEF_WORKSPACE_ID}-chat-`;

export function assistantPanelLayoutId(agentId: string | null): string {
  return `${PREFIX}${encodeURIComponent(agentId ?? 'empty')}`;
}

export function isAssistantPanelLayout(layoutId: string): boolean {
  return layoutId === CHIEF_WORKSPACE_ID || layoutId.startsWith(PREFIX);
}
