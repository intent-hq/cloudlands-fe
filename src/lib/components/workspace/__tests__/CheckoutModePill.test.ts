/**
 * @vitest-environment jsdom
 *
 * CheckoutModePill tests. The pill renders "CoW" for `checkoutMode === 'cow'`,
 * "Worktree" for `'worktree'`, and nothing at all when the field is absent
 * (direct / non-daemon-provisioned checkouts).
 *
 * When a workspace is provided, opening the tooltip fetches the footprint
 * on demand via `appClient.workspaces.diskUsage` (`workspace.diskUsage`,
 * PROTOCOL §5.1) — list/get rows no longer carry it (monorepo#1396). While a
 * walk is in flight with no value yet a spinner shows; once a value exists
 * the tooltip renders total size + file count, the physical-space/scope
 * notes, the per-directory breakdown, and the shrink link. Older daemons
 * without the method (`diskUsage()` → null) fall back to the legacy row
 * field when present.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Workspace } from '$shared/types';

const mocks = vi.hoisted(() => ({
  runShrinkWorkspaceAction: vi.fn().mockResolvedValue(undefined),
  diskUsage: vi.fn(),
}));

vi.mock('../shrink-workspace-action', () => ({
  runShrinkWorkspaceAction: mocks.runShrinkWorkspaceAction,
}));

vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('./mocks/MockTooltipWithContent.svelte')).default,
}));

// The component reaches the daemon through the appClient seam (via the
// disk-usage-poll action module); mock it so no request leaves the test.
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { diskUsage: mocks.diskUsage } },
}));

/** Flush the on-open fetch: dynamic import + client promise + re-render. */
async function flushFetch() {
  await tick();
  await vi.waitFor(() => expect(mocks.diskUsage).toHaveBeenCalled());
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

async function renderPill(props: Record<string, unknown>) {
  const CheckoutModePill = (await import('../CheckoutModePill.svelte')).default;
  return render(CheckoutModePill, { props });
}

describe('CheckoutModePill', () => {
  beforeEach(() => {
    mocks.runShrinkWorkspaceAction.mockClear();
    mocks.diskUsage.mockReset();
    mocks.diskUsage.mockResolvedValue({ diskUsage, refreshing: false });
  });
  afterEach(cleanup);

  it('renders "CoW" when checkoutMode is cow', async () => {
    await renderPill({ checkoutMode: 'cow' });
    const pill = screen.getByText('CoW');
    expect(pill).toBeTruthy();
    expect(pill.classList.contains('shrink-0')).toBe(true);
  });

  it('renders "Worktree" when checkoutMode is worktree', async () => {
    await renderPill({ checkoutMode: 'worktree' });
    expect(screen.getByText('Worktree')).toBeTruthy();
  });

  it('renders nothing when checkoutMode is undefined (direct)', async () => {
    const { container } = await renderPill({});
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('span')).toBeNull();
  });

  it('uses the plain checkout-mode title when no workspace is provided', async () => {
    await renderPill({ checkoutMode: 'cow' });

    const pill = screen.getByText('CoW');
    expect(pill.getAttribute('title')).toBe('Checkout mode: CoW');
    expect(screen.queryByTestId('tooltip-content')).toBeNull();
    expect(mocks.diskUsage).not.toHaveBeenCalled();
  });

  it("derives the label from the workspace's checkoutMode, ignoring a mismatched prop", async () => {
    await renderPill({
      checkoutMode: 'worktree',
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });

    expect(screen.getByText('CoW')).toBeTruthy();
    expect(screen.queryByText('Worktree')).toBeNull();
  });

  it('fetches on tooltip open and shows the disk-usage breakdown', async () => {
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    // The on-demand fetch targets the hovered workspace (monorepo#1396).
    expect(mocks.diskUsage).toHaveBeenCalledWith('ws-1');

    const pill = screen.getByText('CoW');
    expect(pill.getAttribute('title')).toBeNull();

    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('Checkout mode: CoW');
    expect(tooltip.textContent).toContain('Total size: 2.17Gi');
    expect(tooltip.textContent).toContain('12,345 files');
    expect(tooltip.textContent).toContain('may be over-counted');
    expect(tooltip.textContent).toContain('whole workspace directory');
    expect(tooltip.textContent).toContain('repo');
    expect(tooltip.textContent).toContain('1.86Gi');
    expect(tooltip.textContent).toContain('tool-output');
    expect(tooltip.textContent).toContain('315Mi');
    // Fetch settled with refreshing:false — no spinner remains.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the loading spinner while the first walk is in flight (no value yet)', async () => {
    mocks.diskUsage.mockResolvedValue({ refreshing: true });
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('Checkout mode: CoW');
    expect(tooltip.textContent).not.toContain('Total size');
    expect(screen.getByRole('status', { name: 'Loading disk usage' })).toBeTruthy();
  });

  it('shows the value plus a subtle refreshing indicator during a background refresh', async () => {
    mocks.diskUsage.mockResolvedValue({ diskUsage, refreshing: true });
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('Total size: 2.17Gi');
    expect(screen.getByRole('status', { name: 'Refreshing disk usage' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading disk usage' })).toBeNull();
  });

  it('shows only the checkout-mode heading when the daemon has no usage and no walk runs', async () => {
    mocks.diskUsage.mockResolvedValue({ refreshing: false });
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();

    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('Checkout mode: CoW');
    expect(tooltip.textContent).not.toContain('Total size');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('falls back to the legacy row diskUsage when the daemon lacks the method', async () => {
    // Older daemon: diskUsage() resolves null (-32601 METHOD_NOT_FOUND).
    mocks.diskUsage.mockResolvedValue(null);
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow', diskUsage } as Workspace,
    });
    await flushFetch();

    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('Total size: 2.17Gi');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('resets the fetched value when the workspace prop changes (no stale render)', async () => {
    const { rerender } = await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'cow' } as Workspace,
    });
    await flushFetch();
    expect(screen.getByTestId('tooltip-content').textContent).toContain('Total size: 2.17Gi');

    // The new workspace's walk never settles within this test.
    mocks.diskUsage.mockImplementation(() => new Promise(() => {}));
    await rerender({
      workspace: { ...baseWorkspace, id: 'ws-2', checkoutMode: 'cow' } as Workspace,
    });
    await tick();

    // ws-1's value must not render for ws-2; the fetch retargets ws-2.
    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).not.toContain('Total size');
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

    // ws-1's walk settles late — its value must not render for ws-2.
    deferred[0]({ diskUsage, refreshing: false });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tick();
    expect(screen.getByTestId('tooltip-content').textContent).not.toContain('Total size');

    // ws-2's own walk still renders once it settles.
    deferred[1]({ diskUsage, refreshing: false });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tick();
    expect(screen.getByTestId('tooltip-content').textContent).toContain('Total size: 2.17Gi');
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

  it('renders the notes as separate flush-left paragraphs (no pre-wrap indentation)', async () => {
    await renderPill({
      workspace: { ...baseWorkspace, checkoutMode: 'worktree' } as Workspace,
    });
    await flushFetch();

    const tooltip = screen.getByTestId('tooltip-content');
    const paragraphs = Array.from(tooltip.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toMatch(/^\S/);
    expect(paragraphs[1].textContent).toMatch(/^\S/);
    // The tooltip shell applies whitespace-pre-wrap; the body must reset it so
    // source-formatting newlines never render as literal indentation.
    expect(tooltip.querySelector('.whitespace-normal')).toBeTruthy();
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
});
