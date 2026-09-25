// Shared boundary mocks and real Redux/saga runtime for encoder effort suites.
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { HardwareConsoleManager, HardwareConsoleStatus } from '../../device/device-manager';
import type { HardwareDeviceModel } from '../../input/types';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';

const mocks = vi.hoisted(() => ({
  state: { current: {} as unknown },
  emit: () => {},
  dispatch: vi.fn(),
  notify: vi.fn(),
}));
export { mocks };
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const module = createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
  mocks.emit = module.store.emitState;
  return module;
});
vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: vi.fn(),
  isHudWindowRenderer: () => false,
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.notify } }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveAgentsClient } = await import('$lib/client/live/live-agents-client');
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { agents: new LiveAgentsClient(), settings: new LiveSettingsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { unregisterMockIpcHandler } from '$shared/ipc-mock-router';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { AgentStatus } from '$shared/types/agent.types';
import {
  hardwareConsoleReducer,
  initialState as hardwareInitial,
  hydrateHardwareConsoleEncoderBehavior,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { agentSessionReducer } from '$store/renderer/slices/agent-session/agent-session-slice';
import { sidebarNavReducer } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { encoderEffortSaga } from '$store/renderer/slices/hardware-console/sagas/encoder-effort-saga';
import { watchHardwareConsoleEncoderHud } from '$store/renderer/slices/hardware-console/sagas/hardware-console-device-saga';
import { installHardwareConsoleEncoder } from '../encoder-service';

export const request = vi.mocked(backendRequest);
export const tasks: Task[] = [];
const disposers: (() => void)[] = [];
const heldReplies = new Set<() => void>();
export const listeners = new Set<() => void>();
export let state: ReturnType<typeof makeState>;
let channel: ReturnType<typeof stdChannel>;
export let bag: Record<string, unknown>;

function session(id: string, workspaceId = 'ws-1'): StoredAgentSession {
  return {
    id,
    workspaceId,
    name: id,
    model: 'model-a',
    provider: 'codex',
    reasoningEffort: null,
    status: AgentStatus.Active,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    messages: [],
  } as StoredAgentSession;
}
function makeState() {
  return {
    hardwareConsole: { ...hardwareInitial },
    tabState: { currentTabId: 'ws-1' as string | null },
    agentSessions: {
      byAgentId: {
        'agent-1': session('agent-1'),
        'agent-2': session('agent-2'),
        'agent-3': session('agent-3', 'ws-2'),
      } as Record<string, StoredAgentSession>,
      agentIdsByWorkspace: {},
    },
    workspaceAgents: {
      byWorkspaceId: {
        'ws-1': { activeAgentId: 'agent-1' as string | null },
        'ws-2': { activeAgentId: 'agent-3' as string | null },
      },
    },
    workspace: {
      workspaces: createCollection('id', [
        {
          id: 'ws-1',
          title: 'First',
          status: 'Active',
          myRole: 'owner',
          lastActivity: '2026-09-01T00:00:00Z',
        },
        {
          id: 'ws-2',
          title: 'Second',
          status: 'Active',
          myRole: 'owner',
          lastActivity: '2026-09-02T00:00:00Z',
        },
      ]),
    },
    model: {
      availableModels: createCollection('value', [
        { value: 'model-a', label: 'Model A', effortLevels: ['low', 'medium', 'high'] },
        { value: 'model-b', label: 'Model B', effortLevels: ['minimal', 'ultra'] },
      ]),
      defaultProviderId: 'codex',
    },
    guestSessions: { sessions: createCollection('id', []), hasReceivedList: true },
    connections: { windowBackendId: 'local', hasReceivedList: true },
    sidebarNav: sidebarNavReducer(undefined, { type: 'init' }),
    daemonHealth: { stats: { protocolVersion: '6.1' } },
  };
}
function setting() {
  return {
    path: 'hardwareConsole.state',
    value: { ...bag },
    revision: 1,
    definition: {
      path: 'hardwareConsole.state',
      type: 'object',
      label: 'Hardware',
      description: 'Preferences',
      category: 'hardwareConsole',
      defaultValue: {},
    },
  };
}
export function publish() {
  // Redux publishes a fresh root for selector-channel caches, even for fixture transitions.
  state = { ...state };
  mocks.state.current = state;
  for (const listener of listeners) listener();
  mocks.emit();
}
export function start(saga: () => Generator) {
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch: mocks.dispatch, getState: reduxStore.getState, context: { reduxStore } },
    saga,
  );
  tasks.push(task);
  return task;
}
export function manager(model: HardwareDeviceModel = 'codex-micro') {
  const raw = new Set<(message: unknown) => void>();
  const statuses = new Set<(status: HardwareConsoleStatus) => void>();
  const fake = {
    status: 'connected' as HardwareConsoleStatus,
    connectedDevice: { model },
    onRawMessage: (listener: (message: unknown) => void) => {
      raw.add(listener);
      return () => raw.delete(listener);
    },
    onStatusChange: (listener: (status: HardwareConsoleStatus) => void) => {
      statuses.add(listener);
      return () => statuses.delete(listener);
    },
    emit(message: unknown) {
      for (const listener of raw) listener(message);
    },
    turn(direction: 'cw' | 'ccw' = 'cw') {
      fake.emit({ m: 'v.oai.hid', p: { k: direction === 'cw' ? 'ENC_CW' : 'ENC_CC', act: 2 } });
    },
    statusChanged(status: HardwareConsoleStatus) {
      fake.status = status;
      for (const listener of statuses) listener(status);
    },
    raw,
    statuses,
  };
  const navigate = vi.fn(async () => {});
  const dispose = installHardwareConsoleEncoder(fake as unknown as HardwareConsoleManager, {
    navigate,
  });
  disposers.push(dispose);
  return { ...fake, navigate, dispose };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Settle responses on teardown even when a scenario assertion fails early. */
export function heldReply() {
  const held = deferred<unknown>();
  const release = () => held.reject(new Error('scenario ended before reply settled'));
  heldReplies.add(release);
  // A queued reply may settle before the serialized client requests it.
  void held.promise.catch(() => {});
  return {
    promise: held.promise,
    resolve(value: unknown) {
      heldReplies.delete(release);
      held.resolve(value);
    },
    reject(error: Error) {
      heldReplies.delete(release);
      held.reject(error);
    },
  };
}
export async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await tick();
}
export function effort(agentId = 'agent-1') {
  return state.agentSessions.byAgentId[agentId]?.reasoningEffort ?? null;
}
export function mutations() {
  return request.mock.calls.filter(([method]) => method === 'agent.update');
}
export function reply(level: string | null = 'low') {
  return {
    success: true,
    agent: {
      id: 'agent-1',
      workspaceId: 'ws-1',
      name: 'First agent',
      status: 'idle',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      model: 'model-a',
      provider: 'codex',
      reasoningEffort: level,
    },
  };
}

export function useEncoderEffortHarness() {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetSettingsReadCacheForTests();
    state = makeState();
    mocks.state.current = state;
    channel = stdChannel();
    bag = {};
    mocks.dispatch.mockImplementation((action) => {
      state = {
        ...state,
        hardwareConsole: hardwareConsoleReducer(state.hardwareConsole, action),
        agentSessions: agentSessionReducer(state.agentSessions, action),
        sidebarNav: sidebarNavReducer(state.sidebarNav, action),
      };
      publish();
      channel.put(action);
      return action;
    });
    request.mockReset().mockImplementation(async (method, params) => {
      if (method === 'settings.get') return setting();
      if (method === 'settings.update') {
        bag = (params as { changes: { value: Record<string, unknown> }[] }).changes[0].value;
        return { applied: (params as { changes: unknown[] }).changes, revision: 2 };
      }
      if (method === 'agent.update')
        return reply(
          (params as { changes: { reasoningEffort: string | null } }).changes.reasoningEffort,
        );
      throw new Error(`Unexpected method ${method}`);
    });
    start(encoderEffortSaga);
    start(watchHardwareConsoleEncoderHud);
  });
  afterEach(async () => {
    disposers.splice(0).forEach((dispose) => dispose());
    for (const task of tasks.splice(0)) {
      task.cancel();
      await task.toPromise();
    }
    // An assertion can fail before a scenario settles its held replies. Release
    // those promises through the real writer so one failed row cannot strand
    // the next row behind an unfinished same-agent queue.
    for (const release of heldReplies) release();
    heldReplies.clear();
    await flush();
    cleanup();
    unregisterMockIpcHandler(AGENT_CHANNELS.SET_MODEL);
    listeners.clear();
    vi.useRealTimers();
  });
}

export function ready() {
  mocks.dispatch(hydrateHardwareConsoleEncoderBehavior('agent-effort'));
}
