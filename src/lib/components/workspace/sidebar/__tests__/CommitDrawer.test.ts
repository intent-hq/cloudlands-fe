import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import {
  render,
  fireEvent,
  waitFor,
} from '@testing-library/svelte';
import type { TrackedChange } from '$features/file-tracking/types';
import { ChangeStage } from '$features/file-tracking/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const sidebarChanges = {
    commitWhenReady: false,
    createPRWhenReady: false,
    mergeWhenReady: false,
    pendingAutoAction: null as unknown,
    postMergeState: null as unknown,
    gitOperations: {},
  };
  const executorState = { status: 'idle', result: null, error: null, agentId: null };
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return { dispatch, sidebarChanges, executorState, selector };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectSidebarCommitWhenReady: mocks.selector(() => mocks.sidebarChanges.commitWhenReady),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/changes/changes-slice')>()),
  setSidebarCommitWhenReady: vi.fn((...args: unknown[]) => ({ type: 'changes/setSidebarCommitWhenReady', payload: args })),
}));

vi.mock('$store/renderer/slices/background-agent-executor/background-agent-executor-selectors', () => ({
  selectExecutorState: mocks.selector(() => mocks.executorState),
}));

vi.mock('$store/renderer/slices/background-agent-executor/background-agent-executor-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/background-agent-executor/background-agent-executor-slice')>()),
  executeBackgroundAgent: vi.fn((...args: unknown[]) => ({ type: 'backgroundAgentExecutor/execute', payload: args })),
  cancelExecution: vi.fn((...args: unknown[]) => ({ type: 'backgroundAgentExecutor/cancel', payload: args })),
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), custom: vi.fn(), info: vi.fn() },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return new Proxy(actual, {
    get: (target, prop) => {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      return { iconName: String(prop), prefix: 'fas', icon: [0, 0, [], '', ''] };
    },
  });
});

function makeChange(path: string, stage = ChangeStage.Staged): TrackedChange {
  return {
    id: `change-${path}`,
    file: path,
    relativePath: path,
    stage,
    stats: { additions: 1, deletions: 0 },
    attribution: { timestamp: Date.now() },
  };
}

async function renderDrawer(overrides: Partial<Record<string, unknown>> = {}) {
  const CommitDrawer = (await import('../CommitDrawer.svelte')).default;
  const onCommit = vi.fn();
  const defaults = {
    workspaceId: 'ws-1',
    commitMessage: 'chore: test message',
    isCommitting: false,
    commitDrawerOpen: true,
    hasStaged: true,
    stagedChanges: [makeChange('src/a.ts')],
    onCommit,
  };
  const result = render(CommitDrawer, { props: { ...defaults, ...overrides } });
  return { ...result, onCommit };
}

describe('CommitDrawer', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.sidebarChanges.commitWhenReady = false;
    mocks.executorState.status = 'idle';
    mocks.executorState.agentId = null;
  });

  function findSubmitCommitBtn(container: HTMLElement) {
    return Array.from(container.querySelectorAll('button')).find(
      (b) => b.querySelector('[data-icon="code-commit"]') !== null,
    ) as HTMLButtonElement | undefined;
  }

  it('fires onCommit when the commit button is clicked', async () => {
    const { container, onCommit } = await renderDrawer();
    await waitFor(() => expect(container.textContent).toContain('will be committed'));
    const commitBtn = findSubmitCommitBtn(container);
    expect(commitBtn).toBeDefined();
    await fireEvent.click(commitBtn!);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('disables the commit button when the message is blank', async () => {
    const { container } = await renderDrawer({ commitMessage: '   ' });
    const commitBtn = findSubmitCommitBtn(container);
    expect(commitBtn).toBeDefined();
    expect(commitBtn!.disabled).toBe(true);
  });

  it('dispatches setSidebarCommitWhenReady when the auto-commit toggle is clicked while generating', async () => {
    mocks.executorState.status = 'running';
    mocks.executorState.agentId = 'agent-42';
    const { container } = await renderDrawer();
    const toggleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Auto-commit when done'),
    );
    expect(toggleBtn).toBeDefined();
    await fireEvent.click(toggleBtn!);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'changes/setSidebarCommitWhenReady',
        payload: ['ws-1', true],
      }),
    );
  });

});
