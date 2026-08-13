/**
 * @vitest-environment jsdom
 */
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import {
  connectionStatusChanged,
  daemonHealthReducer,
  initialState as daemonHealthInitialState,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const invoke = vi.fn().mockResolvedValue({ success: true });
  const selector = <T>(value: T) =>
    Object.assign(
      () => ({
        subscribe(run: (current: T) => void) {
          run(value);
          return () => {};
        },
      }),
      { select: () => value },
    );
  return { dispatch, invoke, selector };
});

const editors: InstalledEditor[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    priority: 100,
    installed: true,
  },
];

let mockStoreState: Record<string, unknown>;

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockStoreState, dispatch: mocks.dispatch });
});

vi.mock('$lib/utils/platform-capabilities', () => ({ hasCapability: () => true }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentWorkspaceId: mocks.selector('ws-1'),
  selectStagedWorkingChanges: mocks.selector([]),
  selectUnstagedWorkingChanges: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectActiveTab: mocks.selector(null),
  selectAllTabs: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => ({
  selectWorkspaceScriptEntries: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectActiveTerminalIdForWorkspace: mocks.selector(null),
  selectTerminalsForWorkspace: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/app-layout/app-layout-selectors', () => ({
  selectPendingLocateInSidebar: mocks.selector(null),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selector([]),
  selectForegroundWorkspaceAgents: mocks.selector([]),
  selectIsLoadingAgents: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: mocks.selector(false),
  selectAgentIsWaiting: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/file-explorer/file-explorer-selectors', () => ({
  selectEffectiveFileExplorerWorkspacePath: mocks.selector('/tmp/project'),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: mocks.selector({
    id: 'ws-1',
    title: 'Project',
    path: '/tmp/project',
    worktreePath: '/tmp/project',
    skipWorktree: false,
  }),
  selectWorkspaceActivePullRequest: mocks.selector(null),
  selectIsWorkspaceHostLocal: mocks.selector(true),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selector([]),
  selectNotesLoading: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectMultiSelectSidebarSelectedTabIds: mocks.selector(['files']),
  selectMultiSelectSidebarTabOrder: mocks.selector([
    'overview',
    'agents',
    'context',
    'changes',
    'files',
  ]),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskProgress: mocks.selector(null),
}));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openTab: vi.fn() }),
}));
vi.mock('../workspace-phase', () => ({
  deriveWorkspacePhase: () => ({
    phase: 'planning',
    label: 'Planning',
    subtitle: 'Plan',
    isActive: false,
  }),
  deriveWorkspaceStats: () => ({
    tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
    files: { changed: 0, additions: 0, deletions: 0 },
    commits: { total: 0, unpushed: 0 },
    pr: { hasOpen: false, hasMerged: false, hasClosed: false },
  }),
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('../../ui/__tests__/mocks/button.svelte')).default,
}));
vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('../../ui/__tests__/mocks/dropdown-menu.svelte')).default,
}));

vi.mock('../CreateAgentSection.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../WorkspaceAgentsList.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../sidebar/AddContextSection.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../sidebar/ContextPanel.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../sidebar/WorkspaceProgressCard.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/input/input.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../sidebar', async () => {
  const simple = (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default;
  const filesPanel = (await import('./mocks/FilesPanel.svelte')).default;
  return { FilesPanel: filesPanel, SidebarChangesPanel: simple, isSpecNote: () => false };
});

warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/button.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/dropdown-menu.svelte'));
warmImport(() => import('./mocks/FilesPanel.svelte'));
warmImport(() => import('../MultiSelectTabbedSidebar.svelte'));

describe('MultiSelectTabbedSidebar Files Open In', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const localHealth = daemonHealthReducer(
      {
        ...daemonHealthInitialState,
        transport: { mode: 'external-ws', target: 'wss://remote.example' },
        hostLocality: 'remote',
      },
      connectionStatusChanged('connected', {
        mode: 'sidecar-uds',
        target: '/tmp/intentd.sock',
      }),
    );
    mockStoreState = {
      daemonHealth: localHealth,
      externalEditors: {
        selectedAction: 'vscode',
        editors: createCollection<InstalledEditor, 'id'>('id', editors),
        hiddenEditorIds: [],
        loading: false,
        error: null,
        lastFetched: 0,
      },
    };
  });

  it('opens the Files path dropdown and routes the installed editor action', async () => {
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container, getByTitle, getByText } = render(Sidebar, {
      props: { workspaceId: 'ws-1' },
    });

    await fireEvent.click(getByTitle('Open in Visual Studio Code'));
    await waitFor(() => expect(container.querySelector('.dropdown-content')).toBeTruthy());
    expect(getByText('Other')).toBeTruthy();
    expect(getByText('Copy path')).toBeTruthy();

    await fireEvent.click(getByText('Visual Studio Code'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('vscode:open', '/tmp/project'));
  });
});
