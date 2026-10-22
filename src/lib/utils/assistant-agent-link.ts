import { store } from '$store/renderer/store';

export function openAssistantAgentFromEvent(
  event: MouseEvent | KeyboardEvent,
  workspaceId: string,
  agentId: string,
): boolean {
  if (
    event.metaKey ||
    event.ctrlKey ||
    !(event.currentTarget instanceof Element) ||
    !event.currentTarget.closest('[data-assistant-panels]')
  )
    return false;
  const sourceWorkspaceId =
    store.state.agentSessions.byAgentId[agentId]?.workspaceId ?? workspaceId;
  const layoutId = event.currentTarget.closest<HTMLElement>('[data-assistant-layout-id]')?.dataset
    .assistantLayoutId;
  void import('$features/home/assistant-panels').then(({ showAssistantContent }) =>
    showAssistantContent(`intent://local/${sourceWorkspaceId}/agent/${agentId}`, { layoutId }),
  );
  return true;
}
