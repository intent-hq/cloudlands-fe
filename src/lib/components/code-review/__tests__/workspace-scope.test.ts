import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedChange } from '$features/file-tracking/types';

const mocks = vi.hoisted(() => {
  function readable<T>(value: T) {
    return {
      subscribe(run: (next: T) => void) {
        run(value);
        return () => {};
      },
    };
  }

  type ReadableValue<T> = { subscribe(run: (next: T) => void): () => void };

  function mapReadable<T, U>(source: ReadableValue<T>, map: (value: T) => U) {
    return {
      subscribe(run: (next: U) => void) {
        return source.subscribe((value) => run(map(value)));
      },
    };
  }

  const workspaceA = { id: 'ws-a', worktreePath: '/workspace-a' };
  const workspaceB = { id: 'ws-b', worktreePath: '/workspace-b' };
  const workspaceForId = (workspaceId: string) =>
    workspaceId === workspaceA.id
      ? workspaceA
      : workspaceId === workspaceB.id
        ? workspaceB
        : undefined;
  const defaultExecutorState = { status: 'idle', result: null, error: null };
  const executorStates: Record<
    string,
    Record<string, { status: string; result: string | null; error: string | null }>
  > = {};
  const executorStateFor = (workspaceId: string, executorType: string) =>
    executorStates[workspaceId]?.[executorType] ?? defaultExecutorState;
  const selectWorkspaceById = Object.assign(
    vi.fn((workspaceId: string | ReadableValue<string>) =>
      typeof workspaceId === 'string'
        ? readable(workspaceForId(workspaceId))
        : mapReadable(workspaceId, workspaceForId),
    ),
    {
      select: vi.fn((_state: unknown, workspaceId: string) => workspaceForId(workspaceId)),
    },
  );
  const selectExecutorState = Object.assign(
    vi.fn((workspaceId: string | ReadableValue<string>, executorType: string) =>
      typeof workspaceId === 'string'
        ? readable(executorStateFor(workspaceId, executorType))
        : mapReadable(workspaceId, (id) => executorStateFor(id, executorType)),
    ),
    {
      select: vi.fn((_state: unknown, workspaceId: string, executorType: string) =>
        executorStateFor(workspaceId, executorType),
      ),
    },
  );
  const stagedB: TrackedChange[] = [
    {
      id: 'change-b',
      file: 'src/b.ts',
      relativePath: 'src/b.ts',
      stage: 'staged',
      stats: { additions: 1, deletions: 0 },
      attribution: { timestamp: 0 },
    },
  ];

  return {
    workspaceA,
    workspaceB,
    stagedB,
    dispatch: vi.fn(),
    executeBackgroundAgent: vi.fn((...payload: unknown[]) => ({
      type: 'bgExecutor/execute',
      payload,
    })),
    cancelExecution: vi.fn((...payload: unknown[]) => ({
      type: 'bgExecutor/cancel',
      payload,
    })),
    batchedGitDiff: vi.fn(),
    activeWorkspace: readable(workspaceA),
    executorStates,
    selectWorkspaceById,
    selectExecutorState,
    stagedChanges: readable(stagedB),
    executorState: readable(defaultExecutorState),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: () => mocks.activeWorkspace,
  selectWorkspaceById: mocks.selectWorkspaceById,
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentStagedWorkingChanges: (workspaceId: string) => {
    expect(workspaceId).toBe('ws-b');
    return mocks.stagedChanges;
  },
}));

vi.mock(
  '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors',
  () => ({ selectExecutorState: mocks.selectExecutorState }),
);

vi.mock('$store/renderer/slices/background-agent-executor/background-agent-executor-slice', () => ({
  executeBackgroundAgent: mocks.executeBackgroundAgent,
  cancelExecution: mocks.cancelExecution,
}));

vi.mock('$features/file-tracking/components/diff/diff-ipc-batcher', () => ({
  batchedGitDiff: mocks.batchedGitDiff,
}));

vi.mock('../walkthrough/WalkthroughCategorySection.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('../walkthrough/WalkthroughCategoriesGrid.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('../walkthrough/WalkthroughFileDiff.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));

import CodeReviewTabContent from '../CodeReviewTabContent.svelte';
import CodeReviewPanel from '../CodeReviewPanel.svelte';
import CodeWalkthroughSection from '../walkthrough/CodeWalkthroughSection.svelte';

const walkthroughA = {
  title: 'Workspace A walkthrough',
  overview: 'Workspace A changes',
  annotations: [],
  categories: [],
};

const walkthrough = {
  title: 'Workspace B walkthrough',
  overview: 'Workspace B changes',
  annotations: [],
  categories: [
    {
      title: 'B changes',
      description: 'Only workspace B',
      files: [{ path: 'src/b.ts', annotations: [] }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const workspaceId of Object.keys(mocks.executorStates)) {
    delete mocks.executorStates[workspaceId];
  }
  mocks.batchedGitDiff.mockResolvedValue({
    file: 'src/b.ts',
    oldContent: 'before',
    newContent: 'after',
  });
});

afterEach(() => cleanup());

describe('code-review workspace propagation', () => {
  it('clears workspace A walkthrough when the mounted panel changes to idle workspace B', async () => {
    mocks.executorStates['ws-a'] = {
      walkthrough: {
        status: 'success',
        result: JSON.stringify(walkthroughA),
        error: null,
      },
    };
    mocks.executorStates['ws-b'] = {
      walkthrough: { status: 'idle', result: null, error: null },
    };

    const panel = render(CodeReviewPanel, {
      props: { workspaceId: 'ws-a', review: null, status: 'idle' },
    });

    expect(await screen.findByText('Workspace A walkthrough')).toBeTruthy();

    await panel.rerender({ workspaceId: 'ws-b', review: null, status: 'idle' });

    await waitFor(() => {
      expect(screen.queryByText('Workspace A walkthrough')).toBeNull();
    });

    await panel.rerender({ workspaceId: null, review: null, status: 'idle' });
    expect(screen.queryByText('Workspace A walkthrough')).toBeNull();
  });

  it('uses explicit workspace B for staged review actions while active workspace is A', async () => {
    render(CodeReviewTabContent, { props: { workspaceId: 'ws-b' } });

    const startReview = await screen.findByRole('button');
    await fireEvent.click(startReview);

    expect(mocks.selectWorkspaceById).toHaveBeenCalledWith('ws-b');
    expect(mocks.executeBackgroundAgent).toHaveBeenCalledWith('ws-b', 'review', {
      files: ['src/b.ts'],
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'bgExecutor/execute',
      payload: ['ws-b', 'review', { files: ['src/b.ts'] }],
    });
  });

  it('uses explicit workspace B for every walkthrough diff request while active workspace is A', async () => {
    render(CodeWalkthroughSection, {
      props: {
        walkthrough,
        status: 'complete',
        workspaceId: 'ws-b',
        workspacePath: '/workspace-b',
        changes: mocks.stagedB,
      },
    });

    await waitFor(() => {
      expect(mocks.batchedGitDiff).toHaveBeenCalledWith('ws-b', true, 'src/b.ts');
    });
    expect(mocks.batchedGitDiff).not.toHaveBeenCalledWith('ws-a', true, 'src/b.ts');
  });
});
