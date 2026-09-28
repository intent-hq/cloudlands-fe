/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RetireAgentModal from '../RetireAgentModal.svelte';

function mount(onRetire = vi.fn().mockResolvedValue(undefined)) {
  render(RetireAgentModal, { open: true, agentName: 'Backend Coordinator', onRetire });
  return onRetire;
}

describe('RetireAgentModal', () => {
  it.each(['Cancel', 'Escape', 'Close dialog'])(
    'dismisses via %s without retiring',
    async (dismiss) => {
      const onRetire = mount();
      const dialog = await screen.findByRole('dialog');
      expect(onRetire).not.toHaveBeenCalled();
      if (dismiss === 'Escape') await fireEvent.keyDown(dialog, { key: 'Escape' });
      else await fireEvent.click(screen.getByRole('button', { name: dismiss, exact: true }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(onRetire).not.toHaveBeenCalled();
    },
  );

  it('confirms once, blocks repeated activation and dismissal while pending, and closes on success', async () => {
    let resolve!: () => void;
    const onRetire = mount(
      vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      ),
    );
    const confirm = await screen.findByRole('button', { name: 'Retire Agent' });
    await fireEvent.click(confirm);
    await fireEvent.click(confirm);
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onRetire).toHaveBeenCalledTimes(1);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
    resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the daemon error, keeps the dialog open, and allows retry', async () => {
    const onRetire = mount(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('A descendant is running'))
        .mockResolvedValue(undefined),
    );
    const confirm = await screen.findByRole('button', { name: 'Retire Agent' });
    await fireEvent.click(confirm);
    expect((await screen.findByRole('alert')).textContent).toContain('A descendant is running');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRetire).toHaveBeenCalledTimes(2);
  });
});
