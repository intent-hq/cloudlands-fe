import { TAB_REMOVAL_ACTIONS } from '../panel-layout/panel-layout-action-utils';
import type { DividerBoundarySnapshot } from './unread-tracking-types';

export type DividerSessionBoundary =
  | { kind: 'tab-close'; agentIds: string[] }
  | { kind: 'chief-card-close'; agentIds: string[] }
  | {
      kind: 'workspace-switch';
      agentIds: string[];
      previousWorkspaceId: string | null;
      nextWorkspaceId: string | null;
    };

const TAB_REMOVAL_ACTION_TYPES = new Set(TAB_REMOVAL_ACTIONS.map((action) => action.type));

export function detectWorkspaceBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
): DividerSessionBoundary | null {
  if (previous.activeWorkspaceId === current.activeWorkspaceId) return null;
  const chiefIds = new Set(current.chiefSessionAgentIds);
  const agentIds = current.dividerSessionAgentIds.filter((id) => !chiefIds.has(id));
  return agentIds.length > 0
    ? {
        kind: 'workspace-switch',
        agentIds,
        previousWorkspaceId: previous.activeWorkspaceId,
        nextWorkspaceId: current.activeWorkspaceId,
      }
    : null;
}

export function detectChiefCardBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
): DividerSessionBoundary | null {
  return previous.chiefCardVisible &&
    !current.chiefCardVisible &&
    current.chiefSessionAgentIds.length > 0
    ? { kind: 'chief-card-close', agentIds: current.chiefSessionAgentIds }
    : null;
}

export function detectTabBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
): DividerSessionBoundary | null {
  const previouslyOpen = new Set(previous.openAgentTabIds);
  const currentlyOpen = new Set(current.openAgentTabIds);
  const agentIds = current.dividerSessionAgentIds.filter(
    (id) => previouslyOpen.has(id) && !currentlyOpen.has(id),
  );
  return agentIds.length > 0 ? { kind: 'tab-close', agentIds } : null;
}

export function detectDividerSessionBoundary(
  previous: DividerBoundarySnapshot,
  current: DividerBoundarySnapshot,
  actionType: string,
): DividerSessionBoundary | null {
  if (previous.activeWorkspaceId !== current.activeWorkspaceId) {
    return detectWorkspaceBoundary(previous, current);
  }
  if (actionType.startsWith('sidebarNav/')) {
    return detectChiefCardBoundary(previous, current);
  }
  if (!TAB_REMOVAL_ACTION_TYPES.has(actionType)) return null;
  return detectTabBoundary(previous, current);
}
