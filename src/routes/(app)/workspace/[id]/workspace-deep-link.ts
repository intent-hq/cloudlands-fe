/**
 * Workspace deep links: `/workspace/<id>?note=<noteId>` and
 * `/workspace/<id>?agent=<agentId>` open that note or agent chat once the
 * workspace has loaded, then drop the parameters from the address bar.
 *
 * Cross-workspace note links already navigate to `?note=` (see
 * `workspaces-link-handler.ts`); this is the reader for that URL. The same
 * URLs let a browser sandbox open a chosen chat or note directly.
 */
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import type { WorkspaceLoadState } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-types';

export const WORKSPACE_DEEP_LINK_PARAMS = ['note', 'agent'] as const;

export type WorkspaceDeepLink =
  { kind: 'note'; noteId: string } | { kind: 'agent'; agentId: string };

function readId(value: string | null): string | null {
  const id = value?.trim();
  if (!id || id === '.' || id === '..' || /[\\/]/.test(id)) return null;
  return id;
}

/** Note first, agent last, so an agent chat requested alongside a note ends up focused. */
export function parseWorkspaceDeepLinks(params: URLSearchParams): WorkspaceDeepLink[] {
  const links: WorkspaceDeepLink[] = [];
  const noteId = readId(params.get('note'));
  if (noteId) links.push({ kind: 'note', noteId });
  const agentId = readId(params.get('agent'));
  if (agentId) links.push({ kind: 'agent', agentId });
  return links;
}

export function hasWorkspaceDeepLinkParams(params: URLSearchParams): boolean {
  return WORKSPACE_DEEP_LINK_PARAMS.some((name) => params.has(name));
}

export type WorkspaceDeepLinkAction =
  ReturnType<typeof openWorkspaceNote> | ReturnType<typeof openAgentTabRequested>;

export function workspaceDeepLinkAction(
  workspaceId: string,
  link: WorkspaceDeepLink,
): WorkspaceDeepLinkAction {
  return link.kind === 'note'
    ? openWorkspaceNote(workspaceId, link.noteId)
    : openAgentTabRequested(workspaceId, { agentId: link.agentId });
}

/** The same URL without the deep-link parameters, as a path + search + hash. */
export function stripWorkspaceDeepLinkParams(url: URL): string {
  const next = new URL(url);
  for (const name of WORKSPACE_DEEP_LINK_PARAMS) next.searchParams.delete(name);
  return next.pathname + next.search + next.hash;
}

export function isWorkspaceReadyForDeepLinks(status: WorkspaceLoadState['status']): boolean {
  return status === 'ready' || status === 'cached-ready';
}

export interface WorkspaceDeepLinkConsumerDeps {
  dispatch: (action: WorkspaceDeepLinkAction) => unknown;
  replaceUrl: (url: string) => void;
}

/**
 * Returns a function to call whenever the route URL or load state changes.
 * It opens the linked note / agent once per URL after the workspace is ready,
 * then strips the parameters so reloads and back/forward do not reopen them.
 */
export function createWorkspaceDeepLinkConsumer(deps: WorkspaceDeepLinkConsumerDeps) {
  let consumedHref: string | null = null;
  return (
    workspaceId: string,
    url: URL | undefined,
    status: WorkspaceLoadState['status'],
  ): boolean => {
    if (!workspaceId || !url || !hasWorkspaceDeepLinkParams(url.searchParams)) return false;
    if (!isWorkspaceReadyForDeepLinks(status)) return false;
    if (consumedHref === url.href) return false;
    consumedHref = url.href;
    for (const link of parseWorkspaceDeepLinks(url.searchParams)) {
      deps.dispatch(workspaceDeepLinkAction(workspaceId, link));
    }
    deps.replaceUrl(stripWorkspaceDeepLinkParams(url));
    return true;
  };
}
