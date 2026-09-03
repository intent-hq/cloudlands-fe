import type { PanelState, PanelTab, WorkspacePanelLayoutState } from './panel-layout-types';
import { getPanelOrder } from './panel-layout-tabless';

export type EquivalentPanelTab = { panelId: string; tab: PanelTab };

function canonicalWorkspacePath(path: string | undefined): string | null {
  if (!path) return null;
  const source = path.replaceAll('\\', '/').replace(/\/+/g, '/');
  const absolute = source.startsWith('/');
  const segments: string[] = [];
  for (const segment of source.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') segments.pop();
    else segments.push(segment);
  }
  const normalized = `${absolute ? '/' : ''}${segments.join('/')}`;
  return normalized || (absolute ? '/' : null);
}

function commitHash(tab: Omit<PanelTab, 'id'> | PanelTab): string | undefined {
  if (tab.type === 'diff') {
    return (tab.data?.change as { commitHash?: string } | undefined)?.commitHash;
  }
  return (tab.data as { commitHash?: string } | undefined)?.commitHash;
}

export function panelTabsAreEquivalent(
  existing: PanelTab,
  requested: Omit<PanelTab, 'id'>,
): boolean {
  if (existing.type !== requested.type) return false;
  switch (requested.type) {
    case 'agent':
      return !!requested.agentId && existing.agentId === requested.agentId;
    case 'note':
      return !!requested.noteId && existing.noteId === requested.noteId;
    case 'file': {
      const path = canonicalWorkspacePath(requested.filePath);
      return !!path && canonicalWorkspacePath(existing.filePath) === path;
    }
    case 'terminal':
      return requested.scriptId
        ? existing.scriptId === requested.scriptId
        : !!requested.terminalId && existing.terminalId === requested.terminalId;
    case 'hook-script':
      return (
        !!requested.workspaceId &&
        !!requested.hookId &&
        existing.workspaceId === requested.workspaceId &&
        existing.hookId === requested.hookId
      );
    case 'diff': {
      const path = canonicalWorkspacePath(requested.diffPath);
      return (
        !!path &&
        canonicalWorkspacePath(existing.diffPath) === path &&
        commitHash(existing) === commitHash(requested)
      );
    }
    case 'browser':
      if (existing.contextItemId || requested.contextItemId) {
        return !!requested.contextItemId && existing.contextItemId === requested.contextItemId;
      }
      return !!requested.browserUrl && existing.browserUrl === requested.browserUrl;
    case 'changes': {
      const hash = commitHash(requested);
      return !!hash && commitHash(existing) === hash;
    }
    case 'activity-changes': {
      const path = canonicalWorkspacePath(requested.filePath);
      return !!path && canonicalWorkspacePath(existing.filePath) === path;
    }
    case 'chat-changes': {
      const messageId = (requested.data as { messageId?: string } | undefined)?.messageId;
      return (
        !!messageId &&
        (existing.data as { messageId?: string } | undefined)?.messageId === messageId
      );
    }
    case 'activity':
    case 'code-review':
    case 'settings':
    case 'overview':
    case 'agent-overview':
    case 'local-changes':
      return true;
    default:
      return false;
  }
}

export function findEquivalentPanelTab(
  workspaceId: string,
  workspace: Pick<WorkspacePanelLayoutState, 'root' | 'panels' | 'focusedPanelId'>,
  requested: Omit<PanelTab, 'id'>,
  referencePanelId?: string | null,
): EquivalentPanelTab | null {
  if (requested.workspaceId && requested.workspaceId !== workspaceId) return null;
  const panelOrder = getPanelOrder(workspace.root);
  const stableOrder = [
    ...panelOrder,
    ...Object.keys(workspace.panels)
      .filter((panelId) => !panelOrder.includes(panelId))
      .sort(),
  ];
  const referenceIndex = Math.max(
    0,
    stableOrder.indexOf(referencePanelId ?? workspace.focusedPanelId ?? stableOrder[0]),
  );
  const candidates: Array<
    EquivalentPanelTab & { active: number; distance: number; order: number; tabOrder: number }
  > = [];

  stableOrder.forEach((panelId, order) => {
    const panel: PanelState | undefined = workspace.panels[panelId];
    panel?.tabs.forEach((tab, tabOrder) => {
      if (tab.workspaceId && tab.workspaceId !== workspaceId) return;
      if (!panelTabsAreEquivalent(tab, requested)) return;
      candidates.push({
        panelId,
        tab,
        active: panel.activeTabId === tab.id ? 0 : 1,
        distance: Math.abs(order - referenceIndex),
        order,
        tabOrder,
      });
    });
  });

  candidates.sort(
    (a, b) =>
      a.active - b.active ||
      a.distance - b.distance ||
      a.order - b.order ||
      a.tabOrder - b.tabOrder ||
      a.tab.id.localeCompare(b.tab.id),
  );
  const match = candidates[0];
  return match ? { panelId: match.panelId, tab: match.tab } : null;
}
