/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../BulkActionConfirmDialog.svelte'));

describe('BulkActionConfirmDialog', () => {
  it('renders plural agent and hook lines', async () => {
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

  it('renders the open pull request count', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: { open: true, description: 'Delete all spaces?', openPrCount: 2 },
    });

    expect(screen.getByText('2 pull requests are still open')).toBeTruthy();
  });

  it('renders no active-work copy when there is no active work', async () => {
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

  it('focuses the confirm action when the dialog opens', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: { open: true, title: 'Archive spaces?', confirmText: 'Archive' },
    });

    const confirm = screen.getByRole('button', { name: 'Archive' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
  });

  it('focuses Cancel instead of the destructive action when the dialog opens', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: {
        open: true,
        title: 'Delete spaces?',
        confirmText: 'Delete all',
        variant: 'destructive',
      },
    });

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it('disables and marks confirm busy while preflight is pending', async () => {
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, {
      props: { open: true, confirmText: 'Delete all', preflightReady: false },
    });

    const confirm = screen.getByRole('button', { name: 'Delete all' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
  });

  it('cancels the action from the cancel button', async () => {
    const onCancel = vi.fn();
    const BulkActionConfirmDialog = (await import('../BulkActionConfirmDialog.svelte')).default;

    render(BulkActionConfirmDialog, { props: { open: true, onCancel } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
