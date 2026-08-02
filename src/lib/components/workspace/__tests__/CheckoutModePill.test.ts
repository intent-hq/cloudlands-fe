/**
 * @vitest-environment jsdom
 *
 * CheckoutModePill tests. The pill renders "CoW" for `checkoutMode === 'cow'`,
 * "Worktree" for `'worktree'`, and nothing at all when the field is absent
 * (direct / non-daemon-provisioned checkouts).
 *
 * When the workspace carries daemon-computed `diskUsage` (PROTOCOL §5.1),
 * hovering the pill shows the disk-usage tooltip: the checkout-mode heading,
 * total size + file count, the physical-space/scope notes, the per-directory
 * breakdown, and the shrink link that triggers the shrink-workspace action.
 * Without `diskUsage` the pill falls back to its plain checkout-mode title.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';

const mocks = vi.hoisted(() => ({
  runShrinkWorkspaceAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../shrink-workspace-action', () => ({
  runShrinkWorkspaceAction: mocks.runShrinkWorkspaceAction,
}));

vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('./mocks/MockTooltipWithContent.svelte')).default,
}));

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

  it('uses the plain checkout-mode title when diskUsage is absent', async () => {
    await renderPill({ checkoutMode: 'cow', workspace: baseWorkspace });

    const pill = screen.getByText('CoW');
    expect(pill.getAttribute('title')).toBe('Checkout mode: CoW');
    expect(screen.queryByTestId('tooltip-content')).toBeNull();
  });

  it('shows the disk-usage tooltip with the checkout-mode heading when diskUsage is present', async () => {
    await renderPill({
      checkoutMode: 'cow',
      workspace: { ...baseWorkspace, diskUsage } as Workspace,
    });

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
  });

  it('renders the notes as separate flush-left paragraphs (no pre-wrap indentation)', async () => {
    await renderPill({
      checkoutMode: 'worktree',
      workspace: { ...baseWorkspace, diskUsage } as Workspace,
    });

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
    const workspace = { ...baseWorkspace, diskUsage } as Workspace;
    await renderPill({ checkoutMode: 'cow', workspace });

    const link = screen.getByRole('button', { name: 'Try to shrink this workspace' });
    await fireEvent.click(link);

    expect(mocks.runShrinkWorkspaceAction).toHaveBeenCalledOnce();
    expect(mocks.runShrinkWorkspaceAction).toHaveBeenCalledWith(workspace);
  });
});
