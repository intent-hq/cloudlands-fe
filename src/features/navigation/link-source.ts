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
  /** Workspace whose surface renders the element, for callers that pass no workspace. */
  surfaceWorkspaceId?: string;
}

// Only the workspace surface registers here, so rendered content (PR HTML keeps
// data-* attributes) cannot claim a workspace for its links.
const workspaceSurfaces = new WeakMap<Element, string>();

export function workspaceSurfaceLink(node: Element, workspaceId: string) {
  const register = (id: string) => {
    if (id && id !== 'new') workspaceSurfaces.set(node, id);
    else workspaceSurfaces.delete(node);
  };
  register(workspaceId);
  return {
    update: register,
    destroy() {
      workspaceSurfaces.delete(node);
    },
  };
}

function readSurfaceWorkspaceId(element: Element | null | undefined): string | undefined {
  for (let node = element; node; node = node.parentElement) {
    const workspaceId = workspaceSurfaces.get(node);
    if (workspaceId) return workspaceId;
  }
  return undefined;
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
    surfaceWorkspaceId: readSurfaceWorkspaceId(element),
  };
}
