/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: {
      panelLayout: {
        byWorkspaceId: {
          'workspace-1': {
            root: { type: 'panel', panelId: 'panel-1' },
            panels: {},
            focusedPanelId: 'panel-1',
            layoutHistory: [],
            historyIndex: 0,
          },
        },
      },
    },
  },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: () => readable(false),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-slice', () => ({
  startDrag: () => ({ type: 'tabState/startDrag' }),
  endDrag: () => ({ type: 'tabState/endDrag' }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectRecentlyClosed: () => readable([]),
  selectPanelColumnCount: () => readable(1),
  selectPanelLayoutWorkspace: {
    select: (state: any) => state.panelLayout.byWorkspaceId['workspace-1'],
  },
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: () => null },
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  filterPickableSpecialists: (value: unknown[]) => value,
  selectSpecialistName: { select: () => null },
  selectSpecialists: () => readable([]),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => readable(false),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: () => null },
  selectIsWorkspaceHostLocal: () => readable(true),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => readable([]),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: () => readable(false),
  selectAgentIsBlockedWaiting: () => readable(false),
  selectAgentAttentionRequest: () => readable(null),
  selectAgentSession: () => readable(null),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: () => readable([]),
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import PanelTabBar from '../PanelTabBar.svelte';
import { setDraggedPanelId } from '../panel-drag';

const tabs = [{ id: 'tab-1', type: 'file' as const, title: 'File', closable: true }];

function renderTabBar(showTabStrip = false) {
  return render(PanelTabBar, {
    props: {
      tabs,
      activeTabId: 'tab-1',
      panelId: 'panel-1',
      workspaceId: 'workspace-1',
      showTabStrip,
      onTabClose: vi.fn(),
      onClosePanel: vi.fn(),
    },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.dispatch.mockClear();
  setDraggedPanelId(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setDraggedPanelId(null);
  cleanup();
});

describe('panel header double-click expansion', () => {
  it('dispatches one toggle per double-click, including rapid expand and restore', async () => {
    const { container } = renderTabBar();
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;

    await fireEvent.dblClick(header);
    await fireEvent.dblClick(header);

    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'panelLayout/toggleExpandPanel', payload: ['workspace-1', 'panel-1'] },
      { type: 'panelLayout/toggleExpandPanel', payload: ['workspace-1', 'panel-1'] },
    ]);
  });

  it('uses blank tab-bar space but ignores tabs and header action buttons', async () => {
    const { container } = renderTabBar(true);
    const tabBar = container.querySelector<HTMLElement>('[data-panel-tab-bar]')!;
    await fireEvent.dblClick(container.querySelector<HTMLElement>('[data-tab-id="tab-1"]')!);
    await fireEvent.dblClick(
      container.querySelector<HTMLElement>('[data-testid="panel-close-button"]')!,
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await fireEvent.dblClick(tabBar);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'panelLayout/toggleExpandPanel',
      payload: ['workspace-1', 'panel-1'],
    });
  });

  it('does not toggle while a panel drag is active', async () => {
    const { container } = renderTabBar();
    setDraggedPanelId('panel-1');
    await fireEvent.dblClick(container.querySelector('[data-panel-tabless-header]')!);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
