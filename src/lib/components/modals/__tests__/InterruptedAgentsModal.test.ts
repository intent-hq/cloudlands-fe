/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { InterruptedAgent } from '$lib/client/app-client';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const AGENTS: InterruptedAgent[] = [
  {
    agentId: 'a1',
    workspaceId: 'w1',
    workspaceName: 'Alpha',
    agentName: 'Local Agent',
    prevStatus: 'responding',
    interruptedAt: '2026-08-22T10:00:00Z',
  },
  {
    agentId: 'a2',
    workspaceId: 'w2',
    workspaceName: 'Beta',
    agentName: 'Remote Agent',
    prevStatus: 'responding',
    interruptedAt: '2026-08-22T10:01:00Z',
  },
];

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../InterruptedAgentsModal.svelte'));

describe('InterruptedAgentsModal', () => {
  it('selects all agents in a workspace together without abandoning another workspace', async () => {
    const Modal = (await import('../InterruptedAgentsModal.svelte')).default;
    const onResumeSelected = vi.fn();
    render(Modal, {
      open: true,
      agents: [...AGENTS, { ...AGENTS[0], agentId: 'a3' }],
      onResumeSelected,
    });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
    expect(screen.getByRole('button', { name: /Resume selected/ }).hasAttribute('disabled')).toBe(
      true,
    );
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    await fireEvent.click(screen.getByRole('button', { name: /Resume selected/ }));
    expect(onResumeSelected).toHaveBeenCalledExactlyOnceWith(['a1', 'a3'], []);
    expect(screen.getByRole('checkbox', { name: 'Beta' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });
  it('renders agents grouped by workspace', async () => {
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;

    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS } });

    expect(
      await screen.findByRole('alertdialog', { name: 'Agents were interrupted' }),
    ).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByText('Local Agent')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Select All' })).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('starts with all agents selected and explains what happens to unselected agents', async () => {
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS } });

    expect(screen.getByText(/unselected agents stay paused/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Alpha' }).getAttribute('data-state')).toBe(
      'checked',
    );
  });

  it('resumes checked agents and keeps unchecked agents available for later', async () => {
    const onResumeSelected = vi.fn();
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS, onResumeSelected } });

    await fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Resume selected/ }));

    expect(onResumeSelected).toHaveBeenCalledWith(['a1'], []);
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it.each([' '])('toggles the single row option with %s', async (key) => {
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS } });

    const option = screen.getByRole('checkbox', { name: /Alpha/ });
    expect(screen.getAllByRole('checkbox')).toHaveLength(AGENTS.length);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    option.focus();
    await fireEvent.keyDown(option, { key });
    expect(option.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(option);
    await fireEvent.keyDown(option, { key });
    expect(option.getAttribute('aria-checked')).toBe('true');
  });

  it('supports workspace selection, dismissal, and the resume keyboard shortcut', async () => {
    const onResumeSelected = vi.fn();
    const onClose = vi.fn();
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;
    const { rerender } = render(InterruptedAgentsModal, {
      props: { open: true, agents: AGENTS, onResumeSelected, onClose },
    });

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(screen.getByRole('checkbox', { name: /Alpha/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    await fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Enter', ctrlKey: true });
    expect(onResumeSelected).toHaveBeenCalledWith(['a1', 'a2'], []);

    await rerender({ open: true, agents: AGENTS, onResumeSelected, onClose });
    await fireEvent.click(screen.getByRole('button', { name: /Not now/ }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('preserves the explicit abandon-all action contract', async () => {
    const onAbandonAll = vi.fn();
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS, onAbandonAll } });

    await fireEvent.click(screen.getByRole('button', { name: 'Abandon all' }));

    expect(onAbandonAll).not.toHaveBeenCalled();
    expect(screen.getByText(/conversations and queued messages are kept/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Abandon all' }));

    expect(onAbandonAll).toHaveBeenCalledWith(['a1', 'a2']);
  });

  it('focuses the dialog on open so Escape works without clicking inside', async () => {
    const onClose = vi.fn();
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;

    // Focus an unrelated element first — the dialog must steal focus on open.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS, onClose } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Agents were interrupted' });
    await waitFor(() => expect(document.activeElement).toBe(dialogEl));

    // Escape dispatched at the focused element (no prior click inside).
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not re-steal focus when agents change while the modal is open', async () => {
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;

    const { rerender } = render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Agents were interrupted' });
    await waitFor(() => expect(document.activeElement).toBe(dialogEl));

    // A surviving row retains focus when a different workspace is pruned.
    const option = screen.getByRole('checkbox', { name: /Alpha/ });
    option.focus();
    expect(document.activeElement).toBe(option);

    // …then a cross-window prune replaces the agents array mid-open. The
    // focus effect must not re-run and yank focus back to the container.
    await rerender({ open: true, agents: [AGENTS[0]] });

    expect(document.activeElement).toBe(option);
  });

  it('closes on Escape dispatched at the dialog', async () => {
    const onClose = vi.fn();
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;

    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS, onClose } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Agents were interrupted' });
    await fireEvent.keyDown(dialogEl, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('exposes alertdialog ARIA semantics', async () => {
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;

    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'Agents were interrupted' });
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(dialogEl.getAttribute('aria-labelledby')).toBe('interrupted-agents-dialog-title');
    expect(dialogEl.getAttribute('aria-describedby')).toBe('interrupted-agents-dialog-description');
    expect(dialogEl.getAttribute('tabindex')).toBe('-1');
  });

  it('renders nothing when closed or without agents', async () => {
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;

    render(InterruptedAgentsModal, { props: { open: false, agents: AGENTS } });
    render(InterruptedAgentsModal, { props: { open: true, agents: [] } });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not toggle the focused row when resuming with the keyboard shortcut', async () => {
    const onResumeSelected = vi.fn();
    const Modal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(Modal, { open: true, agents: AGENTS, onResumeSelected });
    await fireEvent.keyDown(screen.getByRole('checkbox', { name: /Alpha/ }), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(onResumeSelected).toHaveBeenCalledExactlyOnceWith(['a1', 'a2'], []);
  });

  it('keeps failed agents selected for retry after partial success', async () => {
    const onResumeSelected = vi.fn().mockResolvedValue({
      resumed: ['a1'],
      abandoned: [],
      failed: [{ agentId: 'a2', error: 'Unavailable' }],
    });
    const Modal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(Modal, { open: true, agents: AGENTS, onResumeSelected });
    await fireEvent.click(screen.getByRole('button', { name: /Resume selected/ }));
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.getByRole('checkbox', { name: /Beta/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await fireEvent.click(screen.getByRole('button', { name: /Resume selected/ }));
    expect(onResumeSelected).toHaveBeenLastCalledWith(['a2'], []);
  });

  it('blocks duplicate submission and dismissal until resolution finishes', async () => {
    let finish!: () => void;
    const onResumeSelected = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    const Modal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(Modal, { open: true, agents: AGENTS, onResumeSelected, onClose });
    await fireEvent.click(screen.getByRole('button', { name: /Resume selected/ }));
    await fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Enter', ctrlKey: true });
    await fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onResumeSelected).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('keeps agents and permits retry after a rejected request', async () => {
    const onResumeSelected = vi.fn().mockRejectedValue(new Error('Offline'));
    const Modal = (await import('../InterruptedAgentsModal.svelte')).default;
    render(Modal, { open: true, agents: AGENTS, onResumeSelected });
    await fireEvent.click(screen.getByRole('button', { name: /Resume selected/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Resume selected/ }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: /Resume selected/ }));
    expect(onResumeSelected).toHaveBeenCalledTimes(2);
  });
});
