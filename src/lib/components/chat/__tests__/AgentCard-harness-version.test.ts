/**
 * @vitest-environment jsdom
 *
 * AgentCard — read-only "Harness vX.Y" context-menu item (PROTOCOL §5.5
 * `harnessVersion` / `harnessFeatures`; monorepo#2459).
 * protocol-version-ok-file: harness version strings are agent-harness product fixtures, not protocol versions
 *
 * Renders the REAL component against the REAL configured store: seeds an
 * agent session (with/without `harnessVersion` / `harnessFeatures`), opens
 * the context menu, and asserts the item's visibility, that selecting it
 * opens the read-only harness-features modal, and that legacy/absent
 * shapes render sensibly.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { setAgentNotificationsMutedRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { agentReadSaga } from '$store/renderer/slices/workspace-agents/sagas/agent-read-saga';
import type { AgentSession, Workspace } from '$shared/types';
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

const WORKSPACE = { id: WorkspaceId('ws-1') } as unknown as Workspace;

/** Stub the `agent.get` seam; the real read service / saga run on top of it. */
function stubAgentGet(session: AgentSession | null | (() => Promise<AgentSession | null>)) {
  return vi
    .spyOn(appClient.agents, 'get')
    .mockImplementation(typeof session === 'function' ? session : async () => session);
}

async function flushMicrotasks() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('AgentCard harness version context-menu item', () => {
  // The configured store starts no app sagas; run the real `agent.get` read
  // saga so `ensureAgentSessionLoaded` reaches the (stubbed) client seam.
  let stopReadSaga: (() => void) | undefined;

  beforeEach(() => {
    appStore.init();
    agentId = `agent-harness-${++testAgentSeq}`;
    stopReadSaga = appStore.runSaga(agentReadSaga);
  });

  afterEach(() => {
    stopReadSaga?.();
    stopReadSaga = undefined;
    vi.restoreAllMocks();
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

  // A never-activated session has `harnessVersion` but no snapshot even on
  // the detail read; once that read has landed the item enables and opens the
  // all-OFF modal.
  it('opens the modal for a legacy session without a features snapshot (all OFF)', async () => {
    appStore.dispatch(
      bulkUpsertSessions([makeSession({ harnessVersion: '1.0' })], { listProjection: true }),
    );
    stubAgentGet(makeSession({ harnessVersion: '1.0' }));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText('Harness v1.0');
    const menuButton = item.closest('button');
    expect(menuButton).not.toBeNull();
    await waitFor(() => expect(menuButton!.disabled).toBe(false));

    await fireEvent.click(menuButton!);

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    const states = Array.from(
      dialog.querySelectorAll('[data-testid="harness-feature-state"]'),
    ) as HTMLElement[];
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((el) => el.dataset.enabled === 'false')).toBe(true);
  });

  // §5.5 list projection (intent-hq/intent#5383): the card renders from an
  // `agent.list` row that omits `harnessFeatures`. Mounting over a stored row
  // must not fan out into a per-card `agent.get`; opening the menu pulls the
  // detail read (single-flight per agent), and the harness item stays
  // disabled until that read distinguishes "no snapshot" from "not loaded".
  it('sends no agent.get on mount over a stored slim row; menu open sends one, concurrent opens coalesce', async () => {
    appStore.dispatch(
      bulkUpsertSessions([makeSession({ harnessVersion: '1.0' })], { listProjection: true }),
    );
    let resolveGet!: (session: AgentSession) => void;
    const get = stubAgentGet(
      () => new Promise<AgentSession | null>((resolve) => (resolveGet = resolve)),
    );

    render(AgentCard, { props: { agentId, workspace: WORKSPACE } });
    await screen.findByTestId('agent-list-item');
    await flushMicrotasks();
    expect(get).not.toHaveBeenCalled();

    await openContextMenu();
    const item = await screen.findByText('Harness v1.0');
    const menuButton = item.closest('button')!;
    expect(menuButton.disabled).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(agentId);

    // Re-open while the first read is still in flight: no second request.
    await openContextMenu();
    await flushMicrotasks();
    expect(get).toHaveBeenCalledTimes(1);

    resolveGet(
      makeSession({ harnessVersion: '1.0', harnessFeatures: { structuredQuestions: true } }),
    );

    await waitFor(() => {
      const button = screen.getByText('Harness v1.0').closest('button')!;
      expect(button.disabled).toBe(false);
    });
    await fireEvent.click(screen.getByText('Harness v1.0').closest('button')!);
    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    const state = dialog.querySelector(
      '[data-testid="harness-feature-state"][data-feature="structuredQuestions"]',
    ) as HTMLElement;
    expect(state.dataset.enabled).toBe('true');
  });

  it('still restores a session the store has no row for on mount', async () => {
    const get = stubAgentGet(makeSession({ harnessVersion: '1.0' }));

    render(AgentCard, { props: { agentId, workspace: WORKSPACE } });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith(agentId);
    await waitFor(() => expect(screen.getByText('Harnessed Agent')).toBeTruthy());
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

describe('AgentCard notification mute (PROTOCOL §5.5 notificationsMuted)', () => {
  const MUTE_ACTION = setAgentNotificationsMutedRequested.type;
  let dispatched: Array<{ type: string; payload?: unknown }> = [];

  beforeEach(() => {
    appStore.init();
    agentId = `agent-mute-${++testAgentSeq}`;
    dispatched = [];
    // Intercept only the mute mutation so the test observes the dispatched
    // wire intent without driving the real saga into the daemon client.
    const realDispatch = appStore.dispatch.bind(appStore);
    vi.spyOn(appStore, 'dispatch').mockImplementation((action: any) => {
      dispatched.push(action);
      if (action?.type === MUTE_ACTION) return action;
      return realDispatch(action);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    appStore.dispatch(removeSession(agentId));
  });

  it('offers "Mute notifications" next to Rename and dispatches the mute', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));

    render(AgentCard, { props: { agentId } });
    expect(screen.queryByTestId('agent-card-muted-indicator')).toBeNull();
    await openContextMenu();

    expect(screen.queryByText('Unmute notifications')).toBeNull();
    const item = await screen.findByText('Mute notifications');
    const rename = await screen.findByText('Rename');
    expect(rename.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await fireEvent.click(item.closest('button')!);

    const action = dispatched.find((a) => a.type === MUTE_ACTION);
    expect(action).toBeDefined();
    expect(action!.payload).toEqual(['ws-1', agentId, true]);
    // Selecting the item closes the context menu.
    await waitFor(() => expect(screen.queryByText('Open')).toBeNull());
  });

  it('offers "Unmute notifications" for a muted agent and dispatches the unmute', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ notificationsMuted: true })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    expect(screen.queryByText('Mute notifications')).toBeNull();
    const item = await screen.findByText('Unmute notifications');
    await fireEvent.click(item.closest('button')!);

    const action = dispatched.find((a) => a.type === MUTE_ACTION);
    expect(action!.payload).toEqual(['ws-1', agentId, false]);
  });

  it('shows the bell-slash indicator only while the session is muted', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ notificationsMuted: true })]));

    render(AgentCard, { props: { agentId } });

    const indicator = await screen.findByTestId('agent-card-muted-indicator');
    expect(indicator.getAttribute('aria-label')).toBe('Notifications muted');

    // The agent:updated push converges the flag; the indicator follows without a reload.
    appStore.dispatch(updateSession(agentId, { notificationsMuted: false }));
    await waitFor(() => expect(screen.queryByTestId('agent-card-muted-indicator')).toBeNull());
  });
});
