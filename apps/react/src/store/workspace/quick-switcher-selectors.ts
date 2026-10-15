import { store } from '@/store';
import { computeResults } from '../../../../../src/store/renderer/slices/command-palette/command-palette-results';
import {
  compareWorkspaceActivityDisplayTimeDesc,
  getWorkspaceActivityDisplayTime,
} from '$shared/utils/workspace-activity-time';
import {
  selectWorkspaceIds,
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from './workspace-selectors';
import { selectCurrentConnectionId } from '../connections/connections-selectors';
import { selectAdmittedWorkspaceReadContext } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import {
  selectForegroundWorkspaceAgents,
  selectWorkspaceAgentMetadataStatus,
} from '../workspace-agents/workspace-agents-selectors';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import { m } from '$shared/paraglide/messages.js';

export interface QuickSwitcherItem {
  kind: 'workspace' | 'agent';
  id: string;
  workspaceId: string;
  rootPath: string | null;
  label: string;
  description: string;
}

/** Presentation of admitted canonical entities, using the source palette's ranking. */
export const selectQuickSwitcherItems = store.createSelector(
  (state, workspaceId: string | undefined, query: string): QuickSwitcherItem[] => {
    if (!selectWorkspaceListLoadedForBackend.select(state, selectCurrentConnectionId.select(state)))
      return [];
    const workspaces = selectWorkspaceIds
      .select(state)
      .flatMap((id) => {
        const row = selectWorkspaceById.select(state, id);
        return row && selectAdmittedWorkspaceReadContext.select(state, id) ? [row] : [];
      })
      .sort(compareWorkspaceActivityDisplayTimeDesc);
    const workspace = workspaceId ? selectWorkspaceById.select(state, workspaceId) : undefined;
    const agents =
      workspaceId &&
      selectAdmittedWorkspaceReadContext.select(state, workspaceId) &&
      selectWorkspaceAgentMetadataStatus.select(
        state,
        workspaceId,
        selectPrincipalActionContext.select(state),
      )?.status === 'ready'
        ? selectForegroundWorkspaceAgents
            .select(state, workspaceId)
            .filter((agent) => agent.workspaceId === workspaceId && !agent.retiredAt)
        : [];
    const input = {
      query: query.trim(),
      workspaceId,
      notes: [],
      changes: [],
      terminals: [],
      browserUrls: [],
      recentItems: [],
      files: [],
      commands: [],
      agents: agents
        .map((agent) => ({
          id: agent.id,
          type: 'agent' as const,
          label: agent.name || m.lib_commandPalette_untitledAgent_fallback(),
          description: agent.id,
          icon: null,
          timestamp: new Date(agent.updatedAt || agent.createdAt).getTime(),
        }))
        .sort((a, b) => b.timestamp - a.timestamp),
      workspaceItems: workspaces.map((row) => ({
        id: row.id,
        label: row.title || m.workspace_links_untitled_label(),
        description: row.id,
        icon: null,
        _workspace: true as const,
        _activityTime: getWorkspaceActivityDisplayTime(row),
      })),
    };
    const rows: QuickSwitcherItem[] = [];
    for (const kind of ['agent', 'workspace'] as const) {
      for (const result of computeResults({ ...input, activeFilter: kind })) {
        if (typeof result.id !== 'string') continue;
        const target = kind === 'agent' ? workspace : selectWorkspaceById.select(state, result.id);
        if (!target) continue;
        rows.push({
          kind,
          id: result.id,
          workspaceId: target.id,
          rootPath: target.worktreePath ?? null,
          label: result.label,
          description: result.id,
        });
      }
    }
    return rows;
  },
);
