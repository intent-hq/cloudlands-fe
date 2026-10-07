import { describe, expect, it } from 'vitest';
import {
  hydrateSidebarNav,
  hydrateWorkspaceSidebarUi,
  initialState,
  openPanel,
  setMultiSelectSidebarSelectedTabs,
  setStatsOverlayOpen,
  sidebarNavReducer,
  toggleWorkspaceCollapsedNote,
} from './sidebar-nav-slice';

describe('sidebarNavReducer Chief navigation', () => {
  it('opens the Chief destination', () => {
    const next = sidebarNavReducer(initialState, openPanel('chief'));

    expect(next.panelItem).toBe('chief');
  });
});

describe('sidebarNavReducer workspace sidebar UI persistence', () => {
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

  it('toggles collapsed notes without using non-serializable Set state', () => {
    const collapsed = sidebarNavReducer(
      initialState,
      toggleWorkspaceCollapsedNote('ws-1', 'note-1'),
    );
    const expanded = sidebarNavReducer(collapsed, toggleWorkspaceCollapsedNote('ws-1', 'note-1'));

    expect(collapsed.collapsedNoteIdsByWorkspaceId['ws-1']).toEqual(['note-1']);
    expect(expanded.collapsedNoteIdsByWorkspaceId['ws-1']).toEqual([]);
  });

  it('hydrates per-workspace selected tabs, note order, and collapsed notes without touching other workspaces', () => {
    const seeded = sidebarNavReducer(
      initialState,
      setMultiSelectSidebarSelectedTabs('ws-other', ['overview']),
    );
    const hydrated = sidebarNavReducer(
      seeded,
      hydrateWorkspaceSidebarUi('ws-1', {
        selectedTabIds: ['context', 'overview'],
        noteOrder: ['note-2', 'note-1'],
        collapsedNoteIds: ['note-1'],
      }),
    );

    expect(hydrated.multiSelectSelectedTabIdsByWorkspaceId).toEqual({
      'ws-other': ['overview'],
      'ws-1': ['context', 'overview'],
    });
    expect(hydrated.noteOrderByWorkspaceId).toEqual({ 'ws-1': ['note-2', 'note-1'] });
    expect(hydrated.collapsedNoteIdsByWorkspaceId).toEqual({ 'ws-1': ['note-1'] });

    const tabsOnly = sidebarNavReducer(
      seeded,
      hydrateWorkspaceSidebarUi('ws-1', { selectedTabIds: ['context'] }),
    );
    expect(tabsOnly.noteOrderByWorkspaceId).toBe(seeded.noteOrderByWorkspaceId);
    expect(tabsOnly.collapsedNoteIdsByWorkspaceId).toBe(seeded.collapsedNoteIdsByWorkspaceId);

    const notesOnly = sidebarNavReducer(
      seeded,
      hydrateWorkspaceSidebarUi('ws-1', { collapsedNoteIds: ['note-2'] }),
    );
    expect(notesOnly.multiSelectSelectedTabIdsByWorkspaceId).toBe(
      seeded.multiSelectSelectedTabIdsByWorkspaceId,
    );
    expect(notesOnly.noteOrderByWorkspaceId).toBe(seeded.noteOrderByWorkspaceId);
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
});
