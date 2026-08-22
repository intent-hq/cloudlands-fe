/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const FULL_PAYLOAD: QuitConfirmationShowPayload = {
  requestId: 'req-1',
  interrupted: [
    { agentId: 'a1', agentName: 'Local Agent', workspaceId: 'w1', workspaceName: 'Alpha' },
  ],
  keepRunning: [{ agentId: 'a2', agentName: 'Remote Agent', workspaceName: 'Beta' }],
  disruptedBrowserTabs: [
    { tabId: 't1', ownerAgentId: 'a1', ownerAgentName: 'Local Agent', title: 'Docs page' },
  ],
};

const KEEP_RUNNING_ONLY: QuitConfirmationShowPayload = {
  requestId: 'req-2',
  interrupted: [],
  keepRunning: [{ agentId: 'a2', agentName: 'Remote Agent' }],
  disruptedBrowserTabs: [],
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../QuitConfirmationModal.svelte'));

describe('QuitConfirmationModal', () => {
  it('renders quit framing with all three sections and responds true on Quit', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, { props: { open: true, payload: FULL_PAYLOAD, onRespond } });

    expect(await screen.findByRole('alertdialog', { name: 'Quit Intent?' })).toBeTruthy();
    expect(screen.getByText('Will be interrupted')).toBeTruthy();
    expect(screen.getByText('Keep running')).toBeTruthy();
    expect(screen.getByText('Browsers disconnected')).toBeTruthy();
    expect(screen.getAllByText('Local Agent').length).toBeGreaterThan(0);
    expect(screen.getByText('Remote Agent')).toBeTruthy();
    expect(screen.getByText('Docs page')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Quit' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('renders close framing when only keep-running agents are listed', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, {
      props: { open: true, payload: KEEP_RUNNING_ONLY, onRespond },
    });

    expect(await screen.findByRole('alertdialog', { name: 'Close Intent?' })).toBeTruthy();
    expect(screen.queryByText('Will be interrupted')).toBeNull();
    expect(screen.queryByText('Browsers disconnected')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('responds false on Cancel', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, { props: { open: true, payload: FULL_PAYLOAD, onRespond } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('responds false on Escape', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, { props: { open: true, payload: FULL_PAYLOAD, onRespond } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Quit Intent?' });
    await fireEvent.keyDown(dialogEl, { key: 'Escape' });

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('focuses the dialog on open so Escape works without clicking inside', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    // Focus an unrelated element first — the dialog must steal focus on open.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(QuitConfirmationModal, { props: { open: true, payload: FULL_PAYLOAD, onRespond } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Quit Intent?' });
    expect(document.activeElement).toBe(dialogEl);

    // Escape dispatched at the focused element (no prior click inside).
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('exposes alertdialog ARIA semantics', async () => {
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, {
      props: { open: true, payload: FULL_PAYLOAD, onRespond: vi.fn() },
    });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Quit Intent?' });
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(dialogEl.getAttribute('aria-labelledby')).toBe('quit-confirmation-dialog-title');
    expect(dialogEl.getAttribute('aria-describedby')).toBe('quit-confirmation-dialog-description');
  });

  it('responds false on backdrop click', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, { props: { open: true, payload: FULL_PAYLOAD, onRespond } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Quit Intent?' });
    await fireEvent.click(dialogEl.parentElement!);

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('renders nothing when closed or without payload', async () => {
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, {
      props: { open: false, payload: FULL_PAYLOAD, onRespond: vi.fn() },
    });
    render(QuitConfirmationModal, { props: { open: true, payload: null, onRespond: vi.fn() } });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
