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
      await screen.findByRole('alertdialog', { name: 'Stop agents and delete space?' })
    ).toBeTruthy();
    expect(screen.getByText('Stop agents and delete space?')).toBeTruthy();
    expect(screen.getByText('Agent One')).toBeTruthy();
    expect(screen.getByText('Agent Two')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close delete warning dialog' })).toBeTruthy();

    const deleteButton = screen.getByRole('button', { name: 'Stop agents and delete' });
    expect(deleteButton.className).toContain('bg-red-700');
    expect(deleteButton.className).toContain('text-white');

    await fireEvent.click(deleteButton);

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
      name: 'Stop agents and delete space?',
    });

    await fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
