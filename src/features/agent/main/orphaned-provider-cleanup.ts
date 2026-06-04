import { WorkspaceConfig } from '../../../shared/main/config';

export interface OrphanedProviderCleanupHandler {
  getWorkspaceIdsWithProviders(): Set<string>;
  hasActiveAgentsInWorkspace(workspaceId: string): boolean;
}

export interface OrphanedProviderCleanupPlan {
  orphanedWorkspaceIds: string[];
  safeToCleanup: string[];
  skippedWithActiveAgents: string[];
}

export function getOrphanedProviderCleanupPlan(
  handler: OrphanedProviderCleanupHandler,
  openWorkspaceIds: Set<string>,
): OrphanedProviderCleanupPlan {
  const providerWorkspaceIds = handler.getWorkspaceIdsWithProviders();
  const orphanedWorkspaceIds = [...providerWorkspaceIds].filter(
    (wsId) => !openWorkspaceIds.has(wsId) && !WorkspaceConfig.isVirtualWorkspace(wsId),
  );

  const safeToCleanup: string[] = [];
  const skippedWithActiveAgents: string[] = [];

  for (const wsId of orphanedWorkspaceIds) {
    const hasActive = handler.hasActiveAgentsInWorkspace(wsId);
    if (hasActive) {
      skippedWithActiveAgents.push(wsId);
    } else {
      safeToCleanup.push(wsId);
    }
  }

  return {
    orphanedWorkspaceIds,
    safeToCleanup,
    skippedWithActiveAgents,
  };
}
