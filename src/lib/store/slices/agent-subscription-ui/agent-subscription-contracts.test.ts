/**
 * Agent Subscription Contract Tests
 *
 * Verifies that main-process event emission and renderer-side consumption
 * agree on event names, payload shapes, and workspace routing.
 *
 * Uses a FakeIPCBus to link main-process WorkspaceEvent dispatch to
 * renderer-side listenSync handlers, exercising the real extractEventData
 * logic and both reducers.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import {
  agentSubscriptionUIReducer,
  initialState as rendererInitialState,
  makeKey,
  setSubscriptionSnapshot,
  setWokenUp,
  clearWokenUp,
  resetSubscriptionUI,
} from './agent-subscription-ui-slice';
import type { AgentSubscriptionUIState, WokenUpInfo } from './agent-subscription-ui-types';
import {
  agentSubscriptionsReducer,
  initialState as mainInitialState,
  addSubscription,
  markAgentDeleted,
  type AgentSubscriptionRecord,
} from '../../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
import type { AgentSubscriptionsState } from '../../../../store/main/slices/agent-subscriptions/types';
import {
  createWorkspaceEvent,
  type AgentSubscriptionsChangedEvent,
  type WorkspaceEvent,
} from '$features/events/types';

// Contract coverage must exercise the production helper, not the global
// electron-bridge test mock used by most renderer tests.
const { extractEventData } = await vi.importActual<typeof import('$lib/electron-bridge')>(
  '$lib/electron-bridge',
);

const WS = 'ws-contract-test';
const OTHER_WS = 'ws-other';
const AGENT = 'agent-contract-1';
const AGENT_NAME = 'Contract Agent';

/** Renderer's expected IPC event names (from agent-subscription-ui-saga.ts) */
const RENDERER_SUBSCRIPTION_EVENT_NAMES = [
  'agent:subscribed', 'agent:unsubscribed', 'agent:subscriptions-changed',
  'agent:idle', 'agent:stopped', 'agent:status-changed', 'agent:created',
  'agent:woken-by-subscription', 'agent:event-delivery-failed',
  'agent:event-delivery-timeout', 'agent:subscriptions-restored',
] as const;

/** Subscription events emitted by main-process sagas */
const MAIN_EMITTED_EVENTS = [
  'agent:subscriptions-changed', 'agent:subscribed', 'agent:woken-by-subscription',
  'agent:event-delivery-failed', 'agent:event-delivery-timeout',
  'agent:subscriptions-restored',
] as const;

/** Events emitted directly by agent-subscription-ops.ts */
const OPS_EMITTED_EVENTS = ['agent:unsubscribed', 'agent:status-changed'] as const;

// --- FakeIPCBus ---
type IPCHandler = (event: { payload: WorkspaceEvent }) => void;
class FakeIPCBus {
  private listeners = new Map<string, IPCHandler[]>();
  listenSync(eventName: string, handler: IPCHandler): () => void {
    const arr = this.listeners.get(eventName) ?? [];
    arr.push(handler);
    this.listeners.set(eventName, arr);
    return () => { const idx = arr.indexOf(handler); if (idx >= 0) arr.splice(idx, 1); };
  }
  broadcast(event: WorkspaceEvent): void {
    for (const handler of this.listeners.get(event.type) ?? []) handler({ payload: event });
  }
}

// --- Helpers ---
function makeSubRecord(overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord {
  return {
    id: 'sub-1', agentId: AGENT, agentName: AGENT_NAME, workspaceId: WS,
    filter: { eventTypes: ['file:changed'], batchWindow: 500 },
    createdAt: new Date().toISOString(), ...overrides,
  };
}
function makeWsEvent(type: string, data: Record<string, unknown> = {}): WorkspaceEvent {
  return createWorkspaceEvent(type as any, WS,
    { type: 'agent', id: AGENT, name: AGENT_NAME }, { agentId: AGENT, ...data });
}

// --- Tests ---
describe('Agent Subscription Main↔Renderer Contract', () => {
  let mainState: AgentSubscriptionsState;
  let rendererState: AgentSubscriptionUIState;
  let bus: FakeIPCBus;

  beforeEach(() => {
    mainState = mainInitialState;
    rendererState = rendererInitialState;
    bus = new FakeIPCBus();
  });

  // 1. woken-by-subscription produces correct UI state
  it('woken-by-subscription produces correct renderer UI state', () => {
    const wokeEvent = makeWsEvent('agent:woken-by-subscription', {
      eventCount: 3, eventTypes: ['file:changed', 'agent:idle'],
    });
    const eventData = extractEventData({ payload: wokeEvent });
    expect(eventData.agentId).toBe(AGENT);
    expect(eventData.eventCount).toBe(3);
    expect(eventData.eventTypes).toEqual(['file:changed', 'agent:idle']);

    const info: WokenUpInfo = {
      eventCount: eventData.eventCount, eventTypes: eventData.eventTypes, timestamp: Date.now(),
    };
    rendererState = agentSubscriptionUIReducer(rendererState, setWokenUp(WS, AGENT, info));
    const key = makeKey(WS, AGENT);
    expect(rendererState.entries[key].wokenUpInfo).toEqual(info);
  });

  // 2. subscriptions-changed refreshes tracked agents
  it('subscriptionVersion appears in subscriptions-changed event payload', () => {
    mainState = agentSubscriptionsReducer(mainState, addSubscription(WS, makeSubRecord()));

    const event = createWorkspaceEvent('agent:subscriptions-changed' as any, WS,
      { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
      { subscriptionVersion: 1, reason: 'subscriptions-updated' });
    const data = extractEventData({ payload: event });
    expect(data.subscriptionVersion).toBe(1);
    expect(data.reason).toBe('subscriptions-updated');
    expect(data.agentId).toBeUndefined();
    const eventWsId = extractEventData({ payload: event }, 'workspaceId') ?? data?.workspaceId;
    expect(eventWsId).toBe(WS);
  });

  it('types subscriptions-changed as workspace-scoped when no agent target exists', () => {
    const event: AgentSubscriptionsChangedEvent = {
      id: 'evt-subscriptions-changed',
      workspaceId: WS,
      timestamp: new Date().toISOString(),
      type: 'agent:subscriptions-changed',
      actor: { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
      data: { subscriptionVersion: 2, reason: 'subscriptions-updated' },
      metadata: {},
    };

    expect(event.data.agentId).toBeUndefined();
    expect(event.workspaceId).toBe(WS);
  });

  // 3. late delivery-confirmed doesn't duplicate wake state
  it('clearWokenUp then late setWokenUp replaces cleanly without duplication', () => {
    const info: WokenUpInfo = { eventCount: 1, eventTypes: ['file:changed'], timestamp: Date.now() };
    rendererState = agentSubscriptionUIReducer(rendererState, setWokenUp(WS, AGENT, info));
    const key = makeKey(WS, AGENT);
    expect(rendererState.entries[key].wokenUpInfo).toEqual(info);
    rendererState = agentSubscriptionUIReducer(rendererState, clearWokenUp(WS, AGENT));
    expect(rendererState.entries[key].wokenUpInfo).toBeNull();
    const lateInfo: WokenUpInfo = { eventCount: 2, eventTypes: ['agent:idle'], timestamp: Date.now() + 1000 };
    rendererState = agentSubscriptionUIReducer(rendererState, setWokenUp(WS, AGENT, lateInfo));
    expect(rendererState.entries[key].wokenUpInfo).toEqual(lateInfo);
    expect(rendererState.entries[key].wokenUpInfo).not.toEqual(info);
  });

  // 4. deleted agent can't resurrect UI state
  it('resetSubscriptionUI clears entry so deleted agent cannot resurrect', () => {
    rendererState = agentSubscriptionUIReducer(rendererState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [{
          id: 'sub-1', agentId: AGENT, eventTypes: ['file:changed'],
          actorIds: [], createdAt: '', description: 'test',
        }],
        delegationGroups: [], agentStatuses: {}, waitingState: 'waiting',
      }));
    const key = makeKey(WS, AGENT);
    expect(rendererState.entries[key].waitingState).toBe('waiting');
    expect(rendererState.entries[key].subscriptions).toHaveLength(1);

    mainState = agentSubscriptionsReducer(mainState, markAgentDeleted(WS, AGENT, Date.now()));
    expect(mainState.byWorkspaceId[WS]?.deletedAgents[AGENT]).toBeDefined();

    rendererState = agentSubscriptionUIReducer(rendererState, resetSubscriptionUI(WS, AGENT));
    // resetSubscriptionUI removes the entry entirely — deleted agent has no UI presence
    expect(rendererState.entries[key]).toBeUndefined();
  });

  // 5. event names match between main and renderer
  it('all main-emitted event names are in the renderer subscription list', () => {
    const rendererSet = new Set<string>(RENDERER_SUBSCRIPTION_EVENT_NAMES);
    for (const eventName of MAIN_EMITTED_EVENTS) {
      expect(rendererSet.has(eventName)).toBe(true);
    }
    for (const eventName of OPS_EMITTED_EVENTS) {
      expect(rendererSet.has(eventName)).toBe(true);
    }
  });

  // 6. payload shapes match extractEventData expectations
  it('extractEventData correctly unwraps WorkspaceEvent payloads', () => {
    expect(vi.isMockFunction(extractEventData)).toBe(false);

    const testCases = [
      { type: 'agent:subscribed', data: { agentId: AGENT, subscriptionId: 'sub-1', eventTypes: ['file:changed'], filterDescription: 'types: file:changed' } },
      { type: 'agent:subscriptions-changed', data: { subscriptionVersion: 5, reason: 'subscriptions-updated' } },
      { type: 'agent:woken-by-subscription', data: { agentId: AGENT, eventCount: 2, eventTypes: ['file:changed'] } },
      { type: 'agent:event-delivery-failed', data: { targetAgentId: AGENT, eventCount: 1, eventTypes: ['file:changed'], error: 'boom' } },
      { type: 'agent:event-delivery-timeout', data: { targetAgentId: AGENT, eventCount: 1, eventTypes: ['file:changed'], timeoutMs: 30000 } },
      { type: 'agent:subscriptions-restored', data: { count: 1, agentIds: [AGENT] } },
      {
        type: 'agent:status-changed',
        data: {
          agentId: AGENT,
          previousStatus: 'idle',
          status: 'responding',
          activationState: 'active',
          isActive: true,
          isStreaming: true,
          isProcessing: true,
          isResponding: true,
          stopReason: null,
        },
      },
      { type: 'agent:unsubscribed', data: { agentId: AGENT, subscriptionId: 'sub-1', reason: 'manual-unsubscribe' } },
    ];

    for (const { type, data } of testCases) {
      const event = createWorkspaceEvent(type as any, WS,
        { type: 'agent', id: AGENT, name: AGENT_NAME }, data);
      const extracted = extractEventData({ payload: event });
      expect(extracted).toEqual(data);

      if ('agentId' in data) {
        const agentId = extractEventData({ payload: event }, 'agentId');
        expect(agentId).toBe(AGENT);
      }

      if ('targetAgentId' in data) {
        const targetAgentId = extractEventData({ payload: event }, 'targetAgentId');
        expect(targetAgentId).toBe(AGENT);
      }

      const wsId = extractEventData({ payload: event }, 'workspaceId') ?? extracted?.workspaceId;
      expect(wsId).toBe(WS);
    }
  });

  // 7. workspace ID filtering
  it('FakeIPCBus workspace routing filters events by workspaceId', () => {
    const received: WorkspaceEvent[] = [];
    bus.listenSync('agent:subscribed', (evt) => {
      const data = extractEventData(evt);
      const wsId = extractEventData(evt, 'workspaceId') ?? data?.workspaceId;
      if (wsId === WS) received.push(evt.payload);
    });

    bus.broadcast(createWorkspaceEvent('agent:subscribed' as any, WS,
      { type: 'agent', id: AGENT, name: AGENT_NAME },
      { agentId: AGENT, subscriptionId: 'sub-1', eventTypes: ['file:changed'] }));

    bus.broadcast(createWorkspaceEvent('agent:subscribed' as any, OTHER_WS,
      { type: 'agent', id: 'other-agent', name: 'Other' },
      { agentId: 'other-agent', subscriptionId: 'sub-2', eventTypes: ['file:changed'] }));

    expect(received).toHaveLength(1);
    expect(received[0].workspaceId).toBe(WS);
  });
});
