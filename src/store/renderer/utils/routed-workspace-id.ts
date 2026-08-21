/**
 * The workspace this window's route currently displays, or null outside
 * `/workspace/{id}` (and on `/workspace/new`). Main targets workspace-scoped
 * IPC at windows by this same signal (`windowWorkspaceIds`, fed from the
 * route in `afterNavigate`), so hostedness checks must accept it too: a
 * window routed to a workspace can receive a request while that workspace
 * has no layout entry and is missing from the tab strip (e.g. columns-mode
 * route/stack divergence), and judging it not-hosted would leave the request
 * to time out as "renderer did not respond" (monorepo#2789). Also the
 * "is this workspace currently displayed" signal for the workspace-inactive
 * UI-focus skip (monorepo#3045).
 */
export function routedWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/workspace\/([^/?]+)/);
  const id = match?.[1];
  return id && id !== 'new' ? id : null;
}
