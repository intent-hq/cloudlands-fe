/**
 * @vitest-environment jsdom
 *
 * AgentCard — sidebar "Pin to top" / "Unpin" context-menu item (PROTOCOL §5.5
 * `AgentLite.pinned`, `agent.update { changes: { pinned } }`).
 *
 * Renders the REAL component against the REAL configured store, opens the
 * context menu, and asserts when the item is offered and which pin intent it
 * dispatches. The mutation itself is intercepted so no daemon call runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { setAgentPinnedRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

let testAgentSeq = 0;
let agentId = '';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'Pinnable Agent',
    status: AgentStatus.Idle,
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
  // Every menu has Rename; wait for it so absence checks run on an open menu.
  await screen.findByText(m.chat_agentCard_menu_rename_label());
}

const pinLabel = () => m.chat_agentCard_menu_pinToTop_label();
const unpinLabel = () => m.chat_agentCard_menu_unpin_label();

describe('AgentCard sidebar pin (PROTOCOL §5.5 pinned)', () => {
  const PIN_ACTION = setAgentPinnedRequested.type;
  let dispatched: Array<{ type: string; payload?: unknown }> = [];

  beforeEach(() => {
    appStore.init();
    agentId = `agent-pin-${++testAgentSeq}`;
    dispatched = [];
    const realDispatch = appStore.dispatch.bind(appStore);
    vi.spyOn(appStore, 'dispatch').mockImplementation((action: any) => {
      dispatched.push(action);
      if (action?.type === PIN_ACTION) return action;
      return realDispatch(action);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    appStore.dispatch(removeSession(agentId));
  });

  it('offers "Pin to top" on an unpinned sidebar row and dispatches the pin', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ pinned: false })]));

    render(AgentCard, { props: { agentId, panelRow: true } });
    await openContextMenu();

    expect(screen.queryByText(unpinLabel())).toBeNull();
    const item = await screen.findByText(pinLabel());
    await fireEvent.click(item.closest('[role="menuitem"]')!);

    const action = dispatched.find((a) => a.type === PIN_ACTION);
    expect(action?.payload).toEqual(['ws-1', agentId, true]);
    await waitFor(() => expect(screen.queryByText(m.chat_agentCard_menu_open_label())).toBeNull());
  });

  it('offers "Unpin" on a pinned row and dispatches the unpin', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ pinned: true })]));

    render(AgentCard, { props: { agentId, panelRow: true } });
    await openContextMenu();

    expect(screen.queryByText(pinLabel())).toBeNull();
    const item = await screen.findByText(unpinLabel());
    await fireEvent.click(item.closest('[role="menuitem"]')!);

    const action = dispatched.find((a) => a.type === PIN_ACTION);
    expect(action?.payload).toEqual(['ws-1', agentId, false]);
  });

  it('hides the item when the daemon does not serve the pin (older daemon)', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));

    render(AgentCard, { props: { agentId, panelRow: true } });
    await openContextMenu();

    expect(screen.queryByText(pinLabel())).toBeNull();
    expect(screen.queryByText(unpinLabel())).toBeNull();
  });

  it('hides the item outside sidebar rows', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ pinned: false })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    expect(screen.queryByText(pinLabel())).toBeNull();
  });

  const NOT_PINNABLE = [
    ['a delegated agent', { parentAgentId: AgentId('parent-agent') }],
    ['a background agent', { isBackground: true }],
    ['a retired agent', { retiredAt: '2026-08-02T00:00:00.000Z' }],
  ] as Array<[string, Partial<AgentSession>]>;

  it.each(NOT_PINNABLE)('does not offer pinning for %s', async (_label, overrides) => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ pinned: false, ...overrides })]));
    render(AgentCard, { props: { agentId, panelRow: true } });
    await openContextMenu();
    expect(screen.queryByText(pinLabel())).toBeNull();
  });

  it.each(NOT_PINNABLE)('still offers unpinning for %s', async (_label, overrides) => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ pinned: true, ...overrides })]));
    render(AgentCard, { props: { agentId, panelRow: true } });
    await openContextMenu();
    expect(await screen.findByText(unpinLabel())).toBeTruthy();
  });
});
