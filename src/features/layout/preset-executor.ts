/**
 * Preset Executor
 *
 * Handles applying content-aware layout presets that need to:
 * 1. Query current workspace state (agents, files, etc.)
 * 2. Calculate optimal tiling
 * 3. Apply the layout with appropriate content
 */

import { agentService } from '$features/agent/agent-ipc-bridge';
import { selectStagedWorkingChanges, selectUnstagedWorkingChanges, selectFileTrackingCommits } from '$lib/store/slices/changes/changes-selectors';
import { selectAllWorkspaceAgents } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import type { LayoutPresetId } from '$lib/components/layout/panel-system/types';
import { createLogger } from '$lib/utils/client-logger';
import type { PanelLayoutManager } from './panel-layout-adapter';
import { calculateTiling } from './tiling-utils';

const logger = createLogger('PresetExecutor');

export interface PresetContext {
  workspaceId: string;
  containerWidth: number;
  containerHeight: number;
}

/**
 * Apply a content-aware preset to the layout
 */
export async function applyContentPreset(
  presetId: LayoutPresetId,
  layoutManager: PanelLayoutManager,
  context: PresetContext,
): Promise<boolean> {
  logger.info('Applying content preset', { presetId, context });

  switch (presetId) {
    case 'planning':
      return applyPlanningPreset(layoutManager, context);
    case 'agents-row':
      return applyAgentsRowPreset(layoutManager, context);
    case 'changes':
      return applyChangesPreset(layoutManager, context);
    case 'review':
      return applyReviewPreset(layoutManager, context);
    default:
      // For structural presets, delegate to the layout manager
      layoutManager.applyPreset(
        presetId as 'single' | 'split-horizontal' | 'split-vertical' | 'three-column',
      );
      return true;
  }
}

/**
 * Planning preset: Orchestrator agent on left, Spec note on right
 */
async function applyPlanningPreset(
  layoutManager: PanelLayoutManager,
  context: PresetContext,
): Promise<boolean> {
  const { workspaceId } = context;

  // Find the oldest agent (the initial coordinator)
  const agents = agentService.getSessionsForWorkspace(workspaceId);
  const orchestrator = agents.length > 0
    ? agents.reduce((oldest, current) => {
      const oldestTime = oldest.createdAt ? new Date(oldest.createdAt).getTime() : Infinity;
      const currentTime = current.createdAt ? new Date(current.createdAt).getTime() : Infinity;
      return currentTime < oldestTime ? current : oldest;
    })
    : undefined;

  // Batch all changes into a single history entry
  return layoutManager.batchMutations(() => {
    // Create fresh 2-panel layout (clears existing tabs)
    const panelIds = layoutManager.createGridLayout(2);

    // Open agent in left panel
    if (orchestrator) {
      layoutManager.openTab(
        {
          type: 'agent',
          title: orchestrator.name || 'Agent',
          agentId: orchestrator.id,
          closable: true,
          workspaceId,
        },
        panelIds[0],
      );
    }

    // Open spec note in right panel
    layoutManager.openTab(
      {
        type: 'note',
        title: 'Spec',
        noteId: 'spec',
        closable: true,
        workspaceId,
      },
      panelIds[1],
    );

    return true;
  });
}

/**
 * Agents Row preset: Tile agents, prioritizing non-background, then running/recent background agents
 */
async function applyAgentsRowPreset(
  layoutManager: PanelLayoutManager,
  context: PresetContext,
): Promise<boolean> {
  const { workspaceId, containerWidth, containerHeight } = context;
  const MAX_AGENTS = 6;

  // Use Redux store to get ALL agents including background ones
  // (agentService.getSessionsForWorkspace filters out background agents)
  const allAgents = selectAllWorkspaceAgents.select(getReduxStore().getState(), workspaceId);

  // Helper to check if agent is background
  const isBackground = (a: (typeof allAgents)[0]) =>
    !!(a.isBackground || (a.metadata as any)?.isBackground);

  // Get non-background agents first
  const nonBackgroundAgents = allAgents.filter((a) => !isBackground(a));

  // Get background agents, sorted by: running first, then most recent activity
  const backgroundAgents = allAgents
    .filter((a) => isBackground(a))
    .sort((a, b) => {
      // Running agents first (status === 'active' or isProcessing)
      const aIsRunning = a.status === 'active' || a.isProcessing;
      const bIsRunning = b.status === 'active' || b.isProcessing;
      if (aIsRunning && !bIsRunning) return -1;
      if (!aIsRunning && bIsRunning) return 1;

      // Then by most recent activity
      const aTime = a.lastActivity
        ? new Date(a.lastActivity).getTime()
        : a.updatedAt
          ? new Date(a.updatedAt).getTime()
          : 0;
      const bTime = b.lastActivity
        ? new Date(b.lastActivity).getTime()
        : b.updatedAt
          ? new Date(b.updatedAt).getTime()
          : 0;
      return bTime - aTime; // Most recent first
    });

  logger.info('Agents row preset - agent counts', {
    total: allAgents.length,
    nonBackground: nonBackgroundAgents.length,
    background: backgroundAgents.length,
  });

  // Combine: non-background first, then fill remaining slots with background
  const agents = [
    ...nonBackgroundAgents,
    ...backgroundAgents.slice(0, MAX_AGENTS - nonBackgroundAgents.length),
  ].slice(0, MAX_AGENTS);

  if (agents.length === 0) {
    logger.info('No agents to display for agents-row preset');
    return false;
  }

  // Calculate tiling
  const tiling = calculateTiling(containerWidth, containerHeight, agents.length);
  logger.info('Agent tiling calculated', { tiling, agentCount: agents.length });

  // Batch all changes into a single history entry
  return layoutManager.batchMutations(() => {
    // Create a fresh grid layout with exactly the number of panels needed
    // This clears all existing tabs and creates empty panels
    const panelIds = layoutManager.createGridLayout(agents.length);
    logger.info('Created grid layout for agents', {
      panelIds,
      panelCount: panelIds.length,
      agentCount: agents.length,
    });

    // Open one agent per panel
    for (let i = 0; i < agents.length; i++) {
      const panelId = panelIds[i];
      if (panelId) {
        layoutManager.openTab(
          {
            type: 'agent',
            title: agents[i].name || 'Agent',
            agentId: agents[i].id,
            closable: true,
            workspaceId,
          },
          panelId,
        );
      }
    }

    return true;
  });
}

/**
 * Changes preset: Tile changed files
 */
async function applyChangesPreset(
  layoutManager: PanelLayoutManager,
  context: PresetContext,
): Promise<boolean> {
  const { workspaceId, containerWidth, containerHeight } = context;

  // Get changes - prioritize staged, then unstaged, then recent commits
  const state = getReduxStore().getState();
  const staged = selectStagedWorkingChanges.select(state, workspaceId);
  const unstaged = selectUnstagedWorkingChanges.select(state, workspaceId);
  const commits = selectFileTrackingCommits.select(state, workspaceId);

  // Determine which files to show - combine unstaged + staged (unstaged first)
  const unstagedFiles = unstaged.map((c) => ({
    path: c.relativePath,
    type: 'unstaged' as const,
  }));
  const stagedFiles = staged.map((c) => ({
    path: c.relativePath,
    type: 'staged' as const,
  }));

  let filesToShow: Array<{ path: string; type: 'staged' | 'unstaged' | 'committed' }> = [
    ...unstagedFiles,
    ...stagedFiles,
  ].slice(0, 6);

  // Fall back to recent commits if no working changes
  if (filesToShow.length === 0 && commits.length > 0 && commits[0].files) {
    filesToShow = commits[0].files.slice(0, 6).map((f) => ({
      path: f.path,
      type: 'committed' as const,
    }));
  }

  // Batch all changes into a single history entry
  return layoutManager.batchMutations(() => {
    if (filesToShow.length === 0) {
      logger.info('No changes to display for changes preset');
      // Fall back to showing the changes panel in a fresh single panel
      const panelIds = layoutManager.createGridLayout(1);
      layoutManager.openTab(
        {
          type: 'changes',
          title: 'Changes',
          closable: true,
          workspaceId,
        },
        panelIds[0],
      );
      return true;
    }

    // Calculate tiling for files
    const tiling = calculateTiling(containerWidth, containerHeight, filesToShow.length);
    logger.info('Changes tiling calculated', { tiling, fileCount: filesToShow.length });

    // Create fresh grid layout with exactly the number of panels needed (clears existing tabs)
    const panelIds = layoutManager.createGridLayout(filesToShow.length);
    logger.info('Created grid layout for changes', {
      panelIds,
      panelCount: panelIds.length,
      fileCount: filesToShow.length,
    });

    // Open one diff per panel
    for (let i = 0; i < filesToShow.length; i++) {
      const file = filesToShow[i];
      const fileName = file.path.split('/').pop() || file.path;
      layoutManager.openTab(
        {
          type: 'diff',
          title: fileName,
          diffPath: file.path,
          closable: true,
          workspaceId,
          data: { staged: file.type === 'staged' },
        },
        panelIds[i],
      );
    }

    return true;
  });
}

/**
 * Review preset: Coordinator/Initial agent on left, All Changes on right
 */
async function applyReviewPreset(
  layoutManager: PanelLayoutManager,
  context: PresetContext,
): Promise<boolean> {
  const { workspaceId } = context;

  // Find the oldest agent (the initial coordinator)
  const agents = agentService.getSessionsForWorkspace(workspaceId);
  const coordinator = agents.length > 0
    ? agents.reduce((oldest, current) => {
      const oldestTime = oldest.createdAt ? new Date(oldest.createdAt).getTime() : Infinity;
      const currentTime = current.createdAt ? new Date(current.createdAt).getTime() : Infinity;
      return currentTime < oldestTime ? current : oldest;
    })
    : undefined;

  // Batch all changes into a single history entry
  return layoutManager.batchMutations(() => {
    // Create fresh 2-panel layout (clears existing tabs)
    const panelIds = layoutManager.createGridLayout(2);

    // Open agent in left panel
    if (coordinator) {
      layoutManager.openTab(
        {
          type: 'agent',
          title: coordinator.name || 'Coordinator',
          agentId: coordinator.id,
          closable: true,
          workspaceId,
        },
        panelIds[0],
      );
    }

    // Open all changes (local-changes) in right panel
    layoutManager.openTab(
      {
        type: 'local-changes',
        title: 'All Changes',
        closable: true,
        workspaceId,
      },
      panelIds[1],
    );

    return true;
  });
}
