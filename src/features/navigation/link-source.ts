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
    // The attribute is a styling/test marker and a mutation signal only; never read it for routing.
    node.setAttribute('data-workspace-surface', id);
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

/** The registered workspace surface that contains `element`, if any. */
export function findWorkspaceSurface(
  element: Element | null | undefined,
): { element: Element; workspaceId: string } | undefined {
  for (let node = element; node; node = node.parentElement) {
    const workspaceId = workspaceSurfaces.get(node);
    if (workspaceId) return { element: node, workspaceId };
  }
  return undefined;
}

/** Current workspace of a surface returned by `findWorkspaceSurface`. */
export function surfaceWorkspaceId(surface: Element): string | undefined {
  return workspaceSurfaces.get(surface);
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
    surfaceWorkspaceId: findWorkspaceSurface(element)?.workspaceId,
  };
}
