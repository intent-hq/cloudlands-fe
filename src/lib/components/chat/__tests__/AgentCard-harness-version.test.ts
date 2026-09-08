/**
 * @vitest-environment jsdom
 *
 * AgentCard — read-only "Harness vX.Y" context-menu item (PROTOCOL §5.5
 * `harnessVersion` / `harnessFeatures`; monorepo#2459).
 *
 * Renders the REAL component against the REAL configured store: seeds an
 * agent session (with/without `harnessVersion` / `harnessFeatures`), opens
 * the context menu, and asserts the item's visibility, that selecting it
 * opens the read-only harness-features modal, and that legacy/absent
 * shapes render sensibly.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

// Distinct agent id per test: the configured store is a process singleton.
let testAgentSeq = 0;
let agentId = '';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'Harnessed Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

async function openContextMenu() {
  const card = await screen.findByTestId('agent-list-item');
  const button = card.querySelector('button');
  expect(button).not.toBeNull();
  await fireEvent.contextMenu(button!);
}

describe('AgentCard harness version context-menu item', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-harness-${++testAgentSeq}`;
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
  });

  it('opens the harness-features modal when clicked (features snapshot present)', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({
          harnessVersion: '1.0',
          harnessFeatures: { structuredQuestions: true, taskGraph: false },
        }),
      ]),
    );

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText('Harness v1.0');
    const menuButton = item.closest('button');
    expect(menuButton).not.toBeNull();
    // Enabled, plain menu item (no flyout).
    expect(menuButton!.disabled).toBe(false);
    expect(menuButton!.getAttribute('aria-haspopup')).not.toBe('menu');

    await fireEvent.click(menuButton!);

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    // Selecting the item closes the context menu.
    expect(screen.queryByText('Open')).toBeNull();
    // Settings-page labels, not raw keys; snapshot value wins and catalog
    // keys absent from the snapshot render OFF.
    expect(screen.getByText('Structured questions')).toBeTruthy();
    const states = Array.from(
      dialog.querySelectorAll('[data-testid="harness-feature-state"]'),
    ) as HTMLElement[];
    const stateFor = (key: string) => states.find((el) => el.dataset.feature === key);
    expect(stateFor('structuredQuestions')!.dataset.enabled).toBe('true');
    expect(stateFor('taskGraph')!.dataset.enabled).toBe('false');
    expect(stateFor('backgroundHooks')!.dataset.enabled).toBe('false');
  });

  it('opens the modal for a legacy session without a features snapshot (all OFF)', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ harnessVersion: '1.0' })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText('Harness v1.0');
    const menuButton = item.closest('button');
    expect(menuButton).not.toBeNull();
    expect(menuButton!.disabled).toBe(false);

    await fireEvent.click(menuButton!);

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    const states = Array.from(
      dialog.querySelectorAll('[data-testid="harness-feature-state"]'),
    ) as HTMLElement[];
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((el) => el.dataset.enabled === 'false')).toBe(true);
  });

  it('dismisses the modal with Escape', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({ harnessVersion: '1.0', harnessFeatures: { structuredQuestions: true } }),
      ]),
    );

    render(AgentCard, { props: { agentId } });
    await openContextMenu();
    await fireEvent.click(await screen.findByText('Harness v1.0'));

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders the version verbatim (no reformatting)', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ harnessVersion: '2.3' })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    expect(await screen.findByText('Harness v2.3')).toBeTruthy();
  });

  it('omits the item entirely when the session has no harnessVersion (older daemon)', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    // Menu is open (Open present) but no harness entry.
    expect(await screen.findByText('Open')).toBeTruthy();
    expect(screen.queryByText(/^Harness v/)).toBeNull();
  });
});
