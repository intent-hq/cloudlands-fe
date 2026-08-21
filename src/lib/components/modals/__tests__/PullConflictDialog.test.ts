/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';

const dispatch = vi.fn();

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$store/renderer/slices/external-editors/external-editors-selectors', () => ({
  selectInstalledEditorsFiltered: () => readable([]),
}));
vi.mock('$store/renderer/slices/external-editors/external-editors-slice', () => ({
  fetchEditors: () => ({ type: 'externalEditors/fetchEditors' }),
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch } }));

warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./PullConflictDialogHarness.svelte'));

const openDialog = async () => {
  const trigger = screen.getByRole('button', { name: 'Retry pull' });
  trigger.focus();
  await fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Pull Failed' });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return { trigger, dialog };
};

const expectDismissedOnce = async (trigger: HTMLElement, count = '1') => {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByLabelText('dialog state').textContent).toBe('closed');
  expect(screen.getByLabelText('pull error').textContent).toBe('cleared');
  expect(screen.getByLabelText('dismiss count').textContent).toBe(count);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
};

describe('PullConflictDialog dismissal', () => {
  beforeEach(() => dispatch.mockClear());

  it('closes from the X with mouse and touch activation exactly once per open', async () => {
    const Harness = (await import('./PullConflictDialogHarness.svelte')).default;
    render(Harness);

    const first = await openDialog();
    const mouseClose = screen.getByRole('button', { name: 'Close pull conflict dialog' });
    await fireEvent.pointerDown(mouseClose, { pointerType: 'mouse', button: 0 });
    await fireEvent.pointerUp(mouseClose, { pointerType: 'mouse', button: 0 });
    await fireEvent.click(mouseClose);
    await expectDismissedOnce(first.trigger);

    const second = await openDialog();
    const touchClose = screen.getByRole('button', { name: 'Close pull conflict dialog' });
    await fireEvent.pointerDown(touchClose, { pointerType: 'touch', button: 0 });
    await fireEvent.pointerUp(touchClose, { pointerType: 'touch', button: 0 });
    await fireEvent.click(touchClose);
    await expectDismissedOnce(second.trigger, '2');
  });

  it.each(['Enter', ' '])('uses the native close button activation path for %s', async (key) => {
    const Harness = (await import('./PullConflictDialogHarness.svelte')).default;
    render(Harness);

    const { trigger } = await openDialog();
    const close = screen.getByRole('button', { name: 'Close pull conflict dialog' });
    expect(close.tagName).toBe('BUTTON');
    close.focus();
    await fireEvent.keyDown(close, { key });
    await fireEvent.keyUp(close, { key });
    await fireEvent.click(close);

    await expectDismissedOnce(trigger);
  });

  it('keeps inside clicks contained and dismisses from Escape or the backdrop', async () => {
    const Harness = (await import('./PullConflictDialogHarness.svelte')).default;
    render(Harness);

    const first = await openDialog();
    await fireEvent.click(within(first.dialog).getByText('The branch has conflicting changes.'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('dismiss count').textContent).toBe('0');

    await fireEvent.keyDown(first.dialog, { key: 'Escape' });
    await expectDismissedOnce(first.trigger);

    const second = await openDialog();
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(overlay, {
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await expectDismissedOnce(second.trigger, '2');
  });

  it('uses the top modal stack and marks the production dialog surface as non-draggable', async () => {
    const Harness = (await import('./PullConflictDialogHarness.svelte')).default;
    render(Harness);

    const { dialog } = await openDialog();
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    expect(dialog.className).toContain('app-no-drag');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('[data-pull-conflict-dialog]')).toBe(dialog);
    expect(overlay).toBeTruthy();
  });
});
