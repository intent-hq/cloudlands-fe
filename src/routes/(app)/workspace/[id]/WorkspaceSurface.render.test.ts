import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadState: { status: 'idle', error: null } as {
    status: 'idle' | 'loading' | 'cached-ready' | 'optimistic' | 'ready' | 'not-found' | 'error';
    error: null | { kind: 'not_found' | 'error'; message: string };
  },
  workspace: null as null | { id: string; title: string },
  dispatch: vi.fn(),
  usePanelShortcuts: vi.fn(),
}));
const action = vi.hoisted(
  () => (type: string) => Object.assign((...payload: unknown[]) => ({ type, payload }), { type }),
);
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
  usePanelShortcuts: mocks.usePanelShortcuts,
  useTabManagement: () => ({ isInTransition: false }),
}));

vi.mock('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors', () => {
  const selectWorkspaceLoadResult = Object.assign(() => readable(mocks.workspace), {
    select: () => mocks.workspace,
  });
  return {
    selectWorkspaceLoadResult,
    selectWorkspaceLoadState: () => readable(mocks.loadState),
  };
});
vi.mock('./composables/create-file-command', () => ({
  dispatchCreateFileRequest: vi.fn(),
  handleCommandPaletteCreateFile: vi.fn(),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => {
  return {
    selectActiveWorkspaceId: { select: () => null },
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
  loadWorkspacesRequested: action('workspace/loadWorkspacesRequested'),
}));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-slice', () => ({
  setPanelVisibility: action('uiLayout/setPanelVisibility'),
}));
vi.mock('$store/renderer/slices/note-read-tracking/note-read-tracking-slice', () => ({
  createNoteRequested: action('notes/createNoteRequested'),
}));
vi.mock('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice', () => ({
  workspaceLoadRequested: action('workspace-lifecycle/workspaceLoadRequested'),
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
vi.mock('$lib/components/layout/panel-system', async () => {
  const component = (await import('./__tests__/mocks/MockWorkspaceSurfacePart.svelte')).default;
  const renderPart = component as unknown as (anchor: Node, props: Record<string, unknown>) => void;
  return {
    PanelLayout: (anchor: Node, props: Record<string, unknown>) =>
      renderPart(anchor, { ...props, marker: 'valid-panel-layout' }),
  };
});

import WorkspaceSurface from './WorkspaceSurface.svelte';
import { workspaceLoadRequested } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

function renderHost(workspaceId = 'workspace-1') {
  const result = render(WorkspaceSurface, { props: { workspaceId } });
  const host = result.container.querySelector<HTMLElement>('[data-workspace-surface]')!;
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 960 },
    scrollWidth: { configurable: true, value: 960 },
  });
  return { ...result, host };
}

afterEach(cleanup);
beforeEach(() => {
  mocks.loadState = { status: 'idle', error: null };
  mocks.workspace = null;
  mocks.dispatch.mockClear();
  mocks.usePanelShortcuts.mockClear();
});

describe('WorkspaceSurface terminal shell boundary', () => {
  it.each(['not_found', 'error'] as const)(
    'keeps the standard workspace shell-free for %s terminal state',
    (kind) => {
      mocks.loadState = {
        status: kind === 'not_found' ? 'not-found' : 'error',
        error: {
          kind,
          message: kind === 'error' ? 'Backend unavailable' : 'Workspace not found',
        },
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

  it('renders loading selector state with the standard shell and skeletons', () => {
    mocks.loadState = { status: 'loading', error: null };
    const { container, host } = renderHost();
    expect(container.querySelectorAll('[data-workspace-layout]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-workspace-sidebar]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-panel-canvas]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-terminal-dock]')).toHaveLength(1);
    expect(container.querySelector('[data-workspace-terminal-state]')).toBeNull();
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    expect(
      container.querySelectorAll('[data-workspace-surface-part="content-skeleton"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-workspace-surface-part="sidebar-skeleton"]'),
    ).toHaveLength(1);
  });

  it.each(['cached-ready', 'ready'] as const)(
    'renders the canonical workspace result for %s selector state',
    (status) => {
      mocks.loadState = { status, error: null };
      mocks.workspace = { id: 'workspace-valid', title: 'Valid workspace' };
      const { container, host } = renderHost();
      expect(container.querySelectorAll('[data-workspace-layout]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-workspace-sidebar]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-panel-canvas]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-terminal-dock]')).toHaveLength(1);
      expect(container.querySelector('[data-workspace-terminal-state]')).toBeNull();
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      expect(
        container.querySelectorAll('[data-workspace-surface-part="valid-panel-layout"]'),
      ).toHaveLength(1);
      expect(
        container.querySelectorAll('[data-workspace-surface-part="valid-sidebar"]'),
      ).toHaveLength(1);
    },
  );

  it('keeps optimistic presentation in the shell without a loaded sidebar', () => {
    mocks.loadState = { status: 'optimistic', error: null };
    mocks.workspace = { id: 'optimistic-1', title: 'Creating workspace' };
    const { container } = renderHost('optimistic-1');

    expect(container.querySelector('[data-workspace-layout]')).toBeTruthy();
    expect(container.querySelector('[data-workspace-terminal-state]')).toBeNull();
    expect(
      container.querySelector('[data-workspace-surface-part="content-skeleton"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-workspace-surface-part="valid-sidebar"]')).toBeNull();
    expect(container.querySelector('[data-workspace-surface-part="sidebar-skeleton"]')).toBeNull();
  });
});

describe('WorkspaceSurface session lifecycle', () => {
  it('dispatches canonical load intent while preserving A→B→A sessions', async () => {
    const view = render(WorkspaceSurface, { props: { workspaceId: 'workspace-a' } });

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(workspaceLoadRequested('workspace-a')),
    );
    await view.rerender({ workspaceId: 'workspace-b' });
    await view.rerender({ workspaceId: 'workspace-a' });
    await waitFor(() => {
      const loadActions = mocks.dispatch.mock.calls
        .map(([dispatched]) => dispatched)
        .filter(
          (dispatched) => (dispatched as { type?: string }).type === workspaceLoadRequested.type,
        );
      expect(loadActions).toEqual([
        workspaceLoadRequested('workspace-a'),
        workspaceLoadRequested('workspace-b'),
        workspaceLoadRequested('workspace-a'),
      ]);
    });
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

  it.each(['', 'undefined', 'new'])(
    'does not dispatch load intent for non-loadable route %j',
    async (workspaceId) => {
      render(WorkspaceSurface, { props: { workspaceId } });
      await Promise.resolve();
      expect(mocks.dispatch).not.toHaveBeenCalledWith(workspaceLoadRequested(workspaceId));
    },
  );

  it('gates inactive shortcuts and active-only chrome while retaining the panel tree', () => {
    mocks.loadState = { status: 'ready', error: null };
    mocks.workspace = { id: 'inactive-workspace', title: 'Inactive' };

    const { container } = render(WorkspaceSurface, {
      props: { workspaceId: 'inactive-workspace', active: false },
    });

    const shortcutConfig = mocks.usePanelShortcuts.mock.calls.at(-1)?.[0] as {
      enabled: boolean;
    };
    expect(shortcutConfig.enabled).toBe(false);
    expect(
      container
        .querySelector('[data-workspace-surface-part="valid-panel-layout"]')
        ?.getAttribute('data-active'),
    ).toBe('false');
    expect(container.querySelector('[data-workspace-surface-part="valid-sidebar"]')).toBeNull();
    expect(container.querySelector('[data-workspace-surface-part="quake-terminal"]')).toBeNull();
    expect(container.querySelector('[data-workspace-surface-part="modals"]')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(workspaceLoadRequested('inactive-workspace'));
  });
});
