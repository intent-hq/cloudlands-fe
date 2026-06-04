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

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Stop agents and delete space?')).toBeTruthy();
    expect(screen.getByText('Agent One')).toBeTruthy();
    expect(screen.getByText('Agent Two')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Stop agents and delete' }));

    expect(onDeleteAnyway).toHaveBeenCalledOnce();
  });
});