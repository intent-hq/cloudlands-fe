import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import TrackedChangeDiffViewer from './TrackedChangeDiffViewer.svelte';

const testState = vi.hoisted(() => {
  function createReadable<T>(initialValue: T) {
    let value = initialValue;
    const subscribers = new Set<(value: T) => void>();
    return {
      get value() {
        return value;
      },
      set(nextValue: T) {
        value = nextValue;
        subscribers.forEach((subscriber) => subscriber(value));
      },
      subscribe(subscriber: (value: T) => void) {
        subscribers.add(subscriber);
        subscriber(value);
        return () => subscribers.delete(subscriber);
      },
    };
  }

  return {
    dispatchMock: vi.fn(),
    invokeMock: vi.fn(),
    batchedGitDiffMock: vi.fn(),
    batchedGitBranchBaseDiffMock: vi.fn(),
    dedupedShowFileMock: vi.fn(),
    originalContentStore: createReadable<string | null>(null),
    activeWorkspaceStore: createReadable({ id: 'ws-1', worktreePath: '/repo' }),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: testState.dispatchMock,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: () => testState.activeWorkspaceStore,
  selectWorkspaceById: () => testState.activeWorkspaceStore,
}));

vi.mock('$store/renderer/slices/files/files-selectors', () => ({
  selectOriginalFileContent: Object.assign(
    vi.fn(() => testState.originalContentStore),
    {
      select: vi.fn(() => testState.originalContentStore.value),
    },
  ),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: testState.invokeMock,
}));

vi.mock('./diff-ipc-batcher', () => ({
  batchedGitDiff: testState.batchedGitDiffMock,
  batchedGitBranchBaseDiff: testState.batchedGitBranchBaseDiffMock,
  dedupedShowFile: testState.dedupedShowFileMock,
}));

vi.mock('./DiffViewer.svelte', async () => {
  const MockDiffViewer = (await import('./__tests__/mocks/MockDiffViewer.svelte')).default;
  return { default: MockDiffViewer, hashContent: (content: string) => String(content.length) };
});

vi.mock('$lib/components/ui/skeleton', async () => {
  const MockSimple = (await import('./__tests__/mocks/MockSimple.svelte')).default;
  return { Skeleton: MockSimple };
});

vi.mock('svelte-fa', async () => {
  const MockSimple = (await import('./__tests__/mocks/MockSimple.svelte')).default;
  return { default: MockSimple };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faExclamationTriangle: {},
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

function createChange(overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: 'change-1',
    file: 'src/app.ts',
    relativePath: 'src/app.ts',
    stage: ChangeStage.Unstaged,
    stats: { additions: 1, deletions: 1 },
    attribution: { timestamp: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.originalContentStore.set(null);
  testState.invokeMock.mockResolvedValue({ success: true, data: { content: 'disk content' } });
  testState.batchedGitDiffMock.mockResolvedValue(undefined);
  testState.batchedGitBranchBaseDiffMock.mockResolvedValue(undefined);
  testState.dedupedShowFileMock.mockResolvedValue({ success: true, data: 'index content' });
});

afterEach(() => cleanup());

describe('TrackedChangeDiffViewer content loading regressions', () => {
  it('uses provided chat diff content without dispatching a full file-content load', async () => {
    render(TrackedChangeDiffViewer, {
      props: {
        change: createChange({ content: { oldContent: 'before', newContent: 'after' } }),
        workspaceId: 'ws-1',
        useProvidedContent: true,
      },
    });

    await waitFor(() => expect(screen.getByTestId('new-content').textContent).toBe('after'));

    expect(testState.dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files/loadFileContentRequested' }),
    );
    expect(testState.batchedGitDiffMock).not.toHaveBeenCalled();
  });

  it('renders a gitlink (submodule) pseudo-diff from hunk lines without show-file/file:read (#1739)', async () => {
    testState.batchedGitDiffMock.mockResolvedValue({
      file: 'packages/intentd',
      chunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [
            {
              type: 'Deletion',
              content: 'Subproject commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
              oldNumber: 1,
            },
            {
              type: 'Addition',
              content: 'Subproject commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
              newNumber: 1,
            },
          ],
        },
      ],
    });

    render(TrackedChangeDiffViewer, {
      props: {
        change: createChange({ file: 'packages/intentd', relativePath: 'packages/intentd' }),
        workspaceId: 'ws-1',
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('new-content').textContent).toBe(
        'Subproject commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
      ),
    );

    expect(screen.getByTestId('old-content').textContent).toBe(
      'Subproject commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    );
    // A gitlink has no blob and its path is a directory: neither the
    // show-file fallback nor any working-tree read may fire — including the
    // Redux-dispatched loadFileContentRequested that feeds filesReadSaga.
    expect(testState.dedupedShowFileMock).not.toHaveBeenCalled();
    expect(testState.invokeMock).not.toHaveBeenCalledWith(
      'file:read',
      expect.objectContaining({ path: '/repo/packages/intentd' }),
    );
    expect(testState.dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files/loadFileContentRequested' }),
    );
  });

  it('renders a status-marked gitlink from git.status pin SHAs when hunks do not classify (#1739)', async () => {
    // Diff chunk exists but its hunks are empty (e.g. dirty submodule
    // worktree): the git.status gitlink metadata must still route to the pin
    // presentation instead of the show-file/file:read fallbacks.
    testState.batchedGitDiffMock.mockResolvedValue({
      file: 'packages/intentd',
      chunks: [],
    });

    render(TrackedChangeDiffViewer, {
      props: {
        change: createChange({
          file: 'packages/intentd',
          relativePath: 'packages/intentd',
          gitlink: { mode: '160000', oldSha: 'a'.repeat(40), newSha: 'b'.repeat(40) },
        }),
        workspaceId: 'ws-1',
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('new-content').textContent).toBe(
        `Subproject commit ${'b'.repeat(40)}\n`,
      ),
    );

    expect(screen.getByTestId('old-content').textContent).toBe(
      `Subproject commit ${'a'.repeat(40)}\n`,
    );
    expect(testState.dedupedShowFileMock).not.toHaveBeenCalled();
    expect(testState.invokeMock).not.toHaveBeenCalledWith(
      'file:read',
      expect.objectContaining({ path: '/repo/packages/intentd' }),
    );
    expect(testState.dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files/loadFileContentRequested' }),
    );
  });

  it('renders a status-marked gitlink pin change when git:diff has no chunk at either stage (#1739)', async () => {
    testState.batchedGitDiffMock.mockResolvedValue(undefined);

    render(TrackedChangeDiffViewer, {
      props: {
        change: createChange({
          file: 'packages/intentd',
          relativePath: 'packages/intentd',
          gitlink: { mode: '160000', oldSha: 'a'.repeat(40), newSha: 'b'.repeat(40) },
        }),
        workspaceId: 'ws-1',
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('new-content').textContent).toBe(
        `Subproject commit ${'b'.repeat(40)}\n`,
      ),
    );

    expect(screen.getByTestId('old-content').textContent).toBe(
      `Subproject commit ${'a'.repeat(40)}\n`,
    );
    expect(testState.dedupedShowFileMock).not.toHaveBeenCalled();
    expect(testState.dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files/loadFileContentRequested' }),
    );
  });

  it('falls back to disk-backed working-tree content instead of unsaved Redux content', async () => {
    testState.originalContentStore.set('unsaved editor buffer');
    testState.batchedGitDiffMock.mockResolvedValue({
      file: 'src/app.ts',
      oldContent: 'index before',
      newContent: '',
    });
    testState.invokeMock.mockResolvedValue({ success: true, data: { content: 'disk after' } });

    render(TrackedChangeDiffViewer, {
      props: {
        change: createChange(),
        workspaceId: 'ws-1',
      },
    });

    await waitFor(() => expect(screen.getByTestId('new-content').textContent).toBe('disk after'));

    expect(screen.getByTestId('new-content').textContent).not.toBe('unsaved editor buffer');
    expect(testState.invokeMock).toHaveBeenCalledWith('file:read', {
      workspaceId: 'ws-1',
      path: '/repo/src/app.ts',
    });
  });

  it('passes secondary-root identity and path to working-tree diff reads', async () => {
    testState.batchedGitDiffMock.mockResolvedValue({
      file: 'src/app.ts',
      oldContent: 'before',
      newContent: 'after',
    });

    render(TrackedChangeDiffViewer, {
      props: {
        change: createChange({
          file: '/repo/packages/sub/src/app.ts',
          relativePath: '/repo/packages/sub/src/app.ts',
        }),
        workspaceId: 'ws-1',
        gitRootId: 'root-9',
        gitRootPath: '/repo/packages/sub',
      },
    });

    await waitFor(() =>
      expect(testState.batchedGitDiffMock).toHaveBeenCalledWith('ws-1', false, 'src/app.ts', {
        gitlink: undefined,
        gitRootId: 'root-9',
        gitRootPath: '/repo/packages/sub',
      }),
    );
  });
});
