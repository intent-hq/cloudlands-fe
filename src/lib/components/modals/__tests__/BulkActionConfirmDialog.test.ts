/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../BulkActionConfirmDialog.svelte'));

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
});
