/**
 * Where a link or in-app action was triggered, read from the DOM around it.
 * Kept dependency-free so components can call it without the link handler.
 */
export interface LinkSource {
  /** The element sits in `workspaceId`'s Home preview, so opening content enters that workspace. */
  openInWorkspace: boolean;
  /** Panel containing the element. */
  panelId?: string;
  /** Assistant side-panel layout containing the element. */
  assistantLayoutId?: string;
}

export function readLinkSource(
  element: Element | null | undefined,
  workspaceId: string | undefined,
): LinkSource {
  const previewWorkspaceId = element?.closest<HTMLElement>('[data-workspace-link-target]')?.dataset
    .workspaceLinkTarget;
  return {
    openInWorkspace: !!workspaceId && previewWorkspaceId === workspaceId,
    panelId: element?.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId,
    assistantLayoutId: element?.closest<HTMLElement>('[data-assistant-layout-id]')?.dataset
      .assistantLayoutId,
  };
}
