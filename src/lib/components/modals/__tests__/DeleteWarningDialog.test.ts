/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

describe('DeleteWarningDialog', () => {
  it('shows a clear stop-and-delete action for spaces with running agents', async () => {
    const onDeleteAnyway = vi.fn();
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: ['Agent One', 'Agent Two'],
        onDeleteAnyway,
      },
    });

    expect(
      await screen.findByRole('alertdialog', { name: 'Stop active work and delete space?' })
    ).toBeTruthy();
    expect(screen.getByText('Stop active work and delete space?')).toBeTruthy();
    expect(screen.getByText('Agent One')).toBeTruthy();
    expect(screen.getByText('Agent Two')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close delete warning dialog' })).toBeTruthy();

    const deleteButton = screen.getByRole('button', { name: 'Stop work and delete' });
    expect(deleteButton.className).toContain('bg-red-700');
    expect(deleteButton.className).toContain('text-white');

    await fireEvent.click(deleteButton);

    expect(onDeleteAnyway).toHaveBeenCalledOnce();
  });

  it('lists active background hooks alongside agents', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: ['Agent One'],
        hookNames: ['ci-watch', 'pr-watch'],
      },
    });

    expect(screen.getByText('1 active agent will be stopped')).toBeTruthy();
    expect(screen.getByText('2 active background hooks will be cancelled')).toBeTruthy();
    expect(screen.getByText('ci-watch')).toBeTruthy();
    expect(screen.getByText('pr-watch')).toBeTruthy();
  });

  it('shows only the hooks section when hooks alone are active', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: [],
        hookNames: ['ci-watch'],
      },
    });

    expect(screen.getByText('1 active background hook will be cancelled')).toBeTruthy();
    expect(screen.queryByText(/active agent/)).toBeNull();
  });

  it('renders archive copy and confirm label in archive mode', async () => {
    const onDeleteAnyway = vi.fn();
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        mode: 'archive' as const,
        agentNames: ['Agent One'],
        hookNames: ['ci-watch'],
        onDeleteAnyway,
      },
    });

    expect(
      await screen.findByRole('alertdialog', { name: 'Stop active work and archive space?' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close archive warning dialog' })).toBeTruthy();

    const archiveButton = screen.getByRole('button', { name: 'Stop work and archive' });
    await fireEvent.click(archiveButton);

    expect(onDeleteAnyway).toHaveBeenCalledOnce();
  });

  it('cancels the dialog when Escape is pressed inside the alertdialog', async () => {
    const onCancel = vi.fn();
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: ['Agent One'],
        onCancel,
      },
    });

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Stop active work and delete space?',
    });

    await fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
