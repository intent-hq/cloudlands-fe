import { describe, expect, it } from 'vitest';
import {
  hydrateSidebarNav,
  hydrateWorkspaceSidebarUi,
  initialState,
  openPanel,
  setCombinedPanelSplit,
  setShowArchivedWorkspaces,
  setMultiSelectSidebarSelectedTabs,
  setMultiSelectSidebarTabOrder,
  setStatsOverlayOpen,
  setWorkspaceCollapsedNoteIds,
  setWorkspaceNoteOrder,
  sidebarNavReducer,
  togglePanel,
  toggleShowArchivedWorkspaces,
  toggleStatsOverlay,
  toggleWorkspaceCollapsedNote,
} from './sidebar-nav-slice';
import { isCombinedWorkspacePanelItem } from './sidebar-nav-types';

describe('sidebarNavReducer Chief navigation', () => {
  it('opens the Chief sidebar panel', () => {
    const next = sidebarNavReducer(initialState, openPanel('chief'));

    expect(next.panelItem).toBe('chief');
    expect(next.hoveredItem).toBeNull();
    expect(next.expandedItem).toBeNull();
  });

  it('toggles the Chief sidebar panel with existing panel behavior', () => {
    const opened = sidebarNavReducer(initialState, togglePanel('chief'));
    const closed = sidebarNavReducer(opened, togglePanel('chief'));

    expect(opened.panelItem).toBe('chief');
    expect(closed.panelItem).toBeNull();
    expect(closed.isCardPinned).toBe(false);
  });

  it('treats Chief and All Workspaces as the same combined panel', () => {
    const chiefOpen = sidebarNavReducer(initialState, openPanel('chief'));
    const closed = sidebarNavReducer(chiefOpen, togglePanel('all-workspaces'));

    expect(isCombinedWorkspacePanelItem('chief')).toBe(true);
    expect(isCombinedWorkspacePanelItem('all-workspaces')).toBe(true);
    expect(isCombinedWorkspacePanelItem('settings')).toBe(false);
    expect(closed.panelItem).toBeNull();
  });

  it('stores and clamps the combined panel split', () => {
    expect(sidebarNavReducer(initialState, setCombinedPanelSplit(0.6)).combinedPanelSplit).toBe(
      0.6,
    );
    expect(sidebarNavReducer(initialState, setCombinedPanelSplit(0.01)).combinedPanelSplit).toBe(
      0.15,
    );
    expect(sidebarNavReducer(initialState, setCombinedPanelSplit(0.99)).combinedPanelSplit).toBe(
      0.85,
    );
  });

  it('rejects non-finite combinedPanelSplit values and preserves state identity', () => {
    expect(sidebarNavReducer(initialState, setCombinedPanelSplit(NaN))).toBe(initialState);
    expect(sidebarNavReducer(initialState, setCombinedPanelSplit(Infinity))).toBe(initialState);
    expect(sidebarNavReducer(initialState, setCombinedPanelSplit(-Infinity))).toBe(initialState);
  });

  it('preserves state identity when clamped value matches current value', () => {
    const state = { ...initialState, combinedPanelSplit: 0.5 };
    expect(sidebarNavReducer(state, setCombinedPanelSplit(0.5))).toBe(state);
  });

  it('hydrates the combined split and migrates the removed home panel id', () => {
    const next = sidebarNavReducer(
      initialState,
      hydrateSidebarNav({ combinedPanelSplit: 0.3, panelItem: 'home' }),
    );

    expect(next.combinedPanelSplit).toBe(0.3);
    expect(next.panelItem).toBe('all-workspaces');
  });

  it('hydrates and normalizes combinedPanelSplit, rejecting non-finite values', () => {
    expect(
      sidebarNavReducer(initialState, hydrateSidebarNav({ combinedPanelSplit: 0.05 }))
        .combinedPanelSplit,
    ).toBe(0.15);
    expect(
      sidebarNavReducer(initialState, hydrateSidebarNav({ combinedPanelSplit: 0.95 }))
        .combinedPanelSplit,
    ).toBe(0.85);
    expect(
      sidebarNavReducer(initialState, hydrateSidebarNav({ combinedPanelSplit: NaN }))
        .combinedPanelSplit,
    ).toBe(initialState.combinedPanelSplit);
    expect(
      sidebarNavReducer(initialState, hydrateSidebarNav({ combinedPanelSplit: Infinity }))
        .combinedPanelSplit,
    ).toBe(initialState.combinedPanelSplit);
  });
});

describe('sidebarNavReducer workspace sidebar UI persistence', () => {
  it('stores and hydrates archived workspace visibility with a false default', () => {
    expect(initialState.showArchivedWorkspaces).toBe(false);

    const shown = sidebarNavReducer(initialState, setShowArchivedWorkspaces(true));
    const hidden = sidebarNavReducer(shown, toggleShowArchivedWorkspaces());
    const hydrated = sidebarNavReducer(
      initialState,
      hydrateSidebarNav({ showArchivedWorkspaces: true }),
    );

    expect(shown.showArchivedWorkspaces).toBe(true);
    expect(hidden.showArchivedWorkspaces).toBe(false);
    expect(hydrated.showArchivedWorkspaces).toBe(true);
  });

  it('hydrates the persisted global multi-select tab order', () => {
    const next = sidebarNavReducer(
      initialState,
      hydrateSidebarNav({ multiSelectTabOrder: ['context', 'overview'] }),
    );

    expect(next.multiSelectTabOrder).toEqual(['context', 'overview']);
  });

  it('stores workspace-selected sidebar tabs by workspace', () => {
    const next = sidebarNavReducer(
      initialState,
      setMultiSelectSidebarSelectedTabs('ws-1', ['overview', 'context']),
    );

    expect(next.multiSelectSelectedTabIdsByWorkspaceId).toEqual({
      'ws-1': ['overview', 'context'],
    });
  });

  it('stores custom note order and collapsed note ids by workspace', () => {
    const withOrder = sidebarNavReducer(
      initialState,
      setWorkspaceNoteOrder('ws-1', ['spec', 'note-1']),
    );
    const withCollapsed = sidebarNavReducer(
      withOrder,
      setWorkspaceCollapsedNoteIds('ws-1', ['note-1']),
    );

    expect(withCollapsed.noteOrderByWorkspaceId['ws-1']).toEqual(['spec', 'note-1']);
    expect(withCollapsed.collapsedNoteIdsByWorkspaceId['ws-1']).toEqual(['note-1']);
  });

  it('toggles collapsed notes without using non-serializable Set state', () => {
    const collapsed = sidebarNavReducer(
      initialState,
      toggleWorkspaceCollapsedNote('ws-1', 'note-1'),
    );
    const expanded = sidebarNavReducer(collapsed, toggleWorkspaceCollapsedNote('ws-1', 'note-1'));

    expect(collapsed.collapsedNoteIdsByWorkspaceId['ws-1']).toEqual(['note-1']);
    expect(expanded.collapsedNoteIdsByWorkspaceId['ws-1']).toEqual([]);
  });

  it('hydrates workspace-specific sidebar UI without clobbering omitted fields', () => {
    const existing = {
      ...initialState,
      multiSelectSelectedTabIdsByWorkspaceId: { 'ws-1': ['overview'] },
      noteOrderByWorkspaceId: { 'ws-1': ['spec'] },
      collapsedNoteIdsByWorkspaceId: { 'ws-1': ['note-1'] },
    };

    const next = sidebarNavReducer(
      existing,
      hydrateWorkspaceSidebarUi('ws-1', { noteOrder: ['spec', 'note-2'] }),
    );

    expect(next.multiSelectSelectedTabIdsByWorkspaceId['ws-1']).toEqual(['overview']);
    expect(next.noteOrderByWorkspaceId['ws-1']).toEqual(['spec', 'note-2']);
    expect(next.collapsedNoteIdsByWorkspaceId['ws-1']).toEqual(['note-1']);
  });

  it('stores the global multi-select tab order', () => {
    const next = sidebarNavReducer(
      initialState,
      setMultiSelectSidebarTabOrder(['files', 'changes', 'context']),
    );

    expect(next.multiSelectTabOrder).toEqual(['files', 'changes', 'context']);
  });
});

describe('sidebarNavReducer usage-stats overlay', () => {
  it('is closed by default', () => {
    expect(initialState.statsOverlayOpen).toBe(false);
  });

  it('opens and closes via setStatsOverlayOpen', () => {
    const opened = sidebarNavReducer(initialState, setStatsOverlayOpen(true));
    const closed = sidebarNavReducer(opened, setStatsOverlayOpen(false));

    expect(opened.statsOverlayOpen).toBe(true);
    expect(closed.statsOverlayOpen).toBe(false);
  });

  it('toggles via toggleStatsOverlay', () => {
    const opened = sidebarNavReducer(initialState, toggleStatsOverlay());
    const closed = sidebarNavReducer(opened, toggleStatsOverlay());

    expect(opened.statsOverlayOpen).toBe(true);
    expect(closed.statsOverlayOpen).toBe(false);
  });
});
