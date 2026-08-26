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
warmImport(() => import('../PublishSelfBackendModal.svelte'));

describe('PublishSelfBackendModal', () => {
  it('renders the title and the spec rationale copy', async () => {
    const PublishSelfBackendModal = (await import('../PublishSelfBackendModal.svelte')).default;

    render(PublishSelfBackendModal, { props: { open: true, syncEnabled: true } });

    expect(screen.getByText('Add this backend to iCloud Keychain?')).toBeTruthy();
    // Spec rationale: immediate connect after install + automatic IP sync.
    expect(screen.getByText(/connect immediately after install/)).toBeTruthy();
    expect(screen.getByText(/IP address changes sync automatically/)).toBeTruthy();
  });

  it('shows the sync-off note only when keychain sync is disabled', async () => {
    const PublishSelfBackendModal = (await import('../PublishSelfBackendModal.svelte')).default;

    const { unmount } = render(PublishSelfBackendModal, {
      props: { open: true, syncEnabled: false },
    });
    expect(screen.getByText(/Confirming will also turn it on/)).toBeTruthy();
    unmount();

    render(PublishSelfBackendModal, { props: { open: true, syncEnabled: true } });
    expect(screen.queryByText(/Confirming will also turn it on/)).toBeNull();
  });

  it('invokes onConfirm from the confirm button', async () => {
    const onConfirm = vi.fn();
    const PublishSelfBackendModal = (await import('../PublishSelfBackendModal.svelte')).default;

    render(PublishSelfBackendModal, { props: { open: true, syncEnabled: true, onConfirm } });

    await fireEvent.click(screen.getByRole('button', { name: 'Add to iCloud Keychain' }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('invokes onCancel (and not onConfirm) from the Not now button', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const PublishSelfBackendModal = (await import('../PublishSelfBackendModal.svelte')).default;

    render(PublishSelfBackendModal, {
      props: { open: true, syncEnabled: true, onConfirm, onCancel },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables both actions while busy', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const PublishSelfBackendModal = (await import('../PublishSelfBackendModal.svelte')).default;

    render(PublishSelfBackendModal, {
      props: { open: true, syncEnabled: true, busy: true, onConfirm, onCancel },
    });

    const confirm = screen.getByRole('button', { name: 'Add to iCloud Keychain' });
    const cancel = screen.getByRole('button', { name: 'Not now' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(confirm);
    await fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
