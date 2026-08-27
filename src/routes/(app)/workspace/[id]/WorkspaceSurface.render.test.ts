import { cleanup, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadError: null as null | { kind: 'not_found' | 'error'; message: string },
  workspace: null as null | { id: string; title: string },
  dispatch: vi.fn(),
}));
const action = vi.hoisted(() => (type: string) => (...payload: unknown[]) => ({ type, payload }));
const mockPart = vi.hoisted(() => (marker: string) => async () => {
  const component = (await import('./__tests__/mocks/MockWorkspaceSurfacePart.svelte')).default;
  const renderPart = component as unknown as (anchor: Node, props: Record<string, unknown>) => void;
  return {
    default: (anchor: Node, props: Record<string, unknown>) =>
      renderPart(anchor, { ...props, marker }),
  };
});

vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: mocks.dispatch } }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$features/optimization/memory-manager', () => ({
  CleanupManager: class {
    dispose() {}
  },
}));
vi.mock('./composables/workspace-page-state.svelte', () => ({
  createWorkspacePageState: () => ({
    state: { drawer: {}, mainPanel: {} },
    isOptimistic: false,
    transition: null,
    updateState: vi.fn(),
    restoreInitialScrollPosition: vi.fn(),
    setMainPanel: vi.fn(),
    openDiff: vi.fn(),
    handleFileRenamed: vi.fn(),
    openAcceptChanges: vi.fn(),
    openDrawer: vi.fn(),
  }),
}));
vi.mock('./composables', () => ({
  useCloseHandlers: vi.fn(),
  usePanelShortcuts: vi.fn(),
  useTabManagement: () => ({ isInTransition: false }),
  useWorkspaceLoader: () => ({
    get loadError() {
      return mocks.loadError;
    },
    clearLoadingState: vi.fn(),
  }),
}));
vi.mock('./composables/create-file-command', () => ({
  dispatchCreateFileRequest: vi.fn(),
  handleCommandPaletteCreateFile: vi.fn(),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => {
  const selectWorkspaceById = Object.assign(() => readable(mocks.workspace), {
    select: () => mocks.workspace,
  });
  return {
    selectActiveWorkspaceId: { select: () => null },
    selectWorkspaceById,
    selectWorkspaceIsEmpty: { select: () => false },
    selectIsNewWorkspaceSession: () => readable(false),
  };
});
vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectMainPanelView: () => readable(null),
}));
vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  clearMainPanelView: action('changes/clearMainPanelView'),
}));
vi.mock('$store/renderer/slices/setup-prompt/setup-prompt-selectors', () => ({
  selectBootRouteGateResolved: () => readable(true),
}));
vi.mock('$lib/utils/boot-route-gate', () => ({ isBootRouteLoad: () => false }));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectPanelVisibilityFlag: { select: () => true },
  selectSidebarSide: () => readable('left'),
}));
vi.mock('$store/renderer/slices/app-layout/app-layout-selectors', () => ({
  selectPendingCommandPaletteAction: () => readable(null),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutRoot: () => readable(null),
}));
vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: vi.fn() }));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openTab: vi.fn() }),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToFirstWorkspace: vi.fn() }));
vi.mock('$shared/types/branded-ids', () => ({ WorkspaceId: (id: string) => id }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  clearActiveWorkspace: action('workspace/clearActiveWorkspace'),
  loadWorkspacesRequested: action('workspace/loadWorkspacesRequested'),
  setActiveWorkspaceId: action('workspace/setActiveWorkspaceId'),
  setWorkspaceEntity: action('workspace/setWorkspaceEntity'),
}));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-slice', () => ({
  setPanelVisibility: action('uiLayout/setPanelVisibility'),
}));
vi.mock('$store/renderer/slices/note-read-tracking/note-read-tracking-slice', () => ({
  createNoteRequested: action('notes/createNoteRequested'),
}));
vi.mock('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice', () => ({
  workspaceUnmounted: action('workspace-lifecycle/workspaceUnmounted'),
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-slice', () => ({
  setOnboardingActive: action('sidebarNav/setOnboardingActive'),
}));
vi.mock('$store/renderer/slices/app-layout/app-layout-slice', () => ({
  commandPaletteActionConsumed: action('appLayout/commandPaletteActionConsumed'),
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-slice', () => ({
  setSidebarActiveTab: action('transientUi/setSidebarActiveTab'),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  createAgentRequested: action('workspaceAgents/createAgentRequested'),
  createAgentWithSpecialistRequested: action('workspaceAgents/createAgentWithSpecialistRequested'),
  setAgents: action('workspaceAgents/setAgents'),
  setAgentsLoaded: action('workspaceAgents/setAgentsLoaded'),
}));

vi.mock('$lib/components/workspace/WorkspaceLayout.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockWorkspaceLayoutShell.svelte')).default,
}));
vi.mock('$lib/components/workspace/SidebarSkeleton.svelte', mockPart('sidebar-skeleton'));
vi.mock('$lib/components/workspace/ContentSkeleton.svelte', mockPart('content-skeleton'));
vi.mock('$lib/components/workspace/MultiSelectTabbedSidebar.svelte', mockPart('valid-sidebar'));
vi.mock('$lib/components/workspace/WorkspaceModals.svelte', mockPart('modals'));
vi.mock('$lib/components/modals/InputDialog.svelte', mockPart('input-dialog'));
vi.mock('$lib/components/terminal/QuakeTerminalOverlay.svelte', mockPart('quake-terminal'));
vi.mock('$features/onboarding/OnboardingPage.svelte', mockPart('onboarding'));
vi.mock('$lib/components/layout/panel-system', async () => {
  const component = (await import('./__tests__/mocks/MockWorkspaceSurfacePart.svelte')).default;
  const renderPart = component as unknown as (anchor: Node, props: Record<string, unknown>) => void;
  return {
    PanelLayout: (anchor: Node, props: Record<string, unknown>) =>
      renderPart(anchor, { ...props, marker: 'valid-panel-layout' }),
  };
});

import WorkspaceSurface from './WorkspaceSurface.svelte';

function renderHost() {
  const result = render(WorkspaceSurface, { props: { workspaceId: 'workspace-1' } });
  const host = result.container.querySelector<HTMLElement>('[data-workspace-surface]')!;
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 960 },
    scrollWidth: { configurable: true, value: 960 },
  });
  return { ...result, host };
}

afterEach(cleanup);
beforeEach(() => {
  mocks.loadError = null;
  mocks.workspace = null;
  mocks.dispatch.mockClear();
});

describe('WorkspaceSurface terminal shell boundary', () => {
  it.each(['not_found', 'error'] as const)(
    'keeps the standard workspace shell-free for %s terminal state',
    (kind) => {
      mocks.loadError = {
        kind: kind as 'not_found' | 'error',
        message: kind === 'error' ? 'Backend unavailable' : 'Workspace not found',
      };
      const { container, host } = renderHost();
      const states = [
        ...container.querySelectorAll<HTMLElement>('[data-workspace-terminal-state]'),
      ];

      expect(states).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'All workspaces' })).toHaveLength(1);
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      expect(container.querySelector('[data-workspace-layout]')).toBeNull();
      expect(container.querySelector('[data-workspace-sidebar]')).toBeNull();
      expect(container.querySelector('[data-panel-canvas]')).toBeNull();
      expect(container.querySelector('[data-terminal-dock]')).toBeNull();
      expect(container.querySelector('[data-resize-handle]')).toBeNull();
      expect(
        container.querySelector('[data-workspace-surface-part="sidebar-skeleton"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-workspace-surface-part="content-skeleton"]'),
      ).toBeNull();
    },
  );

  it.each(['loading', 'valid'] as const)(
    'retains the standard workspace shell for %s state',
    (phase) => {
      mocks.workspace =
        phase === 'valid' ? { id: 'workspace-valid', title: 'Valid workspace' } : null;
      const { container, host } = renderHost();
      expect(container.querySelectorAll('[data-workspace-layout]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-workspace-sidebar]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-panel-canvas]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-terminal-dock]')).toHaveLength(1);
      expect(container.querySelector('[data-workspace-terminal-state]')).toBeNull();
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      expect(
        container.querySelectorAll(
          `[data-workspace-surface-part="${phase === 'loading' ? 'content-skeleton' : 'valid-panel-layout'}"]`,
        ),
      ).toHaveLength(1);
      expect(
        container.querySelectorAll(
          `[data-workspace-surface-part="${phase === 'loading' ? 'sidebar-skeleton' : 'valid-sidebar'}"]`,
        ),
      ).toHaveLength(1);
    },
  );
});

describe('WorkspaceSurface session lifecycle', () => {
  it('preserves workspace sessions across A→B→A selection and surface teardown', async () => {
    const view = render(WorkspaceSurface, { props: { workspaceId: 'workspace-a' } });

    await view.rerender({ workspaceId: 'workspace-b' });
    await view.rerender({ workspaceId: 'workspace-a' });
    view.unmount();

    const destructiveActionTypes = new Set([
      'workspace-lifecycle/workspaceUnmounted',
      'workspaceAgents/setAgents',
      'workspaceAgents/setAgentsLoaded',
    ]);
    const destructiveActions = mocks.dispatch.mock.calls
      .map(([dispatched]) => dispatched as { type?: string })
      .filter((dispatched) => dispatched.type && destructiveActionTypes.has(dispatched.type));

    expect(destructiveActions).toEqual([]);
  });
});
