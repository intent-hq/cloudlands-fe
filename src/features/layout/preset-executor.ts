/**
 * Preset Executor
 *
 * Handles applying content-aware layout presets that need to:
 * 1. Query current workspace state (agents, files, etc.)
 * 2. Calculate optimal tiling
 * 3. Apply the layout with appropriate content
 */

import {
  selectStagedWorkingChanges,
  selectUnstagedWorkingChanges,
  selectFileTrackingCommits,
} from '$store/renderer/slices/changes/changes-selectors';
import {
  selectBackgroundWorkspaceAgents,
  selectForegroundWorkspaceAgents,
} from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import type { LayoutPresetId } from '$lib/components/layout/panel-system/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { PanelLayoutManager } from './panel-layout-adapter';
import { calculateTiling } from './tiling-utils';
import { store as appStore } from '$store/renderer/store';

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
  const agents = selectForegroundWorkspaceAgents.select(appStore.state, workspaceId);
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
          title: orchestrator.name || m.layout_tabTypes_agent_title(),
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
        title: m.layout_shared_spec_title(),
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

  const state = appStore.state;

  // Get foreground agents first, using reducer-maintained foreground agent IDs.
  const foregroundAgents = selectForegroundWorkspaceAgents.select(state, workspaceId);

  // Get background agents, sorted by: running first, then most recent activity
  const backgroundAgents = selectBackgroundWorkspaceAgents
    .select(state, workspaceId)
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
    total: foregroundAgents.length + backgroundAgents.length,
    foreground: foregroundAgents.length,
    background: backgroundAgents.length,
  });

  // Combine: foreground first, then fill remaining slots with background
  const agents = [
    ...foregroundAgents,
    ...backgroundAgents.slice(0, MAX_AGENTS - foregroundAgents.length),
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
            title: agents[i].name || m.layout_tabTypes_agent_title(),
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
  const state = appStore.state;
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
          title: m.layout_tabTypes_changes_title(),
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
  const agents = selectForegroundWorkspaceAgents.select(appStore.state, workspaceId);
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
          title: coordinator.name || m.layout_presetExecutor_coordinator_fallback(),
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
        title: m.layout_presetExecutor_allChanges_title(),
        closable: true,
        workspaceId,
      },
      panelIds[1],
    );

    return true;
  });
}
