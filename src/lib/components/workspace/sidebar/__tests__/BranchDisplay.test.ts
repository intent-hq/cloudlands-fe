import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { warmImport } from '../../../../../test/warm-import';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

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

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: Object.assign(
    () => ({
      subscribe(run: (v: unknown) => void) {
        run(mocks.workspaceEntity);
        return () => {};
      },
    }),
    { select: () => mocks.workspaceEntity },
  ),
  selectWorkspaceMutation: mocks.selector(() => ({ loading: false, error: null, version: 0 })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((...args: unknown[]) => ({
    type: 'workspace/setWorkspaceEntity',
    payload: args,
  })),
  renameWorkspaceBranchRequested: vi.fn((...args: unknown[]) => ({
    type: 'workspace/renameBranchRequested',
    payload: args,
  })),
  updateWorkspaceRequested: vi.fn((...args: unknown[]) => ({
    type: 'workspace/updateRequested',
    payload: args,
  })),
}));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  custom: vi.fn(),
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: mockToast,
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: mockToast,
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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockBranchSelector.svelte'));
warmImport(() => import('./mocks/MockTooltip.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../BranchDisplay.svelte'));

describe('BranchDisplay', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.workspaceEntity.branch = 'feature/branch';
  });

  it('affirms repository branch metadata and alignment in every required visual state', async () => {
    const observed = await exerciseVisualStates(async () => {
      const view = await renderBranchDisplay({ trunkBranch: 'develop' });
      const target = view.container.querySelector<HTMLButtonElement>('button')!;
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(target.textContent).toContain('feature/branch');
          expect(
            view.container
              .querySelector('[data-testid="branch-selector"]')
              ?.getAttribute('data-value'),
          ).toBe('develop');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
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

  it('Enter with an invalid branch name shows a toast error and does not request a rename', async () => {
    const { container } = await renderBranchDisplay();
    await fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(container.querySelector('input[type="text"]')).toBeTruthy());

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'bad..name' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/renameBranchRequested' }),
    );
  });

  it('Escape while editing cancels without requesting a rename', async () => {
    const { container } = await renderBranchDisplay();
    await fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(container.querySelector('input[type="text"]')).toBeTruthy());

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'other' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(container.querySelector('input[type="text"]')).toBeFalsy());
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/renameBranchRequested' }),
    );
  });

  it('BranchSelector onchange dispatches the baseRef update request', async () => {
    const { container } = await renderBranchDisplay({ canChangeTrunk: true });
    const changeBtn = container.querySelector(
      '[data-testid="branch-selector-change"]',
    ) as HTMLButtonElement;
    await fireEvent.click(changeBtn);

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'workspace/updateRequested',
        payload: ['ws-1', { baseRef: 'develop' }, 'base-ref'],
      }),
    );
  });

  it('dispatches a branch rename request with the trimmed branch name', async () => {
    const { container } = await renderBranchDisplay();
    await fireEvent.click(container.querySelector('button')!);
    const input = container.querySelector('input')!;
    await fireEvent.input(input, { target: { value: ' feature/renamed ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'workspace/renameBranchRequested',
        payload: ['ws-1', 'feature/renamed'],
      }),
    );
  });

  it('shift-copy preserves full long values without renaming or unlocking the target', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const longBranch = 'feature/a-long-working-branch-that-is-truncated-only-visually';
    mocks.workspaceEntity.branch = longBranch;
    const { container } = await renderBranchDisplay({
      canChangeTrunk: false,
      trunkBranch: 'release/locked-target',
    });
    await fireEvent.click(container.querySelector('button')!, { shiftKey: true });
    expect(writeText).toHaveBeenCalledWith(longBranch);
    expect(container.querySelector('[data-branch-field="working"] input')).toBeNull();
    const target = container.querySelector<HTMLInputElement>('[data-branch-field="target"] input')!;
    expect(target.readOnly).toBe(true);
    await fireEvent.click(target, { shiftKey: true });
    expect(writeText).toHaveBeenLastCalledWith('release/locked-target');
    expect(container.querySelector('[data-testid="branch-selector"]')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/renameBranchRequested' }),
    );
  });

  it('with canChangeTrunk=false renders the read-only trunk and never calls workspace.update', async () => {
    const { notify } = await import('$lib/components/patterns/notify');
    vi.mocked(notify.error).mockClear();

    const { container } = await renderBranchDisplay({ canChangeTrunk: false, trunkBranch: 'main' });

    expect(container.querySelector('[data-testid="branch-selector"]')).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('[data-branch-field="target"] input')?.value,
    ).toBe('main');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('with isOwner=false never enters branch-rename mode', async () => {
    const { container } = await renderBranchDisplay({ isOwner: false, canChangeTrunk: false });
    const branchBtn = container.querySelector(
      '[data-testid="branch-name-button"]',
    ) as HTMLButtonElement;
    expect(branchBtn?.textContent).toContain('feature/branch');
    await fireEvent.click(branchBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('ignores a BranchSelector onchange echoing the current trunk (no workspace.update)', async () => {
    const { notify } = await import('$lib/components/patterns/notify');
    vi.mocked(notify.error).mockClear();

    // MockBranchSelector always reports 'develop'; make that the current trunk
    // so the change is an echo of the initial auto-selection.
    const { container } = await renderBranchDisplay({
      canChangeTrunk: true,
      trunkBranch: 'develop',
    });
    const changeBtn = container.querySelector(
      '[data-testid="branch-selector-change"]',
    ) as HTMLButtonElement;
    await fireEvent.click(changeBtn);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/setWorkspaceEntity' }),
    );
    expect(notify.error).not.toHaveBeenCalled();
  });
});
