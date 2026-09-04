/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../BulkActionConfirmDialog.svelte'));

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

describe('BulkActionConfirmDialog', () => {
  it('renders the active-work warning panel with plural agent and hook lines', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: {
        open: true,
        description: 'Archive all spaces?',
        activeAgentCount: 2,
        activeHookCount: 3,
      },
    });

    expect(screen.getByText('2 active agents will be stopped')).toBeTruthy();
    expect(screen.getByText('3 active background hooks will be cancelled')).toBeTruthy();
  });

  it('renders singular copy for one agent and omits the hooks line when zero', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: {
        open: true,
        description: 'Archive all spaces?',
        activeAgentCount: 1,
        activeHookCount: 0,
      },
    });

    expect(screen.getByText('1 active agent will be stopped')).toBeTruthy();
    expect(screen.queryByText(/background hook/)).toBeNull();
  });

  it('renders only the hooks line when hooks alone are active', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: {
        open: true,
        description: 'Delete all archived spaces?',
        activeAgentCount: 0,
        activeHookCount: 1,
      },
    });

    expect(screen.getByText('1 active background hook will be cancelled')).toBeTruthy();
    expect(screen.queryByText(/active agent/)).toBeNull();
  });

  it('renders no warning panel when there is no active work', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: {
        open: true,
        description: 'Archive all spaces?',
        activeAgentCount: 0,
        activeHookCount: 0,
      },
    });

    expect(screen.queryByText(/active agent/)).toBeNull();
    expect(screen.queryByText(/background hook/)).toBeNull();
  });

  it('renders one row for every affected workspace', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;
    const workspaces = [
      makeWorkspace('ws-1', 'First workspace', 'feature/first'),
      makeWorkspace('ws-2', 'Second workspace', 'feature/second'),
      makeWorkspace('ws-3', 'Legacy workspace', 'old-branch', WorkspaceStatusEnum.Archived),
    ];

    render(BulkActionConfirmDialog, { props: { open: true, workspaces } });

    expect(screen.getAllByRole('listitem')).toHaveLength(workspaces.length);
    for (const workspace of workspaces) {
      expect(screen.getByText(workspace.title)).toBeTruthy();
    }
  });

  it('renders no workspace list when workspaces is empty', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, { props: { open: true, workspaces: [] } });

    expect(screen.queryByRole('list')).toBeNull();
  });

  it('confirms the action even when active work is present', async () => {
    const onConfirm = vi.fn();
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: {
        open: true,
        description: 'Archive all spaces?',
        activeAgentCount: 1,
        activeHookCount: 1,
        onConfirm,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('uses the canonical icon-free surface and visibly focuses the confirm action', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: { open: true, title: 'Archive spaces?', confirmText: 'Archive' },
    });

    const dialog = screen.getByRole('dialog');
    const confirm = screen.getByRole('button', { name: 'Archive' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(confirm.className).toContain('ring-[3px]');
    expect(dialog.className).toContain('max-w-sm');
    expect(dialog.querySelector('.svelte-fa')).toBeNull();
  });
});
