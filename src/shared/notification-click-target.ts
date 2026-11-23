import { CHIEF_WORKSPACE_ID } from './types/branded-ids';

/**
 * Where a notification click goes: a workspace and the agent that finished,
 * or (chief) the Assistant thread. Built only by {@link notificationClickTarget}
 * so the desktop service and the web saga send the same fields.
 */
export interface NotificationClickTarget {
  workspaceId: string;
  /** Set for the Assistant workspace — route to the homepage Assistant. */
  chief?: boolean;
  /** Exact conversation to select in the target workspace or Assistant. */
  agentId?: string;
}

export function notificationClickTarget(
  workspaceId: string | undefined,
  agentId: string | undefined,
): NotificationClickTarget | undefined {
  if (!workspaceId) return undefined;
  return {
    workspaceId,
    ...(workspaceId === CHIEF_WORKSPACE_ID ? { chief: true } : {}),
    ...(agentId ? { agentId } : {}),
  };
}
