/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileTreeView from '../file-tree-view.svelte';
import { warmImport } from '../../../../test/warm-import';

const {
  appStore,
  createReadable,
  dispatchMock,
  error$,
  initializationInputs$,
  initializeFileExplorerMock,
  loadGitStatusMock,
  shouldInitializeState,
  workspacePath$,
} = vi.hoisted(() => {
  function createReadable<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<(value: T) => void>();
    return {
      subscribe(fn: (value: T) => void) {
        subscribers.add(fn);
        fn(value);
        return () => subscribers.delete(fn);
      },
      set(next: T) {
        value = next;
        for (const fn of subscribers) fn(value);
      },
      get value() {
        return value;
      },
    };
  }

  type InitializationInputs = {
    workspacePath: string;
    currentWorkspacePath: string;
    isLoading: boolean;
    isInitialized: boolean;
  };

  const shouldInitializeState = { value: true };
  const initialInputs: InitializationInputs = {
    workspacePath: '/repo',
    currentWorkspacePath: '',
    isLoading: false,
    isInitialized: false,
  };
  const initializationInputs$ = createReadable(initialInputs);
  const error$ = createReadable<string | null>(null);
  const workspacePath$ = createReadable('/repo');

  return {
    appStore: { state: {}, dispatch: vi.fn() },
    createReadable,
    dispatchMock: vi.fn(),
    error$,
    initializeFileExplorerMock: vi.fn((...payload: unknown[]) => ({
      type: 'fileExplorer/initializeFileExplorer',
      payload,
    })),
    initializationInputs$,
    loadGitStatusMock: vi.fn((...payload: unknown[]) => ({ type: 'git/loadGitStatus', payload })),
    shouldInitializeState,
    workspacePath$,
  };
});

vi.mock('$store/renderer/store', () => ({ store: appStore }));
vi.mock('$lib/utils/client-logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));
vi.mock('$lib/utils/file-type-icons', () => ({ getFileTypeIconSvg: () => '' }));
vi.mock('../VirtualizedFileTree.svelte', async () => ({
  default: (await import('../../chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$store/renderer/slices/git/git-slice', () => ({ loadGitStatus: loadGitStatusMock }));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  getPanelTabOpenState: () => ({
    count: 0,
    isOpen: false,
    isActive: false,
    isOpenElsewhere: false,
  }),
}));
vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectGitStatus: { select: vi.fn(() => null) },
}));
vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentStagedWorkingChanges: () => createReadable([]),
  selectCurrentUnstagedWorkingChanges: () => createReadable([]),
}));
vi.mock('$store/renderer/slices/file-explorer/file-explorer-slice', () => ({
  initializeFileExplorer: initializeFileExplorerMock,
  toggleDirectoryRequested: vi.fn(),
  removeExpandedPath: vi.fn(),
  expandToPathRequested: vi.fn(),
  expandAllRequested: vi.fn(),
  clearExpandedPathsExceptRoot: vi.fn(),
  syncGitStatusFromStoresRequested: vi.fn(),
  fileSearchRequested: (...payload: unknown[]) => ({
    type: 'fileExplorer/fileSearchRequested',
    payload,
  }),
  fileSearchReleased: (...payload: unknown[]) => ({
    type: 'fileExplorer/fileSearchReleased',
    payload,
  }),
}));
vi.mock('$store/renderer/slices/file-explorer/file-explorer-selectors', () => ({
  selectFileExplorerRootNode: () => createReadable(null),
  selectFileExplorerIsLoading: () => createReadable(false),
  selectFileExplorerIsInitialized: () => createReadable(true),
  selectFileExplorerError: () => error$,
  selectFileExplorerSearch: () => createReadable(undefined),
  selectFileExplorerGitStatus: () => createReadable({}),
  selectFlattenedNodes: () => createReadable([]),
  selectHasExpandedDirectories: { select: vi.fn(() => false) },
  selectEffectiveFileExplorerWorkspacePath: Object.assign(
    vi.fn(() => workspacePath$),
    {
      select: vi.fn(() => workspacePath$.value),
    },
  ),
  selectFileExplorerInitializationInputs: Object.assign(
    vi.fn(() => initializationInputs$),
    {
      select: vi.fn(() => initializationInputs$.value),
    },
  ),
  selectShouldInitializeFileExplorerForWorkspace: {
    select: vi.fn(() => shouldInitializeState.value),
  },
}));

function initializationDispatches() {
  return dispatchMock.mock.calls.filter(
    ([action]) => action.type === 'fileExplorer/initializeFileExplorer',
  );
}

async function renderTree() {
  const view = render(FileTreeView, { props: { workspaceId: 'ws-1' } });
  await waitFor(() => expect(initializationDispatches()).toHaveLength(1));
  return view;
}

async function markInitializationSettled() {
  shouldInitializeState.value = false;
  initializationInputs$.set({
    workspacePath: '/repo',
    currentWorkspacePath: '/repo',
    isLoading: false,
    isInitialized: true,
  });
  await waitFor(() => expect(initializationDispatches()).toHaveLength(1));
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../chat/__tests__/mocks/SlotOnly.svelte'));

describe('FileTreeView initialization trigger', () => {
  beforeEach(() => {
    dispatchMock.mockReset();
    appStore.dispatch = dispatchMock;
    shouldInitializeState.value = true;
    error$.set(null);
    initializationInputs$.set({
      workspacePath: '/repo',
      currentWorkspacePath: '',
      isLoading: false,
      isInitialized: false,
    });
    workspacePath$.set('/repo');
  });

  afterEach(() => cleanup());

  it('keeps a stable per-tree search consumer and releases the old workspace on switch and teardown', async () => {
    shouldInitializeState.value = false;
    const first = render(FileTreeView, { workspaceId: 'ws-1', searchQuery: 'first' });
    const second = render(FileTreeView, { workspaceId: 'ws-1', searchQuery: 'second' });
    const requests = () =>
      dispatchMock.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'fileExplorer/fileSearchRequested');
    await waitFor(() => expect(requests()).toHaveLength(2));
    const consumer = requests()[0].payload[1];
    expect(requests()[1].payload[1]).not.toBe(consumer);
    await first.rerender({ workspaceId: 'ws-2', searchQuery: 'next' });
    expect(requests().at(-1).payload).toEqual(['ws-2', consumer, expect.any(String), 'next']);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'fileExplorer/fileSearchReleased',
      payload: ['ws-1', consumer],
    });
    first.unmount();
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'fileExplorer/fileSearchReleased',
      payload: ['ws-2', consumer],
    });
    second.unmount();
  });

  it('does not duplicate dispatches while a request for the same path is pending', async () => {
    await renderTree();

    shouldInitializeState.value = false;
    initializationInputs$.set({
      workspacePath: '/repo',
      currentWorkspacePath: '/repo',
      isLoading: true,
      isInitialized: false,
    });
    await waitFor(() => expect(initializationDispatches()).toHaveLength(1));

    shouldInitializeState.value = true;
    initializationInputs$.set({
      workspacePath: '/repo',
      currentWorkspacePath: '/repo',
      isLoading: false,
      isInitialized: false,
    });

    await waitFor(() => expect(initializationDispatches()).toHaveLength(1));
  });

  it('shows a retryable error and dispatches initialization again when Retry is clicked', async () => {
    const view = await renderTree();

    error$.set('Unable to load files.');
    const retry = await view.findByRole('button', { name: 'Retry' });
    await fireEvent.click(retry);

    expect(view.getByText('Unable to load files.')).toBeTruthy();
    expect(initializationDispatches()).toHaveLength(2);
  });

  it.each([
    [
      'cleared state',
      {
        workspacePath: '/repo',
        currentWorkspacePath: '',
        isLoading: false,
        isInitialized: false,
      },
    ],
  ])('dispatches when %s makes the internal gate true again', async (_caseName, nextInputs) => {
    await renderTree();
    await markInitializationSettled();

    shouldInitializeState.value = true;
    initializationInputs$.set(nextInputs);

    await waitFor(() => expect(initializationDispatches()).toHaveLength(2));
  });
});
