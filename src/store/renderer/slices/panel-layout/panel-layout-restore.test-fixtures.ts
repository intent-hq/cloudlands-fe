import {
  PANEL_LAYOUT_PERSISTENCE_VERSION,
  type PanelState,
  type PanelTab,
  type WorkspacePanelLayout,
} from './panel-layout-types';

function tab(workspaceId: string, id: string): PanelTab {
  return {
    id,
    type: 'note',
    title: id,
    noteId: id,
    workspaceId,
    closable: true,
  };
}

function panel(
  workspaceId: string,
  id: string,
  tabIds: string[],
  activeTabId: string,
  attentionTabIds?: string[],
): PanelState {
  return {
    id,
    tabs: tabIds.map((tabId) => tab(workspaceId, tabId)),
    activeTabId,
    ...(attentionTabIds ? { attentionTabIds } : {}),
  };
}

export function narrowOverlappingGeometryFixture(workspaceId: string): WorkspacePanelLayout {
  return {
    version: PANEL_LAYOUT_PERSISTENCE_VERSION,
    root: {
      type: 'split',
      direction: 'horizontal',
      children: ['narrow-left', 'narrow-middle', 'wide-right'].map((panelId) => ({
        type: 'panel' as const,
        panelId,
      })),
      sizes: [12, 12, 76],
    },
    panels: {
      'narrow-left': panel(
        workspaceId,
        'narrow-left',
        ['left-background', 'left-active'],
        'left-active',
        ['left-background'],
      ),
      'narrow-middle': panel(workspaceId, 'narrow-middle', ['middle-active'], 'middle-active'),
      'wide-right': panel(workspaceId, 'wide-right', ['right-active'], 'right-active'),
    },
    focusedPanelId: 'narrow-middle',
    columnCount: 3,
    canvasWidth: 1200,
    canvasWidthSource: 'explicit',
  };
}

/**
 * The panel tree a hang left behind: a valid two-column split whose panels
 * carry no tabs and no active tab. It passes stored-layout validation, so the
 * restore settles as 'restored' and renders a blank content area with only
 * the split divider unless the reconcile reseeds the primary agent tab.
 */
export function tablessSplitFixture(): WorkspacePanelLayout {
  return {
    version: PANEL_LAYOUT_PERSISTENCE_VERSION,
    root: {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'panel', panelId: 'lost-left' },
        { type: 'panel', panelId: 'lost-right' },
      ],
      sizes: [50, 50],
    },
    panels: {
      'lost-left': { id: 'lost-left', tabs: [], activeTabId: null },
      'lost-right': { id: 'lost-right', tabs: [], activeTabId: null },
    },
    focusedPanelId: 'lost-left',
    columnCount: 2,
    canvasWidth: null,
    canvasWidthSource: null,
  };
}

export function displacedOrphanSliverFixture(workspaceId: string): WorkspacePanelLayout {
  return {
    version: PANEL_LAYOUT_PERSISTENCE_VERSION,
    root: {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'panel', panelId: 'anchored-left' },
        { type: 'panel', panelId: 'stale-sliver-placeholder' },
      ],
      sizes: [96, 4],
    },
    panels: {
      'anchored-left': panel(workspaceId, 'anchored-left', ['left-active'], 'left-active'),
      displaced: panel(
        workspaceId,
        'displaced',
        ['recovered-background', 'recovered-active'],
        'recovered-active',
        ['recovered-background'],
      ),
    },
    focusedPanelId: 'displaced',
    columnCount: 2,
    canvasWidth: 1000,
    canvasWidthSource: 'explicit',
  };
}
