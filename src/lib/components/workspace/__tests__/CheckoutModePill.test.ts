/**
 * @vitest-environment jsdom
 *
 * CheckoutModePill tests. The pill shows the real `checkoutMode`: "CoW" for
 * `'cow'` whatever the `workspace.cowIsolation` setting says (per-agent CoW
 * sandboxes are retired), "Worktree" for `'worktree'`, "Direct" for
 * `'direct'`, and nothing at all when the field is absent
 * (non-daemon-provisioned checkouts).
 *
 * When a workspace is provided, opening the tooltip fetches the footprint
 * on demand via `appClient.workspaces.diskUsage` (`workspace.diskUsage`,
 * PROTOCOL §5.1) — list/get rows no longer carry it (monorepo#1396). While a
 * walk is in flight, loading and refreshing states follow the response.
 * Fetches retarget when the workspace changes and stop after unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Workspace } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { warmImport } from '../../../../test/warm-import';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { initialState as workspaceInitialState } from '$store/renderer/slices/workspace/workspace-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';

const fixture = vi.hoisted(() => ({ state: null as StoreState | null }));

const mocks = vi.hoisted(() => ({
  runShrinkWorkspaceAction: vi.fn().mockResolvedValue(undefined),
  diskUsage: vi.fn(),
  settingsGet: vi.fn(),
  hidesAgentLifecycleActions: false,
}));

vi.mock('../shrink-workspace-action', () => ({
  runShrinkWorkspaceAction: mocks.runShrinkWorkspaceAction,
}));

vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('./mocks/MockTooltipWithContent.svelte')).default,
}));

// The component reaches the daemon through the appClient seam (via the
// disk-usage-poll action module); mock it so no request leaves the test.
// `settings.get` is mocked only to prove the pill never reads
// `workspace.cowIsolation`.
vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: { diskUsage: mocks.diskUsage },
    settings: { get: mocks.settingsGet },
  },
}));

// Use the real selector construction against an admitted fixture snapshot;
// administrative settings reads require the current Owner, not a saved row.
vi.mock('$store/renderer/store', async () => {
  const { Store } = await import('@themislib/themis/svelte-store');
  const selectorStore = new Store();
  return {
    store: {
      createSelector: selectorStore.createSelector.bind(selectorStore),
      get state() {
        if (!fixture.state) throw new Error('Checkout fixture admission is not initialized');
        return fixture.state;
      },
    },
  };
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectHidesAgentLifecycleActions: () => ({
    subscribe: (fn: (v: boolean) => void) => {
      fn(mocks.hidesAgentLifecycleActions);
      return () => {};
    },
  }),
}));

/** Flush the on-open fetch: dynamic import + client promise + re-render. */
async function flushFetch() {
  await tick();
  await vi.waitFor(() => expect(mocks.diskUsage).toHaveBeenCalled());
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
}

/** Flush pending effects + re-render. */
async function flushLabel() {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
}

const baseWorkspace = {
  id: 'ws-1',
  title: 'Disk Workspace',
  branch: 'main',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: 'active',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
} as unknown as Workspace;

const diskUsage = {
  bytes: 2_330_000_000,
  fileCount: 12345,
  computedAt: '2026-08-01T12:00:00Z',
  breakdown: [
    { name: 'repo', bytes: 2_000_000_000, fileCount: 12000 },
    { name: 'tool-output', bytes: 330_000_000, fileCount: 345 },
  ],
};

async function renderPill(props: Record<string, unknown>, target?: HTMLElement) {
  const CheckoutModePill = (await import('../CheckoutModePill.svelte')).default;
  return render(CheckoutModePill, { props, target });
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockTooltipWithContent.svelte'));
warmImport(() => import('../CheckoutModePill.svelte'));

describe('CheckoutModePill', () => {
  beforeEach(() => {
    const state = withLegacyPrincipal({
      connections: { windowBackendId: 'local' },
      workspace: {
        ...workspaceInitialState,
        hasLoaded: true,
        loadedBackendId: 'local',
        workspaces: createCollection('id', [baseWorkspace]),
      },
    });
    state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
    fixture.state = state;
    mocks.runShrinkWorkspaceAction.mockClear();
    mocks.diskUsage.mockReset();
    mocks.diskUsage.mockResolvedValue({ diskUsage, refreshing: false });
    mocks.settingsGet.mockReset();
    mocks.settingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: false });
  });
  afterEach(cleanup);

  it('renders "CoW" for a cow checkout whatever workspace.cowIsolation says', async () => {
    mocks.settingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: false });
    const { container } = await renderPill({
      presentation: 'repository',
      workspace: { ...baseWorkspace, checkoutMode: 'cow', cowSupported: false } as Workspace,
    });
    await flushLabel();
    expect(container.textContent).toContain('Checkout mode: CoW');
    expect(
      container.querySelector('[data-checkout-mode-icon]')?.getAttribute('data-checkout-mode-icon'),
    ).toBe('cow');
    expect(container.textContent).not.toContain('Checkout mode: Direct');
  });

  it('renders "CoW" for a cow checkout without reading workspace.cowIsolation', async () => {
    await renderPill({ checkoutMode: 'cow' });
    await flushLabel();
    const pill = screen.getByText('CoW');
    expect(pill.classList.contains('shrink-0')).toBe(true);
    expect(mocks.settingsGet).not.toHaveBeenCalled();
  });

  it('follows the workspace prop from a cow to a direct checkout', async () => {
    const view = await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushLabel();
    expect(screen.getByText('CoW')).toBeTruthy();
    await view.rerender({
      workspace: { ...baseWorkspace, id: 'ws-2', checkoutMode: 'direct' } as Workspace,
    });
    await flushLabel();
    expect(screen.getByText('Direct')).toBeTruthy();
    expect(screen.queryByText('CoW')).toBeNull();
  });

  it('renders an accessible icon instead of Worktree text', async () => {
    const { container } = await renderPill({ checkoutMode: 'worktree' });
    const pill = screen.getByLabelText('Checkout mode: Worktree');

    expect(pill.getAttribute('data-checkout-mode')).toBe('worktree');
    expect(pill.textContent?.trim()).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders "Direct" when checkoutMode is direct (cache-hydrated local clone)', async () => {
    await renderPill({ checkoutMode: 'direct' });
    expect(screen.getByText('Direct')).toBeTruthy();
  });

  it('renders nothing when checkoutMode is undefined (non-daemon-provisioned)', async () => {
    const { container } = await renderPill({});
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('span')).toBeNull();
  });

  it.each([
    ['cow', 'cow'],
    ['worktree', 'worktree'],
    ['direct', 'direct'],
  ] as const)(
    'renders a mode-specific %s icon in repository presentation',
    async (checkoutMode, expected) => {
      const { container } = await renderPill({
        presentation: 'repository',
        workspace: { ...baseWorkspace, checkoutMode } as Workspace,
      });
      await flushLabel();

      expect(
        container
          .querySelector('[data-checkout-mode-icon]')
          ?.getAttribute('data-checkout-mode-icon'),
      ).toBe(expected);
      expect(container.querySelector('[data-checkout-mode-label]')?.textContent).toContain(
        checkoutMode === 'cow' ? 'CoW' : checkoutMode === 'worktree' ? 'Worktree' : 'Direct',
      );
    },
  );

  it('renders no repository details when checkoutMode is undefined', async () => {
    const { container } = await renderPill({
      presentation: 'repository',
      workspace: baseWorkspace,
    });

    expect(container.querySelector('[data-checkout-mode-details]')).toBeNull();
  });

  it('does not fetch disk usage without a workspace', async () => {
    await renderPill({ checkoutMode: 'cow' });
    await flushLabel();

    expect(mocks.diskUsage).not.toHaveBeenCalled();
  });

  it("derives the label from the workspace's checkoutMode, ignoring a mismatched prop", async () => {
    await renderPill({
      checkoutMode: 'worktree',
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushLabel();

    expect(screen.getByText('CoW')).toBeTruthy();
    expect(screen.queryByText('Worktree')).toBeNull();
  });

  it('fetches disk usage for the current workspace on demand', async () => {
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    // The on-demand fetch targets the hovered workspace (monorepo#1396).
    expect(mocks.diskUsage).toHaveBeenCalledWith('ws-1');

    // Fetch settled with refreshing:false — no loading state remains.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('fetches and exposes disk actions when the repository hover card opens', async () => {
    const workspace = { ...baseWorkspace, checkoutMode: 'direct' } as Workspace;
    await renderPill({
      presentation: 'repository',
      repositoryOpen: true,
      workspace,
    });
    await flushFetch();

    expect(mocks.diskUsage).toHaveBeenCalledWith('ws-1');
    const shrink = screen.getByRole('button', { name: 'Try to shrink this workspace' });
    await fireEvent.click(shrink);
    expect(mocks.runShrinkWorkspaceAction).toHaveBeenCalledWith(workspace);
  });

  it('shows a skeleton while the first walk is in flight (no value yet)', async () => {
    mocks.diskUsage.mockResolvedValue({ refreshing: true });
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    const loading = screen.getByRole('status', { name: 'Loading disk usage' });
    expect(loading.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });

  it('keeps polling an in-progress first walk until loading finishes', async () => {
    vi.useFakeTimers();
    try {
      mocks.diskUsage
        .mockResolvedValueOnce({ refreshing: true })
        .mockResolvedValueOnce({ diskUsage, refreshing: false });

      await renderPill({
        workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
      });
      await tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.diskUsage).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status', { name: 'Loading disk usage' })).toBeTruthy();

      await vi.advanceTimersByTimeAsync(1000);
      await tick();

      expect(mocks.diskUsage).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('status', { name: 'Loading disk usage' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports background refresh without returning to initial loading', async () => {
    mocks.diskUsage.mockResolvedValue({ diskUsage, refreshing: true });
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    expect(screen.getByRole('status', { name: 'Refreshing disk usage' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading disk usage' })).toBeNull();
  });

  it('does not report loading when the daemon has no walk running', async () => {
    mocks.diskUsage.mockResolvedValue({ refreshing: false });
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not stay loading when the daemon lacks the disk usage method', async () => {
    // Older daemon: diskUsage() resolves null (-32601 METHOD_NOT_FOUND).
    mocks.diskUsage.mockResolvedValue(null);
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow', diskUsage } as Workspace,
    });
    await flushFetch();

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('restarts loading and retargets the fetch when the workspace changes', async () => {
    const { rerender } = await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    // The new workspace's walk never settles within this test.
    mocks.diskUsage.mockImplementation(() => new Promise(() => {}));
    await rerender({
      workspace: { ...baseWorkspace, id: 'ws-2', checkoutMode: 'cow' } as Workspace,
    });
    await tick();

    // The fetch retargets ws-2 and reports loading again.
    expect(screen.getByRole('status', { name: 'Loading disk usage' })).toBeTruthy();
    expect(mocks.diskUsage).toHaveBeenLastCalledWith('ws-2');
  });

  it('ignores a poll that resolves after the workspace prop changed', async () => {
    const deferred: Array<(value: unknown) => void> = [];
    mocks.diskUsage.mockImplementation(() => new Promise((resolve) => deferred.push(resolve)));
    const { rerender } = await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await tick();
    await vi.waitFor(() => expect(mocks.diskUsage).toHaveBeenCalledTimes(1));

    await rerender({
      workspace: { ...baseWorkspace, id: 'ws-2', checkoutMode: 'cow' } as Workspace,
    });
    await tick();
    await vi.waitFor(() => expect(mocks.diskUsage).toHaveBeenCalledTimes(2));

    // The late ws-1 result must not finish ws-2's loading state.
    deferred[0]({ diskUsage, refreshing: false });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tick();

    expect(screen.getByRole('status', { name: 'Loading disk usage' })).toBeTruthy();

    // ws-2's own walk finishes its loading state.
    deferred[1]({ diskUsage, refreshing: false });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tick();
    expect(screen.queryByRole('status', { name: 'Loading disk usage' })).toBeNull();
  });

  it('does not schedule further polls when the fetch resolves after unmount', async () => {
    vi.useFakeTimers();
    try {
      let resolvePoll: ((value: unknown) => void) | undefined;
      mocks.diskUsage.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }),
      );
      const { unmount } = await renderPill({
        workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
      });
      await tick();
      await Promise.resolve();
      expect(mocks.diskUsage).toHaveBeenCalledTimes(1);

      unmount();
      const timersBefore = vi.getTimerCount();
      // refreshing:true would normally schedule the next ~1s poll.
      resolvePoll!({ diskUsage, refreshing: true });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(timersBefore);
      await vi.runAllTimersAsync();
      expect(mocks.diskUsage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the shrink action for the workspace when the shrink link is clicked', async () => {
    const workspace = { ...baseWorkspace, checkoutMode: 'cow' } as Workspace;
    await renderPill({ workspace });
    await flushFetch();

    const link = screen.getByRole('button', { name: 'Try to shrink this workspace' });
    await fireEvent.click(link);

    expect(mocks.runShrinkWorkspaceAction).toHaveBeenCalledOnce();
    expect(mocks.runShrinkWorkspaceAction).toHaveBeenCalledWith(workspace);
  });

  it('withholds the shrink link (it launches an agent) when agent lifecycle actions are hidden', async () => {
    mocks.hidesAgentLifecycleActions = true;
    try {
      const workspace = { ...baseWorkspace, checkoutMode: 'cow' } as Workspace;
      await renderPill({ workspace });
      await flushFetch();

      expect(screen.queryByRole('button', { name: 'Try to shrink this workspace' })).toBeNull();
      expect(mocks.runShrinkWorkspaceAction).not.toHaveBeenCalled();
    } finally {
      mocks.hidesAgentLifecycleActions = false;
    }
  });
});
