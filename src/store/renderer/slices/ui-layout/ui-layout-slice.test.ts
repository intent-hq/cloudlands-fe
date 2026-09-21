import { describe, expect, it } from 'vitest';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { selectPanelVisibilityFlag } from './ui-layout-selectors';
import {
  DEFAULT_EXPANDED_WIDTH,
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  defaultBottomDockState,
  defaultPanelVisibility,
  defaultWorkspaceSidebarPanelLayout,
  hydrateCollapsiblePanelCollapsed,
  hydrateResizablePanelGroupLayout,
  hydrateResizablePanelSize,
  setCollapsiblePanelCollapsed,
  setPanelVisibility,
  setCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  setResizablePanelGroupLayout,
  setResizablePanelSize,
  setSidebarExpandedWidth,
  setWidth,
  toggleDiffIndicators,
  toggleDiffSideBySide,
  toggleFoldUnchanged,
  toggleLineWrapping,
  toggleSidebar,
  setSpacesSidebarWidth,
  setSpacesSidebarCollapsed,
  toggleSpacesSidebarCollapsed,
  setTabbedSidebarPinned,
  toggleTabbedSidebarPinned,
  setSidebarSide,
  toggleSidebarSide,
  uiLayoutReducer,
  type UiLayoutState,
} from './ui-layout-slice';

describe('uiLayoutReducer', () => {
  const initialState: UiLayoutState = {
    lineWrapping: true,
    foldUnchanged: true,
    diffSideBySide: true,
    diffIndicators: true,
    sidebarWidth: DEFAULT_WIDTH,
    sidebarExpandedWidth: DEFAULT_EXPANDED_WIDTH,
    sidebarWidthBeforeCollapse: DEFAULT_WIDTH,
    sidebarCollapsed: false,
    panelVisibility: {
      byWorkspaceId: {},
    },
    spacesSidebarWidth: 200,
    spacesSidebarCollapsed: false,
    tabbedSidebarPinned: true,
    sidebarSide: 'left',
    bottomDock: { ...defaultBottomDockState },
    resizablePanelSizes: {},
    hydratedResizablePanelSizes: {},
    resizablePanelGroupLayouts: {},
    collapsiblePanelCollapsed: {},
    workspaceSidebarPanelLayout: { ...defaultWorkspaceSidebarPanelLayout },
  };

  it('should return initial state', () => {
    const state = uiLayoutReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('editor settings', () => {
    it('should set lineWrapping', () => {
      expect(uiLayoutReducer(initialState, setLineWrapping(false)).lineWrapping).toBe(false);
    });

    it('should set foldUnchanged', () => {
      expect(uiLayoutReducer(initialState, setFoldUnchanged(false)).foldUnchanged).toBe(false);
    });

    it('should set diffSideBySide', () => {
      expect(uiLayoutReducer(initialState, setDiffSideBySide(false)).diffSideBySide).toBe(false);
    });

    it('should set diffIndicators', () => {
      expect(uiLayoutReducer(initialState, setDiffIndicators(false)).diffIndicators).toBe(false);
    });

    it('should toggle editor booleans off', () => {
      expect(uiLayoutReducer(initialState, toggleLineWrapping()).lineWrapping).toBe(false);
      expect(uiLayoutReducer(initialState, toggleFoldUnchanged()).foldUnchanged).toBe(false);
      expect(uiLayoutReducer(initialState, toggleDiffSideBySide()).diffSideBySide).toBe(false);
      expect(uiLayoutReducer(initialState, toggleDiffIndicators()).diffIndicators).toBe(false);
    });

    it('should toggle editor booleans on', () => {
      const disabledState: UiLayoutState = {
        ...initialState,
        lineWrapping: false,
        foldUnchanged: false,
        diffSideBySide: false,
        diffIndicators: false,
      };

      expect(uiLayoutReducer(disabledState, toggleLineWrapping()).lineWrapping).toBe(true);
      expect(uiLayoutReducer(disabledState, toggleFoldUnchanged()).foldUnchanged).toBe(true);
      expect(uiLayoutReducer(disabledState, toggleDiffSideBySide()).diffSideBySide).toBe(true);
      expect(uiLayoutReducer(disabledState, toggleDiffIndicators()).diffIndicators).toBe(true);
    });
  });

  describe('sidebar layout', () => {
    it('uses a compact 360px workspace sidebar by default', () => {
      expect(DEFAULT_WIDTH).toBe(360);
      expect(MIN_WIDTH).toBe(280);
    });

    it('should set width clamped to min/max', () => {
      expect(uiLayoutReducer(initialState, setWidth(400)).sidebarWidth).toBe(400);
      expect(uiLayoutReducer(initialState, setWidth(50)).sidebarWidth).toBe(MIN_WIDTH);
      expect(uiLayoutReducer(initialState, setWidth(1200)).sidebarWidth).toBe(MAX_WIDTH);
      expect(uiLayoutReducer(initialState, setWidth(360.7)).sidebarWidth).toBe(361);
    });

    it('should not update sidebarWidthBeforeCollapse while collapsed', () => {
      const collapsedState: UiLayoutState = {
        ...initialState,
        sidebarWidth: 300,
        sidebarWidthBeforeCollapse: 300,
        sidebarCollapsed: true,
      };

      const state = uiLayoutReducer(collapsedState, setWidth(400));
      expect(state.sidebarWidth).toBe(400);
      expect(state.sidebarWidthBeforeCollapse).toBe(300);
    });

    it('should toggle sidebar collapsed state', () => {
      const collapsed = uiLayoutReducer(initialState, toggleSidebar());
      expect(collapsed.sidebarCollapsed).toBe(true);
      expect(collapsed.sidebarWidthBeforeCollapse).toBe(DEFAULT_WIDTH);

      const expanded = uiLayoutReducer({ ...collapsed, sidebarWidth: 300 }, toggleSidebar());
      expect(expanded.sidebarCollapsed).toBe(false);
    });

    it('should set sidebar collapsed state', () => {
      const collapsed = uiLayoutReducer(initialState, setCollapsed(true));
      expect(collapsed.sidebarCollapsed).toBe(true);
      expect(collapsed.sidebarWidthBeforeCollapse).toBe(DEFAULT_WIDTH);

      const expanded = uiLayoutReducer(
        { ...collapsed, sidebarWidth: 300, sidebarWidthBeforeCollapse: 300 },
        setCollapsed(false),
      );
      expect(expanded.sidebarCollapsed).toBe(false);
    });

    it('should return same state when setCollapsed matches current state', () => {
      expect(uiLayoutReducer(initialState, setCollapsed(false))).toBe(initialState);
    });

    it('should set expanded sidebar width clamped to min/max', () => {
      expect(uiLayoutReducer(initialState, setSidebarExpandedWidth(500)).sidebarExpandedWidth).toBe(
        500,
      );
      expect(uiLayoutReducer(initialState, setSidebarExpandedWidth(50)).sidebarExpandedWidth).toBe(
        MIN_WIDTH,
      );
      expect(
        uiLayoutReducer(initialState, setSidebarExpandedWidth(1200)).sidebarExpandedWidth,
      ).toBe(MAX_WIDTH);
    });
  });

  describe('panel persistence state', () => {
    it('hydrates and sets resizable panel sizes by storage key', () => {
      const hydrated = uiLayoutReducer(initialState, hydrateResizablePanelSize('panel-width', 42));
      expect(hydrated.resizablePanelSizes['panel-width']).toBe(42);
      expect(hydrated.hydratedResizablePanelSizes['panel-width']).toBe(true);

      const updated = uiLayoutReducer(hydrated, setResizablePanelSize('panel-width', 50));
      expect(updated.resizablePanelSizes['panel-width']).toBe(50);
      expect(updated.hydratedResizablePanelSizes['panel-width']).toBe(true);
    });

    it('records completed panel-size hydration when persistence has no value', () => {
      const hydrated = uiLayoutReducer(initialState, hydrateResizablePanelSize('missing'));

      expect(hydrated.resizablePanelSizes.missing).toBeUndefined();
      expect(hydrated.hydratedResizablePanelSizes.missing).toBe(true);
    });

    it('hydrates and sets resizable panel group layouts by storage key', () => {
      const layout = { sizes: [25, 75], collapsed: ['left'] };
      const hydrated = uiLayoutReducer(
        initialState,
        hydrateResizablePanelGroupLayout('group', layout),
      );
      expect(hydrated.resizablePanelGroupLayouts.group).toEqual(layout);

      const updatedLayout = { sizes: [50, 50], collapsed: [] };
      const updated = uiLayoutReducer(
        hydrated,
        setResizablePanelGroupLayout('group', updatedLayout),
      );
      expect(updated.resizablePanelGroupLayouts.group).toEqual(updatedLayout);
    });

    it('hydrates and sets collapsible panel collapsed state by storage key', () => {
      const hydrated = uiLayoutReducer(
        initialState,
        hydrateCollapsiblePanelCollapsed('activity', true),
      );
      expect(hydrated.collapsiblePanelCollapsed.activity).toBe(true);

      const updated = uiLayoutReducer(hydrated, setCollapsiblePanelCollapsed('activity', false));
      expect(updated.collapsiblePanelCollapsed.activity).toBe(false);
    });
  });

  describe('panel visibility', () => {
    it('sets a single panel visibility flag', () => {
      const next = uiLayoutReducer(
        initialState,
        setPanelVisibility('ws-1', 'showNavigationRail', false),
      );
      expect(next.panelVisibility.byWorkspaceId['ws-1']).toEqual({
        ...defaultPanelVisibility,
        showNavigationRail: false,
      });
    });

    it('is a no-op when a single value matches the default', () => {
      expect(
        uiLayoutReducer(initialState, setPanelVisibility('ws-1', 'showNavigationRail', true)),
      ).toBe(initialState);
    });

    it('cleans up visibility on workspace unmount', () => {
      const withState = uiLayoutReducer(
        initialState,
        setPanelVisibility('ws-1', 'showNavigationRail', false),
      );

      const unmounted = uiLayoutReducer(withState, workspaceUnmounted('ws-1'));
      expect(unmounted.panelVisibility.byWorkspaceId['ws-1']).toBeUndefined();
    });

    it('keeps visibility isolated per workspace', () => {
      let state = uiLayoutReducer(
        initialState,
        setPanelVisibility('ws-1', 'showNavigationRail', false),
      );
      state = uiLayoutReducer(state, setPanelVisibility('ws-2', 'showMainContent', false));

      expect(state.panelVisibility.byWorkspaceId['ws-1']?.showNavigationRail).toBe(false);
      expect(state.panelVisibility.byWorkspaceId['ws-1']?.showMainContent).toBe(true);
      expect(state.panelVisibility.byWorkspaceId['ws-2']?.showNavigationRail).toBe(true);
      expect(state.panelVisibility.byWorkspaceId['ws-2']?.showMainContent).toBe(false);
    });

    it('returns selector defaults for workspaces without stored visibility', () => {
      const state = { uiLayout: initialState } as any;

      for (const [key, defaultValue] of Object.entries(defaultPanelVisibility)) {
        expect(
          selectPanelVisibilityFlag.select(
            state,
            'ws-new',
            key as keyof typeof defaultPanelVisibility,
          ),
        ).toBe(defaultValue);
      }
    });

    it('reads stored selector values for a workspace', () => {
      const state = {
        uiLayout: {
          ...initialState,
          panelVisibility: {
            byWorkspaceId: {
              'ws-1': { ...defaultPanelVisibility, showMainContent: false },
            },
          },
        },
      } as any;

      expect(selectPanelVisibilityFlag.select(state, 'ws-1', 'showMainContent')).toBe(false);
      expect(selectPanelVisibilityFlag.select(state, 'ws-1', 'showNotesPanel')).toBe(true);
    });
  });

  describe('layout settings', () => {
    it('should set spacesSidebarWidth', () => {
      const state = uiLayoutReducer(initialState, setSpacesSidebarWidth(300));
      expect(state.spacesSidebarWidth).toBe(300);
    });

    it('should be no-op when setting same spacesSidebarWidth', () => {
      expect(uiLayoutReducer(initialState, setSpacesSidebarWidth(200))).toBe(initialState);
    });

    it('should set spacesSidebarCollapsed', () => {
      expect(
        uiLayoutReducer(initialState, setSpacesSidebarCollapsed(true)).spacesSidebarCollapsed,
      ).toBe(true);
    });

    it('should toggle spacesSidebarCollapsed', () => {
      expect(
        uiLayoutReducer(initialState, toggleSpacesSidebarCollapsed()).spacesSidebarCollapsed,
      ).toBe(true);
      const collapsed = { ...initialState, spacesSidebarCollapsed: true };
      expect(
        uiLayoutReducer(collapsed, toggleSpacesSidebarCollapsed()).spacesSidebarCollapsed,
      ).toBe(false);
    });

    it('should set tabbedSidebarPinned', () => {
      expect(uiLayoutReducer(initialState, setTabbedSidebarPinned(false)).tabbedSidebarPinned).toBe(
        false,
      );
    });

    it('should toggle tabbedSidebarPinned', () => {
      expect(uiLayoutReducer(initialState, toggleTabbedSidebarPinned()).tabbedSidebarPinned).toBe(
        false,
      );
    });

    it('should set sidebarSide', () => {
      expect(uiLayoutReducer(initialState, setSidebarSide('right')).sidebarSide).toBe('right');
    });

    it('should be no-op when setting same sidebarSide', () => {
      expect(uiLayoutReducer(initialState, setSidebarSide('left'))).toBe(initialState);
    });

    it('should toggle sidebarSide', () => {
      expect(uiLayoutReducer(initialState, toggleSidebarSide()).sidebarSide).toBe('right');
      const rightState = { ...initialState, sidebarSide: 'right' as const };
      expect(uiLayoutReducer(rightState, toggleSidebarSide()).sidebarSide).toBe('left');
    });
  });
});
