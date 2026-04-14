import { ROOT_WORKSPACE_ID, isValidWorkspaceId } from '$shared/types/branded-ids';

export type ProviderTerminalTarget = {
  ipcWorkspaceId: string;
  uiWorkspaceId: string;
  isRootContext: boolean;
};

/**
 * Resolve where provider setup commands should run and which terminal overlay
 * state bucket should be opened.
 *
 * During onboarding and other non-workspace contexts, the backend PTY is created
 * under the special root workspace id and the root overlay also listens under
 * that same id. Keeping both ids aligned prevents terminal creation from
 * succeeding while the UI opens an empty `new` workspace overlay.
 */
export function getProviderTerminalTarget(
  activeWorkspaceId: string | null | undefined,
): ProviderTerminalTarget {
  if (
    activeWorkspaceId &&
    activeWorkspaceId !== ROOT_WORKSPACE_ID &&
    isValidWorkspaceId(activeWorkspaceId)
  ) {
    return {
      ipcWorkspaceId: activeWorkspaceId,
      uiWorkspaceId: activeWorkspaceId,
      isRootContext: false,
    };
  }

  return {
    ipcWorkspaceId: ROOT_WORKSPACE_ID,
    uiWorkspaceId: ROOT_WORKSPACE_ID,
    isRootContext: true,
  };
}
