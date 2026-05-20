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

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const workspaceEntity = {
    id: 'ws-1',
    branch: 'feature/branch',
    baseRef: 'main',
    repositoryPath: '/repo',
  } as Record<string, unknown>;
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return { dispatch, workspaceEntity, selector };
});

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: Object.assign(
    () => ({
      subscribe(run: (v: unknown) => void) {
        run(mocks.workspaceEntity);
        return () => {};
      },
    }),
    { select: () => mocks.workspaceEntity },
  ),
}));

vi.mock('$lib/store/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((...args: unknown[]) => ({ type: 'workspace/setWorkspaceEntity', payload: args })),
}));

const mockUpdate = vi.fn().mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
vi.mock('$lib/store/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mockUpdate },
}));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), custom: vi.fn() },
}));

vi.mock('$lib/components/workspace/initializer/BranchSelector.svelte', async () => {
  const { default: MockComponent } = await import('./mocks/MockBranchSelector.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/ui/tooltip', async () => {
  const Tooltip = (await import('./mocks/MockTooltip.svelte')).default;
  return { Tooltip };
});

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

const mockInvoke = vi.fn();

async function renderBranchDisplay(overrides: Partial<Record<string, unknown>> = {}) {
  const BranchDisplay = (await import('../BranchDisplay.svelte')).default;
  const defaults = {
    workspaceId: 'ws-1',
    trunkBranch: 'main',
    repoPath: '/repo',
    repoType: 'github' as const,
    canChangeTrunk: true,
  };
  return render(BranchDisplay, { props: { ...defaults, ...overrides } });
}

describe('BranchDisplay', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mockUpdate.mockClear();
    mockUpdate.mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
    mockInvoke.mockReset();
    mocks.workspaceEntity.branch = 'feature/branch';

    // Mock window.electronAPI.invoke
    (window as unknown as { electronAPI: { invoke: typeof mockInvoke } }).electronAPI = {
      invoke: mockInvoke,
    };
  });

  it('renders the workspace branch and trunk branch', async () => {
    const { container } = await renderBranchDisplay({ trunkBranch: 'develop' });
    const branchBtn = container.querySelector('button');
    expect(branchBtn?.textContent).toContain('feature/branch');
    const selector = container.querySelector('[data-testid="branch-selector"]');
    expect(selector?.getAttribute('data-value')).toBe('develop');
  });

  it('clicking the branch button switches to input mode', async () => {
    const { container } = await renderBranchDisplay();
    const branchBtn = container.querySelector('button')!;
    await fireEvent.click(branchBtn);
    await waitFor(() => {
      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('feature/branch');
    });
  });

  it('Enter with a valid new branch name invokes IPC and dispatches setWorkspaceEntity', async () => {
    mockInvoke.mockResolvedValue({ success: true });
    const newEntity = { ...mocks.workspaceEntity, branch: 'feature/renamed' };
    mockUpdate.mockResolvedValue({ ok: true, data: newEntity });

    const { container } = await renderBranchDisplay();
    await fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(container.querySelector('input[type="text"]')).toBeTruthy());

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'feature/renamed' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const [channel, payload] = mockInvoke.mock.calls[0];
    expect(channel).toMatch(/rename/i);
    expect(payload).toEqual({ id: 'ws-1', newBranchName: 'feature/renamed' });

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature/renamed' })),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/setWorkspaceEntity' }),
    );
  });

  it('Enter with an invalid branch name shows a toast error and does not call IPC', async () => {
    const { toast } = await import('$lib/components/ui/toast');

    const { container } = await renderBranchDisplay();
    await fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(container.querySelector('input[type="text"]')).toBeTruthy());

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'bad..name' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('Escape while editing cancels without calling IPC', async () => {
    const { container } = await renderBranchDisplay();
    await fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(container.querySelector('input[type="text"]')).toBeTruthy());

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'other' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(container.querySelector('input[type="text"]')).toBeFalsy());
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('BranchSelector onchange persists baseRef and dispatches setWorkspaceEntity', async () => {
    mockUpdate.mockResolvedValue({
      ok: true,
      data: { ...mocks.workspaceEntity, baseRef: 'develop' },
    });

    const { container } = await renderBranchDisplay({ canChangeTrunk: true });
    const changeBtn = container.querySelector('[data-testid="branch-selector-change"]') as HTMLButtonElement;
    await fireEvent.click(changeBtn);

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ baseRef: 'develop' })),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/setWorkspaceEntity' }),
    );
  });
});
