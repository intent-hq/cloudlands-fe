/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';
import type { WorkspaceId } from '$shared/types';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const FULL_PAYLOAD: QuitConfirmationShowPayload = {
  requestId: 'req-1',
  interrupted: [
    { agentId: 'a1', agentName: 'Local Agent', workspaceId: 'w1', workspaceName: 'Alpha' },
  ],
  disruptedBrowserTabs: [
    { tabId: 't1', ownerAgentId: 'a1', ownerAgentName: 'Local Agent', title: 'Docs page' },
  ],
};

const TABS_ONLY: QuitConfirmationShowPayload = {
  requestId: 'req-2',
  interrupted: [],
  disruptedBrowserTabs: [
    { tabId: 't1', ownerAgentId: 'a2', ownerAgentName: 'Tab Owner', title: 'Docs page' },
  ],
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../QuitConfirmationModal.svelte'));

describe('QuitConfirmationModal', () => {
  it('resolves browser-only workspace identities without inventing names for missing metadata', async () => {
    const Modal = (await import('../QuitConfirmationModal.svelte')).default;
    render(Modal, {
      open: true,
      workspaceDetails: [
        {
          id: 'w1' as WorkspaceId,
          title: 'Design system',
          repositoryOwner: 'intent-hq',
          repositoryName: 'intent',
          branch: 'design',
        },
      ],
      payload: {
        requestId: 'identities',
        interrupted: [],
        disruptedBrowserTabs: [
          { tabId: 't1', ownerAgentId: 'a1', workspaceId: 'w1' },
          { tabId: 't2', ownerAgentId: 'a2', workspaceId: 'w2' },
        ],
      },
    });
    const named = await screen.findByRole('listitem', { name: 'Design system' });
    expect(within(named).getByText('intent-hq/intent')).toBeTruthy();
    expect(named.querySelector('img')?.getAttribute('src')).toContain('github.com/intent-hq.png');
    const missing = screen.getByRole('listitem', { name: 'Untitled' });
    expect(within(missing).getByText('w2')).toBeTruthy();
    expect(screen.getByRole('alertdialog').getAttribute('aria-describedby')).toBeTruthy();
  });
  it('counts browsers per workspace, including owner fallback and explicit workspace overrides', async () => {
    const Modal = (await import('../QuitConfirmationModal.svelte')).default;
    render(Modal, {
      open: true,
      payload: {
        requestId: 'workspace-counts',
        interrupted: FULL_PAYLOAD.interrupted,
        disruptedBrowserTabs: [
          { tabId: 't1', ownerAgentId: 'a1' },
          { tabId: 't2', ownerAgentId: 'a1', workspaceId: 'w1' },
          { tabId: 't3', ownerAgentId: 'a1', workspaceId: 'w2' },
          { tabId: 't4', ownerAgentId: 'unknown' },
        ],
      },
    });
    expect(
      within(screen.getByRole('listitem', { name: 'Alpha' })).getByRole('img', {
        name: '2 browsers',
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('listitem', { name: 'Untitled' })).getByRole('img', {
        name: '1 browser',
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('listitem', { name: 'Other' })).getByRole('img', {
        name: '1 browser',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('alertdialog', { description: "We'll stop 1 agent and close 4 browsers." }),
    ).toBeTruthy();
  });
  it('renders quit framing with grouped content and responds true on Quit', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, { props: { open: true, payload: FULL_PAYLOAD, onRespond } });

    expect(await screen.findByRole('alertdialog', { name: 'Quit Intent?' })).toBeTruthy();
    expect(screen.queryByText('Local Agent')).toBeNull();
    expect(screen.queryByText('Docs page')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Quit' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('keeps the quit framing when only disrupted tabs are listed', async () => {
    const onRespond = vi.fn();
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;

    render(QuitConfirmationModal, { props: { open: true, payload: TABS_ONLY, onRespond } });

    expect(await screen.findByRole('alertdialog', { name: 'Quit Intent?' })).toBeTruthy();
    expect(screen.queryByText('Local Agent')).toBeNull();
    expect(screen.queryByText('Docs page')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Quit' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('groups interrupted agents and owner tabs together, keeping unassigned agents separate', async () => {
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;
    render(QuitConfirmationModal, {
      props: {
        open: true,
        payload: {
          ...FULL_PAYLOAD,
          interrupted: [
            ...FULL_PAYLOAD.interrupted,
            { agentId: 'a2', agentName: 'Remote Agent', workspaceId: 'w1', workspaceName: 'Alpha' },
            { agentId: 'a3', agentName: 'Unassigned Agent' },
            {
              agentId: 'a4',
              agentName: 'Second workspace agent',
              workspaceId: 'w2',
              workspaceName: 'Alpha',
            },
          ],
        },
      },
    });
    const groups = await screen.findAllByRole('listitem', { name: 'Alpha' });
    expect(groups).toHaveLength(2);
    const agentIds = (row: HTMLElement) =>
      Array.from(
        row.querySelectorAll('[data-quit-agent-stack] [data-agent-avatar-stack-agent-id]'),
        (avatar) => avatar.getAttribute('data-agent-avatar-stack-agent-id'),
      );
    expect(agentIds(groups[0])).toEqual(['a1', 'a2']);
    expect(agentIds(groups[1])).toEqual(['a4']);
    expect(agentIds(screen.getByRole('listitem', { name: 'Other' }))).toEqual(['a3']);
    expect(screen.queryByText('Docs page')).toBeNull();
  });

  it('keeps tabs-only workspaces and quit behavior when there are no agents', async () => {
    const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;
    const onRespond = vi.fn();
    render(QuitConfirmationModal, {
      props: {
        open: true,
        onRespond,
        payload: {
          requestId: 'tabs-only',
          interrupted: [],
          disruptedBrowserTabs: [
            {
              tabId: 'tab',
              ownerAgentId: 'missing',
              workspaceId: 'w3',
              url: 'https://example.com',
            },
          ],
        },
      },
    });
    expect(await screen.findByRole('listitem', { name: 'Untitled' })).toBeTruthy();
    expect(screen.queryByText('https://example.com')).toBeNull();
    expect(screen.queryByRole('listitem', { name: 'Other' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(onRespond).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([
    [1, 0, "We'll stop 1 agent in 1 workspace."],
    [3, 0, "We'll stop 3 agents in 1 workspace."],
    [0, 1, "We'll close 1 browser."],
    [0, 2, "We'll close 2 browsers."],
    [1, 1, "We'll stop 1 agent and close 1 browser."],
    [3, 2, "We'll stop 3 agents and close 2 browsers in 1 workspace."],
  ])(
    'describes affected counts for %i agents and %i browsers',
    async (agents, browsers, summary) => {
      const QuitConfirmationModal = (await import('../QuitConfirmationModal.svelte')).default;
      render(QuitConfirmationModal, {
        props: {
          open: true,
          payload: {
            requestId: 'counts',
            interrupted: Array.from({ length: agents }, (_, i) => ({
              ...FULL_PAYLOAD.interrupted[0],
              agentId: `a${i}`,
            })),
            disruptedBrowserTabs: Array.from({ length: browsers }, (_, i) => ({
              ...FULL_PAYLOAD.disruptedBrowserTabs[0],
              tabId: `t${i}`,
            })),
          },
        },
      });
      expect(await screen.findByRole('alertdialog', { description: summary })).toBeTruthy();
    },
  );

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

    await screen.findByRole('alertdialog', { name: 'Quit Intent?' });
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(overlay, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
    });

    await waitFor(() => expect(onRespond).toHaveBeenCalledExactlyOnceWith(false));
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
