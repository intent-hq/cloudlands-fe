/**
 * Helpers for applying AI-generated panel layouts.
 *
 * Extracted from `PanelLayout.svelte` to keep that component under the
 * repo-wide 1200-line cap. Behavior is unchanged — these functions are
 * direct moves of the inline helpers that lived inside the onMount
 * closure of PanelLayout.
 */

import { m } from '$shared/paraglide/messages.js';
import type { PanelLayoutManager } from '$features/layout/panel-layout-adapter';
import type { ClientLogger } from '$lib/utils/client-logger';
import { store as appStore } from '$store/renderer/store';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createAgentFromConfigRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

export interface AILayoutTabConfig {
  type: string;
  agentId?: string;
  agentName?: string;
  noteId?: string;
  noteTitle?: string;
  filePath?: string;
  browserUrl?: string;
  createNew?: boolean;
  newAgentName?: string;
  title?: string;
}

export interface AILayoutPanelConfig {
  tabs: AILayoutTabConfig[];
  activeTabIndex?: number;
}

export interface OpenTabFromConfigCtx {
  layoutManager: PanelLayoutManager;
  workspaceId: string;
  logger: ClientLogger;
}

/**
 * Flatten nested panel structures (AI sometimes returns nested panels).
 */
export function flattenPanels(
  panelConfigs: AILayoutPanelConfig[],
): Array<{ tabs: AILayoutTabConfig[] }> {
  const result: Array<{ tabs: AILayoutTabConfig[] }> = [];
  for (const panel of panelConfigs) {
    if (Array.isArray(panel.tabs) && panel.tabs.length > 0) {
      // Panel has tabs directly - use it
      result.push({ tabs: panel.tabs });
    } else if ('panels' in panel && Array.isArray((panel as any).panels)) {
      // Panel has nested panels - flatten them
      result.push(...flattenPanels((panel as any).panels));
    }
  }
  return result;
}

/**
 * Open a tab from an AI-generated layout config into the given panel.
 */
export async function openTabFromConfig(
  tab: AILayoutTabConfig,
  panelId: string,
  panelIndex: number,
  ctx: OpenTabFromConfigCtx,
): Promise<void> {
  const { layoutManager, workspaceId, logger } = ctx;
  switch (tab.type) {
    case 'agent':
      // For agent, either use existing agent ID or create new
      if (tab.agentId) {
        // Open existing agent
        layoutManager.openTab(
          {
            type: 'agent',
            title: tab.title || tab.agentName || m.layout_aiLayout_agent_fallback(),
            closable: true,
            agentId: tab.agentId,
            workspaceId,
          },
          panelId,
        );
      } else {
        // Request a new agent session; the workspace-agent saga opens the tab
        // in the requested panel when creation succeeds.
        const agentName =
          tab.newAgentName ||
          tab.title ||
          m.layout_aiLayout_agentNumbered_fallback({ number: panelIndex + 1 });
        try {
          appStore.dispatch(createAgentFromConfigRequested(workspaceId, {
            name: agentName,
            // Every name on this path comes from the AI-generated layout
            // config (newAgentName/title) or the `Agent N` fallback — none is
            // user-chosen, so keep the session self-renameable.
            nameExplicitlySet: false,
            workspaceId: WorkspaceId(workspaceId),
            source: 'panel-ai-layout',
            metadata: { source: 'panel-ai-layout' },
          }, { openAgent: true, panelId }));
          logger.info('Requested new agent for layout', { name: agentName, panelId });
        } catch (error) {
          logger.error('Failed to create agent for layout', { error, agentName });
        }
      }
      break;

    case 'note':
      layoutManager.openTab(
        {
          type: 'note',
          title: tab.title || tab.noteId || m.layout_aiLayout_note_fallback(),
          closable: true,
          noteId: tab.noteId,
          workspaceId,
        },
        panelId,
      );
      break;

    case 'file':
      if (tab.filePath) {
        const fileName = tab.filePath.split('/').pop() || tab.filePath;
        layoutManager.openTab(
          {
            type: 'file',
            title: tab.title || fileName,
            closable: true,
            filePath: tab.filePath,
            workspaceId,
          },
          panelId,
        );
      }
      break;

    case 'terminal':
      layoutManager.openTab(
        {
          type: 'terminal',
          title: tab.title || m.layout_panelLayout_terminal_fallback(),
          closable: true,
          workspaceId,
        },
        panelId,
      );
      break;

    case 'browser':
      layoutManager.openTab(
        {
          type: 'browser',
          title: tab.title || m.layout_panelLayout_browser_fallback(),
          closable: true,
          browserUrl: tab.browserUrl || 'about:blank',
          workspaceId,
        },
        panelId,
      );
      break;

    case 'changes':
      layoutManager.openTab(
        {
          type: 'changes',
          title: tab.title || m.layout_aiLayout_changes_fallback(),
          closable: true,
          workspaceId,
        },
        panelId,
      );
      break;

    case 'activity':
      layoutManager.openTab(
        {
          type: 'activity',
          title: tab.title || m.layout_aiLayout_activity_fallback(),
          closable: true,
          workspaceId,
        },
        panelId,
      );
      break;

    default:
      logger.warn('Unknown content type', { type: tab.type });
  }
}

