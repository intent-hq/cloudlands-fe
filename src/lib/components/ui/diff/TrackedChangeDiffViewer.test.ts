import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  ChangeStage,
  type TrackedChange,
} from '$features/file-tracking/types';
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
    activeWorkspaceIdStore: createReadable('ws-1'),
  };
});

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: testState.dispatchMock,
  });
});

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: () => testState.activeWorkspaceStore,
  selectActiveWorkspaceId: () => testState.activeWorkspaceIdStore,
}));

vi.mock('$lib/store/slices/files/files-selectors', () => ({
  selectOriginalFileContent: Object.assign(vi.fn(() => testState.originalContentStore), {
    select: vi.fn(() => testState.originalContentStore.value),
  }),
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

vi.mock('$lib/services/analytics', () => ({
  track: vi.fn(),
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
});