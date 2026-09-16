/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmHost from './ConfirmHost.svelte';
import { alert, confirm, prompt } from './confirm-service';
import { resetConfirmServiceForTests } from './confirm-service';

afterEach(() => {
  cleanup();
  resetConfirmServiceForTests();
});

describe('confirm service', () => {
  it.each(['confirm', 'prompt'] as const)(
    'shows and resolves the next queued %s after cancelling the first',
    async (kind) => {
      render(ConfirmHost);
      const enqueue = (title: string) =>
        kind === 'confirm'
          ? confirm({ title, confirmLabel: 'Continue' })
          : prompt({
              title,
              confirmLabel: 'Continue',
              field: { label: 'Name', initialValue: title, required: true },
            });
      const first = enqueue('First request');
      const second = enqueue('Second request');

      await screen.findByRole('dialog', { name: 'First request' });
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await expect(first).resolves.toBe(kind === 'confirm' ? false : null);

      expect(await screen.findByRole('dialog', { name: 'Second request' })).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await expect(second).resolves.toBe(kind === 'confirm' ? true : 'Second request');
    },
  );

  it('queues requests and resolves them in invocation order', async () => {
    render(ConfirmHost);
    const first = confirm({ title: 'First request', confirmLabel: 'Continue' });
    const second = alert({ title: 'Second request', confirmLabel: 'Acknowledge' });

    expect(await screen.findByRole('dialog', { name: 'First request' })).toBeTruthy();
    expect(screen.queryByText('Second request')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await expect(first).resolves.toBe(true);

    expect(await screen.findByRole('alertdialog', { name: 'Second request' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await expect(second).resolves.toBeUndefined();
  });

  it('returns focus to the invoking element after the queue drains', async () => {
    render(ConfirmHost);
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const result = confirm({ title: 'Return focus', confirmLabel: 'Done' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    await expect(result).resolves.toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps an async confirm open and busy until the action settles', async () => {
    render(ConfirmHost);
    let release!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const result = confirm({ title: 'Async action', confirmLabel: 'Save', onConfirm });

    const button = await screen.findByRole('button', { name: 'Save' });
    await fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Async action' })).toBeTruthy();

    release();
    await expect(result).resolves.toBe(true);
  });

  it('submits a required prompt value and supports cancellation', async () => {
    render(ConfirmHost);
    const accepted = prompt({
      title: 'Name item',
      confirmLabel: 'Create',
      field: { label: 'Name', required: true },
    });
    const input = await screen.findByRole('textbox', { name: 'Name' });
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
    await fireEvent.input(input, { target: { value: '  Alpha  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await expect(accepted).resolves.toBe('Alpha');

    const cancelled = prompt({ title: 'Cancel item', field: { required: false } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(cancelled).resolves.toBeNull();
  });

  it('confirms a destructive action without requiring text input', async () => {
    render(ConfirmHost);
    const result = confirm({
      title: 'Delete Alpha',
      confirmLabel: 'Delete',
      destructive: true,
    });
    const button = await screen.findByRole('button', { name: 'Delete' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(button.hasAttribute('disabled')).toBe(false);
    await fireEvent.click(button);
    await expect(result).resolves.toBe(true);
  });
});
