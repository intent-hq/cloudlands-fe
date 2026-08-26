/**
 * @vitest-environment jsdom
 *
 * AgentCard — read-only "Specialist: {name}" context-menu item
 * (monorepo#3498; `metadata.specialist`).
 *
 * Renders the REAL component against the REAL configured store: seeds an
 * agent session (with/without `metadata.specialist`) plus the specialists
 * slice, opens the context menu, and asserts the item resolves the display
 * name for known ids, falls back to the raw id for unknown ids, and is
 * omitted entirely when the agent has no specialist.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { setBundledSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { Specialist } from '$lib/constants/specialists';

// Distinct agent id per test: the configured store is a process singleton.
let testAgentSeq = 0;
let agentId = '';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'Specialist Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function makeBundledSpecialist(overrides: Partial<Specialist> = {}): Specialist {
  return {
    id: 'implementor',
    name: 'Implementor',
    description: 'Implements tasks',
    codingAgent: 'auggie',
    defaultBehaviorPrompt: '',
    ...overrides,
  } as Specialist;
}

async function openContextMenu() {
  const card = await screen.findByTestId('agent-list-item');
  const button = card.querySelector('button');
  expect(button).not.toBeNull();
  await fireEvent.contextMenu(button!);
}

describe('AgentCard specialist context-menu item', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-specialist-${++testAgentSeq}`;
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
    appStore.dispatch(setBundledSpecialists([]));
  });

  it('shows the resolved display name for a known specialist id', async () => {
    appStore.dispatch(setBundledSpecialists([makeBundledSpecialist()]));
    appStore.dispatch(
      bulkUpsertSessions([makeSession({ metadata: { specialist: 'implementor' } })]),
    );

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText('Specialist: Implementor');
    // Read-only informational entry: disabled, no flyout.
    const menuButton = item.closest('button');
    expect(menuButton).not.toBeNull();
    expect(menuButton!.disabled).toBe(true);
    expect(menuButton!.getAttribute('aria-haspopup')).not.toBe('menu');
  });

  it('falls back to the raw id when the specialist id is unknown', async () => {
    appStore.dispatch(setBundledSpecialists([makeBundledSpecialist()]));
    appStore.dispatch(
      bulkUpsertSessions([makeSession({ metadata: { specialist: 'my-custom-role' } })]),
    );

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    expect(await screen.findByText('Specialist: my-custom-role')).toBeTruthy();
  });

  it('omits the item entirely when the agent has no specialist', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    // Menu is open (Open present) but no specialist entry.
    expect(await screen.findByText('Open')).toBeTruthy();
    expect(screen.queryByText(/^Specialist:/)).toBeNull();
  });

  it('selecting the specialist item does not close the menu (inert info row)', async () => {
    appStore.dispatch(setBundledSpecialists([makeBundledSpecialist()]));
    appStore.dispatch(
      bulkUpsertSessions([makeSession({ metadata: { specialist: 'implementor' } })]),
    );

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText('Specialist: Implementor');
    await fireEvent.click(item.closest('button')!);

    // Disabled item: click is a no-op, the menu stays open.
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Specialist: Implementor')).toBeTruthy();
  });
});
