import { getContext } from 'svelte';
import { WorkspaceId } from '$shared/types/branded-ids';

export const WORKSPACE_ROUTE_CONTEXT = Symbol('workspace-route-context');

export type WorkspaceRouteContext = Readonly<{
  workspaceId: WorkspaceId | null;
}>;

export function workspaceIdFromRouteParam(routeParam: string | undefined): WorkspaceId | null {
  return routeParam && routeParam !== 'new' ? WorkspaceId(routeParam) : null;
}

export function workspaceIdFromRoute(
  pathname: string | undefined,
  routeParam: string | undefined,
): WorkspaceId | null {
  return pathname?.startsWith('/workspace/') ? workspaceIdFromRouteParam(routeParam) : null;
}

export function getWorkspaceRouteContext(): WorkspaceRouteContext | undefined {
  try {
    return getContext<WorkspaceRouteContext>(WORKSPACE_ROUTE_CONTEXT);
  } catch {
    return undefined;
  }
}
