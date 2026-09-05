/**
 * End-to-end regression coverage for multi-window unread-cycle divergence:
 * per-window Redux stores can miss `workspace:attention-changed` deltas
 * (raise or clear) while unfocused, and the console-owner window's stale
 * store answers hardware key presses. Symptoms: a skipped blue-dot
 * workspace ("No unread agents" toast despite a visible dot elsewhere) and
 * phantom stops with a pinned HUD count ("N more to go" forever).
 *
 * These tests drive the REAL reconciliation path — `lifecycleReadSaga`'s
 * focus / console-owner triggers refetching `workspace.list`, applied by
 * the real `workspaceReducer` — and then execute the real
 * `cycle-unread-agents` action on the converged state.
 */
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspaces: { list: vi.fn(), recentViews: vi.fn(), getTokenUsage: vi.fn(), getContext: vi.fn() },
  tasks: { list: vi.fn(), listAgentLinks: vi.fn() },
  events: { list: vi.fn() },
  skills: { list: vi.fn() },
  scripts: { list: vi.fn() },
  git: {
    prRefresh: vi.fn(),
    status: vi.fn(),
    trackedChanges: vi.fn(),
    commitsWithBoundary: vi.fn(),
  },
  agents: { list: vi.fn(), listWithMeta: vi.fn() },
  terminals: { list: vi.fn() },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: mocks.workspaces,
    tasks: mocks.tasks,
    events: mocks.events,
    skills: mocks.skills,
    scripts: mocks.scripts,
    git: mocks.git,
    agents: mocks.agents,
    terminals: mocks.terminals,
  },
}));
vi.mock('$features/line-changes/line-changes.client', () => ({ getAgentLineStats: vi.fn() }));
vi.mock('$features/agent/utils/pending-agent-deletions', () => ({
  isAgentDeletionPending: vi.fn(),
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../voice/voice-recorder', () => ({ isVoiceRecordingSupported: vi.fn(() => true) }));
vi.mock('../../voice/ptt-controller', () => ({
  handleVoiceKeyDown: vi.fn(),
  handleVoiceKeyUp: vi.fn(),
  isPttRecordingActive: vi.fn(() => false),
}));
vi.mock('../../voice/voice-setup-toast', () => ({ showVoiceSetupToast: vi.fn() }));
vi.mock('$features/layout/panel-layout-adapter', () => ({ getPanelLayoutManager: vi.fn() }));
vi.mock('$features/layout/preset-executor', () => ({
  applyContentPreset: vi.fn(async () => true),
}));

import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '$shared/types';
import {
  actionHudShown,
  consoleOwnerChanged,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  replaceWorkspaceList,
  workspaceReducer,
} from '$store/renderer/slices/workspace/workspace-slice';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { collectUnreadWorkspaceStops } from '../agent-cycle';
import {
  getActionKeyDefinition,
  resetActionKeyCycleCursors,
  type ActionKeyContext,
  type ActionKeyState,
} from '../action-key-registry';
import { DEFAULT_CYCLE_SCOPES } from '../cycle-scope';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

/** A PROTOCOL-shaped `workspace.list` row (attention rides the list emit). */
function wire(id: string, attention: 'none' | 'unread'): Workspace {
  return { id, branch: 'main', attention } as unknown as Workspace;
}

/**
 * Run the real lifecycleReadSaga with a loopback dispatch: dispatched
 * actions are applied by the real workspaceReducer AND re-fed into the
 * channel, so the focus/owner triggers drive `loadWorkspacesRequested` and
 * the store observably converges — one per-window store in miniature.
 */
function startHarness() {
  const channel = stdChannel();
  let workspaceState = workspaceReducer(undefined, { type: '@@INIT' });
  const baseState = {
    tabState: { currentTabId: null },
    workspaceTasks: { byWorkspaceId: {} },
    changes: { agentStats: {}, agentLineStatsRequests: {} },
    agentSessions: { byAgentId: {} },
    workspaceAgents: { byWorkspaceId: {} },
    prStatus: { byWorkspaceId: {} },
  };
  const dispatch = (action: { type: string }) => {
    workspaceState = workspaceReducer(workspaceState, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ ...baseState, workspace: workspaceState }) },
    lifecycleReadSaga,
  );
  return { channel, dispatch, task, workspaces: () => workspaceState.workspaces };
}

async function stop(task: ReturnType<typeof runSaga>) {
  task.cancel();
  await task.toPromise();
}

interface AgentsSpec {
  [wsId: string]: { ids: string[]; activeAgentId?: string | null };
}

/**
 * The cycle-action view of the store: the LIVE workspace collection from
 * the harness (the slice the reconciliation converges) plus static hydrated
 * sessions. Sessions carry no per-agent unread (`lastMessageId`), so each
 * unread workspace yields its single workspace-clearing fallback stop.
 */
function makeCycleState(
  workspaces: Collection<Workspace, 'id'>,
  agents: AgentsSpec,
): ActionKeyState {
  const byWorkspaceId: ActionKeyState['workspaceAgents']['byWorkspaceId'] = {};
  const byAgentId: ActionKeyState['agentSessions']['byAgentId'] = {};
  for (const [wsId, entry] of Object.entries(agents)) {
    byWorkspaceId[wsId] = {
      agentIds: [...entry.ids],
      foregroundAgentIds: entry.ids,
      activeAgentId: entry.activeAgentId ?? null,
    };
    for (const agentId of entry.ids) {
      byAgentId[agentId] = { id: agentId, status: 'Completed', messages: [] } as never;
    }
  }
  return {
    workspace: { workspaces },
    workspaceAgents: { byWorkspaceId },
    agentSessions: { byAgentId },
    hardwareConsole: { cycleScopeByFamily: { ...DEFAULT_CYCLE_SCOPES } },
    sidebarNav: {
      multiSelectTabOrder: [],
      multiSelectSelectedTabIdsByWorkspaceId: {},
    },
    voiceSettings: {
      isLoading: false,
      engine: 'daemon',
      osEngineAvailable: false,
      provider: 'elevenlabs',
      keyConfigured: { elevenlabs: true, openai: false },
    },
    panelLayout: { byWorkspaceId: {} },
  };
}

function makeContext(state: ActionKeyState, workspaceId: string): ActionKeyContext {
  return {
    state,
    workspaceId,
    dispatch: vi.fn(),
    navigate: vi.fn(() => Promise.resolve()),
    focusComposer: vi.fn(),
    showHint: vi.fn(),
  };
}

const definition = () => {
  const def = getActionKeyDefinition('cycle-unread-agents');
  if (!def) throw new Error('cycle-unread-agents not registered');
  return def;
};

describe('unread-cycle reconciliation (multi-window divergence)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetActionKeyCycleCursors();
    mocks.workspaces.recentViews.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skip symptom: a missed unread raise converges on console-owner acquisition and the cycle key steps into the workspace', async () => {
    const run = startHarness();
    // Stale per-window snapshot: the daemon raised unread on ws-2 while this
    // window was unfocused and missed the delta.
    run.dispatch(replaceWorkspaceList([wire('ws-1', 'none'), wire('ws-2', 'none')]));
    const agents: AgentsSpec = {
      'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
      'ws-2': { ids: ['b-1'] },
    };

    // Symptom before reconciliation: the stale store yields no stops, so the
    // key is unavailable and a press would toast "No unread agents" despite
    // the blue dot visible in the other window.
    const staleState = makeCycleState(run.workspaces(), agents);
    const staleContext = makeContext(staleState, 'ws-1');
    expect(collectUnreadWorkspaceStops(staleState)).toEqual([]);
    expect(definition().isAvailable(staleContext)).toBe(false);
    expect(definition().getUnavailableHint?.(staleContext)).toBe(
      m.hardwareConsole_actionKey_noUnreadAgents_message(),
    );

    // This window becomes the console owner: the real saga refetches
    // workspace.list and the real reducer applies the daemon's truth.
    mocks.workspaces.list.mockResolvedValue([wire('ws-1', 'none'), wire('ws-2', 'unread')]);
    run.channel.put(consoleOwnerChanged(true));
    await settle();
    await settle();
    expect(mocks.workspaces.list.mock.calls).toEqual([[{ includeArchived: true }]]);

    const state = makeCycleState(run.workspaces(), agents);
    const context = makeContext(state, 'ws-1');
    expect(collectUnreadWorkspaceStops(state)).toEqual([
      { wsId: 'ws-2', agentId: 'b-1', clearsWorkspace: true },
    ]);
    expect(definition().isAvailable(context)).toBe(true);

    definition().execute(context);
    expect(context.showHint).not.toHaveBeenCalled();
    expect(context.navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(context.dispatch).toHaveBeenCalledWith(setActiveAgentId('ws-2', 'b-1'));
    // Sole stop: the HUD shows the plain label, not a remaining count.
    expect(context.dispatch).toHaveBeenCalledWith(
      actionHudShown(m.hardwareConsole_actionKey_cycleUnreadAgents_label()),
    );
    await stop(run.task);
  });

  it('phantom symptom: stale unread flags drop out on window refocus and the HUD count reflects reality', async () => {
    const run = startHarness();
    // Stale snapshot: ws-2/ws-3/ws-4 unread locally, but the daemon has
    // since cleared ws-2 and ws-3 (read in another window).
    run.dispatch(
      replaceWorkspaceList([
        wire('ws-1', 'none'),
        wire('ws-2', 'unread'),
        wire('ws-3', 'unread'),
        wire('ws-4', 'unread'),
      ]),
    );
    const agents: AgentsSpec = {
      'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
      'ws-2': { ids: ['b-1'] },
      'ws-3': { ids: ['c-1'] },
      'ws-4': { ids: ['d-1'] },
    };

    // Press 1 against the stale store: steps into ws-2 and pins the phantom
    // "2 more to go" — two of the three stops no longer exist daemon-side.
    const staleState = makeCycleState(run.workspaces(), agents);
    const press1 = makeContext(staleState, 'ws-1');
    definition().execute(press1);
    expect(press1.navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(press1.dispatch).toHaveBeenCalledWith(
      actionHudShown(m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_many({ count: 2 })),
    );

    // The window regains focus: the real saga refetches and the store
    // converges on the daemon's truth (only ws-4 still unread).
    mocks.workspaces.list.mockResolvedValue([
      wire('ws-1', 'none'),
      wire('ws-2', 'none'),
      wire('ws-3', 'none'),
      wire('ws-4', 'unread'),
    ]);
    window.dispatchEvent(new Event('focus'));
    await settle();
    await settle();
    expect(mocks.workspaces.list.mock.calls).toEqual([[{ includeArchived: true }]]);

    const state = makeCycleState(run.workspaces(), {
      ...agents,
      'ws-2': { ids: ['b-1'], activeAgentId: 'b-1' },
    });
    // The phantom stops (ws-2, ws-3) dropped out; only the real one remains.
    expect(collectUnreadWorkspaceStops(state)).toEqual([
      { wsId: 'ws-4', agentId: 'd-1', clearsWorkspace: true },
    ]);

    // Press 2: lands on the one genuinely unread workspace with nothing
    // left over — the plain HUD label, not a pinned "N more to go".
    const press2 = makeContext(state, 'ws-2');
    definition().execute(press2);
    expect(press2.navigate).toHaveBeenCalledWith('/workspace/ws-4');
    expect(press2.dispatch).toHaveBeenCalledWith(setActiveAgentId('ws-4', 'd-1'));
    expect(press2.dispatch).toHaveBeenCalledWith(
      actionHudShown(m.hardwareConsole_actionKey_cycleUnreadAgents_label()),
    );
    expect(press2.showHint).not.toHaveBeenCalled();
    await stop(run.task);
  });

  it('phantom symptom: when the daemon has cleared every flag, reconciliation ends the walk instead of cycling phantoms', async () => {
    const run = startHarness();
    run.dispatch(replaceWorkspaceList([wire('ws-1', 'none'), wire('ws-2', 'unread')]));
    const agents: AgentsSpec = {
      'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
      'ws-2': { ids: ['b-1'] },
    };
    expect(
      definition().isAvailable(makeContext(makeCycleState(run.workspaces(), agents), 'ws-1')),
    ).toBe(true);

    mocks.workspaces.list.mockResolvedValue([wire('ws-1', 'none'), wire('ws-2', 'none')]);
    window.dispatchEvent(new Event('focus'));
    await settle();
    await settle();

    const state = makeCycleState(run.workspaces(), agents);
    expect(collectUnreadWorkspaceStops(state)).toEqual([]);
    expect(definition().isAvailable(makeContext(state, 'ws-1'))).toBe(false);
    await stop(run.task);
  });
});
