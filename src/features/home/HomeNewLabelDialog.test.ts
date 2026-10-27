/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../test/warm-import';

warmImport(() => import('./HomeNewLabelDialog.svelte'));
afterEach(cleanup);

async function open(existingLabels: string[] = ['For Later']) {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  const Dialog = (await import('./HomeNewLabelDialog.svelte')).default;
  render(Dialog, { open: true, existingLabels, onCreate, onCancel });
  const input = await screen.findByRole('textbox', { name: 'Name' });
  return { onCreate, onCancel, input };
}

describe('HomeNewLabelDialog', () => {
  it('creates a trimmed label with Enter and closes', async () => {
    const { onCreate, input } = await open();
    await fireEvent.input(input, { target: { value: '  Reading  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Reading'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('creates from the Create button', async () => {
    const { onCreate, input } = await open();
    await fireEvent.input(input, { target: { value: 'Reading' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Reading'));
  });

  it.each([
    ['   ', 'Enter a label name.'],
    ['x'.repeat(65), 'Use 64 characters or fewer.'],
    ['for later', 'A label with this name already exists.'],
    ['Pinned', 'This name is reserved. Choose another name.'],
  ])('rejects %j with an inline error and keeps the dialog open', async (value, error) => {
    const { onCreate, input } = await open();
    await fireEvent.input(input, { target: { value } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(error)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('clears the error once the name becomes valid', async () => {
    const { input } = await open();
    await fireEvent.input(input, { target: { value: 'pinned' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('This name is reserved. Choose another name.');
    await fireEvent.input(input, { target: { value: 'Pinned later' } });
    await waitFor(() =>
      expect(screen.queryByText('This name is reserved. Choose another name.')).toBeNull(),
    );
  });

  it('cancels with Escape without creating', async () => {
    const { onCreate, onCancel, input } = await open();
    await fireEvent.input(input, { target: { value: 'Reading' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancels from the Cancel button', async () => {
    const { onCreate, onCancel } = await open();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onCreate).not.toHaveBeenCalled();
  });
});
