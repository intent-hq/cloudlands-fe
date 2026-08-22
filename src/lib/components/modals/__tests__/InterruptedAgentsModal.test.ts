/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
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
  it('renders agents grouped by workspace', async () => {
    const InterruptedAgentsModal = (await import('../InterruptedAgentsModal.svelte')).default;

    render(InterruptedAgentsModal, { props: { open: true, agents: AGENTS } });

    expect(
      await screen.findByRole('alertdialog', { name: 'Agents were interrupted' }),
    ).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Local Agent')).toBeTruthy();
    expect(screen.getByText('Remote Agent')).toBeTruthy();
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
    expect(document.activeElement).toBe(dialogEl);

    // Escape dispatched at the focused element (no prior click inside).
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
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
});
