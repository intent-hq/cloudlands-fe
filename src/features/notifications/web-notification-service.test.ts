import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockState, mockPlayNotificationSound, mockBackendRequest } = vi.hoisted(
  () => {
    const mockState = {
      userPreferences: {
        enabled: true,
        soundEnabled: true,
        soundOnlyWhenUnfocused: false,
        volume: 0.5,
      },
      tabState: { currentTabId: null as string | null },
    };
    return {
      mockState,
      mockAppStore: {
        state: mockState,
        dispatch: vi.fn(),
        createSelector: (selector: (state: typeof mockState) => unknown) => ({
          select: (state: typeof mockState) => selector(state),
        }),
      },
      mockPlayNotificationSound: vi.fn(() => Promise.resolve()),
      mockBackendRequest: vi.fn(),
    };
  },
);

vi.mock('$store/renderer/store', () => ({
  store: mockAppStore,
}));

vi.mock('$lib/utils/notification-sound', () => ({
  playNotificationSound: mockPlayNotificationSound,
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mockBackendRequest,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

// Import after mocking
import {
  handleWebAgentIdle,
  showTestWebNotification,
  requestWebNotificationPermission,
  __resetWebNotificationServiceForTesting,
  __getActiveWebNotificationCountForTesting,
} from './web-notification-service';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import type { AgentIdleEvent } from '$features/events/types';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';

/** Mock browser Notification API capturing constructor calls + instances. */
class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => MockNotification.permission);
  static instances: MockNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: { body?: string; tag?: string },
  ) {
    MockNotification.instances.push(this);
  }
}

function makeIdleEvent(overrides: Partial<AgentIdleEvent['data']> = {}, workspaceId = 'ws-1') {
  return {
    type: 'agent:idle',
    workspaceId,
    timestamp: new Date().toISOString(),
    data: { agentId: 'agent-1', agentName: 'My Agent', ...overrides },
  } as unknown as AgentIdleEvent;
}

/** §5.5 AgentLite row subset the idle-gate stub serves (`agent.get` by id, `agent.listActive` busy subset). */
interface AgentRow {
  id: string;
  workspaceId?: string;
  name?: string;
  status?: string;
  isStreaming?: boolean;
  isResponding?: boolean;
  notificationsMuted?: boolean;
  metadata?: { isBackground?: boolean; specialist?: string };
}

/** Workspace rows (PROTOCOL §5.5 AgentLite subset) where only the idle agent exists (no suppression). */
const SOLO_AGENT_LIST: { agents: AgentRow[] } = {
  agents: [
    {
      id: 'agent-1',
      name: 'My Agent',
      status: 'idle',
      isStreaming: false,
      isResponding: false,
      metadata: { isBackground: false },
    },
  ],
};

/** Daemon settings paths the service reads per idle event (PROTOCOL §5.12). */
const SETTINGS_PATHS = ['notifications.enabled', 'notifications.soundOnlyWhenUnfocused'];

/** PROTOCOL §5.12 `settings.get` result envelope for a notifications.* boolean. */
function settingsGetResult(path: string, value: unknown) {
  return {
    path,
    value,
    origin: 'default',
    definition: {
      path,
      label: path,
      description: 'Notification preference',
      category: 'notifications',
      type: 'boolean',
      defaultValue: true,
    },
  };
}

/**
 * Exact-wire backendRequest stub (AGENTS.md wire-testing rule): each served
 * method asserts the precise request it receives — `settings.get` must carry
 * exactly `{ path }` with a known notifications.* path, `agent.get` exactly
 * `{ agentId, workspaceId }` and `workspace.get` exactly `{ workspaceId }`
 * with an expected id, `agent.listActive` exactly `{}` (daemon-global) — and
 * answers with PROTOCOL-shaped payloads. `agent.get` for a row absent from
 * `agentListResult` rejects with the daemon's `not-found` shape;
 * `agent.listActive` serves the `isStreaming || isResponding` rows as
 * `streams` (each stamped with its row `workspaceId`, defaulting to the first
 * expected id). Unexpected methods/params throw, which the service folds to
 * its failure paths; tests where that fold is indistinguishable from
 * legitimate suppression ALSO assert the exact `mockBackendRequest.mock.calls`
 * transcript after acting.
 */
function stubBackendWire({
  workspaceIds = ['ws-1'],
  settingsValues,
  settingsError = false,
  agentListResult = SOLO_AGENT_LIST,
  workspaceGetResult,
}: {
  workspaceIds?: string[];
  settingsValues?: Record<string, boolean>;
  settingsError?: boolean;
  agentListResult?: { agents: AgentRow[] };
  workspaceGetResult?: { workspace: { id: string; title: string } };
} = {}): void {
  mockBackendRequest.mockImplementation(async (method: string, params?: unknown) => {
    if (method === 'settings.get') {
      const path = (params as { path?: string } | undefined)?.path ?? '';
      expect(SETTINGS_PATHS).toContain(path);
      expect(params).toEqual({ path });
      if (settingsError) throw new Error('daemon unavailable');
      const values = settingsValues ?? {
        'notifications.enabled': mockState.userPreferences.enabled,
        'notifications.soundOnlyWhenUnfocused': mockState.userPreferences.soundOnlyWhenUnfocused,
      };
      // Guard against a missing key silently serving value: undefined, which
      // would make fetchNotificationPrefs() fall back to the store and let
      // tests pass for the wrong reason.
      expect(typeof values[path]).toBe('boolean');
      return settingsGetResult(path, values[path]);
    }
    if (method === 'agent.listActive') {
      expect(params).toEqual({});
      return {
        streams: agentListResult.agents
          .filter((row) => row.isStreaming === true || row.isResponding === true)
          .map((row) => ({ agentId: row.id, workspaceId: row.workspaceId ?? workspaceIds[0] })),
      };
    }
    if (method === 'agent.get') {
      const { agentId, workspaceId } = (params ?? {}) as { agentId?: string; workspaceId?: string };
      expect(workspaceIds).toContain(workspaceId);
      expect(params).toEqual({ agentId, workspaceId });
      const row = agentListResult.agents.find((candidate) => candidate.id === agentId);
      if (!row) {
        throw Object.assign(new Error(`Agent not found: ${agentId}`), {
          rpcCode: -32602,
          data: { code: 'not-found' },
        });
      }
      return { agent: row };
    }
    if (method === 'workspace.get') {
      const workspaceId = (params as { workspaceId?: string } | undefined)?.workspaceId ?? '';
      expect(workspaceIds).toContain(workspaceId);
      expect(params).toEqual({ workspaceId });
      // Default workspace.get fixture is keyed to the REQUESTED id so
      // multi-workspace tests get a per-id-consistent Workspace envelope.
      return workspaceGetResult ?? { workspace: { id: workspaceId, title: 'My Workspace' } };
    }
    throw new Error(`Unexpected backendRequest method: ${method}`);
  });
}

/**
 * The exact wire transcript one handleWebAgentIdle run produces: the settings
 * reads, then the bounded idle gate (`agent.get` for the idle agent, the
 * daemon-global `agent.listActive` busy set, one `agent.get` per active
 * sibling in `siblingIds`), then `workspace.get`.
 */
function idleWireCalls(
  workspaceId = 'ws-1',
  {
    idleGate = true,
    busySet = true,
    siblingIds = [],
    workspaceGet = true,
  }: { idleGate?: boolean; busySet?: boolean; siblingIds?: string[]; workspaceGet?: boolean } = {},
): unknown[][] {
  const calls: unknown[][] = [
    ['settings.get', { path: 'notifications.enabled' }],
    ['settings.get', { path: 'notifications.soundOnlyWhenUnfocused' }],
  ];
  if (idleGate) {
    calls.push(['agent.get', { agentId: 'agent-1', workspaceId }]);
    if (busySet) calls.push(['agent.listActive', {}]);
    for (const agentId of siblingIds) calls.push(['agent.get', { agentId, workspaceId }]);
  }
  if (workspaceGet) calls.push(['workspace.get', { workspaceId }]);
  return calls;
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('web-notification-service', () => {
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetSettingsReadCacheForTests();
    __resetWebNotificationServiceForTesting();
    mockState.userPreferences.enabled = true;
    mockState.userPreferences.soundEnabled = true;
    mockState.userPreferences.soundOnlyWhenUnfocused = false;
    mockState.userPreferences.volume = 0.5;
    mockState.tabState.currentTabId = null;
    MockNotification.permission = 'granted';
    MockNotification.instances = [];
    MockNotification.requestPermission = vi.fn(async () => MockNotification.permission);
    vi.stubGlobal('Notification', MockNotification);
    stubBackendWire();
    hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    hasFocusSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  describe('trigger conditions (Electron NotificationService parity)', () => {
    it('shows a notification with the Electron title/body format', async () => {
      await handleWebAgentIdle(makeIdleEvent({ specialist: 'implementor', taskTitle: 'Fix bug' }));

      expect(MockNotification.instances).toHaveLength(1);
      expect(MockNotification.instances[0].title).toBe('My Workspace - Implementor: Fix bug');
      expect(MockNotification.instances[0].options?.body).toBe('Task completed');
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('tags idle notifications with workspaceId:agentId so same-agent banners replace', async () => {
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
      expect(MockNotification.instances[0].options?.tag).toBe('ws-1:agent-1');
    });

    it('sound gate still runs on every tagged idle notification', async () => {
      await handleWebAgentIdle(makeIdleEvent());
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(MockNotification.instances).toHaveLength(2);
      expect(MockNotification.instances[0].options?.tag).toBe('ws-1:agent-1');
      expect(MockNotification.instances[1].options?.tag).toBe('ws-1:agent-1');
      expect(mockPlayNotificationSound).toHaveBeenCalledTimes(2);
    });

    it('evicts the replaced same-tag notification from the strong-ref set even without onclose (leak regression)', async () => {
      await handleWebAgentIdle(makeIdleEvent());
      await handleWebAgentIdle(makeIdleEvent());
      await handleWebAgentIdle(makeIdleEvent());

      // Three same-tag idles, no onclose fired: only the latest survives.
      expect(MockNotification.instances).toHaveLength(3);
      expect(__getActiveWebNotificationCountForTesting()).toBe(1);

      // Closing the survivor drains the set.
      MockNotification.instances[2].onclose?.();
      expect(__getActiveWebNotificationCountForTesting()).toBe(0);
    });

    it('distinct-tag notifications never evict each other', async () => {
      stubBackendWire({ workspaceIds: ['ws-1', 'ws-2'] });
      await handleWebAgentIdle(makeIdleEvent());
      await handleWebAgentIdle(makeIdleEvent({ agentId: 'agent-1' }, 'ws-2'));

      expect(MockNotification.instances).toHaveLength(2);
      expect(__getActiveWebNotificationCountForTesting()).toBe(2);
    });

    it('falls back to "Agent"/"Finished" without specialist/taskTitle/workspace title', async () => {
      stubBackendWire({ workspaceGetResult: { workspace: { id: 'ws-1', title: '' } } });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances[0].title).toBe('Agent');
      expect(MockNotification.instances[0].options?.body).toBe('Finished');
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('skips when notifications are disabled (store fallback on daemon read failure)', async () => {
      mockState.userPreferences.enabled = false;
      stubBackendWire({ settingsError: true });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('prefers fresh daemon notifications.enabled over the store (refreshPrefs parity)', async () => {
      mockState.userPreferences.enabled = true;
      stubBackendWire({
        settingsValues: {
          'notifications.enabled': false,
          'notifications.soundOnlyWhenUnfocused': false,
        },
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('skips background agents (event fast path)', async () => {
      await handleWebAgentIdle(makeIdleEvent({ isBackground: true }));

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('skips background agents (agent.get metadata) without reading the busy set', async () => {
      stubBackendWire({
        agentListResult: {
          agents: [
            {
              id: 'agent-1',
              name: 'My Agent',
              status: 'idle',
              isStreaming: false,
              isResponding: false,
              metadata: { isBackground: true },
            },
          ],
        },
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { busySet: false, workspaceGet: false }),
      );
    });

    it('notifies when the idle agent row is not-found and the busy set is empty', async () => {
      stubBackendWire({ agentListResult: { agents: [] } });
      await handleWebAgentIdle(makeIdleEvent());

      // A `not-found` row means no flags — parity with the old empty
      // `agent.list`: the gate falls through to the busy set and notifies.
      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('skips when the agent is waiting on other agents (event fast path, no idle-gate read)', async () => {
      await handleWebAgentIdle(makeIdleEvent({ isWaitingForOtherAgents: true }));

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('does not skip when isWaitingForOtherAgents is false (existing behavior)', async () => {
      await handleWebAgentIdle(makeIdleEvent({ isWaitingForOtherAgents: false }));

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('does not skip when isWaitingForOtherAgents is absent (older daemons)', async () => {
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('skips when the agent is waiting on active hooks (event fast path, no idle-gate read)', async () => {
      await handleWebAgentIdle(
        makeIdleEvent({ waitingOnHooks: [{ hookId: 'hook-1', name: 'Watch CI' }] }),
      );

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('does not skip when waitingOnHooks is empty', async () => {
      await handleWebAgentIdle(makeIdleEvent({ waitingOnHooks: [] }));

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('does not skip when waitingOnHooks is absent (older daemons)', async () => {
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('skips when the agent is waiting on active PR monitors (event fast path, no idle-gate read)', async () => {
      await handleWebAgentIdle(
        makeIdleEvent({
          waitingOnPrMonitors: [{ monitorId: 'mon-1', repo: 'intent-hq/intentd', prNumber: 42 }],
        }),
      );

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('does not skip when waitingOnPrMonitors is empty', async () => {
      await handleWebAgentIdle(makeIdleEvent({ waitingOnPrMonitors: [] }));

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('does not skip when waitingOnPrMonitors is absent (older daemons)', async () => {
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('skips when the workspace is archived (event fast path, no idle-gate read)', async () => {
      await handleWebAgentIdle(makeIdleEvent({ workspaceArchived: true }));

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('does not skip when workspaceArchived is false', async () => {
      await handleWebAgentIdle(makeIdleEvent({ workspaceArchived: false }));

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('does not skip when workspaceArchived is absent (older daemons)', async () => {
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('skips when other agents are still active in the workspace', async () => {
      stubBackendWire({
        agentListResult: {
          agents: [
            ...SOLO_AGENT_LIST.agents,
            {
              id: 'agent-2',
              name: 'Busy Agent',
              status: 'active',
              isStreaming: true,
              isResponding: false,
              metadata: { isBackground: false },
            },
          ],
        },
      });
      await handleWebAgentIdle(makeIdleEvent());

      // Bounded transcript: busy set, then ONE `agent.get` for the active
      // sibling — never an unscoped `agent.list`.
      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { siblingIds: ['agent-2'], workspaceGet: false }),
      );
    });

    it('ignores busy streams from OTHER workspaces in the daemon-global busy set', async () => {
      stubBackendWire({
        agentListResult: {
          agents: [
            ...SOLO_AGENT_LIST.agents,
            {
              id: 'agent-elsewhere',
              workspaceId: 'ws-2',
              isStreaming: true,
              isResponding: true,
            },
          ],
        },
      });
      await handleWebAgentIdle(makeIdleEvent());

      // The foreign stream is filtered client-side; its row is never read.
      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('drops the notification when agent.listActive fails (parity with a failed agent.list)', async () => {
      stubBackendWire();
      const stub = mockBackendRequest.getMockImplementation()!;
      mockBackendRequest.mockImplementation(async (method: string, params?: unknown) => {
        if (method === 'agent.listActive') throw new Error('daemon unavailable');
        return stub(method, params);
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls('ws-1', { workspaceGet: false }));
    });

    it('skips muted agents (event fast path): no banner, no sound, no idle-gate read', async () => {
      await handleWebAgentIdle(makeIdleEvent({ notificationsMuted: true }));

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { idleGate: false, workspaceGet: false }),
      );
    });

    it('skips muted agents (agent.get notificationsMuted): no banner, no sound, no busy-set read', async () => {
      stubBackendWire({
        agentListResult: {
          agents: [
            {
              id: 'agent-1',
              name: 'My Agent',
              status: 'idle',
              isStreaming: false,
              isResponding: false,
              notificationsMuted: true,
              metadata: { isBackground: false },
            },
          ],
        },
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { busySet: false, workspaceGet: false }),
      );
    });

    it('does not let a running MUTED sibling hold the other-agents-active gate', async () => {
      stubBackendWire({
        agentListResult: {
          agents: [
            ...SOLO_AGENT_LIST.agents,
            {
              id: 'agent-2',
              name: 'Muted Busy Agent',
              status: 'active',
              isStreaming: true,
              isResponding: false,
              notificationsMuted: true,
              metadata: { isBackground: false },
            },
          ],
        },
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls('ws-1', { siblingIds: ['agent-2'] }),
      );
    });

    it('enriches specialist from agent.get metadata when the payload lacks it', async () => {
      stubBackendWire({
        agentListResult: {
          agents: [
            {
              id: 'agent-1',
              name: 'My Agent',
              status: 'idle',
              isStreaming: false,
              isResponding: false,
              metadata: { isBackground: false, specialist: 'verifier' },
            },
          ],
        },
        workspaceGetResult: { workspace: { id: 'ws-1', title: 'WS' } },
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances[0].title).toBe('WS - Verifier');
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('titles chief completions with the chat thread name and skips workspace.get', async () => {
      stubBackendWire({ workspaceIds: [CHIEF_WORKSPACE_ID] });
      await handleWebAgentIdle(
        makeIdleEvent({ agentName: 'Morning check-in' }, CHIEF_WORKSPACE_ID),
      );

      expect(MockNotification.instances[0].title).toBe('Assistant — Morning check-in');
      expect(mockBackendRequest.mock.calls).toEqual(
        idleWireCalls(CHIEF_WORKSPACE_ID, { workspaceGet: false }),
      );
    });

    it('suppresses the banner when focused viewing the workspace with soundOnlyWhenUnfocused (sound gate still runs and declines while focused)', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      mockState.tabState.currentTabId = 'ws-1';
      hasFocusSpy.mockReturnValue(true);

      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(MockNotification.instances).toHaveLength(0);
      // Electron parity: notification:show is still sent, but the renderer
      // sound gate itself skips playback while focused with this setting on.
      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
      // Suppression happens AFTER content is built, so the full wire sequence runs.
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('shows the banner when focused on a DIFFERENT workspace with soundOnlyWhenUnfocused', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      mockState.tabState.currentTabId = 'ws-other';
      hasFocusSpy.mockReturnValue(true);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('shows the banner when focused viewing the workspace with soundOnlyWhenUnfocused OFF', async () => {
      mockState.tabState.currentTabId = 'ws-1';
      hasFocusSpy.mockReturnValue(true);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
    });
  });

  describe('permission gating', () => {
    it('requests permission lazily at the first notification attempt', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => 'granted' as NotificationPermission);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
      expect(MockNotification.instances).toHaveLength(1);
    });

    it('degrades silently when permission is denied (sound still plays)', async () => {
      MockNotification.permission = 'denied';

      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockPlayNotificationSound).toHaveBeenCalled();
    });

    it('degrades silently when the user dismisses the request (stays default)', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => 'default' as NotificationPermission);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
      // Permission gating happens after the full wire sequence has run.
      expect(mockBackendRequest.mock.calls).toEqual(idleWireCalls());
    });

    it('coalesces concurrent permission prompts into one requestPermission call', async () => {
      stubBackendWire({ workspaceIds: ['ws-1', 'ws-2'] });
      MockNotification.permission = 'default';
      let resolvePrompt!: (value: NotificationPermission) => void;
      MockNotification.requestPermission = vi.fn(
        () => new Promise<NotificationPermission>((resolve) => (resolvePrompt = resolve)),
      );

      const first = handleWebAgentIdle(makeIdleEvent());
      const second = handleWebAgentIdle(makeIdleEvent({ agentId: 'agent-1' }, 'ws-2'));
      await flushAsync();
      resolvePrompt('granted');
      await Promise.all([first, second]);

      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
      expect(MockNotification.instances).toHaveLength(2);
    });
  });

  describe('click navigation', () => {
    it('focuses the tab and navigates to the workspace on click', async () => {
      const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
      await handleWebAgentIdle(makeIdleEvent());

      MockNotification.instances[0].onclick?.();
      await flushAsync();

      expect(focusSpy).toHaveBeenCalled();
      expect(goto).toHaveBeenCalledWith('/workspace/ws-1');
      expect(MockNotification.instances[0].close).toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it('opens the Assistant panel and selects the thread for chief clicks', async () => {
      stubBackendWire({ workspaceIds: [CHIEF_WORKSPACE_ID] });
      vi.spyOn(window, 'focus').mockImplementation(() => {});
      await handleWebAgentIdle(makeIdleEvent({ agentName: 'Chat' }, CHIEF_WORKSPACE_ID));

      MockNotification.instances[0].onclick?.();
      await flushAsync();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(setChiefActiveAgentId('agent-1'));
      expect(mockAppStore.dispatch).toHaveBeenCalledWith(openPanel('chief'));
      expect(goto).not.toHaveBeenCalled();
    });
  });

  describe('sound settings matrix', () => {
    it('plays at the configured volume', async () => {
      mockState.userPreferences.volume = 0.8;
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.8);
    });

    it('does not play when soundEnabled is off (banner still shows)', async () => {
      mockState.userPreferences.soundEnabled = false;
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
      expect(MockNotification.instances).toHaveLength(1);
    });

    it('does not play when soundOnlyWhenUnfocused is on and the document has focus', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(true);
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
    });

    it('plays when soundOnlyWhenUnfocused is on and the document is unfocused', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(false);
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });
  });

  describe('test notification + permission envelopes', () => {
    it('showTestWebNotification shows the Electron-parity test payload without a tag', async () => {
      const result = await showTestWebNotification();

      expect(result).toEqual({ success: true });
      expect(MockNotification.instances[0].title).toBe('Agent');
      expect(MockNotification.instances[0].options?.body).toBe('Test notification');
      expect(MockNotification.instances[0].options).not.toHaveProperty('tag');
    });

    it('showTestWebNotification folds a denied permission to a shaped failure', async () => {
      MockNotification.permission = 'denied';
      const result = await showTestWebNotification();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('requestWebNotificationPermission returns { success, granted } envelopes', async () => {
      expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: true });

      __resetWebNotificationServiceForTesting();
      MockNotification.permission = 'denied';
      expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: false });
    });

    it('requestWebNotificationPermission surfaces a thrown requestPermission as { success: false, error }', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => {
        throw new Error('prompt already in progress');
      });

      expect(await requestWebNotificationPermission()).toEqual({
        success: false,
        error: 'prompt already in progress',
      });
    });
  });
});
