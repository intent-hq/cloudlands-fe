/**
 * Regression tests for intent-hq/monorepo#1567: the sibling change/diff tab
 * types must not double-join Windows-absolute paths (drive-letter or UNC)
 * under the workspace root. Mirrors the FileTabType.test.ts pattern: assert
 * the exact path each component emits for a Windows-absolute in-root input,
 * plus the unchanged Unix behavior (relative joins, `/abs` passthrough).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const { createMockSelector, dispatchMock, mockReduxState, resetMockReduxState } = vi.hoisted(() => {
  const mockReduxState = {
    workspace: {
      id: 'ws-1',
      worktreePath: '/repo',
      repositoryPath: '/repo',
    } as { id: string; worktreePath: string; repositoryPath: string },
    ftChanges: [] as unknown[],
    ftCommits: [] as unknown[],
    activityChanges: [] as unknown[],
    gitRoots: [] as unknown[],
    secondaryRootGit: {
      status: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [{ path: 'src/root.ts', status: 'M', staged: false }],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      },
      commits: [],
      commitFiles: {},
      loading: false,
      error: null,
    },
  };

  function resetMockReduxState() {
    mockReduxState.workspace = {
      id: 'ws-1',
      worktreePath: '/repo',
      repositoryPath: '/repo',
    };
    mockReduxState.ftChanges = [];
    mockReduxState.ftCommits = [];
    mockReduxState.activityChanges = [];
    mockReduxState.gitRoots = [];
  }

  function isReadable(
    value: unknown,
  ): value is { subscribe: (run: (value: unknown) => void) => () => void } {
    return !!value && typeof value === 'object' && 'subscribe' in value;
  }

  function createMockSelector<T>(getter: (...args: unknown[]) => T) {
    const selector = (...args: unknown[]) => ({
      subscribe(run: (value: T) => void) {
        const argValues = [...args];
        const update = () => run(getter(...argValues));
        const subscriptions = args.flatMap((arg, index) =>
          isReadable(arg)
            ? [
                arg.subscribe((value) => {
                  argValues[index] = value;
                  update();
                }),
              ]
            : [],
        );

        if (subscriptions.length === 0) update();

        return () => {
          subscriptions.forEach((unsubscribe) => unsubscribe());
        };
      },
    });

    selector.select = (_state: unknown, ...args: unknown[]) => getter(...args);
    selector.effect = (..._args: unknown[]) => undefined;
    selector.withStore = () => selector;
    return selector;
  }

  const dispatchMock = vi.fn((action: unknown) => action);

  return { createMockSelector, dispatchMock, mockReduxState, resetMockReduxState };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: createMockSelector(() => mockReduxState.workspace),
  selectWorkspaceById: createMockSelector((wsId: unknown) =>
    wsId === mockReduxState.workspace.id ? mockReduxState.workspace : undefined,
  ),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectFileTrackingChanges: createMockSelector(() => mockReduxState.ftChanges),
  selectFileTrackingCommits: createMockSelector(() => mockReduxState.ftCommits),
  selectFileTrackingOlderCommits: createMockSelector(() => []),
  selectFileTrackingLoading: createMockSelector(() => false),
  selectFileTrackingBoundarySha: createMockSelector(() => null),
}));

vi.mock('$store/renderer/slices/git-roots/git-roots-selectors', () => ({
  selectGitRoots: createMockSelector(() => mockReduxState.gitRoots),
}));

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  emptySecondaryRootState: {
    status: null,
    commits: [],
    commitFiles: {},
    loading: false,
    error: null,
  },
  selectSecondaryRootGitRoots: createMockSelector(() => ({
    'root-9': mockReduxState.secondaryRootGit,
  })),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectLineWrapping: createMockSelector(() => false),
  selectFoldUnchanged: createMockSelector(() => false),
  selectDiffSideBySide: createMockSelector(() => false),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-slice', () => ({
  toggleLineWrapping: () => ({ type: 'uiLayout/toggleLineWrapping', payload: [] }),
  toggleFoldUnchanged: () => ({ type: 'uiLayout/toggleFoldUnchanged', payload: [] }),
  toggleDiffSideBySide: () => ({ type: 'uiLayout/toggleDiffSideBySide', payload: [] }),
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-slice', () => ({
  openTab: (...args: unknown[]) => ({ type: 'panelLayout/openTab', payload: args }),
  openTabInAdjacentOrSplit: (...args: unknown[]) => ({
    type: 'panelLayout/openTabInAdjacentOrSplit',
    payload: args,
  }),
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: createMockSelector(() => null),
}));

vi.mock('$store/renderer/slices/files/files-selectors', () => ({
  selectOriginalFileContent: createMockSelector(() => null),
}));

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: createMockSelector(() => 'monospace'),
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: createMockSelector(() => false),
}));

vi.mock('$store/renderer/slices/app-layout/app-layout-slice', () => ({
  requestPanelFocus: (...args: unknown[]) => ({
    type: 'appLayout/requestPanelFocus',
    payload: args,
  }),
  openAgentTabRequested: (...args: unknown[]) => ({
    type: 'appLayout/openAgentTabRequested',
    payload: args,
  }),
}));

vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-slice', () => ({
  openWorkspaceNote: (...args: unknown[]) => ({
    type: 'workspaceNavigation/openWorkspaceNote',
    payload: args,
  }),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  refreshRequested: (...args: unknown[]) => ({ type: 'changes/refreshRequested', payload: args }),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  loadGitStatus: (...args: unknown[]) => ({ type: 'git/loadGitStatus', payload: args }),
  loadSecondaryRootGit: (...args: unknown[]) => ({
    type: 'git/loadSecondaryRoot',
    payload: args,
  }),
}));

vi.mock('$features/git/git.client', () => ({
  gitClient: {
    getStatus: vi.fn(async () => ({
      ok: true,
      data: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [{ path: 'src/root.ts', status: 'M', staged: false }],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      },
    })),
    getHistory: vi.fn(async () => ({ ok: true, data: { items: [] } })),
    stageHunk: vi.fn(async () => ({ ok: true })),
    unstageHunk: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { commitDetails: vi.fn(async () => null) } },
}));

vi.mock('$features/git/git-cache', () => ({
  gitCache: { invalidateWorkspace: vi.fn() },
}));

vi.mock('$features/git/git-write-service', () => ({
  stageFiles: vi.fn(async () => ({ success: true })),
  unstageFiles: vi.fn(async () => ({ success: true })),
  discardFiles: vi.fn(async () => ({ success: true })),
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('$features/file-tracking/change-converters', () => ({
  eventToTrackedChange: () => mockReduxState.activityChanges,
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('$features/file-tracking/components/diff', async () => ({
  TrackedChangeDiffViewer: (await import('./mocks/MockTrackedChangeDiffViewer.svelte')).default,
}));

vi.mock('$lib/components/chat/ChatChangesPanel.svelte', async () => ({
  default: (await import('./mocks/MockChatChangesPanel.svelte')).default,
}));

vi.mock('$features/external-editors/components/OpenComboButton.svelte', async () => ({
  default: (await import('./mocks/MockOpenComboButton.svelte')).default,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

import MockTabTypeHeaderHarness from './mocks/MockTabTypeHeaderHarness.svelte';
import { stageFiles, unstageFiles, discardFiles } from '$features/git/git-write-service';
import ActivityChangesTabType from '../ActivityChangesTabType.svelte';
import DiffTabType from '../DiffTabType.svelte';
import LocalChangesTabType from '../LocalChangesTabType.svelte';
import ChatChangesTabType from '../ChatChangesTabType.svelte';
import ChangesTabType from '../ChangesTabType.svelte';

async function findOpenComboButton() {
  await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
  return screen.findByTestId('open-combo-button');
}

function setWindowsWorkspace() {
  mockReduxState.workspace = {
    id: 'ws-1',
    worktreePath: 'C:/repo',
    repositoryPath: 'C:/repo',
  };
}

function setUncWorkspace() {
  mockReduxState.workspace = {
    id: 'ws-1',
    worktreePath: '//server/share/repo',
    repositoryPath: '//server/share/repo',
  };
}

function makeTrackedChange(path: string, stage: string) {
  return {
    id: `change-${stage}-${path}`,
    file: path,
    relativePath: path,
    status: 'modified',
    stage,
    stats: { additions: 1, deletions: 1 },
    attribution: { timestamp: 0 },
    content: { oldContent: 'a', newContent: 'b', diff: '@@ -1 +1 @@\n-a\n+b' },
  };
}

async function findChangePaths(): Promise<string[]> {
  await screen.findByTestId('chat-changes-panel');
  return screen.getAllByTestId('chat-change').map((el) => el.getAttribute('data-file-path') ?? '');
}

describe('tab-type absolute path joins (intent-hq/monorepo#1567)', () => {
  beforeEach(() => {
    resetMockReduxState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('ActivityChangesTabType', () => {
    function renderActivity(changePath: string) {
      mockReduxState.activityChanges = [makeTrackedChange(changePath, 'committed')];
      return render(MockTabTypeHeaderHarness, {
        props: {
          component: ActivityChangesTabType,
          tab: {
            id: 'tab-activity',
            type: 'activity-changes',
            title: 'Activity',
            closable: true,
            data: { event: { id: 'ev-1', type: 'file:changed', timestamp: 0, data: {} } },
          },
          workspaceId: 'ws-1',
        },
      });
    }

    it('passes a Windows-absolute in-root path through without double-joining', async () => {
      setWindowsWorkspace();
      renderActivity('C:/repo/src/x.ts');

      const openButton = await findOpenComboButton();
      expect(openButton.getAttribute('data-file-path')).toBe('C:/repo/src/x.ts');
    });

    it('still joins relative paths and passes Unix-absolute paths through', async () => {
      renderActivity('src/x.ts');
      const openButton = await findOpenComboButton();
      expect(openButton.getAttribute('data-file-path')).toBe('/repo/src/x.ts');
    });

    it('passes a UNC in-root path through without double-joining', async () => {
      setUncWorkspace();
      renderActivity('\\\\server\\share\\repo\\src\\x.ts');

      const openButton = await findOpenComboButton();
      expect(openButton.getAttribute('data-file-path')).toBe('\\\\server\\share\\repo\\src\\x.ts');
    });
  });

  describe('DiffTabType', () => {
    function renderDiff(diffPath: string) {
      return render(MockTabTypeHeaderHarness, {
        props: {
          component: DiffTabType,
          tab: {
            id: 'tab-diff',
            type: 'diff',
            title: 'Diff',
            closable: true,
            diffPath,
            data: {},
          },
          workspaceId: 'ws-1',
        },
      });
    }

    it('passes a Windows-absolute in-root path through without double-joining', async () => {
      setWindowsWorkspace();
      renderDiff('C:/repo/src/x.ts');

      const openButton = await findOpenComboButton();
      expect(openButton.getAttribute('data-file-path')).toBe('C:/repo/src/x.ts');
    });

    it('forwards secondary-root scope and keeps hunk mutations disabled', async () => {
      render(MockTabTypeHeaderHarness, {
        props: {
          component: DiffTabType,
          tab: {
            id: 'tab-diff-root',
            type: 'diff',
            title: 'root.ts',
            closable: true,
            diffPath: 'src/root.ts',
            data: {
              gitRootId: 'root-9',
              gitRootPath: '/repo/packages/sub',
              change: makeTrackedChange('src/root.ts', 'unstaged'),
            },
          },
          workspaceId: 'ws-1',
        },
      });
      const viewer = await screen.findByTestId('tracked-change-diff-viewer');
      expect(viewer.getAttribute('data-git-root-id')).toBe('root-9');
      expect(viewer.getAttribute('data-git-root-path')).toBe('/repo/packages/sub');
      expect(screen.queryByTestId('stage-hunk')).toBeNull();
      expect(screen.queryByTestId('unstage-hunk')).toBeNull();
    });

    it('still joins relative paths under the workspace root', async () => {
      renderDiff('src/x.ts');
      const openButton = await findOpenComboButton();
      expect(openButton.getAttribute('data-file-path')).toBe('/repo/src/x.ts');
    });

    it('passes a UNC in-root path through without double-joining', async () => {
      setUncWorkspace();
      renderDiff('\\\\server\\share\\repo\\src\\x.ts');

      const openButton = await findOpenComboButton();
      expect(openButton.getAttribute('data-file-path')).toBe('\\\\server\\share\\repo\\src\\x.ts');
    });

    it.each([
      ['unstaged', 'stage-hunk'],
      ['staged', 'unstage-hunk'],
    ])(
      'dispatches one broad refresh after a successful %s hunk mutation',
      async (stage, testId) => {
        mockReduxState.ftChanges = [makeTrackedChange('src/x.ts', stage)];
        renderDiff('src/x.ts');

        await fireEvent.click(await screen.findByTestId(testId));
        await vi.waitFor(() => {
          expect(
            dispatchMock.mock.calls
              .map(([action]) => action)
              .filter(
                (action: any) =>
                  action.type === 'git/loadGitStatus' || action.type === 'changes/refreshRequested',
              ),
          ).toEqual([
            { type: 'git/loadGitStatus', payload: ['ws-1', true] },
            { type: 'changes/refreshRequested', payload: ['ws-1', true] },
          ]);
        });
      },
    );
  });

  describe('LocalChangesTabType', () => {
    function renderLocalChanges(unstagedPath: string, stagedPath: string, commitPath: string) {
      mockReduxState.ftChanges = [
        makeTrackedChange(unstagedPath, 'unstaged'),
        makeTrackedChange(stagedPath, 'staged'),
      ];
      mockReduxState.ftCommits = [
        {
          hash: 'abc123',
          message: 'commit message',
          timestamp: 0,
          files: [{ path: commitPath, additions: 1, deletions: 1 }],
        },
      ];
      return render(LocalChangesTabType, {
        props: {
          tab: { id: 'tab-local', type: 'local-changes', title: 'Local', closable: true },
          workspaceId: 'ws-1',
          isActive: true,
        },
      });
    }

    it('passes Windows-absolute in-root paths through at all three join sites', async () => {
      setWindowsWorkspace();
      renderLocalChanges('C:/repo/src/a.ts', 'C:/repo/src/b.ts', 'C:/repo/src/c.ts');

      expect(await findChangePaths()).toEqual([
        'C:/repo/src/a.ts',
        'C:/repo/src/b.ts',
        'C:/repo/src/c.ts',
      ]);
    });

    it('still joins relative paths under the workspace root', async () => {
      renderLocalChanges('src/a.ts', 'src/b.ts', 'src/c.ts');

      expect(await findChangePaths()).toEqual([
        '/repo/src/a.ts',
        '/repo/src/b.ts',
        '/repo/src/c.ts',
      ]);
    });

    it('passes UNC in-root paths through at all three join sites', async () => {
      setUncWorkspace();
      renderLocalChanges(
        '\\\\server\\share\\repo\\src\\a.ts',
        '\\\\server\\share\\repo\\src\\b.ts',
        '\\\\server\\share\\repo\\src\\c.ts',
      );

      expect(await findChangePaths()).toEqual([
        '\\\\server\\share\\repo\\src\\a.ts',
        '\\\\server\\share\\repo\\src\\b.ts',
        '\\\\server\\share\\repo\\src\\c.ts',
      ]);
    });

    it('sends repo-relative paths on the wire for backslash-form Windows absolutes', async () => {
      setWindowsWorkspace();
      renderLocalChanges('C:\\repo\\src\\a.ts', 'C:\\repo\\src\\b.ts', 'C:\\repo\\src\\c.ts');

      await screen.findByTestId('chat-changes-panel');
      const [stageButton] = screen.getAllByTestId('stage-button');
      const [, unstageButton] = screen.getAllByTestId('unstage-button');
      const [revertButton] = screen.getAllByTestId('revert-button');

      await fireEvent.click(stageButton);
      expect(stageFiles).toHaveBeenCalledWith('ws-1', ['src/a.ts']);

      await fireEvent.click(unstageButton);
      expect(unstageFiles).toHaveBeenCalledWith('ws-1', ['src/b.ts']);

      await fireEvent.click(revertButton);
      expect(discardFiles).toHaveBeenCalledWith('ws-1', ['src/a.ts']);
    });

    it('sends repo-relative paths on the wire for forward-slash Windows absolutes', async () => {
      setWindowsWorkspace();
      renderLocalChanges('C:/repo/src/a.ts', 'C:/repo/src/b.ts', 'C:/repo/src/c.ts');

      await screen.findByTestId('chat-changes-panel');
      const [stageButton] = screen.getAllByTestId('stage-button');

      await fireEvent.click(stageButton);
      expect(stageFiles).toHaveBeenCalledWith('ws-1', ['src/a.ts']);
    });

    it('loads secondary-root paths and forwards the read-only root scope', async () => {
      mockReduxState.gitRoots = [
        { id: 'root-9', path: '/repo/packages/sub', registeredCommitSha: 'bound111' },
      ];
      render(LocalChangesTabType, {
        props: {
          tab: {
            id: 'tab-local-root',
            type: 'local-changes',
            title: 'Local',
            closable: true,
            data: { gitRootId: 'root-9' },
          },
          workspaceId: 'ws-1',
          isActive: true,
        },
      });

      const panel = await screen.findByTestId('chat-changes-panel');
      await vi.waitFor(async () =>
        expect(await findChangePaths()).toEqual(['/repo/packages/sub/src/root.ts']),
      );
      expect(panel.getAttribute('data-git-root-id')).toBe('root-9');
      expect(panel.getAttribute('data-git-root-path')).toBe('/repo/packages/sub');
      expect(panel.getAttribute('data-show-staging-controls')).toBe('false');
    });

    it('renders secondary-root working-tree line counts without mutation controls', async () => {
      mockReduxState.gitRoots = [{ id: 'root-9', path: '/repo/packages/sub' }];
      mockReduxState.secondaryRootGit.status.files = [
        { path: 'src/root.ts', status: 'M', staged: false, additions: 7, deletions: 3 } as never,
      ];
      render(LocalChangesTabType, {
        props: {
          tab: {
            id: 'tab-local-root',
            type: 'local-changes',
            title: 'Local',
            closable: true,
            data: { gitRootId: 'root-9' },
          },
          workspaceId: 'ws-1',
          isActive: true,
        },
      });
      const row = await screen.findByTestId('chat-change');
      expect(row.getAttribute('data-additions')).toBe('7');
      expect(row.getAttribute('data-deletions')).toBe('3');
      expect(
        (await screen.findByTestId('chat-changes-panel')).getAttribute(
          'data-show-staging-controls',
        ),
      ).toBe('false');
    });
  });

  describe('ChatChangesTabType', () => {
    function renderChatChanges(filePath: string) {
      return render(ChatChangesTabType, {
        props: {
          tab: {
            id: 'tab-chat',
            type: 'chat-changes',
            title: 'Chat',
            closable: true,
            data: {
              changes: [{ filePath, toolCallId: 'tc-1', action: 'modify' }],
            },
          },
          workspaceId: 'ws-1',
        },
      });
    }

    it('passes a Windows-absolute in-root path through without double-joining', async () => {
      setWindowsWorkspace();
      renderChatChanges('C:/repo/src/x.ts');

      expect(await findChangePaths()).toEqual(['C:/repo/src/x.ts']);
    });

    it('still joins relative paths under the workspace root', async () => {
      renderChatChanges('src/x.ts');
      expect(await findChangePaths()).toEqual(['/repo/src/x.ts']);
    });

    it('passes a UNC in-root path through without double-joining', async () => {
      setUncWorkspace();
      renderChatChanges('\\\\server\\share\\repo\\src\\x.ts');

      expect(await findChangePaths()).toEqual(['\\\\server\\share\\repo\\src\\x.ts']);
    });
  });

  describe('ChangesTabType', () => {
    function renderChanges(commitFilePath: string) {
      mockReduxState.ftCommits = [
        {
          hash: 'abc123',
          message: 'commit message',
          timestamp: 0,
          files: [{ path: commitFilePath, additions: 1, deletions: 1 }],
        },
      ];
      return render(ChangesTabType, {
        props: {
          tab: {
            id: 'tab-changes',
            type: 'changes',
            title: 'Changes',
            closable: true,
            data: { commitHash: 'abc123', commitMessage: 'commit message' },
          },
          workspaceId: 'ws-1',
          isActive: true,
        },
      });
    }

    it('passes a Windows-absolute in-root path through without double-joining', async () => {
      setWindowsWorkspace();
      renderChanges('C:/repo/src/x.ts');

      expect(await findChangePaths()).toEqual(['C:/repo/src/x.ts']);
    });

    it('still joins relative paths under the workspace root', async () => {
      renderChanges('src/x.ts');
      expect(await findChangePaths()).toEqual(['/repo/src/x.ts']);
    });

    it('passes a UNC in-root path through without double-joining', async () => {
      setUncWorkspace();
      renderChanges('\\\\server\\share\\repo\\src\\x.ts');

      expect(await findChangePaths()).toEqual(['\\\\server\\share\\repo\\src\\x.ts']);
    });
  });
});
