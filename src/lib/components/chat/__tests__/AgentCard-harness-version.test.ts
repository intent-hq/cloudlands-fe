/**
 * @vitest-environment jsdom
 *
 * AgentCard — read-only "Harness vX.Y" context-menu item (PROTOCOL §5.5
 * `harnessVersion`; monorepo#2459).
 *
 * Renders the REAL component against the REAL configured store: seeds an
 * agent session (with/without `harnessVersion`), opens the context menu, and
 * asserts the item's visibility, disabled state, and that clicking it does
 * not close the menu (informational, not an action).
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

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

  it('shows a disabled "Harness v1.0" item when the session carries harnessVersion', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ harnessVersion: '1.0' })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText('Harness v1.0');
    const menuButton = item.closest('button');
    expect(menuButton).not.toBeNull();
    expect(menuButton!.disabled).toBe(true);
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

  it('does not close the menu when the disabled item is clicked', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ harnessVersion: '1.0' })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText('Harness v1.0');
    await fireEvent.click(item);

    // Still rendered: a disabled menu item is inert.
    expect(screen.queryByText('Harness v1.0')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeTruthy();
  });
});
