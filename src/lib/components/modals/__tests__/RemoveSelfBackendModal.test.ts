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
warmImport(() => import('../RemoveSelfBackendModal.svelte'));

describe('RemoveSelfBackendModal', () => {
  it('renders the title and the rationale copy', async () => {
    const RemoveSelfBackendModal = (await import('../RemoveSelfBackendModal.svelte')).default;

    render(RemoveSelfBackendModal, { props: { open: true } });

    expect(screen.getByText('Remove this backend from iCloud Keychain?')).toBeTruthy();
    // Rationale: the API is off, other devices can no longer connect;
    // removal propagates, keeping leaves the entry.
    expect(screen.getByText(/can no longer connect/)).toBeTruthy();
    expect(screen.getByText(/deletes the entry from your other devices/)).toBeTruthy();
  });

  it('invokes onConfirm from the confirm button', async () => {
    const onConfirm = vi.fn();
    const RemoveSelfBackendModal = (await import('../RemoveSelfBackendModal.svelte')).default;

    render(RemoveSelfBackendModal, { props: { open: true, onConfirm } });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove from iCloud Keychain' }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('invokes onCancel (and not onConfirm) from the Keep button', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const RemoveSelfBackendModal = (await import('../RemoveSelfBackendModal.svelte')).default;

    render(RemoveSelfBackendModal, { props: { open: true, onConfirm, onCancel } });

    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables both actions while busy', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const RemoveSelfBackendModal = (await import('../RemoveSelfBackendModal.svelte')).default;

    render(RemoveSelfBackendModal, { props: { open: true, busy: true, onConfirm, onCancel } });

    const confirm = screen.getByRole('button', { name: 'Remove from iCloud Keychain' });
    const cancel = screen.getByRole('button', { name: 'Keep' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(confirm);
    await fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
