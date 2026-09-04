/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { workspaceHoverCardIntentSession } from '../../workspace/utils/workspace-hover-card-intent';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('../../layout/__tests__/mocks/MockWorkspaceHoverCard.svelte')).default,
}));

warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../BulkWorkspaceList.svelte'));

function makeWorkspace(
  id: string,
  title: string,
  branch: string,
  status = WorkspaceStatusEnum.Active,
): Workspace {
  return {
    id: id as Workspace['id'],
    title,
    branch,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('BulkWorkspaceList', () => {
  beforeEach(() => workspaceHoverCardIntentSession.reset());

  afterEach(() => {
    vi.useRealTimers();
    workspaceHoverCardIntentSession.reset();
  });

  it('renders one row for every affected workspace', async () => {
    const BulkWorkspaceList = (await import('../BulkWorkspaceList.svelte')).default;
    const workspaces: Workspace[] = [
      {
        ...makeWorkspace('ws-1', 'First workspace', 'feature/first'),
        displayStatus: 'in_progress',
      },
      {
        ...makeWorkspace('ws-2', 'Second workspace', 'feature/second'),
        displayStatus: 'needs_attention',
      },
      {
        ...makeWorkspace('ws-3', 'Legacy workspace', 'old-branch', WorkspaceStatusEnum.Archived),
        displayStatus: 'complete',
      },
    ];

    render(BulkWorkspaceList, { props: { workspaces } });

    expect(screen.getAllByRole('listitem')).toHaveLength(workspaces.length);
    for (const workspace of workspaces) {
      expect(screen.getByText(workspace.title)).toBeTruthy();
      expect(screen.queryByText(workspace.branch!)).toBeNull();
    }
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.getByText('Archived workspace')).toBeTruthy();
  });

  it('opens a workspace hover card after pointer rest and closes it on leave', async () => {
    vi.useFakeTimers();
    const BulkWorkspaceList = (await import('../BulkWorkspaceList.svelte')).default;
    const workspace = makeWorkspace('ws-hover', 'Hover workspace', 'feature/hover');

    render(BulkWorkspaceList, { props: { workspaces: [workspace] } });
    const row = screen.getByText(workspace.title).closest('[role="listitem"]')!;

    await fireEvent.mouseEnter(row);
    vi.advanceTimersByTime(399);
    await tick();
    expect(document.querySelector('[data-workspace-hover-card]')).toBeNull();

    vi.advanceTimersByTime(1);
    await tick();
    expect(document.querySelector('[data-workspace-hover-card]')).toBeTruthy();

    await fireEvent.mouseLeave(row);
    await tick();
    expect(document.querySelector('[data-workspace-hover-card]')).toBeNull();
  });

  it('renders no workspace list when workspaces is empty', async () => {
    const BulkWorkspaceList = (await import('../BulkWorkspaceList.svelte')).default;

    render(BulkWorkspaceList, { props: { workspaces: [] } });

    expect(screen.queryByRole('list')).toBeNull();
  });
});
