/**
 * @vitest-environment jsdom
 *
 * Disk-usage pill (PROTOCOL §5.1 `diskUsage`): renders the binary-formatted
 * size in the subtitle, the tooltip shows the total + file count, the
 * physical-space/scope notes, the per-directory breakdown, and the shrink
 * link that triggers the shrink-workspace action. Renders nothing when
 * `diskUsage` is absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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

async function renderPill(workspace: Workspace | null) {
  const WorkspaceDiskUsagePill = (await import('../WorkspaceDiskUsagePill.svelte')).default;
  return render(WorkspaceDiskUsagePill, { props: { workspace } });
}

describe('WorkspaceDiskUsagePill', () => {
  beforeEach(() => {
    mocks.runShrinkWorkspaceAction.mockClear();
  });

  it('renders the binary-formatted size when diskUsage is present', async () => {
    await renderPill({ ...baseWorkspace, diskUsage } as Workspace);

    expect(screen.getByText('2.17Gi')).toBeTruthy();
  });

  it('renders nothing when diskUsage is absent', async () => {
    const { container } = await renderPill(baseWorkspace);

    expect(container.textContent?.trim()).toBe('');
  });

  it('shows total size, file count, notes, and breakdown in the tooltip', async () => {
    await renderPill({ ...baseWorkspace, diskUsage } as Workspace);

    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip.textContent).toContain('Total size: 2.17Gi');
    expect(tooltip.textContent).toContain('12,345 files');
    expect(tooltip.textContent).toContain('may be over-counted');
    expect(tooltip.textContent).toContain('whole workspace directory');
    expect(tooltip.textContent).toContain('repo');
    expect(tooltip.textContent).toContain('1.86Gi');
    expect(tooltip.textContent).toContain('tool-output');
    expect(tooltip.textContent).toContain('315Mi');
  });

  it('runs the shrink action for the workspace when the shrink link is clicked', async () => {
    const workspace = { ...baseWorkspace, diskUsage } as Workspace;
    await renderPill(workspace);

    const link = screen.getByRole('button', { name: 'Try to shrink this workspace' });
    await fireEvent.click(link);

    expect(mocks.runShrinkWorkspaceAction).toHaveBeenCalledOnce();
    expect(mocks.runShrinkWorkspaceAction).toHaveBeenCalledWith(workspace);
  });
});
