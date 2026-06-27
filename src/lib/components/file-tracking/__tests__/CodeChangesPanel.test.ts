import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import type { TrackedChange } from '$features/file-tracking/types';
import { ChangeStage } from '$features/file-tracking/types';

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// ─── Hoisted mock state ──────────────────────────────────────────────────────
const { store, mockStageFiles, mockDispatch, makeSelector } = vi.hoisted(() => {
  const store = {
    staged: [] as any[],
    unstaged: [] as any[],
    currentWsId: 'ws-1' as string | null,
  };
  const makeSelector = <T>(getter: () => T) => {
    const fn = (..._a: any[]) => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    (fn as any).select = () => getter();
    (fn as any).effect = () => {};
    (fn as any).withStore = () => fn;
    return fn;
  };
  return {
    store,
    mockStageFiles: vi.fn(() => Promise.resolve({ success: true })),
    mockDispatch: vi.fn(),
    makeSelector,
  };
});

// ─── git-write-service seam ──────────────────────────────────────────────────
vi.mock('$features/git/git-write-service', () => ({
  stageFiles: mockStageFiles,
  commit: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ uiLayout: { collapsiblePanelCollapsed: {} } }),
    dispatch: mockDispatch,
  });
});

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentStagedWorkingChanges: makeSelector(() => store.staged),
  selectCurrentUnstagedWorkingChanges: makeSelector(() => store.unstaged),
  selectCurrentCommits: makeSelector(() => []),
  selectCurrentLoading: makeSelector(() => false),
  selectMainPanelView: makeSelector(() => null),
  selectAcceptChangesState: makeSelector(() => ({ backgroundOperation: null })),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  setMainPanelView: vi.fn((v: any) => ({ type: 'changes/setMainPanelView', payload: v })),
  unstageChangesRequested: vi.fn((...a: any[]) => ({ type: 'changes/unstageChangesRequested', payload: a })),
  revertChangeRequested: vi.fn((...a: any[]) => ({ type: 'changes/revertChangeRequested', payload: a })),
  loadWorkspaceDataRequested: vi.fn((...a: any[]) => ({ type: 'changes/loadWorkspaceDataRequested', payload: a })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: makeSelector(() => store.currentWsId),
}));

vi.mock('$store/renderer/slices/workspace-settings/workspace-settings-selectors', () => ({
  selectAutoCommitEnabled: makeSelector(() => false),
}));

vi.mock('$store/renderer/slices/workspace-settings/workspace-settings-slice', () => ({
  setAutoCommitEnabled: vi.fn((...a: any[]) => ({ type: 'ws-settings/setAutoCommitEnabled', payload: a })),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  loadGitStatus: vi.fn((...a: any[]) => ({ type: 'git/loadStatus', payload: a })),
}));

vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-slice', () => ({
  openWorkspaceAcceptChanges: vi.fn((...a: any[]) => ({ type: 'nav/acceptChanges', payload: a })),
  openWorkspaceDiff: vi.fn((...a: any[]) => ({ type: 'nav/diff', payload: a })),
}));

vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/Fa.svelte')).default }));

vi.mock('@fortawesome/free-solid-svg-icons', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return new Proxy(actual, {
    get: (t, p) => (p in t ? (t as any)[p] : { iconName: String(p), prefix: 'fas', icon: [0, 0, [], '', ''] }),
  });
});

vi.mock('svelte-sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));

vi.mock('$lib/utils/logger', () => ({
  Logger: class { info() {} warn() {} error() {} debug() {} },
}));

vi.mock('../FileChangesList.svelte', async () => ({
  default: (await import('./mocks/MockFileChangesList.svelte')).default,
}));

function makeChange(overrides: Partial<TrackedChange> & { relativePath: string }): TrackedChange {
  return {
    id: overrides.id ?? `change-${overrides.relativePath}`,
    file: overrides.relativePath,
    relativePath: overrides.relativePath,
    stage: overrides.stage ?? ChangeStage.Unstaged,
    stats: overrides.stats ?? { additions: 1, deletions: 0 },
    attribution: overrides.attribution ?? { timestamp: Date.now() },
    ...overrides,
  } as TrackedChange;
}

async function renderPanel(props: Record<string, any> = {}) {
  const CodeChangesPanel = (await import('../CodeChangesPanel.svelte')).default;
  return render(CodeChangesPanel, { props: { workspaceId: 'ws-1', ...props } });
}

describe('CodeChangesPanel git-write-service routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.staged = [];
    store.unstaged = [];
    store.currentWsId = 'ws-1';
  });

  it('routes single-file stage through the git-write-service seam', async () => {
    store.unstaged = [makeChange({ relativePath: 'src/foo.ts' })];
    const { container } = await renderPanel();
    await waitFor(() => expect(container.querySelector('[data-testid="stage-btn"]')).toBeTruthy());
    await fireEvent.click(container.querySelector('[data-testid="stage-btn"]')!);
    expect(mockStageFiles).toHaveBeenCalledWith('ws-1', ['src/foo.ts']);
  });

  it('routes "Stage all" through the git-write-service seam', async () => {
    store.unstaged = [makeChange({ relativePath: 'src/a.ts' }), makeChange({ relativePath: 'src/b.ts' })];
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain('Unstaged'));
    // The "Stage all" action button is icon-only (faPlus); the Fa mock renders
    // its icon name as data-icon, so target the innermost button around it.
    const stageAll = container.querySelector('[data-icon="plus"]')?.closest('button');
    expect(stageAll).toBeTruthy();
    await fireEvent.click(stageAll!);
    expect(mockStageFiles).toHaveBeenCalledWith('ws-1', ['src/a.ts', 'src/b.ts']);
  });

  it('keeps unstage on the legacy dispatch path (BE-gated)', async () => {
    store.staged = [makeChange({ relativePath: 'src/foo.ts', stage: ChangeStage.Staged })];
    const { container } = await renderPanel();
    await waitFor(() => expect(container.querySelector('[data-testid="unstage-btn"]')).toBeTruthy());
    await fireEvent.click(container.querySelector('[data-testid="unstage-btn"]')!);
    expect(mockStageFiles).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changes/unstageChangesRequested' }),
    );
  });

  it('keeps revert on the legacy dispatch path (BE-gated)', async () => {
    store.unstaged = [makeChange({ relativePath: 'src/foo.ts' })];
    const { container } = await renderPanel();
    await waitFor(() => expect(container.querySelector('[data-testid="revert-btn"]')).toBeTruthy());
    await fireEvent.click(container.querySelector('[data-testid="revert-btn"]')!);
    expect(mockStageFiles).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changes/revertChangeRequested' }),
    );
  });
});
