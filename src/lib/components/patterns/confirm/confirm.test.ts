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

  it('requires an exact typed confirmation before enabling destructive submit', async () => {
    render(ConfirmHost);
    const result = confirm({
      title: 'Delete Alpha',
      confirmLabel: 'Delete',
      destructive: true,
      typedConfirmation: 'Alpha',
    });
    const input = await screen.findByRole('textbox');
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await fireEvent.input(input, { target: { value: 'alpha' } });
    expect(button.hasAttribute('disabled')).toBe(true);
    await fireEvent.input(input, { target: { value: 'Alpha' } });
    await fireEvent.click(button);
    await expect(result).resolves.toBe(true);
  });
});
