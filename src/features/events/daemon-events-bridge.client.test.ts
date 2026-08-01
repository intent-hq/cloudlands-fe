import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage, AgentSession } from '$shared/types';

// Fake the live backend transport so the bridge installs against in-memory
// fakes (no Electron). `vi.hoisted` keeps the spies visible to the hoisted
// vi.mock factory.
const {
  onBackendNotificationSpy,
  backendRequestSpy,
  applyNoteFromEventSpy,
  applyCommentFromEventSpy,
  capturedHandlers,
  capturedReconnectHandlers,
} = vi.hoisted(() => ({
  onBackendNotificationSpy: vi.fn(),
  backendRequestSpy: vi.fn(),
  applyNoteFromEventSpy: vi.fn(),
  applyCommentFromEventSpy: vi.fn(),
  capturedHandlers: [] as Array<(n: { method: string; params?: unknown }) => void>,
  // RESUB-1: capture reconnect listeners so a test can simulate a daemon
  // restart by invoking each captured handler.
  capturedReconnectHandlers: [] as Array<() => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendNotification: (handler: (n: { method: string; params?: unknown }) => void) => {
    onBackendNotificationSpy(handler);
    capturedHandlers.push(handler);
    return () => {
      const idx = capturedHandlers.indexOf(handler);
      if (idx >= 0) capturedHandlers.splice(idx, 1);
    };
  },
  onBackendReconnected: (handler: () => void) => {
    capturedReconnectHandlers.push(handler);
    return () => {
      const idx = capturedReconnectHandlers.indexOf(handler);
      if (idx >= 0) capturedReconnectHandlers.splice(idx, 1);
    };
  },
  backendRequest: (method: string, params?: unknown) => {
    const result = backendRequestSpy(method, params);
    // Use the spy's return value if configured, otherwise default
    return result || Promise.resolve({ subscriptionId: 'sub-1' });
  },
}));
// Mock the notes-read-service so the bridge's note:* routing is observable
// without touching the real appClient.notes.list seam.
vi.mock('$features/notes/notes-read-service', () => ({
  applyNoteFromEvent: applyNoteFromEventSpy,
  createNotesReadMiddleware: () => () => (next: (a: unknown) => unknown) => (a: unknown) => next(a),
  __resetNotesReadServiceForTests: () => {},
}));
// Mock the comments-read-service so the bridge's comment:* routing is
// observable without touching the real appClient.comments.list seam.
vi.mock('$features/comments/comments-read-service', () => ({
  applyCommentFromEvent: applyCommentFromEventSpy,
  __resetCommentsReadServiceForTests: () => {},
}));

// The bridge routes `agent:created`/`agent:updated` through the shared
// read-service so the transcript-preserving merge is exercised in one place.
// Fake it here so the tests can assert the bridge hits the correct seam and
// simulate its store-hydration side effect without a real `agent.get` fetch.
const { ensureAgentSessionSpy } = vi.hoisted(() => ({
  ensureAgentSessionSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('$features/agent/agent-read-service', () => ({
  ensureAgentSession: ensureAgentSessionSpy,
  createAgentReadMiddleware: () => () => (next: (a: unknown) => unknown) => (a: unknown) => next(a),
}));

// Fake the attention-toast service so the bridge's `agent:attention-requested`
// routing is observable without the svelte-sonner/toast-component seam — the
// sticky-toast semantics themselves are covered by
// agent-attention-toast-service.test.ts.
const { showAgentAttentionToastSpy } = vi.hoisted(() => ({
  showAgentAttentionToastSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('$features/agent/agent-attention-toast-service', () => ({
  showAgentAttentionToast: showAgentAttentionToastSpy,
}));

// Fake the navigate-away helper so the bridge's `workspace:deleted` navigation
// routing is observable without jsdom location/tab-state choreography. This is
// the live-mode path for #766: the `events.event` firehose fires in both live
// and legacy modes, unlike the workspace-list snapshot diff (monorepo#775).
const { navigateAwayIfViewingSpy } = vi.hoisted(() => ({
  navigateAwayIfViewingSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('$features/workspace/navigate-away-if-viewing', () => ({
  navigateAwayIfViewing: navigateAwayIfViewingSpy,
}));

// Fake the agent-subscription read service so the bridge's completion-watch
// refresh routing (agent:idle/failed/deleted/created →
// refreshWorkspaceSubscriptionEntries) is observable without real
// `agent.getSubscriptions` fetches mutating the store.
const { refreshWorkspaceSubscriptionEntriesSpy } = vi.hoisted(() => ({
  refreshWorkspaceSubscriptionEntriesSpy: vi.fn(),
}));
vi.mock('$features/agent/agent-subscription-read-service', () => ({
  refreshWorkspaceSubscriptionEntries: refreshWorkspaceSubscriptionEntriesSpy,
  createAgentSubscriptionReadMiddleware:
    () => () => (next: (a: unknown) => unknown) => (a: unknown) =>
      next(a),
}));

// RESUB-1: mock chat-read-service so the bridge's reconnect refresh path can
// assert `loadChatTranscript(activeAgentId)` fires without touching the real
// `appClient.chat.subscribeSnapshot` seam.
const { loadChatTranscriptSpy } = vi.hoisted(() => ({
  loadChatTranscriptSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('$features/agent/chat-read-service', () => ({
  loadChatTranscript: loadChatTranscriptSpy,
  createChatReadMiddleware: () => () => (next: (a: unknown) => unknown) => (a: unknown) => next(a),
}));

// Controllable standing-subscription gate: the bridge skips the STAB-22
// `agent:message` echo refetch while the standing chat.subscribe stream is
// live for the event's agent (it delivers the persisted row itself). Defaults
// to false — no live subscription — matching the real service in these tests.
const { hasLiveChatSubscriptionSpy } = vi.hoisted(() => ({
  hasLiveChatSubscriptionSpy: vi.fn(() => false),
}));
vi.mock('$features/agent/chat-subscribe-service', () => ({
  hasLiveChatSubscription: hasLiveChatSubscriptionSpy,
  createChatSubscribeMiddleware: () => () => (next: (a: unknown) => unknown) => (a: unknown) =>
    next(a),
}));

// Mock electron-bridge to avoid Electron dependency in tests. Provides stubs
// for all exports; tests that need specific behavior (e.g., app-UI events suite)
// can override via mockImplementation/mockReturnValue.
const { invokeSpy } = vi.hoisted(() => ({
  invokeSpy: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('$lib/electron-bridge', () => ({
  extractEventData: vi.fn((event: any, fieldName?: string) => {
    const payload = event?.payload ?? event;
    return fieldName ? payload?.[fieldName] : payload;
  }),
  isWorkspaceEvent: vi.fn(() => false),
  isElectron: vi.fn(() => false),
  electronAPI: vi.fn(() => ({})),
  invoke: invokeSpy,
  invokeWithTimeout: vi.fn(() => Promise.resolve()),
  listenSync: vi.fn(() => vi.fn()),
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emit: vi.fn(() => Promise.resolve()),
  on: vi.fn(() => 'mock-listener-id'),
  off: vi.fn(),
  dialog: { open: vi.fn(() => Promise.resolve(null)) },
  shell: { open: vi.fn(() => Promise.resolve()) },
  open: vi.fn(() => Promise.resolve(null)),
  core: { invoke: invokeSpy },
  event: {
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    emit: vi.fn(() => Promise.resolve()),
  },
  IpcTimeoutError: class IpcTimeoutError extends Error {},
}));

import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  clearAllSessions,
  setAgentStreaming,
  updateSession,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentIsResponding } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { selectEnabledProviderIds } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { __resetDaemonEventsBridgeForTests } from '$features/events/daemon-events-bridge.client';
import { selectContextItems } from '$store/renderer/slices/context/context-selectors';
import {
  chatQueuedRetryRecordSet,
  chatReset,
  chatSendFailed,
  chatSendStarted,
  chatStopCompleted,
  chatStopInitiated,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import type { StatusEvent } from '$store/renderer/slices/chat-state/chat-state-types';
import {
  clearAgentQueue,
  removeQueuedMessageFromAgentQueue,
} from '$store/renderer/slices/agent-queue/agent-queue-slice';
import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
import type { QueuedMessage } from '$shared/types';
import { addMockIpcListener, resetMockIpcRouter } from '$shared/ipc-mock-router';
import {
  bulkSetServerStatus,
  clearAllErrorMessages,
  setServerErrorMessage,
  setServers,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import type { McpServerStatus } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import { disposeScripts, upsertScript } from '$store/renderer/slices/scripts/scripts-slice';
import type { ScriptOutputBuffer } from '$store/renderer/slices/scripts/scripts-types';
import { shouldShowStoppedIndicator } from '$lib/components/chat/message-display-utils';
import {
  clearAgentFailureRegistry,
  listAgentFailureEntries,
} from '$features/agent/agent-failure-registry';

function readStatusEvents(): StatusEvent[] {
  const state = appStore.state as {
    chatState?: { byAgentId: Record<string, { statusEvents: StatusEvent[] }> };
  };
  return state.chatState?.byAgentId[AGENT]?.statusEvents ?? [];
}

const MESSAGE_ID = 'msg_assistant_1';
const STREAM_ID = 'stream_1';

/** Build a PROTOCOL §6.3 `events.event` notification envelope. */
function notification(eventType: string, data: Record<string, unknown>) {
  return {
    method: 'events.event' as const,
    params: {
      event: {
        id: `evt-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: WS,
        timestamp: '2026-01-02T00:00:00.000Z',
        type: eventType,
        actor: { type: 'agent', id: AGENT },
        data,
      },
    },
  };
}

/**
 * Variant carrying the wire-level `params.subscriptionId` the daemon attaches
 * when fanning a domain event out per matching subscription (PROTOCOL §6.3 /
 * intent-transport `build_event_notification`). Used to exercise the bridge's
 * fan-out scope gate.
 */
function notificationWithSub(
  eventType: string,
  data: Record<string, unknown>,
  subscriptionId: string,
) {
  const base = notification(eventType, data);
  return {
    method: base.method,
    params: { ...base.params, subscriptionId },
  };
}

function readSession(): AgentSession | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return state.agentSessions?.byAgentId[AGENT];
}

function readAssistantMessages(): AgentMessage[] {
  return (readSession()?.messages ?? []).filter((m) => m.role === 'assistant');
}

const WS = 'ws-bridge-1';
const AGENT = 'agent-bridge-1';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedSession(overrides: Partial<AgentSession> = {}): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        backendSessionId: 'backend-1',
        workspaceId: WS,
        name: 'A',
        status: AgentStatus.Pending,
        messages: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      } as AgentSession,
    ]),
  );
}

/** Trigger the bridge to install — middleware runs lazily on first dispatch. */
async function primeBridge(): Promise<void> {
  // setAgentStreaming(false) is a harmless action that runs through the
  // configured middleware chain and triggers the bridge's lazy install.
  appStore.dispatch(setAgentStreaming(AGENT, false));
  // installSubscriptionOnce is async; let the microtask settle.
  await flush();
}

describe('daemonEventsBridge (wire contract — agent:idle clears the spinner)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  it('registers a notification listener and subscribes to agent:* + activity-timeline + settings/usage + legacy-relay families on first dispatch', async () => {
    await primeBridge();

    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    // The settings-hydration middleware also fires `settings.list` lazily, so
    // we assert the bridge's events.subscribe call explicitly instead of the
    // total spy count.
    expect(backendRequestSpy).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: [
        'agent:*',
        'file:*',
        'note:*',
        'comment:*',
        'script:*',
        'settings:changed',
        'workspace:tokenUsage-changed',
        'workspace:context-changed',
        'workspace:activity-changed',
        'workspace:displayStatus-changed',
        'workspace:updated',
        'workspace:created',
        'workspace:deleted',
        'task:*',
        'git:*',
        'changes:git-status',
        'changes:tracked',
        'line-attribution:updated',
        'pr:*',
        'mcp.servers:status-changed',
        'github:auth-changed',
        'app:ui-navigate',
        'app:ui-highlight',
        'app:workspace-open',
      ],
    });
  });

  it('events.subscribe filter matches task:status-changed and git:commit (daemon filter is exact-match unless :*)', async () => {
    // The reducer-focused test below injects synthetic events straight into
    // the captured handler, bypassing the daemon's per-subscription filter.
    // This assertion locks in the wire contract: the bridge's subscribe list
    // must include a pattern that matches every task/git family the reducers
    // consume, otherwise the daemon routes nothing to the FE. Emulates the
    // daemon-side filter — `pattern` matches `type` when `pattern === type`
    // or `pattern.endsWith(":*")` and `type` starts with the prefix.
    await primeBridge();
    const call = backendRequestSpy.mock.calls.find(([method]) => method === 'events.subscribe');
    expect(call).toBeDefined();
    const eventTypes = (call![1] as { eventTypes: string[] }).eventTypes;
    const matchesFilter = (type: string) =>
      eventTypes.some(
        (pattern) =>
          pattern === type || (pattern.endsWith(':*') && type.startsWith(pattern.slice(0, -1))),
      );
    expect(matchesFilter('task:status-changed')).toBe(true);
    expect(matchesFilter('task:ready-tasks-changed')).toBe(true);
    expect(matchesFilter('git:commit')).toBe(true);
    expect(matchesFilter('git:pull')).toBe(true);
  });

  it('agent:idle notification flips selectAgentIsResponding from true → false', async () => {
    // Optimistic chatSendStarted-style flag: the FE reducer marks isStreaming
    // true while the user message is being sent.
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    await primeBridge();
    const handler = capturedHandlers[0];
    expect(handler).toBeTypeOf('function');

    // PROTOCOL §7 notification envelope: `events.event` with the WorkspaceEvent
    // nested in `params.event`. The bridge must extract `params.event` and
    // dispatch eventReceived(workspaceId, event) — that drives the
    // agentSession reducer's canonicalFieldsFromWorkspaceEvent path which
    // clears isStreaming/isProcessing/isResponding and sets status='idle'.
    handler!({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-1',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:idle',
          actor: { type: 'agent', id: AGENT },
          data: { agentId: AGENT, status: 'idle', isActive: false },
        },
      },
    });

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it('routes agent:session-stats-changed (PROTOCOL §5.24) into agent-session.stats', async () => {
    seedSession();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:session-stats-changed', {
        sessionId: AGENT,
        agentId: AGENT,
        stats: { creditsUsed: 1.54, messageCount: 18, toolCount: 42 },
      }),
    );

    expect(readSession()?.stats).toEqual({
      creditsUsed: 1.54,
      messageCount: 18,
      toolCount: 42,
    });
  });

  it('routes agent:process:queued into agent-session.processQueueHint and clears on agent:process:resumed', async () => {
    seedSession();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Deliver agent:process:queued event — should set processQueueHint.
    // Use saturated values (used === cap) to match the documented semantics
    // ("all slots active") per PROTOCOL §6.5.
    handler(
      notification('agent:process:queued', {
        agentId: AGENT,
        used: 3,
        cap: 3,
      }),
    );

    expect(readSession()?.processQueueHint).toEqual({
      waiting: true,
      used: 3,
      cap: 3,
    });

    // Deliver agent:process:resumed event — should clear processQueueHint.
    // Include used/cap to match PROTOCOL §6.5 (AgentProcessResumedEvent carries
    // { agentId, used, cap }) even though the handler only uses agentId.
    handler(
      notification('agent:process:resumed', {
        agentId: AGENT,
        used: 2,
        cap: 3,
      }),
    );

    expect(readSession()?.processQueueHint).toBeUndefined();
  });

  it('ignores non-events.event methods, and forwards non-lifecycle events.event notifications into workspaceEvents without changing agent-session flags', async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Unrelated method — no-op.
    handler({ method: 'agent.stream:activity', params: { agentId: AGENT } });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    // events.event carrying a non-lifecycle domain event — still stored in the
    // workspaceEvents buffer (activity timeline) but never flips the
    // agent-session isResponding flag, which is owned by the lifecycle subset.
    // (`note:*` / `comment:*` / `task:*` / `pr:*` are intercepted with an
    // early-return route, so pick a domain event that still falls through to
    // the shared `eventReceived` dispatch.)
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-2',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'file:changed',
          actor: { type: 'system' },
          data: { agentId: AGENT },
        },
      },
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
    const state = appStore.state as {
      workspaceEvents: { byWorkspaceId: Record<string, { events: Array<{ id: string }> }> };
    };
    expect(state.workspaceEvents.byWorkspaceId[WS]?.events.map((event) => event.id)).toContain(
      'evt-2',
    );
  });

  it('drops events without a workspaceId rather than guessing', async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-3',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:idle',
          actor: { type: 'agent', id: AGENT },
          data: { agentId: AGENT, status: 'idle' },
        },
      },
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
  });

  it('routes settings:changed (workspace-less) through applySettingsChanges into the mcp-settings slice', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-set-1',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'settings:changed',
          actor: { type: 'system' },
          data: {
            changes: [{ path: 'mcp.enableUserServers', value: true }],
          },
        },
      },
    });

    const state = appStore.state as { mcpSettings: { enabled: boolean } };
    expect(state.mcpSettings.enabled).toBe(true);
  });

  it('propagates a providers.enabled toggle from settings:changed into the enabled-provider-ids selector', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const settingsChanged = (id: string, enabled: Record<string, boolean>) => ({
      method: 'events.event',
      params: {
        event: {
          id,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'settings:changed',
          actor: { type: 'system' },
          data: {
            changes: [{ path: 'providers.enabled', value: enabled }],
          },
        },
      },
    });

    handler(settingsChanged('evt-set-2', { auggie: true, codex: false }));
    expect(selectEnabledProviderIds.select(appStore.state)).not.toContain('codex');

    // Toggling the provider ON in Settings arrives as the same event shape —
    // the slice and selector must reflect it live, no restart required.
    handler(settingsChanged('evt-set-3', { auggie: true, codex: true }));

    const state = appStore.state as {
      providerSettings: { enabledProviders: Record<string, boolean> };
    };
    expect(state.providerSettings.enabledProviders).toEqual({ auggie: true, codex: true });
    expect(selectEnabledProviderIds.select(appStore.state)).toContain('codex');
  });
});

describe('daemonEventsBridge (live stream wire contract — agent:stream:* → status hints/bookkeeping)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession({ isStreaming: true, status: AgentStatus.Active });
  });

  afterEach(() => vi.clearAllMocks());

  // The standing chat.subscribe delta stream (PROTOCOL §7.1,
  // chat-subscribe-service) is the sole transcript writer — the firehose
  // stream family must never create or grow transcript messages.
  it('agent:stream:activity / agent:tool:call / agent:stream:end never write transcript messages', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Hello ',
      }),
    );
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't1',
        input: { path: 'src/lib.rs' },
        status: 'completed',
        output: 'ok',
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        stopReason: 'interrupted',
        trailingBlocks: [{ type: 'resource', resource: { uri: 'intent-question://q1' } }],
      }),
    );

    expect(readAssistantMessages()).toHaveLength(0);
  });

  // intentd#792: `agent:stream:activity` carries the server-derived live
  // preview — the bridge push-applies it to the session slice with zero RPCs
  // (no agent.get refetch, no debounce).
  it('agent:stream:activity applies lastAgentResponse/digest to the session without any RPC', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Working through the parser rewrite',
        digest: 'Parser rewrite in progress',
      }),
    );

    expect(readSession()?.lastAgentResponse).toBe('Working through the parser rewrite');
    expect(readSession()?.digest).toBe('Parser rewrite in progress');
    expect(readAssistantMessages()).toHaveLength(0);
    expect(backendRequestSpy).not.toHaveBeenCalledWith('agent.get', expect.anything());
    // Bookkeeping: response text present → the streaming status entry arms.
    expect(readStatusEvents().map((e) => e.phase)).toEqual(['streaming']);
  });

  it('agent:stream:activity without preview fields (pre-first-token ping) only refreshes bookkeeping', async () => {
    appStore.dispatch(updateSession(AGENT, { lastAgentResponse: 'previous turn text' }));
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:stream:activity', { agentId: AGENT, messageId: MESSAGE_ID }));

    // No preview fields → no text derivable yet this turn: session preview
    // untouched, no streaming entry yet.
    expect(readSession()?.lastAgentResponse).toBe('previous turn text');
    expect(readSession()?.digest).toBeUndefined();
    expect(readStatusEvents()).toEqual([]);
    expect(backendRequestSpy).not.toHaveBeenCalledWith('agent.get', expect.anything());
  });

  it('a whitespace-only lastAgentResponse is treated like an absent preview (no streaming flip, no session write)', async () => {
    appStore.dispatch(updateSession(AGENT, { lastAgentResponse: 'previous turn text' }));
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: '   \n  ',
      }),
    );

    // The bookkeeping predicate mirrors applyStreamPreviewFields' meaningful-
    // text check: no preview applied and no "Streaming response…" entry.
    expect(readSession()?.lastAgentResponse).toBe('previous turn text');
    expect(readStatusEvents()).toEqual([]);
  });

  it('terminal agent:stream:end applies the final lastAgentResponse/digest so the preview lands on the turn end-state', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'partial mid-turn text',
      }),
    );
    expect(readSession()?.lastAgentResponse).toBe('partial mid-turn text');

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'The full final response tail.',
        digest: 'Turn complete',
      }),
    );

    expect(readSession()?.lastAgentResponse).toBe('The full final response tail.');
    expect(readSession()?.digest).toBe('Turn complete');
    // Terminal bookkeeping still ran: busy flags cleared, no transcript writes.
    expect(readSession()?.isStreaming).toBe(false);
    expect(readAssistantMessages()).toHaveLength(0);
  });

  it('agent:stream:end clears the busy flags and agent:idle clears the spinner', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Hello',
      }),
    );
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));

    // streamEnded bookkeeping cleared the session busy flags without
    // touching the (empty) transcript. The seeded status stays Active until
    // the lifecycle `agent:idle` lands, so assert the flags directly here.
    expect(readAssistantMessages()).toHaveLength(0);
    expect(readSession()?.isStreaming).toBe(false);
    expect(readSession()?.isProcessing).toBe(false);

    handler(
      notification('agent:idle', {
        agentId: AGENT,
        status: 'idle',
        isActive: false,
        reason: 'stream_complete',
        finishReason: 'stop',
      }),
    );

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it('agent:failed clears the spinner and surfaces the failure without transcript writes', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Working',
      }),
    );
    handler(
      notification('agent:failed', {
        agentId: AGENT,
        error: 'boom',
        status: 'failed',
        isActive: false,
      }),
    );

    expect(readAssistantMessages()).toHaveLength(0);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
    const chatAgent = (
      appStore.state as { chatState?: { byAgentId: Record<string, { error: string | null }> } }
    ).chatState?.byAgentId[AGENT];
    expect(chatAgent?.error).toBe('boom');
  });

  it("emits status hint transitions: 'Streaming response…' on first text-bearing activity → 'Calling tool' on tool:call started → 'Awaiting tool response' on tool:call completed → 'Streaming response…' on next activity → cleared on stream:end/idle", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // First text-bearing activity ping arms the "Streaming response…" status
    // entry via the activity reducer (no explicit dispatch needed from the bridge).
    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Looking',
      }),
    );

    let events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: 'streaming', message: 'Streaming response…' },
    ]);

    // tool:call (started) → "Calling tool" entry, resetting receivedFirstChunk
    // so the next text chunk re-arms the streaming hint.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't1',
        input: { path: 'src/lib.rs' },
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );

    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: 'streaming', message: 'Streaming response…' },
      { phase: 'tool-call', message: 'Calling tool' },
    ]);

    // tool:call (completed) → "Awaiting tool response" entry closes off the
    // "Calling tool" entry at the tool's terminal event so its duration in
    // computeCompletedEvents reflects the actual tool-execution window.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't1',
        input: { path: 'src/lib.rs' },
        status: 'completed',
        output: 'ok',
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );

    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message, level: e.level }))).toEqual([
      { phase: 'streaming', message: 'Streaming response…', level: 'info' },
      { phase: 'tool-call', message: 'Calling tool', level: 'info' },
      { phase: 'tool-waiting', message: 'Awaiting tool response', level: 'info' },
    ]);

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Done.',
      }),
    );

    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: 'streaming', message: 'Streaming response…' },
      { phase: 'tool-call', message: 'Calling tool' },
      { phase: 'tool-waiting', message: 'Awaiting tool response' },
      { phase: 'streaming', message: 'Streaming response…' },
    ]);

    // Terminal: stream:end clears the status hints; subsequent agent:idle is
    // a no-op for statusEvents (already cleared).
    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));
    expect(readStatusEvents()).toEqual([]);

    handler(
      notification('agent:idle', {
        agentId: AGENT,
        status: 'idle',
        isActive: false,
        reason: 'stream_complete',
      }),
    );
    expect(readStatusEvents()).toEqual([]);
  });

  it('maps agent:stream:status (STAT-1 turn-startup family) to chatState/streamStatusReceived with a localized message keyed off phase (wire message ignored for known phases); first text-bearing activity still clears it via the chunk reducer', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const promptAt = 1_700_000_000_000;
    // `agent:stream:status` (PROTOCOL §6.5 / §7 pre-first-token family)
    // arrives before any chunk with the daemon-authoritative phase plus an
    // English `message`. The bridge renders the catalog string for the phase;
    // the wire message here deliberately differs to prove it is not passed
    // through for known phases.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'prompt',
        message: 'RAW WIRE MESSAGE (ignored)',
        level: 'info',
        timestamp: promptAt,
      }),
    );

    let events = readStatusEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: 'prompt',
      message: 'Sent prompt\u2026',
      level: 'info',
      timestamp: promptAt,
    });

    // Subsequent phase (session-load with warn level, e.g. a resume path)
    // appends — level/phase/timestamp round-trip verbatim, message localizes.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'session-load',
        message: 'RAW WIRE MESSAGE (ignored)',
        level: 'warn',
        timestamp: promptAt + 5,
      }),
    );
    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message, level: e.level }))).toEqual([
      { phase: 'prompt', message: 'Sent prompt\u2026', level: 'info' },
      { phase: 'session-load', message: 'Resuming session\u2026', level: 'warn' },
    ]);

    // Unknown phase → the daemon's wire message is the fallback rendering
    // (e.g. future phases or Unsloth launch-progress variants).
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'some-future-phase',
        message: 'Daemon-authored fallback text',
        level: 'info',
        timestamp: promptAt + 7,
      }),
    );
    events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({
      phase: 'some-future-phase',
      message: 'Daemon-authored fallback text',
    });

    // First text-bearing `agent:stream:activity` appends the activity
    // reducer's "Streaming response…" entry after the startup hints — the
    // bridge itself does NOT clear anything on the way in (mirrors the
    // existing tool-call bridge path). The terminal reducer paths below own
    // the clear.
    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Hi',
      }),
    );
    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: 'prompt', message: 'Sent prompt\u2026' },
      { phase: 'session-load', message: 'Resuming session\u2026' },
      { phase: 'some-future-phase', message: 'Daemon-authored fallback text' },
      { phase: 'streaming', message: 'Streaming response\u2026' },
    ]);

    // Terminal `agent:stream:end` clears the status hints (existing chunk
    // reducer path via `dispatchStreamUpdate(..., "complete")`), including
    // the pre-first-token startup hints — the bridge does not need to
    // duplicate the clear.
    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));
    expect(readStatusEvents()).toEqual([]);
  });

  it('agent:stream:status edge cases: missing message on known phase localizes, warn-level launch keeps wire text, prototype-key phases do not resolve, empty unknown-phase drops', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const at = 1_700_000_000_000;

    // Known phase with a missing wire message still renders the localized
    // string (the phase alone is self-sufficient for known phases).
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'init',
        level: 'info',
        timestamp: at,
      }),
    );
    let events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({
      phase: 'init',
      message: 'Initializing protocol\u2026',
    });

    // Warn-level launch (model-switch restart warning, §6.5 / intentd#647)
    // keeps the daemon-authored wire text instead of the static launch label.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'launch',
        message: 'Restarting Unsloth server; attached sessions will lose the loaded model',
        level: 'warn',
        timestamp: at + 1,
      }),
    );
    events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({
      phase: 'launch',
      message: 'Restarting Unsloth server; attached sessions will lose the loaded model',
      level: 'warn',
    });

    // Info-level launch renders the localized static label (wire text ignored).
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'launch',
        message: 'Still downloading model\u2026',
        level: 'info',
        timestamp: at + 2,
      }),
    );
    events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({
      phase: 'launch',
      message: 'Launching agent\u2026',
    });

    const countBefore = readStatusEvents().length;

    // A phase matching an inherited Object.prototype key must not resolve a
    // catalog entry — the wire message is the fallback.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'constructor',
        message: 'Prototype-key wire text',
        level: 'info',
        timestamp: at + 3,
      }),
    );
    events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({
      phase: 'constructor',
      message: 'Prototype-key wire text',
    });

    // Unknown phase with no usable message: nothing to render → dropped.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'some-future-phase',
        level: 'info',
        timestamp: at + 4,
      }),
    );
    expect(readStatusEvents()).toHaveLength(countBefore + 1);
  });

  it('agent:stream:status: every daemon-emitted phase (PROTOCOL §6.5) renders its own localized catalog string, never the wire message', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const at = 1_700_000_000_000;

    // Exhaustive phase → localized-message pinning for the full §6.5 set.
    // Each event carries a deliberately-English wire `message` to prove the
    // daemon text is not what gets rendered for known phases (user sighting:
    // "Initializing protocol…" / "Resuming session…" leaking in English came
    // from builds predating the phase-keyed catalog rendering).
    //
    // Intentional overlap: prompt/session-load/info-launch are also asserted
    // by the STAT-1 and edge-case tests above — do not dedupe; this test's
    // value is the single-pass exhaustive pin (it is also the only direct
    // coverage of session-create).
    const phaseExpectations: Array<{ phase: string; localized: string }> = [
      { phase: 'launch', localized: 'Launching agent\u2026' },
      { phase: 'init', localized: 'Initializing protocol\u2026' },
      { phase: 'session-create', localized: 'Creating session\u2026' },
      { phase: 'session-load', localized: 'Resuming session\u2026' },
      { phase: 'prompt', localized: 'Sent prompt\u2026' },
    ];

    phaseExpectations.forEach(({ phase }, i) => {
      handler(
        notification('agent:stream:status', {
          agentId: AGENT,
          workspaceId: WS,
          phase,
          message: `DAEMON WIRE TEXT for ${phase} (must not render)`,
          level: 'info',
          timestamp: at + i,
        }),
      );
    });

    let events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual(
      phaseExpectations.map(({ phase, localized }) => ({ phase, message: localized })),
    );

    // The streaming state (first text-bearing activity) is also a catalog
    // string, appended by the activity reducer — completing the full
    // pre-first-token → streaming set.
    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'Hi',
      }),
    );
    events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({
      phase: 'streaming',
      message: 'Streaming response\u2026',
    });
  });

  it("tool started → completed short window: tool-call entry's duration ends at the completed event's timestamp", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const startedAt = 1_700_000_000_000;
    const completedAt = startedAt + 250;
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't-short',
        input: { path: 'a' },
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );
    vi.setSystemTime(completedAt);
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't-short',
        input: { path: 'a' },
        status: 'completed',
        output: 'ok',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );

    const events = readStatusEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ phase: 'tool-call', timestamp: startedAt });
    expect(events[1]).toMatchObject({ phase: 'tool-waiting', timestamp: completedAt });
    // computeCompletedEvents: duration of tool-call = timestamp(tool-waiting) − timestamp(tool-call).
    expect(events[1].timestamp - events[0].timestamp).toBe(250);

    vi.useRealTimers();
  });

  it('tool completed with error: appends a tool-waiting close entry at error level (still closes the hint)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't-err',
        input: { path: 'a' },
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't-err',
        input: { path: 'a' },
        status: 'error',
        output: 'boom',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );

    const events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message, level: e.level }))).toEqual([
      { phase: 'tool-call', message: 'Calling tool', level: 'info' },
      { phase: 'tool-waiting', message: 'Tool call failed', level: 'error' },
    ]);
  });

  it('repeated completed updates for the same toolCallId do not append a second tool-waiting entry', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't-dup',
        input: { path: 'a' },
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );
    for (let i = 0; i < 3; i++) {
      handler(
        notification('agent:tool:call', {
          agentId: AGENT,
          toolName: 'Read',
          toolKind: 'file',
          toolCallId: 't-dup',
          input: { path: 'a' },
          status: 'completed',
          output: 'ok',
          messageId: MESSAGE_ID,
          blockIndex: 0,
          blockId: `${MESSAGE_ID}:0`,
        }),
      );
    }

    const events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: 'tool-call', message: 'Calling tool' },
      { phase: 'tool-waiting', message: 'Awaiting tool response' },
    ]);
  });

  it('repeated started ticks for the same toolCallId (progress-only) do not append duplicate Calling tool entries', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't-prog',
        input: { path: 'a' },
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );
    // Progress-only tick: empty toolName, same toolCallId, still started.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: '',
        toolCallId: 't-prog',
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );

    const events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: 'tool-call', message: 'Calling tool' },
    ]);
  });

  it('multiple sequential tool calls each append their own tool-call → tool-waiting pair with accurate short durations', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const t0 = 1_700_000_000_000;
    const timeline: Array<{
      at: number;
      toolCallId: string;
      status: 'started' | 'completed';
      idx: number;
    }> = [
      { at: t0, toolCallId: 't-a', status: 'started', idx: 0 },
      { at: t0 + 100, toolCallId: 't-a', status: 'completed', idx: 0 },
      { at: t0 + 300, toolCallId: 't-b', status: 'started', idx: 1 },
      { at: t0 + 450, toolCallId: 't-b', status: 'completed', idx: 1 },
    ];
    vi.useFakeTimers();

    for (const step of timeline) {
      vi.setSystemTime(step.at);
      handler(
        notification('agent:tool:call', {
          agentId: AGENT,
          toolName: 'Read',
          toolKind: 'file',
          toolCallId: step.toolCallId,
          input: { path: `p${step.idx}` },
          status: step.status,
          ...(step.status === 'completed' ? { output: 'ok' } : {}),
          messageId: MESSAGE_ID,
          blockIndex: step.idx,
          blockId: `${MESSAGE_ID}:${step.idx}`,
        }),
      );
    }

    const events = readStatusEvents();
    expect(events.map((e) => e.phase)).toEqual([
      'tool-call',
      'tool-waiting',
      'tool-call',
      'tool-waiting',
    ]);
    // Each tool's duration = timestamp(next entry) − timestamp(this entry).
    expect(events[1].timestamp - events[0].timestamp).toBe(100);
    expect(events[3].timestamp - events[2].timestamp).toBe(150);

    vi.useRealTimers();
  });
});

// PROTOCOL §6.6 / §7: `agent:stream:start { agentId, messageId, reason:
// "harness-wake" }` announces an implicit agent-initiated turn — no user send
// precedes it, so the bridge itself must open the streaming UI (busy state via
// chatSendStarted). Prompt (user-initiated) turns never emit this event. The
// wake turn's transcript arrives via the standing chat.subscribe delta stream
// — the bridge creates no placeholder message.
describe('daemonEventsBridge (spontaneous streams — agent:stream:start opens the wake turn)', () => {
  const WAKE_MESSAGE_ID = 'msg_wake_1';

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    // A wake turn starts from a fully idle session — no send set any flags.
    seedSession({ status: AgentStatus.Idle, isStreaming: false, isProcessing: false });
  });

  afterEach(() => vi.clearAllMocks());

  function streamStart(handler: (n: { method: string; params?: unknown }) => void): void {
    handler(
      notification('agent:stream:start', {
        agentId: AGENT,
        messageId: WAKE_MESSAGE_ID,
        reason: 'harness-wake',
      }),
    );
  }

  it('opens the busy/Thinking state on an idle session WITHOUT adding any message rows', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    streamStart(handler);

    // Busy state opens exactly like a user-initiated turn…
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
    const session = readSession();
    expect(session?.isStreaming).toBe(true);
    expect(session?.isProcessing).toBe(true);

    // …but with NO phantom/optimistic user row and NO assistant placeholder —
    // the standing chat.subscribe stream delivers the wake turn's transcript.
    const userMessages = (session?.messages ?? []).filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(0);
    expect(readAssistantMessages()).toHaveLength(0);
  });

  it('a duplicate agent:stream:start for the same messageId is a no-op (no mid-turn statusEvents/timer reset)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamStart(handler);
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        phase: 'prompt',
        message: 'Sent prompt…',
        timestamp: 1000,
      }),
    );
    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: WAKE_MESSAGE_ID,
        lastAgentResponse: 'Waking…',
      }),
    );
    const statusEventsBefore = readStatusEvents();
    expect(statusEventsBefore.length).toBeGreaterThan(0);

    // At-least-once delivery (e.g. across a reconnect) replays the start event.
    streamStart(handler);

    // Busy state stays open and the mid-turn status/timer state is NOT wiped
    // by a second chatSendStarted.
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
    expect(readStatusEvents()).toEqual(statusEventsBefore);
  });

  it('a fresh wake turn after stream:end re-opens the busy state (dedup map cleared per turn)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamStart(handler);
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: WAKE_MESSAGE_ID,
      }),
    );
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    // A REPLAY of the finished wake turn's start (same messageId) after the
    // dedup map was cleared re-opens the busy state; stream:end closes it
    // again. This documents the trade-off of keying dedup per in-flight turn.
    handler(
      notification('agent:stream:start', {
        agentId: AGENT,
        messageId: 'msg_wake_2',
        reason: 'harness-wake',
      }),
    );
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
  });

  it('ignores malformed agent:stream:start payloads (missing agentId or missing/empty messageId)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:stream:start', { agentId: AGENT, reason: 'harness-wake' }));
    handler(
      notification('agent:stream:start', { messageId: WAKE_MESSAGE_ID, reason: 'harness-wake' }),
    );
    handler(
      notification('agent:stream:start', { agentId: AGENT, messageId: '', reason: 'harness-wake' }),
    );

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
    expect(readAssistantMessages()).toHaveLength(0);
  });
});

// Regression (intentd#336): a user interrupt (agent.stop, or agent.sendMessage
// with priority:interrupt) mid-stream must NOT erase the streamed-so-far
// content. The partial transcript is written by the standing chat.subscribe
// delta stream (chat-subscribe-service) — here it is seeded directly into the
// session to simulate that writer — and the bridge's terminal
// `agent:stream:end` + `agent:idle { reason: "interrupted" }` bookkeeping must
// leave it intact while clearing the busy flags.
describe('daemonEventsBridge (interrupt regression — subscription-written deltas survive the terminal events)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession({ isStreaming: true, status: AgentStatus.Active });
  });

  afterEach(() => vi.clearAllMocks());

  /**
   * Seed the partial turn AS the standing subscription would have written it:
   * an in-flight assistant message with the streamed-so-far blocks.
   */
  function seedSubscriptionPartial(): void {
    const session = readSession()!;
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...session,
          messages: [
            ...(session.messages ?? []),
            {
              id: MESSAGE_ID,
              role: 'assistant',
              timestamp: '2026-01-02T00:00:00.000Z',
              isStreaming: true,
              contentBlocks: [
                { type: 'text', id: `${MESSAGE_ID}:0`, text: 'Partial ' },
                {
                  type: 'tool_use',
                  id: `${MESSAGE_ID}:1`,
                  name: 'Read',
                  toolCallId: 't-int',
                  input: { path: 'src/lib.rs' },
                },
                { type: 'tool_result', tool_use_id: 't-int', output: 'ok' },
                { type: 'text', id: `${MESSAGE_ID}:2`, text: 'answer' },
              ],
            } as unknown as AgentMessage,
          ],
        },
      ]),
    );
  }

  const expectPartialBlocksIntact = (message: AgentMessage | undefined): void => {
    expect(message).toBeDefined();
    const blocks = message!.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_result', 'text']);
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'Partial ' });
    expect(blocks[3]).toMatchObject({ type: 'text', text: 'answer' });
  };

  it('user stop mid-stream: terminal stream:end + idle(reason=interrupted) clear the busy flags without erasing the partial', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    seedSubscriptionPartial();
    expectPartialBlocksIntact(readAssistantMessages()[0]);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    // The Stop button path (`dispatchStopChat` in chat-send-service.ts)
    // dispatches `chatStopInitiated` before calling `agent.stop` — the local
    // stop dispatch must NOT remove the in-flight partial message.
    appStore.dispatch(chatStopInitiated(AGENT));
    expectPartialBlocksIntact(readAssistantMessages()[0]);

    // `interrupt_inner` emits the single terminal `agent:stream:end` carrying
    // `stopReason: "interrupted"` + the turn's `messageId`, followed by the
    // STAB-28 `agent:idle { reason: "interrupted" }`.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        messageId: MESSAGE_ID,
      }),
    );
    handler(
      notification('agent:idle', {
        agentId: AGENT,
        status: 'idle',
        isActive: false,
        reason: 'interrupted',
      }),
    );

    // The terminal events alone must flip the responding flag — asserted
    // BEFORE `chatStopCompleted` (which also clears session runtime flags)
    // so the local dispatch can't mask a regression in the event handling.
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    // `dispatchStopChat` dispatches `chatStopCompleted` once `agent.stop`
    // resolves — this local completion dispatch must not erase the partial
    // either.
    appStore.dispatch(chatStopCompleted(AGENT));

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expectPartialBlocksIntact(assistantMessages[0]);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it('persisted interrupted row reconciles in: blocks stay intact and the Stopped indicator shows', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    seedSubscriptionPartial();
    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));
    handler(
      notification('agent:idle', {
        agentId: AGENT,
        status: 'idle',
        isActive: false,
        reason: 'interrupted',
      }),
    );

    // Simulate the chat-read-service hydration reconcile: the daemon's
    // `flush_partial_turn_on_interruption` persisted the partial under the
    // turn's minted message id with `metadata.interrupted = true` +
    // `stopReason = "interrupted"` (intentd#336 wire contract), so
    // agent.getConversation now returns it and bulkUpsertSessions upserts it
    // by the SAME id the live stream used.
    const session = readSession();
    expect(session).toBeDefined();
    const persistedInterrupted = {
      id: MESSAGE_ID,
      role: 'assistant',
      timestamp: '2026-01-02T00:00:01.000Z',
      contentBlocks: [
        { type: 'text', id: `${MESSAGE_ID}:0`, text: 'Partial ' },
        {
          type: 'tool_use',
          id: `${MESSAGE_ID}:1`,
          name: 'Read',
          toolCallId: 't-int',
          input: { path: 'src/lib.rs' },
        },
        { type: 'tool_result', tool_use_id: 't-int', output: 'ok' },
        { type: 'text', id: `${MESSAGE_ID}:2`, text: 'answer' },
      ],
      metadata: { interrupted: true, stopReason: 'interrupted' },
    } as unknown as AgentMessage;
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...session!,
          isStreaming: false,
          status: AgentStatus.Idle,
          messages: [
            ...(session!.messages ?? []).filter((m) => m.role !== 'assistant'),
            persistedInterrupted,
          ],
        },
      ]),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].contentBlocks?.map((b) => b.type)).toEqual([
      'text',
      'tool_use',
      'tool_result',
      'text',
    ]);
    expect(assistantMessages[0].metadata).toMatchObject({
      interrupted: true,
      stopReason: 'interrupted',
    });
    // The persisted row carries `metadata.interrupted: true`, so a `false`
    // here can only come from the isStreaming gate — pins that the indicator
    // stays hidden while a stream is (still) considered in-flight.
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: true })).toBe(
      false,
    );
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false })).toBe(
      true,
    );
  });
});

describe('daemonEventsBridge (queue wire contract — agent:queue:updated → replaceAgentQueue)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(clearAgentQueue(AGENT));
    appStore.dispatch(chatReset(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  /** Read this agent's chat-state retry fields for the clear-queue assertions. */
  function readRetryState() {
    const state = appStore.state as {
      chatState?: {
        byAgentId: Record<
          string,
          { lastAttemptedMessage: unknown; queuedRetryRecords: Record<string, unknown> }
        >;
      };
    };
    const agent = state.chatState?.byAgentId[AGENT];
    return {
      lastAttemptedMessage: agent?.lastAttemptedMessage ?? null,
      queuedRetryRecords: agent?.queuedRetryRecords ?? {},
    };
  }

  it('renders the BE queue snapshot from a PROTOCOL §5.5 agent:queue:updated payload', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const queue: QueuedMessage[] = [
      { id: 'q-1', content: 'first', queuedAt: '2026-01-02T00:00:01.000Z', position: 0 },
      { id: 'q-2', content: 'second', queuedAt: '2026-01-02T00:00:02.000Z', position: 1 },
    ];

    handler(notification('agent:queue:updated', { agentId: AGENT, queue }));

    expect(
      selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => ({
        id: m.id,
        position: m.position,
      })),
    ).toEqual([
      { id: 'q-1', position: 0 },
      { id: 'q-2', position: 1 },
    ]);
  });

  it('replaces the local queue when a follow-up agent:queue:updated arrives (read-through view)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:queue:updated', {
        agentId: AGENT,
        queue: [{ id: 'q-1', content: 'first', queuedAt: '2026-01-02T00:00:01.000Z', position: 0 }],
      }),
    );
    handler(
      notification('agent:queue:updated', {
        agentId: AGENT,
        queue: [
          { id: 'q-2', content: 'second', queuedAt: '2026-01-02T00:00:02.000Z', position: 0 },
        ],
      }),
    );

    expect(selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => m.id)).toEqual([
      'q-2',
    ]);
  });

  it('suppresses a recently-removed message when a stale agent:queue:updated snapshot still carries it', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Simulate the optimistic delete the queue-mutation handler performs
    // before the BE catches up — this writes a tombstone for "q-1".
    appStore.dispatch(removeQueuedMessageFromAgentQueue(AGENT, 'q-1'));

    // BE has not yet self-drained, so its next snapshot still includes q-1.
    handler(
      notification('agent:queue:updated', {
        agentId: AGENT,
        queue: [
          { id: 'q-1', content: 'first', queuedAt: '2026-01-02T00:00:01.000Z', position: 0 },
          { id: 'q-2', content: 'second', queuedAt: '2026-01-02T00:00:02.000Z', position: 1 },
        ],
      }),
    );

    // The tombstone must hold — q-1 stays hidden, q-2 surfaces at position 0.
    expect(
      selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => ({
        id: m.id,
        position: m.position,
      })),
    ).toEqual([{ id: 'q-2', position: 0 }]);
  });

  it('ignores agent:queue:updated payloads without a queue array (FE never invents data)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Seed a known good snapshot first so we can verify the malformed one is a no-op.
    handler(
      notification('agent:queue:updated', {
        agentId: AGENT,
        queue: [{ id: 'q-1', content: 'first', queuedAt: '2026-01-02T00:00:01.000Z', position: 0 }],
      }),
    );
    handler(notification('agent:queue:updated', { agentId: AGENT, queue: undefined }));

    expect(selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => m.id)).toEqual([
      'q-1',
    ]);
  });

  it('an empty snapshot leaves parked retry records untouched — agent:queue:processing owns the promotion (monorepo#1057)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:queue:updated', {
        agentId: AGENT,
        queue: [
          {
            id: 'q-mine',
            content: 'mine',
            queuedAt: '2026-01-02T00:00:01.000Z',
            position: 0,
            turnId: 'q-mine',
          },
        ],
      }),
    );
    appStore.dispatch(chatQueuedRetryRecordSet(AGENT, 'q-mine', { text: 'mine' }, 'q-mine'));

    // The daemon dequeues the sole entry to run it: the shrunk snapshot
    // arrives first, then agent:queue:processing performs the exact
    // promotion. The snapshot alone must not promote (a discard publishes
    // the same empty snapshot).
    handler(notification('agent:queue:updated', { agentId: AGENT, queue: [] }));
    expect(readRetryState()).toEqual({
      lastAttemptedMessage: null,
      queuedRetryRecords: { 'q-mine': { seq: 1, record: { text: 'mine' }, turnId: 'q-mine' } },
    });

    handler(
      notification('agent:queue:processing', {
        agentId: AGENT,
        messageId: 'q-mine',
        content: 'mine',
        turnId: 'q-mine',
      }),
    );
    expect(readRetryState()).toEqual({
      lastAttemptedMessage: { text: 'mine' },
      queuedRetryRecords: {},
    });
  });

  it('forwards queue entries carrying the PROTOCOL §6.6 turnId verbatim into the queue mirror', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // A fresh enqueue sets turnId = id; a terminal-failure requeue mints a new
    // entry id but preserves the failed turn's turnId. Both must survive the
    // bridge → slice round-trip untouched (the FE never heals BE payloads).
    handler(
      notification('agent:queue:updated', {
        agentId: AGENT,
        queue: [
          {
            id: 'q-fresh',
            content: 'fresh',
            queuedAt: '2026-01-02T00:00:01.000Z',
            position: 0,
            turnId: 'q-fresh',
          },
          {
            id: 'q-requeue',
            content: 'requeued',
            queuedAt: '2026-01-02T00:00:02.000Z',
            position: 1,
            turnId: 'turn-original',
          },
        ],
      }),
    );

    expect(
      selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => ({
        id: m.id,
        turnId: m.turnId,
      })),
    ).toEqual([
      { id: 'q-fresh', turnId: 'q-fresh' },
      { id: 'q-requeue', turnId: 'turn-original' },
    ]);
  });

  it('still accepts queue entries WITHOUT turnId (legacy pre-#1022 entries)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:queue:updated', {
        agentId: AGENT,
        queue: [{ id: 'q-1', content: 'first', queuedAt: '2026-01-02T00:00:01.000Z', position: 0 }],
      }),
    );

    const [entry] = selectAgentQueueMessages.select(appStore.state, AGENT);
    expect(entry.id).toBe('q-1');
    expect(entry.turnId).toBeUndefined();
  });
});

describe('daemonEventsBridge (queue drain-start — agent:queue:processing → chatQueueProcessingReceived)', () => {
  beforeAll(() => appStore.init());

  let dispatchCalls: any[];

  beforeEach(async () => {
    dispatchCalls = [];
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore appStore.dispatch getter overridden by wrapDispatch() to avoid leaking into other suites.
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(appStore), 'dispatch');
    if (original) Object.defineProperty(appStore, 'dispatch', original);
  });

  /** Track dispatches — the action is a stub with no reducer case yet. */
  function wrapDispatch() {
    const originalGetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(appStore),
      'dispatch',
    )!.get!;
    const realDispatch = originalGetter.call(appStore);

    Object.defineProperty(appStore, 'dispatch', {
      get() {
        return (action: any) => {
          dispatchCalls.push(action);
          return realDispatch(action);
        };
      },
      configurable: true,
    });
  }

  function queueProcessingCalls() {
    return dispatchCalls.filter((a) => a.type === 'chatState/queueProcessingReceived');
  }

  it('dispatches chatQueueProcessingReceived with the drained entry turnId (PROTOCOL §6.5)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    wrapDispatch();

    handler(
      notification('agent:queue:processing', {
        agentId: AGENT,
        messageId: 'q-1',
        content: 'first',
        turnId: 'turn-abc',
      }),
    );

    expect(queueProcessingCalls()).toEqual([
      expect.objectContaining({
        type: 'chatState/queueProcessingReceived',
        payload: [AGENT, 'turn-abc'],
      }),
    ]);
  });

  it('dispatches with turnId undefined when the payload omits it (legacy pre-#1022 entry)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    wrapDispatch();

    handler(notification('agent:queue:processing', { agentId: AGENT, messageId: 'q-1' }));

    expect(queueProcessingCalls()).toEqual([
      expect.objectContaining({ payload: [AGENT, undefined] }),
    ]);
  });

  it('ignores agent:queue:processing payloads missing agentId or messageId (FE never invents data)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    wrapDispatch();

    handler(notification('agent:queue:processing', { agentId: AGENT }));
    handler(notification('agent:queue:processing', { messageId: 'q-1' }));

    expect(queueProcessingCalls()).toHaveLength(0);
  });

  it('threads the agent:failed turnId through the chatSendFailed dispatch (PROTOCOL §6.6)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    wrapDispatch();

    handler(
      notification('agent:failed', {
        agentId: AGENT,
        error: 'boom',
        status: 'error',
        turnId: 'turn-failed-1',
      }),
    );

    const failedCalls = dispatchCalls.filter((a) => a.type === 'chatState/sendFailed');
    expect(failedCalls).toEqual([
      expect.objectContaining({ payload: [AGENT, 'boom', 'turn-failed-1'] }),
    ]);
  });

  it('chatSendFailed carries turnId undefined when agent:failed omits it (older daemons)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    wrapDispatch();

    handler(notification('agent:failed', { agentId: AGENT, error: 'boom', status: 'error' }));

    const failedCalls = dispatchCalls.filter((a) => a.type === 'chatState/sendFailed');
    expect(failedCalls).toEqual([expect.objectContaining({ payload: [AGENT, 'boom', undefined] })]);
  });
});

describe('daemonEventsBridge (fan-out scope gate — subscriptionId-aware delivery)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession({ isStreaming: true, status: AgentStatus.Active });
  });

  afterEach(() => vi.clearAllMocks());

  it('applies a status event exactly once when the daemon fans the same event out across N subscriptions on the socket', async () => {
    // Mock backendRequest resolves events.subscribe with `{ subscriptionId: "sub-1" }`
    // (top-of-file vi.mock factory). That id is the bridge's own subscription.
    // The daemon emits ONE `events.event` notification per matching subscription
    // on the socket (PROTOCOL §6.3 / intent-transport `build_event_notification`),
    // each carrying that subscription's id. If another live-* client subscribes
    // to an overlapping `agent:*` filter, the event is delivered three times to
    // the socket-level notification handler — once tagged "sub-1" (ours), once
    // "sub-foreign-a", once "sub-foreign-b". `agent:stream:status` appends a
    // statusEvents entry per applied delivery, so without the scope gate three
    // identical entries would land — the symptom this gate targets.
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const data = {
      agentId: AGENT,
      workspaceId: WS,
      phase: 'prompt',
      message: 'Sent prompt…',
      level: 'info',
      timestamp: 1000,
    };

    handler(notificationWithSub('agent:stream:status', data, 'sub-1'));
    handler(notificationWithSub('agent:stream:status', data, 'sub-foreign-a'));
    handler(notificationWithSub('agent:stream:status', data, 'sub-foreign-b'));

    const events = readStatusEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ phase: 'prompt' });
  });

  it("drops a notification whose envelope subscriptionId does not match the bridge's own", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Foreign subscription on the same socket — another consumer's overlapping
    // `agent:*` subscribe. The bridge must NOT apply these copies.
    handler(
      notificationWithSub(
        'agent:stream:status',
        {
          agentId: AGENT,
          workspaceId: WS,
          phase: 'prompt',
          message: 'leaked',
          level: 'info',
          timestamp: 1000,
        },
        'sub-foreign',
      ),
    );

    expect(readStatusEvents()).toHaveLength(0);
  });

  it('still applies legacy/flat envelopes with no subscriptionId (back-compat)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // No `params.subscriptionId` on the envelope — older transports / tests
    // never tagged the wire copy. Must continue to apply.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'prompt',
        message: 'Legacy ok',
        level: 'info',
        timestamp: 1000,
      }),
    );

    const events = readStatusEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ phase: 'prompt' });
  });

  it('install is idempotent — repeated primeBridge dispatches register one notification listener and one events.subscribe call', async () => {
    await primeBridge();
    await primeBridge();
    await primeBridge();

    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    const subscribeCalls = backendRequestSpy.mock.calls.filter(
      ([method]) => method === 'events.subscribe',
    );
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0][1]).toEqual({
      eventTypes: [
        'agent:*',
        'file:*',
        'note:*',
        'comment:*',
        'script:*',
        'settings:changed',
        'workspace:tokenUsage-changed',
        'workspace:context-changed',
        'workspace:activity-changed',
        'workspace:displayStatus-changed',
        'workspace:updated',
        'workspace:created',
        'workspace:deleted',
        'task:*',
        'git:*',
        'changes:git-status',
        'changes:tracked',
        'line-attribution:updated',
        'pr:*',
        'mcp.servers:status-changed',
        'github:auth-changed',
        'app:ui-navigate',
        'app:ui-highlight',
        'app:workspace-open',
      ],
    });
  });
});

describe('daemonEventsBridge (usage wire contract — workspace:tokenUsage-changed → tokenUsage slice)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('mirrors the pushed §5.23 TokenUsage rollup into the tokenUsage slice', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];
    expect(handler).toBeTypeOf('function');

    // PROTOCOL §6.5: data = { workspaceId, tokenUsage } (self-sufficient §6.7).
    const tokenUsage = {
      byAgentId: {
        'agent-123': {
          inputTokens: 12000,
          outputTokens: 3400,
          cacheReadTokens: 8000,
          cacheCreationTokens: 1200,
        },
      },
      byModel: {
        'opus-4.8': {
          inputTokens: 12000,
          outputTokens: 3400,
          cacheReadTokens: 8000,
          cacheCreationTokens: 1200,
        },
      },
      totals: {
        inputTokens: 12000,
        outputTokens: 3400,
        cacheReadTokens: 8000,
        cacheCreationTokens: 1200,
      },
      lastScanAt: '2026-06-17T12:00:00Z',
    };
    handler!(notification('workspace:tokenUsage-changed', { workspaceId: WS, tokenUsage }));

    const state = appStore.state as {
      tokenUsage: { byWorkspaceId: Record<string, unknown> };
    };
    expect(state.tokenUsage.byWorkspaceId[WS]).toEqual({
      ...tokenUsage,
      isStale: false,
    });
  });

  it('ignores a push without a tokenUsage object', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    handler!(notification('workspace:tokenUsage-changed', { workspaceId: 'ws-token-empty' }));

    const state = appStore.state as {
      tokenUsage: { byWorkspaceId: Record<string, unknown> };
    };
    expect(state.tokenUsage.byWorkspaceId['ws-token-empty']).toBeUndefined();
  });
});

describe('daemonEventsBridge (context wire contract — workspace:context-changed → context slice)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('mirrors the pushed §5.1 items list into the context slice via hydrateContextItems', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    const items = [
      {
        id: 'n1',
        type: 'note',
        title: 'note-1',
        provider: 'internal',
        noteId: 'n1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    handler!(notification('workspace:context-changed', { workspaceId: WS, items }));

    // The context slice stores items as a Collection keyed by `id`; assert on
    // the flat item list so the test does not lean on the internal collection
    // shape.
    expect(selectContextItems.select(appStore.state, WS).map((i) => i.id)).toEqual(['n1']);
  });

  it('ignores a push without an items array', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    handler!(notification('workspace:context-changed', { workspaceId: 'ws-ctx-empty' }));

    const state = appStore.state as {
      context: { byWorkspaceId: Record<string, unknown> };
    };
    expect(state.context.byWorkspaceId['ws-ctx-empty']).toBeUndefined();
  });

  // The context slice keys items by `id` and discriminates variants by `type`,
  // so the bridge drops rows missing either before dispatching — mirrors the
  // filter the AppClient seam applies to `workspace.getContext` responses.
  it('filters out rows missing id or type before hydrating', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    const good = {
      id: 'n1',
      type: 'note',
      title: 'note-1',
      provider: 'internal',
      noteId: 'n1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    handler!(
      notification('workspace:context-changed', {
        workspaceId: 'ws-ctx-filter',
        items: [good, { title: 'missing id/type' }, { id: 'n2' }, null, 'n3'],
      }),
    );

    expect(selectContextItems.select(appStore.state, 'ws-ctx-filter').map((i) => i.id)).toEqual([
      'n1',
    ]);
  });
});

describe('daemonEventsBridge (linkage wire contract — task:agent-linked / task:agent-unlinked)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('folds task:agent-linked into taskAgentAssociations via applyTaskAgentLinked', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    const link = {
      workspaceId: WS,
      noteId: 'note-1',
      taskKey: 'agent:a1',
      taskText: 'do it',
      agentId: 'a1',
      createdAt: 1700000000000,
    };
    handler!(
      notification('task:agent-linked', {
        workspaceId: WS,
        noteId: 'note-1',
        taskKey: 'agent:a1',
        link,
      }),
    );

    const state = appStore.state as {
      taskAgentAssociations: {
        byWorkspaceId: Record<string, { byNoteId: Record<string, Record<string, unknown>> }>;
      };
    };
    expect(state.taskAgentAssociations.byWorkspaceId[WS]?.byNoteId['note-1']?.['agent:a1']).toEqual(
      {
        noteId: 'note-1',
        taskKey: 'agent:a1',
        taskText: 'do it',
        agentId: 'a1',
        createdAt: 1700000000000,
      },
    );
  });

  it('removes the row when task:agent-unlinked arrives', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    handler!(
      notification('task:agent-linked', {
        workspaceId: WS,
        noteId: 'note-2',
        taskKey: 'agent:a2',
        link: {
          workspaceId: WS,
          noteId: 'note-2',
          taskKey: 'agent:a2',
          taskText: 'gone soon',
          agentId: 'a2',
          createdAt: 1700000000001,
        },
      }),
    );
    handler!(
      notification('task:agent-unlinked', {
        workspaceId: WS,
        noteId: 'note-2',
        taskKey: 'agent:a2',
      }),
    );

    const state = appStore.state as {
      taskAgentAssociations: {
        byWorkspaceId: Record<string, { byNoteId: Record<string, unknown> }>;
      };
    };
    expect(state.taskAgentAssociations.byWorkspaceId[WS]?.byNoteId['note-2']).toBeUndefined();
  });
});

describe('daemonEventsBridge (legacy mock-IPC relay — daemon events → listenSync channels)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    resetMockIpcRouter();
    capturedHandlers.length = 0;
  });

  afterEach(() => {
    resetMockIpcRouter();
    vi.clearAllMocks();
  });

  /** Register a mock-IPC listener and return the payloads it receives. */
  function listenOn(channel: string): unknown[] {
    const seen: unknown[] = [];
    addMockIpcListener(channel, (payload) => seen.push(payload));
    return seen;
  }

  it('re-emits task:ready-tasks-changed with the §5.4 TS-parity envelope (workspaceId + data.readyTaskIds)', async () => {
    await primeBridge();
    const seen = listenOn('task:ready-tasks-changed');

    const data = {
      readyTaskIds: ['note-1', 'note-2'],
      triggeredBy: { noteId: 'note-3', previousStatus: 'in_progress', newStatus: 'complete' },
      computedAt: '2026-01-02T00:00:00.000Z',
    };
    capturedHandlers[0]!(notification('task:ready-tasks-changed', data));

    expect(seen).toHaveLength(1);
    // The listener (WorkspaceProgressCard) reads payload.workspaceId and
    // payload.data.readyTaskIds — the daemon event envelope carries both.
    expect(seen[0]).toMatchObject({ workspaceId: WS, data });
  });

  it('re-emits changes:git-status as git:status-changed { workspaceId }', async () => {
    await primeBridge();
    const seen = listenOn('git:status-changed');

    capturedHandlers[0]!(
      notification('changes:git-status', { workspaceId: WS, status: { files: [] } }),
    );

    expect(seen).toEqual([{ workspaceId: WS }]);
  });

  it('re-emits changes:tracked as file-tracking:changes-updated { workspaceId }', async () => {
    await primeBridge();
    const seen = listenOn('file-tracking:changes-updated');

    capturedHandlers[0]!(notification('changes:tracked', { workspaceId: WS, changes: [] }));

    expect(seen).toEqual([{ workspaceId: WS }]);
  });

  it('re-emits line-attribution:updated with { workspaceId, noteId, attributions } for the gutter', async () => {
    // PROTOCOL §5.2.1 / §6.5 — daemon emits the self-sufficient payload; the
    // bridge forwards it so LineAttributionGutter's listenSync path fires.
    await primeBridge();
    const seen = listenOn('line-attribution:updated');

    const attributions = {
      '1': {
        timestamp: 1720193696000,
        author: { id: 'system', name: 'intentd', type: 'system' as const },
      },
    };
    capturedHandlers[0]!(
      notification('line-attribution:updated', {
        workspaceId: WS,
        noteId: 'note-abc',
        attributions,
      }),
    );

    expect(seen).toEqual([{ workspaceId: WS, noteId: 'note-abc', attributions }]);
  });

  it('re-emits workspace:updated with the event data as changes', async () => {
    await primeBridge();
    const seen = listenOn('workspace:updated');

    capturedHandlers[0]!(notification('workspace:updated', { title: 'Renamed' }));

    expect(seen).toEqual([{ workspaceId: WS, changes: { title: 'Renamed' } }]);
  });

  // `pr:linked` / `pr:updated` / `pr:unlinked` are no longer re-emitted onto
  // the legacy `workspace:updated` mock-IPC channel — they are dispatched
  // directly to the workspace slice via `handlePrEvent`. The Redux path is
  // covered by the "daemonEventsBridge (pr:linked / pr:updated / pr:unlinked
  // → workspace slice)" suite below.

  it('re-emits agent:status-changed and agent:idle onto their legacy channels (and still dispatches the lifecycle)', async () => {
    appStore.dispatch(clearAllSessions());
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const statusSeen = listenOn('agent:status-changed');
    const idleSeen = listenOn('agent:idle');

    capturedHandlers[0]!(
      notification('agent:status-changed', { agentId: AGENT, status: 'active' }),
    );
    capturedHandlers[0]!(notification('agent:idle', { agentId: AGENT }));

    // active-streams-tracker refetches on any delivery — payload is the event.
    expect(statusSeen).toHaveLength(1);
    expect(statusSeen[0]).toMatchObject({ type: 'agent:status-changed', workspaceId: WS });
    expect(idleSeen).toHaveLength(1);
    expect(idleSeen[0]).toMatchObject({ type: 'agent:idle', workspaceId: WS });
    // The relay is a side effect, not an early return: agent:idle still clears
    // the optimistic responding flag through the lifecycle dispatch.
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it('does not relay events dropped by the fan-out scope gate', async () => {
    await primeBridge();
    const seen = listenOn('git:status-changed');

    const base = notification('changes:git-status', { workspaceId: WS, status: {} });
    capturedHandlers[0]!({
      method: base.method,
      params: { ...base.params, subscriptionId: 'sub-foreign' },
    });

    expect(seen).toEqual([]);
  });
});

describe('daemonEventsBridge (script wire contract — script:output/state → scripts slice)', () => {
  const SCRIPT_ID = 'script-bridge-1';

  function seedScript(): void {
    appStore.dispatch(
      upsertScript(WS, {
        id: SCRIPT_ID,
        workspaceId: WS,
        name: 'Dev Server',
        command: 'pnpm dev',
        mode: 'service',
        source: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
  }

  function readScriptsState(): {
    scripts: Record<string, { runtime: { status: string; pid?: number; detectedUrl?: string } }>;
    outputBuffers: Record<string, ScriptOutputBuffer>;
  } {
    const state = appStore.state as {
      scripts: {
        byWorkspaceId: Record<
          string,
          {
            scripts: Record<
              string,
              { runtime: { status: string; pid?: number; detectedUrl?: string } }
            >;
            outputBuffers: Record<string, ScriptOutputBuffer>;
          }
        >;
      };
    };
    return (
      state.scripts.byWorkspaceId[WS] ?? {
        scripts: {},
        outputBuffers: {},
      }
    );
  }

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    appStore.dispatch(disposeScripts(WS));
    seedScript();
  });

  afterEach(() => vi.clearAllMocks());

  it('decodes script:output base64 chunk and appends it verbatim — no line splitting', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // PROTOCOL §6.5 payload: { scriptId, chunk } — chunk is base64 of raw PTY bytes.
    const raw = 'hello\nworld\n';
    const chunk = Buffer.from(raw, 'utf-8').toString('base64');
    handler(notification('script:output', { scriptId: SCRIPT_ID, chunk }));

    const buffer = readScriptsState().outputBuffers[SCRIPT_ID];
    expect(buffer.chunks.map((c) => c.text)).toEqual([raw]);
    expect(buffer.dropped).toBe(0);
  });

  it('reconstructs a multi-chunk stream (chunk ending mid-line) with no injected newlines', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const send = (raw: string) =>
      handler(
        notification('script:output', {
          scriptId: SCRIPT_ID,
          chunk: Buffer.from(raw, 'utf-8').toString('base64'),
        }),
      );
    send('Compi');
    send('ling...\r\ndo');
    send('ne\r\n');

    const buffer = readScriptsState().outputBuffers[SCRIPT_ID];
    expect(buffer.chunks.map((c) => c.text).join('')).toBe('Compiling...\r\ndone\r\n');
    // Verbatim storage: each wire chunk is one store chunk.
    expect(buffer.chunks).toHaveLength(3);
  });

  it('preserves bare-\\r spinner frames verbatim (no synthesized lines)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const raw = '⠋ building\r⠙ building\r⠹ building\r';
    handler(
      notification('script:output', {
        scriptId: SCRIPT_ID,
        chunk: Buffer.from(raw, 'utf-8').toString('base64'),
      }),
    );

    const buffer = readScriptsState().outputBuffers[SCRIPT_ID];
    expect(buffer.chunks.map((c) => c.text)).toEqual([raw]);
    expect(buffer.chunks.map((c) => c.text).join('')).not.toContain('\n');
  });

  it('preserves an ANSI sequence split across two chunks', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const send = (raw: string) =>
      handler(
        notification('script:output', {
          scriptId: SCRIPT_ID,
          chunk: Buffer.from(raw, 'utf-8').toString('base64'),
        }),
      );
    // '\x1b[32mok\x1b[0m' split mid-CSI-sequence.
    send('\x1b[3');
    send('2mok\x1b[0m');

    const buffer = readScriptsState().outputBuffers[SCRIPT_ID];
    expect(buffer.chunks.map((c) => c.text).join('')).toBe('\x1b[32mok\x1b[0m');
    expect(buffer.chunks.map((c) => c.text).join('')).not.toContain('\n');
  });

  it('decodes a multibyte character split across two chunks losslessly (streaming decoder)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // '⠋ build' is 9 UTF-8 bytes ('⠋' = e2 a0 8b); split mid-character so each
    // chunk alone is invalid UTF-8. A stateless decoder would emit U+FFFD.
    const bytes = Buffer.from('⠋ build', 'utf-8');
    const send = (slice: Buffer) =>
      handler(
        notification('script:output', { scriptId: SCRIPT_ID, chunk: slice.toString('base64') }),
      );
    send(bytes.subarray(0, 2));
    send(bytes.subarray(2));

    const buffer = readScriptsState().outputBuffers[SCRIPT_ID];
    expect(buffer.chunks.map((c) => c.text).join('')).toBe('⠋ build');
    expect(buffer.chunks.map((c) => c.text).join('')).not.toContain('\uFFFD');
  });

  it('ignores script:output payloads without a scriptId or chunk', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('script:output', { scriptId: SCRIPT_ID }));
    handler(notification('script:output', { chunk: 'aGk=' }));

    expect(readScriptsState().outputBuffers[SCRIPT_ID]).toBeUndefined();
  });

  it("mirrors script:state into the scripts slice's runtime", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // PROTOCOL §6.5 payload: ScriptRuntimeState + scriptId (self-sufficient §6.7).
    handler(
      notification('script:state', {
        scriptId: SCRIPT_ID,
        status: 'running',
        pid: 4242,
        restartCount: 0,
        startedAt: '2026-01-02T00:00:00.000Z',
      }),
    );

    expect(readScriptsState().scripts[SCRIPT_ID].runtime).toMatchObject({
      status: 'running',
      pid: 4242,
      startedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('mirrors detectedUrl from script:state into the runtime state', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('script:state', {
        scriptId: SCRIPT_ID,
        status: 'running',
        restartCount: 0,
        detectedUrl: 'http://localhost:5173',
      }),
    );

    expect(readScriptsState().scripts[SCRIPT_ID].runtime.detectedUrl).toBe('http://localhost:5173');
  });
});

describe('daemonEventsBridge (permission flow — PROTOCOL §8 request/resolved events)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  const REQUEST_ID = 'perm_1718600000000_1';

  function readPermissionRequests(): unknown[] {
    const state = appStore.state as {
      permission?: { requests?: { ids: string[]; map: Record<string, unknown> } };
    };
    const requests = state.permission?.requests;
    if (!requests) return [];
    return requests.ids.map((id) => requests.map[id]);
  }

  it('dispatches permissionRequestReceived with the normalized wire payload from agent:permission:request', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // PROTOCOL §8 normalized `PermissionRequestData` — the exact shape the
    // Electron reference and intentd emit on `agent:permission:request`.
    handler(
      notification('agent:permission:request', {
        requestId: REQUEST_ID,
        sessionId: AGENT,
        title: 'Run command',
        description: 'Tool input: { "command": "npm test" }',
        options: [
          { id: 'allow_once', label: 'Allow', destructive: false },
          { id: 'reject_once', label: 'Deny', destructive: true },
        ],
        agentName: 'auggie',
        riskLevel: 'high',
        timestamp: 1718600000000,
      }),
    );

    const requests = readPermissionRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requestId: REQUEST_ID,
      sessionId: AGENT,
      title: 'Run command',
      agentName: 'auggie',
      riskLevel: 'high',
      timestamp: 1718600000000,
      options: [
        { id: 'allow_once', label: 'Allow', destructive: false },
        { id: 'reject_once', label: 'Deny', destructive: true },
      ],
    });
  });

  it('clears the request via removePermissionRequest on agent:permission:resolved', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:permission:request', {
        requestId: REQUEST_ID,
        sessionId: AGENT,
        title: 'Run command',
        options: [{ id: 'allow_once', label: 'Allow' }],
        timestamp: 1718600000000,
      }),
    );
    expect(readPermissionRequests()).toHaveLength(1);

    // PROTOCOL §8: `agent:permission:resolved` carries `{ requestId, outcome }`
    // — the outcome value is preserved on the wire but the FE only needs
    // `requestId` to clear the inline prompt.
    handler(
      notification('agent:permission:resolved', {
        requestId: REQUEST_ID,
        outcome: { outcome: 'selected', optionId: 'allow_once' },
      }),
    );

    expect(readPermissionRequests()).toHaveLength(0);
  });

  it('ignores permission events missing requestId / sessionId / title (schema guard)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:permission:request', {
        sessionId: AGENT,
        title: 'No id',
        options: [],
      }),
    );
    handler(
      notification('agent:permission:request', {
        requestId: REQUEST_ID,
        title: 'No session',
        options: [],
      }),
    );
    handler(
      notification('agent:permission:resolved', {
        outcome: { outcome: 'cancelled' },
      }),
    );

    expect(readPermissionRequests()).toHaveLength(0);
  });
});

describe('daemonEventsBridge (attention flow — agent:attention-requested → sticky toast)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    showAgentAttentionToastSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('routes agent:attention-requested to showAgentAttentionToast with the self-sufficient payload', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Wire contract: `{ workspaceId, agentId, agentName, kind, reason }` —
    // the payload is self-sufficient (carries its own workspaceId).
    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentId: AGENT,
        agentName: 'Implementor',
        kind: 'discussion',
        reason: 'Need a decision on the API shape',
      }),
    );

    expect(showAgentAttentionToastSpy).toHaveBeenCalledTimes(1);
    expect(showAgentAttentionToastSpy).toHaveBeenCalledWith({
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'discussion',
      reason: 'Need a decision on the API shape',
      // Envelope timestamp (the payload carries no timestamp of its own).
      timestamp: '2026-01-02T00:00:00.000Z',
    });
  });

  it('fires for agents in ANY workspace — the payload workspaceId wins over the envelope', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // The notification() helper stamps the envelope with WS; the payload
    // targets a DIFFERENT (unfocused) workspace — the toast must route there.
    handler(
      notification('agent:attention-requested', {
        workspaceId: 'ws-other-2',
        agentId: 'agent-other-2',
        agentName: 'Verifier',
        kind: 'blocker',
        reason: 'Blocked: main branch is broken',
      }),
    );

    expect(showAgentAttentionToastSpy).toHaveBeenCalledWith({
      workspaceId: 'ws-other-2',
      agentId: 'agent-other-2',
      agentName: 'Verifier',
      kind: 'blocker',
      reason: 'Blocked: main branch is broken',
      timestamp: '2026-01-02T00:00:00.000Z',
    });
  });

  it('falls back to the envelope workspaceId when the payload omits it', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        agentId: AGENT,
        agentName: 'Implementor',
        kind: 'blocker',
        reason: 'CI is red',
      }),
    );

    expect(showAgentAttentionToastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, agentId: AGENT, kind: 'blocker' }),
    );
  });

  it('ignores malformed payloads (missing agentId / unknown kind / empty reason)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentName: 'Implementor',
        kind: 'discussion',
        reason: 'no agentId',
      }),
    );
    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentId: AGENT,
        agentName: 'Implementor',
        kind: 'shout',
        reason: 'unknown kind',
      }),
    );
    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentId: AGENT,
        agentName: 'Implementor',
        kind: 'blocker',
        reason: '',
      }),
    );

    expect(showAgentAttentionToastSpy).not.toHaveBeenCalled();
  });

  it('falls through to the activity timeline (eventReceived) alongside the toast', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentId: AGENT,
        agentName: 'Implementor',
        kind: 'discussion',
        reason: 'Need a decision',
      }),
    );

    const state = appStore.state as {
      workspaceEvents?: { byWorkspaceId?: Record<string, { events?: Array<{ type: string }> }> };
    };
    const events = state.workspaceEvents?.byWorkspaceId?.[WS]?.events ?? [];
    expect(events.some((event) => event.type === 'agent:attention-requested')).toBe(true);
  });

  it('skips the toast when the payload carries parentAgentId (delegated agent — parent handles it)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    ensureAgentSessionSpy.mockClear();

    // PROTOCOL §6.5: optional parentAgentId, present for delegated agents.
    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentId: AGENT,
        agentName: 'Implementor',
        kind: 'discussion',
        reason: 'Need a decision on the API shape',
        parentAgentId: 'agent-parent-1',
      }),
    );

    expect(showAgentAttentionToastSpy).not.toHaveBeenCalled();
    // The gate only suppresses the toast — the session refetch and the
    // activity timeline still fire so the sidebar indicator/timeline work.
    expect(ensureAgentSessionSpy).toHaveBeenCalledWith(AGENT);
    const state = appStore.state as {
      workspaceEvents?: { byWorkspaceId?: Record<string, { events?: Array<{ type: string }> }> };
    };
    const events = state.workspaceEvents?.byWorkspaceId?.[WS]?.events ?? [];
    expect(events.some((event) => event.type === 'agent:attention-requested')).toBe(true);
  });

  it('still toasts when parentAgentId is absent or empty (parentless agent / older daemon)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentId: AGENT,
        agentName: 'Implementor',
        kind: 'blocker',
        reason: 'CI is red',
        parentAgentId: '',
      }),
    );

    expect(showAgentAttentionToastSpy).toHaveBeenCalledTimes(1);
    expect(showAgentAttentionToastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT, kind: 'blocker' }),
    );
  });
});

describe('daemonEventsBridge (wire contract — mcp.servers:status-changed §6.5)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    // Reset the mcpSettings slice via a fresh server list so `id`s resolve.
    appStore.dispatch(setServers([]));
    appStore.dispatch(bulkSetServerStatus({}));
    appStore.dispatch(clearAllErrorMessages());
  });

  afterEach(() => vi.clearAllMocks());

  function seedMcpServer(id: string, name: string): void {
    appStore.dispatch(setServers([{ id, name, type: 'stdio', command: 'npx' }]));
  }

  function mcpNotification(data: Record<string, unknown>) {
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-mcp-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'mcp.servers:status-changed',
          actor: { type: 'system', id: 'daemon' },
          data,
        },
      },
    };
  }

  function readStatus(name: string): McpServerStatus | undefined {
    return appStore.state.mcpSettings.statusMap[name];
  }

  it("running → sets statusMap[name] = 'connected' and clears any prior error", async () => {
    seedMcpServer('srv-fs', 'filesystem');
    // Prime a prior error to prove the handler clears it on recovery.
    appStore.dispatch(setServerErrorMessage('filesystem', 'boot failed'));

    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      mcpNotification({
        serverId: 'srv-fs',
        status: { serverId: 'srv-fs', state: 'running', pid: 1234, toolCount: 7 },
      }),
    );

    expect(readStatus('filesystem')).toBe('connected');
    expect(appStore.state.mcpSettings.errorMessages.filesystem).toBeUndefined();
  });

  it("error → sets 'error' status and surfaces lastError via setServerErrorMessage", async () => {
    seedMcpServer('srv-gh', 'github');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      mcpNotification({
        serverId: 'srv-gh',
        status: { serverId: 'srv-gh', state: 'error', lastError: 'connect ECONNREFUSED' },
      }),
    );

    expect(readStatus('github')).toBe('error');
    expect(appStore.state.mcpSettings.errorMessages.github).toBe('connect ECONNREFUSED');
  });

  it('starting/stopped map to configured/stopped respectively', async () => {
    seedMcpServer('srv-a', 'alpha');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      mcpNotification({ serverId: 'srv-a', status: { serverId: 'srv-a', state: 'starting' } }),
    );
    expect(readStatus('alpha')).toBe('configured');

    handler(
      mcpNotification({ serverId: 'srv-a', status: { serverId: 'srv-a', state: 'stopped' } }),
    );
    expect(readStatus('alpha')).toBe('stopped');
  });

  it('drops events for an unknown serverId (no FE state mutation)', async () => {
    seedMcpServer('srv-known', 'known');
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const before = appStore.state.mcpSettings.statusMap;

    handler(
      mcpNotification({
        serverId: 'srv-ghost',
        status: { serverId: 'srv-ghost', state: 'running' },
      }),
    );

    expect(appStore.state.mcpSettings.statusMap).toEqual(before);
  });

  it('ignores payloads missing serverId or a mappable state', async () => {
    seedMcpServer('srv-x', 'x');
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const before = appStore.state.mcpSettings.statusMap;

    handler(mcpNotification({ status: { state: 'running' } }));
    handler(mcpNotification({ serverId: 'srv-x', status: { state: 'unknown' } }));
    handler(mcpNotification({ serverId: 'srv-x' }));

    expect(appStore.state.mcpSettings.statusMap).toEqual(before);
  });
});

describe('daemonEventsBridge (wire contract — github:auth-changed §6.5)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  function githubAuthNotification(data: Record<string, unknown>) {
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-gh-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'github:auth-changed',
          // Global event — empty workspaceId per §6.5.
          actor: { type: 'system', id: 'daemon' },
          data,
        },
      },
    };
  }

  it('terminal statuses dispatch githubAuthChanged into the auth state', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(githubAuthNotification({ status: 'expired' }));
    await flush();

    expect(appStore.state.githubAuth.error).toContain('expired');
    expect(appStore.state.githubAuth.isAuthenticating).toBe(false);
  });

  it('revoked resets the auth state to signed-out', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(githubAuthNotification({ status: 'revoked' }));
    await flush();

    expect(appStore.state.githubAuth.isAuthenticated).toBe(false);
    expect(appStore.state.githubAuth.user).toBeNull();
  });

  it('ignores payloads with an unknown or missing status', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const before = appStore.state.githubAuth;

    handler(githubAuthNotification({ status: 'bogus' }));
    handler(githubAuthNotification({}));
    await flush();

    expect(appStore.state.githubAuth).toEqual(before);
  });
});

describe('daemonEventsBridge (session lifecycle — agent:created/renamed/updated §5.5)', () => {
  const CREATED_AGENT = 'agent-created-1';

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    ensureAgentSessionSpy.mockReset();
    ensureAgentSessionSpy.mockImplementation(() => Promise.resolve());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    // Prime the bridge without seeding a session (agent:created runs against an
    // empty store to prove it surfaces a brand-new sidebar entry).
    appStore.dispatch(setAgentStreaming('prime-noop', false));
    await flush();
  });

  afterEach(() => vi.clearAllMocks());

  it('agent:created hydrates the sidebar entry via the transcript-preserving read-service seam', async () => {
    const handler = capturedHandlers[0]!;
    // Simulate what the real ensureAgentSession does on a successful fetch:
    // dispatch bulkUpsertSessions so the new session lands in the store.
    ensureAgentSessionSpy.mockImplementationOnce(async () => {
      appStore.dispatch(
        bulkUpsertSessions([
          {
            id: CREATED_AGENT,
            backendSessionId: null,
            workspaceId: WS,
            name: 'Delegated Child',
            status: AgentStatus.Pending,
            messages: [],
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          } as AgentSession,
        ]),
      );
    });

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-created-1',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:created',
          actor: { type: 'system', id: 'daemon' },
          data: { agentId: CREATED_AGENT, name: 'Delegated Child' },
        },
      },
    });
    await flush();

    expect(ensureAgentSessionSpy).toHaveBeenCalledWith(CREATED_AGENT);
    const state = appStore.state as {
      agentSessions: {
        byAgentId: Record<string, AgentSession>;
        agentIdsByWorkspace: Record<string, string[]>;
      };
    };
    expect(state.agentSessions.byAgentId[CREATED_AGENT]?.name).toBe('Delegated Child');
    expect(state.agentSessions.agentIdsByWorkspace[WS] ?? []).toContain(CREATED_AGENT);
  });

  it("agent:renamed updates the sidebar entry's name without clobbering the transcript", async () => {
    const message: AgentMessage = {
      id: 'asst-1',
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: 'hello' }],
      timestamp: '2026-01-02T00:00:00.000Z',
    };
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AGENT,
          backendSessionId: 'backend-1',
          workspaceId: WS,
          name: 'Original',
          status: AgentStatus.Active,
          messages: [message],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as AgentSession,
      ]),
    );

    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-renamed-1',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:renamed',
          actor: { type: 'system', id: 'daemon' },
          data: { agentId: AGENT, name: 'Renamed' },
        },
      },
    });

    const state = appStore.state as {
      agentSessions: { byAgentId: Record<string, AgentSession> };
    };
    expect(state.agentSessions.byAgentId[AGENT]?.name).toBe('Renamed');
    // Transcript must survive the metadata mutation.
    expect(state.agentSessions.byAgentId[AGENT]?.messages).toHaveLength(1);
    expect(state.agentSessions.byAgentId[AGENT]?.messages[0].id).toBe('asst-1');
  });

  it('agent:updated re-reads through the seam and does not clobber the local transcript', async () => {
    const message: AgentMessage = {
      id: 'asst-keep',
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: 'keep me' }],
      timestamp: '2026-01-02T00:00:00.000Z',
    };
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AGENT,
          backendSessionId: 'backend-1',
          workspaceId: WS,
          name: 'A',
          status: AgentStatus.Active,
          messages: [message],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as AgentSession,
      ]),
    );

    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-updated-1',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:updated',
          actor: { type: 'system', id: 'daemon' },
          data: { agentId: AGENT, modelId: 'claude-opus-4.7' },
        },
      },
    });
    await flush();

    expect(ensureAgentSessionSpy).toHaveBeenCalledWith(AGENT);
    const state = appStore.state as {
      agentSessions: { byAgentId: Record<string, AgentSession> };
    };
    // The bridge itself must not dispatch anything that clears the messages;
    // any refresh goes through ensureAgentSession, which preserves the
    // transcript on metadata-only reads (see FE 69f8c74c).
    expect(state.agentSessions.byAgentId[AGENT]?.messages).toHaveLength(1);
    expect(state.agentSessions.byAgentId[AGENT]?.messages[0].id).toBe('asst-keep');
  });

  it('ignores agent:created/renamed/updated payloads missing agentId (schema guard)', async () => {
    const handler = capturedHandlers[0]!;

    for (const type of ['agent:created', 'agent:renamed', 'agent:updated'] as const) {
      handler({
        method: 'events.event',
        params: {
          event: {
            id: `evt-${type}-guard`,
            workspaceId: WS,
            timestamp: '2026-01-02T00:00:00.000Z',
            type,
            actor: { type: 'system', id: 'daemon' },
            data: { name: 'no agent id' },
          },
        },
      });
    }
    await flush();

    expect(ensureAgentSessionSpy).not.toHaveBeenCalled();
  });
});
describe('daemonEventsBridge (note:* wire contract → applyNoteFromEvent)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    applyNoteFromEventSpy.mockClear();
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('routes note:created/updated/deleted envelopes to applyNoteFromEvent with the workspaceId + noteId', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-note-1',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'note:created',
          actor: { type: 'system' },
          data: { noteId: 'note-1', path: '/x', action: 'create' },
        },
      },
    });
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-note-2',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'note:updated',
          actor: { type: 'system' },
          data: { noteId: 'note-2', path: '/y', action: 'update' },
        },
      },
    });
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-note-3',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'note:deleted',
          actor: { type: 'system' },
          data: { noteId: 'note-3', path: '/z', action: 'delete' },
        },
      },
    });

    expect(applyNoteFromEventSpy).toHaveBeenCalledWith(WS, 'note-1', 'note:created');
    expect(applyNoteFromEventSpy).toHaveBeenCalledWith(WS, 'note-2', 'note:updated');
    expect(applyNoteFromEventSpy).toHaveBeenCalledWith(WS, 'note-3', 'note:deleted');
  });

  it('drops note:* events without a workspaceId envelope', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-note-no-ws',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'note:updated',
          actor: { type: 'system' },
          data: { noteId: 'note-x', path: '/x', action: 'update' },
        },
      },
    });

    expect(applyNoteFromEventSpy).not.toHaveBeenCalled();
  });
});

describe('daemonEventsBridge (note:* → debounced workspace-tasks refetch)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    // mockReset (not just clear) so a per-test task.list implementation never
    // leaks into later suites that rely on the default subscribe fallback.
    backendRequestSpy.mockReset();
    vi.clearAllMocks();
  });

  /** PROTOCOL §6.3 note:* envelope for an arbitrary workspace. */
  function noteEnvelope(
    workspaceId: string,
    type: 'note:created' | 'note:updated' | 'note:deleted',
    noteId: string,
  ) {
    const action =
      type === 'note:created' ? 'create' : type === 'note:deleted' ? 'delete' : 'update';
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-${noteId}-${Math.random().toString(36).slice(2, 8)}`,
          workspaceId,
          timestamp: '2026-01-02T00:00:00.000Z',
          type,
          actor: { type: 'agent', id: AGENT },
          data: { noteId, path: `/notes/${noteId}.md`, action },
        },
      },
    };
  }

  /** Wire calls issued as `task.list` for the given workspace (PROTOCOL §5.4). */
  function taskListCalls(workspaceId: string) {
    return backendRequestSpy.mock.calls.filter(
      ([method, params]: [string, { workspaceId?: string } | undefined]) =>
        method === 'task.list' && params?.workspaceId === workspaceId,
    );
  }

  it('note:created on an initialized workspace triggers a debounced task.list refetch and stores the fresh BE stats', async () => {
    const TASKS_WS = 'ws-bridge-tasks-init';
    const { loadWorkspaceTasksSucceeded } =
      await import('$store/renderer/slices/workspace-tasks/workspace-tasks-slice');
    // Seed an initialized workspace whose stats show completed === total —
    // the stale-"Complete" precondition (a new task note arrives without any
    // task:status-changed edge).
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(
        TASKS_WS,
        [{ id: 'task-1', title: 'Task 1', status: 'complete' }],
        { total: 1, completed: 1, inProgress: 0 },
      ),
    );
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // PROTOCOL §5.4-shaped task.list response: the new not_started task note
    // exists on the BE, so the rollup no longer shows completed === total.
    backendRequestSpy.mockImplementation((method: string) =>
      method === 'task.list'
        ? Promise.resolve({
            tasks: [
              { id: 'task-1', title: 'Task 1', status: 'complete' },
              { id: 'task-2', title: 'Task 2', status: 'not_started' },
            ],
            stats: { total: 2, completed: 1, inProgress: 0 },
          })
        : undefined,
    );

    vi.useFakeTimers();
    handler(noteEnvelope(TASKS_WS, 'note:created', 'task-2'));

    // Debounced: no wire call before the ~1s window elapses.
    expect(taskListCalls(TASKS_WS)).toHaveLength(0);

    vi.advanceTimersByTime(1000);

    // Exact wire request shape per PROTOCOL §5.4.
    expect(taskListCalls(TASKS_WS)).toHaveLength(1);
    expect(backendRequestSpy).toHaveBeenCalledWith('task.list', { workspaceId: TASKS_WS });

    // Let the read-middleware's async fetch settle, then assert the slice
    // stores the fresh BE-owned rollup — completed !== total, so the derived
    // display status flips away from 'complete'.
    vi.useRealTimers();
    await flush();
    const wsState = (
      appStore.state as {
        workspaceTasks: {
          byWorkspaceId: Record<string, { stats: unknown; tasks: { length: number } }>;
        };
      }
    ).workspaceTasks.byWorkspaceId[TASKS_WS];
    expect(wsState.stats).toEqual({ total: 2, completed: 1, inProgress: 0 });
  });

  it('note events on a workspace whose tasks slice is not initialized do NOT trigger a task.list fetch', async () => {
    const UNINIT_WS = 'ws-bridge-tasks-uninit';
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    handler(noteEnvelope(UNINIT_WS, 'note:updated', 'note-x'));
    vi.advanceTimersByTime(2000);

    expect(taskListCalls(UNINIT_WS)).toHaveLength(0);
    // The slice stays untouched — no eager load for a workspace nobody viewed.
    const wsState = (
      appStore.state as { workspaceTasks: { byWorkspaceId: Record<string, unknown> } }
    ).workspaceTasks.byWorkspaceId[UNINIT_WS];
    expect(wsState).toBeUndefined();
  });

  it('a burst of note events for the same workspace coalesces into a single task.list refetch', async () => {
    const BURST_WS = 'ws-bridge-tasks-burst';
    const { loadWorkspaceTasksSucceeded } =
      await import('$store/renderer/slices/workspace-tasks/workspace-tasks-slice');
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(BURST_WS, [], { total: 0, completed: 0, inProgress: 0 }),
    );
    await primeBridge();
    const handler = capturedHandlers[0]!;

    backendRequestSpy.mockImplementation((method: string) =>
      method === 'task.list'
        ? Promise.resolve({ tasks: [], stats: { total: 0, completed: 0, inProgress: 0 } })
        : undefined,
    );

    vi.useFakeTimers();
    const types = [
      'note:created',
      'note:updated',
      'note:updated',
      'note:deleted',
      'note:updated',
    ] as const;
    for (let i = 0; i < types.length; i++) {
      handler(noteEnvelope(BURST_WS, types[i], `note-${i}`));
      vi.advanceTimersByTime(200); // less than the 1s debounce
    }
    vi.advanceTimersByTime(1000);

    expect(taskListCalls(BURST_WS)).toHaveLength(1);
  });

  it('a pending refetch is dropped if the tasks slice is cleared during the debounce window', async () => {
    const CLEARED_WS = 'ws-bridge-tasks-cleared';
    const { loadWorkspaceTasksSucceeded, clearWorkspaceTasks } =
      await import('$store/renderer/slices/workspace-tasks/workspace-tasks-slice');
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(CLEARED_WS, [], { total: 0, completed: 0, inProgress: 0 }),
    );
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    handler(noteEnvelope(CLEARED_WS, 'note:deleted', 'note-y'));
    // Workspace unmounted/deleted while the debounce is pending — the timer
    // re-checks `initialized` at fire time and must not issue a task.list.
    appStore.dispatch(clearWorkspaceTasks(CLEARED_WS));
    vi.advanceTimersByTime(2000);

    expect(taskListCalls(CLEARED_WS)).toHaveLength(0);
  });
});

describe('daemonEventsBridge (workspace:deleted → purge agent/chat state)', () => {
  const OTHER_WS = 'ws-bridge-other';
  const OTHER_AGENT = 'agent-bridge-other';

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    // chat-state persists across tests via appStore; reset the entries this
    // suite seeds so preconditions/postconditions reflect only this test.
    appStore.dispatch(chatReset(AGENT));
    appStore.dispatch(chatReset(OTHER_AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    navigateAwayIfViewingSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('fires navigateAwayIfViewing for the deleted workspace (#766 live-mode navigation path)', async () => {
    // Unlike the workspace-list snapshot diff (legacy-mode only — the
    // delta-subscription layer suppresses legacy refetches under live-state,
    // monorepo#775), this events.event route fires in BOTH modes, so it is the
    // path that actually covers "deleted by another client" in production.
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-deleted-nav',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:deleted',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: WS },
        },
      },
    });

    expect(navigateAwayIfViewingSpy).toHaveBeenCalledWith(WS);
  });

  it('purges agent-session, workspace-agents, and chat-state for the deleted workspace', async () => {
    // Seed two sessions — one in WS and one in a sibling workspace — to prove
    // scoping. `bulkUpsertSessions` populates the agent-session slice while the
    // per-item `upsertSession` also registers each agent in the workspace-agents
    // index (see agent-mutation-service `persistSession`).
    const sessionA: AgentSession = {
      id: AGENT,
      backendSessionId: 'backend-1',
      workspaceId: WS,
      name: 'A',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AgentSession;
    const sessionB: AgentSession = {
      id: OTHER_AGENT,
      backendSessionId: 'backend-2',
      workspaceId: OTHER_WS,
      name: 'B',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AgentSession;
    appStore.dispatch(bulkUpsertSessions([sessionA, sessionB]));
    appStore.dispatch(upsertSession(sessionA));
    appStore.dispatch(upsertSession(sessionB));

    // Seed per-agent chat-state so the purge assertion has something to remove.
    appStore.dispatch(chatSendStarted(AGENT, WS));
    appStore.dispatch(chatSendStarted(OTHER_AGENT, OTHER_WS));

    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Precondition: sessions, workspace-agents index and chat-state entries exist.
    const before = appStore.state as {
      agentSessions: {
        byAgentId: Record<string, unknown>;
        agentIdsByWorkspace: Record<string, string[]>;
      };
      workspaceAgents: { byWorkspaceId: Record<string, unknown> };
      chatState: { byAgentId: Record<string, unknown> };
    };
    expect(before.agentSessions.byAgentId[AGENT]).toBeDefined();
    expect(before.agentSessions.agentIdsByWorkspace[WS]).toContain(AGENT);
    expect(before.workspaceAgents.byWorkspaceId[WS]).toBeDefined();
    expect(before.chatState.byAgentId[AGENT]).toBeDefined();

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-deleted-1',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:deleted',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: WS },
        },
      },
    });

    const after = appStore.state as typeof before;
    expect(after.agentSessions.byAgentId[AGENT]).toBeUndefined();
    expect(after.agentSessions.agentIdsByWorkspace[WS]).toBeUndefined();
    expect(after.workspaceAgents.byWorkspaceId[WS]).toBeUndefined();
    expect(after.chatState.byAgentId[AGENT]).toBeUndefined();

    // Sibling workspace is untouched — recreate flow shows only fresh agents.
    expect(after.agentSessions.byAgentId[OTHER_AGENT]).toBeDefined();
    expect(after.agentSessions.agentIdsByWorkspace[OTHER_WS]).toContain(OTHER_AGENT);
    expect(after.chatState.byAgentId[OTHER_AGENT]).toBeDefined();
  });

  it('drops workspace:deleted events lacking a workspaceId envelope', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AGENT,
          backendSessionId: 'backend-1',
          workspaceId: WS,
          name: 'A',
          status: AgentStatus.Idle,
          messages: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as AgentSession,
      ]),
    );

    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-deleted-no-ws',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:deleted',
          actor: { type: 'user', id: 'u1' },
          data: {},
        },
      },
    });

    const state = appStore.state as { agentSessions: { byAgentId: Record<string, unknown> } };
    expect(state.agentSessions.byAgentId[AGENT]).toBeDefined();
    expect(navigateAwayIfViewingSpy).not.toHaveBeenCalled();
  });
});

describe('daemonEventsBridge (workspace:created → recycled-ID purge + rehydrate)', () => {
  const RECYCLED_WS = 'ws-bridge-recycled';
  const STALE_AGENT = 'agent-bridge-stale';

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(STALE_AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('purges stale local state for the recycled ID and refetches the agent list', async () => {
    // Seed state under RECYCLED_WS as if it survived from the ID's previous
    // life (i.e. the workspace:deleted event was never delivered).
    const staleSession: AgentSession = {
      id: STALE_AGENT,
      backendSessionId: 'backend-stale',
      workspaceId: RECYCLED_WS,
      name: 'Stale',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AgentSession;
    appStore.dispatch(bulkUpsertSessions([staleSession]));
    appStore.dispatch(upsertSession(staleSession));
    appStore.dispatch(chatSendStarted(STALE_AGENT, RECYCLED_WS));

    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-created-recycled',
          workspaceId: RECYCLED_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:created',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: RECYCLED_WS },
        },
      },
    });
    // hydrateAgentsRequested → lifecycle-read-service → appClient.agents.list
    // (live client → mocked backendRequest); let the async hydrate settle.
    await flush();

    const after = appStore.state as {
      agentSessions: {
        byAgentId: Record<string, unknown>;
        agentIdsByWorkspace: Record<string, string[]>;
      };
      workspaceAgents: { byWorkspaceId: Record<string, { agentIds?: string[] }> };
      chatState: { byAgentId: Record<string, unknown> };
    };
    // Stale traces are purged (same path as workspace:deleted).
    expect(after.agentSessions.byAgentId[STALE_AGENT]).toBeUndefined();
    expect(after.agentSessions.agentIdsByWorkspace[RECYCLED_WS]).toBeUndefined();
    expect(after.chatState.byAgentId[STALE_AGENT]).toBeUndefined();
    expect(after.workspaceAgents.byWorkspaceId[RECYCLED_WS]?.agentIds ?? []).toEqual([]);
    // The bridge re-hydrates from the daemon's canonical list (PROTOCOL §5.5).
    expect(backendRequestSpy).toHaveBeenCalledWith('agent.list', {
      workspaceId: RECYCLED_WS,
    });
  });

  it('is a no-op (no purge, no refetch) when the created ID has no local state', async () => {
    const FRESH_WS = 'ws-bridge-fresh';
    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-created-fresh',
          workspaceId: FRESH_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:created',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: FRESH_WS },
        },
      },
    });
    await flush();

    expect(backendRequestSpy).not.toHaveBeenCalledWith('agent.list', {
      workspaceId: FRESH_WS,
    });
  });
});

describe('daemonEventsBridge (task:status-changed → applyTaskStatusChanged)', () => {
  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it.skip('applies task:status-changed onto the workspace-tasks slice for a hydrated workspace', async () => {
    const TASK_WS = 'ws-task-1';
    // Seed a hydrated workspace-tasks entry so the reducer's `initialized`
    // guard passes and the status update lands.
    const { loadWorkspaceTasksSucceeded } =
      await import('$store/renderer/slices/workspace-tasks/workspace-tasks-slice');
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(
        TASK_WS,
        [{ id: 'note-t1', title: 'Task 1', status: 'not_started' }],
        { total: 1, completed: 0, inProgress: 0 },
      ),
    );

    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-task-1',
          workspaceId: TASK_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'task:status-changed',
          actor: { type: 'system' },
          data: {
            noteId: 'note-t1',
            noteTitle: 'Task 1',
            previousStatus: 'not_started',
            newStatus: 'in_progress',
            changedAt: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    });

    const { getItem } = await import('$lib/store-shim/utils/collections/collection-utils');
    const state = appStore.state as {
      workspaceTasks: {
        byWorkspaceId: Record<string, { tasks: unknown }>;
      };
    };
    const task = getItem(state.workspaceTasks.byWorkspaceId[TASK_WS].tasks as never, 'note-t1') as
      { status: string } | undefined;
    expect(task?.status).toBe('in_progress');
  });

  it('drops task:status-changed events lacking a workspaceId envelope', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    // No workspaceId — bridge must ignore the event; verified by absence of a throw.
    expect(() =>
      handler({
        method: 'events.event',
        params: {
          event: {
            id: 'evt-task-no-ws',
            timestamp: '2026-01-02T00:00:00.000Z',
            type: 'task:status-changed',
            actor: { type: 'system' },
            data: { noteId: 'note-t1', newStatus: 'complete' },
          },
        },
      }),
    ).not.toThrow();
  });
});

describe('daemonEventsBridge (comment:added / comment:resolved → applyCommentFromEvent)', () => {
  const COMMENT_WS = 'ws-comment-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    applyCommentFromEventSpy.mockClear();
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it('routes comment:added and comment:resolved envelopes to applyCommentFromEvent with (workspaceId, noteId, kind)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-comment-1',
          workspaceId: COMMENT_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'comment:added',
          actor: { type: 'agent', id: AGENT },
          data: { noteId: 'note-c1', commentId: 'c-1' },
        },
      },
    });
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-comment-2',
          workspaceId: COMMENT_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'comment:resolved',
          actor: { type: 'user', id: 'u1' },
          data: { noteId: 'note-c1', threadId: 't-1', resolved: true },
        },
      },
    });

    expect(applyCommentFromEventSpy).toHaveBeenCalledWith(COMMENT_WS, 'note-c1', 'added');
    expect(applyCommentFromEventSpy).toHaveBeenCalledWith(COMMENT_WS, 'note-c1', 'resolved');
  });

  it('drops comment:* events without a noteId', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-comment-no-note',
          workspaceId: COMMENT_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'comment:added',
          actor: { type: 'system' },
          data: {},
        },
      },
    });

    expect(applyCommentFromEventSpy).not.toHaveBeenCalled();
  });
});

describe('daemonEventsBridge (pr:linked / pr:updated / pr:unlinked → workspace slice)', () => {
  const PR_WS = 'ws-pr-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  async function seedWorkspace(): Promise<void> {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: PR_WS,
        title: 'PR ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    );
  }

  async function readWorkspace(): Promise<{
    prNumber?: number;
    prUrl?: string;
    prStatus?: string;
    activePullRequest?: unknown;
    pullRequests?: Array<{ number: number; status?: string }>;
  }> {
    const { getItem } = await import('$lib/store-shim/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return (getItem(state.workspace.workspaces as never, PR_WS) ?? {}) as never;
  }

  it('pr:linked writes prNumber / prUrl / prStatus / activePullRequest / pullRequests onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-pr-linked-1',
          workspaceId: PR_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'pr:linked',
          actor: { type: 'system' },
          data: {
            workspaceId: PR_WS,
            prNumber: 42,
            prUrl: 'https://example.com/pr/42',
            prStatus: 'Open',
            activePullRequest: { number: 42, url: 'https://example.com/pr/42' },
            pullRequests: [
              { number: 41, status: 'Merged' },
              { number: 42, status: 'Open' },
            ],
          },
        },
      },
    });

    const ws = await readWorkspace();
    expect(ws.prNumber).toBe(42);
    expect(ws.prUrl).toBe('https://example.com/pr/42');
    expect(ws.prStatus).toBe('Open');
    expect(ws.activePullRequest).toMatchObject({ number: 42 });
    // §6.5: the daemon-owned per-branch PR list is folded verbatim, including
    // merged/closed history alongside the newly linked PR.
    expect(ws.pullRequests).toEqual([
      { number: 41, status: 'Merged' },
      { number: 42, status: 'Open' },
    ]);
  });

  it('pr:updated merges the changed fields without a full replace', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Prime with pr:linked.
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-pr-linked-2',
          workspaceId: PR_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'pr:linked',
          actor: { type: 'system' },
          data: {
            workspaceId: PR_WS,
            prNumber: 42,
            prUrl: 'https://example.com/pr/42',
            prStatus: 'Open',
            activePullRequest: { number: 42 },
          },
        },
      },
    });

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-pr-updated-1',
          workspaceId: PR_WS,
          timestamp: '2026-01-02T00:00:01.000Z',
          type: 'pr:updated',
          actor: { type: 'system' },
          data: {
            workspaceId: PR_WS,
            prNumber: 42,
            prStatus: 'Merged',
            activePullRequest: { number: 42, merged: true },
            pullRequests: [{ number: 42, status: 'Merged' }],
          },
        },
      },
    });

    const ws = await readWorkspace();
    expect(ws.prStatus).toBe('Merged');
    // prUrl was not in the pr:updated payload; the merge must retain it.
    expect(ws.prUrl).toBe('https://example.com/pr/42');
    // pullRequests from the pr:updated payload replaces the previous list.
    expect(ws.pullRequests).toEqual([{ number: 42, status: 'Merged' }]);
  });

  it('pr:unlinked clears the active-PR fields but retains the pullRequests list', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-pr-linked-3',
          workspaceId: PR_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'pr:linked',
          actor: { type: 'system' },
          data: {
            workspaceId: PR_WS,
            prNumber: 42,
            prUrl: 'https://example.com/pr/42',
            prStatus: 'Open',
            activePullRequest: { number: 42 },
            pullRequests: [{ number: 42, status: 'Open' }],
          },
        },
      },
    });

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-pr-unlinked-1',
          workspaceId: PR_WS,
          timestamp: '2026-01-02T00:00:02.000Z',
          type: 'pr:unlinked',
          actor: { type: 'system' },
          data: { workspaceId: PR_WS },
        },
      },
    });

    const ws = await readWorkspace();
    expect(ws.prNumber).toBeUndefined();
    expect(ws.prUrl).toBeUndefined();
    expect(ws.prStatus).toBeUndefined();
    expect(ws.activePullRequest).toBeNull();
    // The daemon owns the per-branch PR list and retains merged/closed history
    // across unlinks (§6.5) — pr:unlinked must not clear it.
    expect(ws.pullRequests).toEqual([{ number: 42, status: 'Open' }]);
  });
});

describe('daemonEventsBridge (workspace:updated → workspace slice)', () => {
  const WS_UPD = 'ws-updated-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    resetMockIpcRouter();
    capturedHandlers.length = 0;
  });

  afterEach(() => {
    resetMockIpcRouter();
    vi.clearAllMocks();
  });

  async function seedWorkspace(): Promise<void> {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS_UPD,
        title: 'Original',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    );
  }

  async function readWorkspace(): Promise<Record<string, unknown>> {
    const { getItem } = await import('$lib/store-shim/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return (getItem(state.workspace.workspaces as never, WS_UPD) ?? {}) as never;
  }

  function updatedNotification(changes: Record<string, unknown>): {
    method: string;
    params?: unknown;
  } {
    return {
      method: 'events.event',
      params: {
        event: {
          id: `evt-ws-updated-${Math.random().toString(36).slice(2, 8)}`,
          workspaceId: WS_UPD,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:updated',
          actor: { type: 'system' },
          data: { workspaceId: WS_UPD, changes },
        },
      },
    };
  }

  it('merges a title-only delta onto the workspace entity (agent workspace.setTitle parity)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(updatedNotification({ title: 'Add dark mode support' }));

    const ws = await readWorkspace();
    expect(ws.title).toBe('Add dark mode support');
    // Unrelated fields on the entity stay intact.
    expect(ws.branch).toBe('main');
  });

  it('merges non-title whitelisted delta fields (tags, statusMessage, status)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      updatedNotification({
        tags: ['a', 'b'],
        statusMessage: 'Reviewing PR',
        status: 'Inactive',
      }),
    );

    const ws = await readWorkspace();
    expect(ws.tags).toEqual(['a', 'b']);
    expect(ws.statusMessage).toBe('Reviewing PR');
    expect(ws.status).toBe('Inactive');
  });

  it('maps the canonical skipIsolation delta onto the skipWorktree entity field', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // PROTOCOL §5.1: the daemon serializes the `workspace.update` skip toggle
    // under its canonical `skipIsolation` name in the changes delta.
    handler(updatedNotification({ skipIsolation: true }));

    const ws = await readWorkspace();
    expect(ws.skipWorktree).toBe(true);
  });

  it('still accepts the deprecated skipWorktree delta key from older daemons', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(updatedNotification({ skipWorktree: true }));

    const ws = await readWorkspace();
    expect(ws.skipWorktree).toBe(true);
  });

  it('drops unknown wire fields rather than leaking them into the entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      updatedNotification({
        title: 'Renamed',
        // Not in the FE Workspace type; must be filtered out.
        attention: 'unread',
        bogusField: 42,
      }),
    );

    const ws = await readWorkspace();
    expect(ws.title).toBe('Renamed');
    expect((ws as Record<string, unknown>).attention).toBeUndefined();
    expect((ws as Record<string, unknown>).bogusField).toBeUndefined();
  });

  it('still fires the legacy mock-IPC workspace:updated relay alongside the Redux update', async () => {
    await seedWorkspace();
    await primeBridge();
    const seen: unknown[] = [];
    addMockIpcListener('workspace:updated', (payload) => seen.push(payload));

    capturedHandlers[0]!(updatedNotification({ title: 'Renamed' }));

    // Redux path
    const ws = await readWorkspace();
    expect(ws.title).toBe('Renamed');
    // Legacy relay path (unchanged shape: the full event `data` as `changes`).
    expect(seen).toEqual([
      { workspaceId: WS_UPD, changes: { workspaceId: WS_UPD, changes: { title: 'Renamed' } } },
    ]);
  });

  it('is a no-op when the delta has no whitelisted fields', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(updatedNotification({ attention: 'unread' }));

    const ws = await readWorkspace();
    expect(ws.title).toBe('Original');
  });

  it('drops an out-of-enum status value rather than writing it to Redux', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // A buggy client / BE contract violation must not poison the closed
    // WorkspaceStatus enum in the store; the title still merges through.
    handler(updatedNotification({ title: 'Renamed', status: 'NotARealStatus' }));

    const ws = await readWorkspace();
    expect(ws.title).toBe('Renamed');
    // Original seeded status ("Active") is preserved.
    expect(ws.status).toBe('Active');
  });

  it('merges the full archive delta (archived, status, archivedAt) onto the entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      updatedNotification({
        archived: true,
        status: 'Archived',
        archivedAt: '2026-07-25T12:00:00.000Z',
      }),
    );

    const ws = await readWorkspace();
    expect(ws.archived).toBe(true);
    expect(ws.status).toBe('Archived');
    expect(ws.archivedAt).toBe('2026-07-25T12:00:00.000Z');
  });

  it('clears archivedAt on an explicit null in the unarchive delta and restores Active', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      updatedNotification({
        archived: true,
        status: 'Archived',
        archivedAt: '2026-07-25T12:00:00.000Z',
      }),
    );
    handler(
      updatedNotification({
        archived: false,
        status: 'Active',
        archivedAt: null,
      }),
    );

    const ws = await readWorkspace();
    expect(ws.archived).toBe(false);
    expect(ws.status).toBe('Active');
    // The wire null must drop the stale timestamp rather than retain it.
    expect(ws.archivedAt).toBeUndefined();
  });

  it('merges a statusImageAssetId delta onto the entity (agent setStatusImage parity)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // PROTOCOL §5.1: the daemon serializes the applied `workspace.update`
    // delta with the content-addressed status screenshot asset id.
    handler(updatedNotification({ statusImageAssetId: 'asset-abc123' }));

    const ws = await readWorkspace();
    expect(ws.statusImageAssetId).toBe('asset-abc123');
    // Unrelated fields on the entity stay intact.
    expect(ws.branch).toBe('main');
  });

  it('clears statusImageAssetId on an explicit null in the delta', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(updatedNotification({ statusImageAssetId: 'asset-abc123' }));
    handler(updatedNotification({ statusImageAssetId: null }));

    const ws = await readWorkspace();
    // The wire null must drop the stale asset reference rather than retain it.
    expect(ws.statusImageAssetId).toBeUndefined();
  });
});

describe('daemonEventsBridge (workspace:activity-changed → workspace slice)', () => {
  const WS_ACT = 'ws-activity-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  async function seedWorkspace(): Promise<void> {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS_ACT,
        title: 'Activity ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    );
  }

  async function readWorkspace(): Promise<{
    activity?: 'idle' | 'agent_running';
  }> {
    const { getItem } = await import('$lib/store-shim/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return (getItem(state.workspace.workspaces as never, WS_ACT) ?? {}) as never;
  }

  function activityChangedNotification(activity: 'idle' | 'agent_running') {
    return {
      method: 'events.event',
      params: {
        event: {
          id: 'evt-activity-1',
          workspaceId: WS_ACT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:activity-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_ACT,
            activity,
          },
        },
      },
    };
  }

  it('subscribes to workspace:activity-changed in the bridge firehose filter', async () => {
    await primeBridge();
    expect(backendRequestSpy).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: expect.arrayContaining(['workspace:activity-changed']),
    });
  });

  it('merges activity=agent_running onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(activityChangedNotification('agent_running'));

    const ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');
  });

  it('merges activity=idle onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Set to agent_running first, then idle
    handler(activityChangedNotification('agent_running'));
    let ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');

    handler(activityChangedNotification('idle'));
    ws = await readWorkspace();
    expect(ws.activity).toBe('idle');
  });

  it('is a no-op when the activity value is invalid', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // First set a valid value
    handler(activityChangedNotification('idle'));
    let ws = await readWorkspace();
    expect(ws.activity).toBe('idle');

    // Try to set an invalid value
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-activity-bad',
          workspaceId: WS_ACT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:activity-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_ACT,
            activity: 'invalid_value',
          },
        },
      },
    });

    // Should still be idle
    ws = await readWorkspace();
    expect(ws.activity).toBe('idle');
  });

  it('is a no-op when data or activity is missing', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Set initial activity to idle
    handler(activityChangedNotification('idle'));
    let ws = await readWorkspace();
    expect(ws.activity).toBe('idle');

    // Try to send an event with missing data
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-activity-no-data',
          workspaceId: WS_ACT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:activity-changed',
          actor: { type: 'system' },
          data: {},
        },
      },
    });

    // Activity should remain unchanged (still idle)
    ws = await readWorkspace();
    expect(ws.activity).toBe('idle');
  });
});

describe('daemonEventsBridge (workspace:displayStatus-changed → workspace slice)', () => {
  const WS_DS = 'ws-display-status-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  async function seedWorkspace(): Promise<void> {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS_DS,
        title: 'Display status ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    );
  }

  async function readWorkspace(): Promise<{
    displayStatus?: string;
  }> {
    const { getItem } = await import('$lib/store-shim/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return (getItem(state.workspace.workspaces as never, WS_DS) ?? {}) as never;
  }

  function displayStatusChangedNotification(displayStatus: string) {
    return {
      method: 'events.event',
      params: {
        event: {
          id: `evt-display-status-${displayStatus}`,
          workspaceId: WS_DS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:displayStatus-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_DS,
            displayStatus,
          },
        },
      },
    };
  }

  it('subscribes to workspace:displayStatus-changed in the bridge firehose filter', async () => {
    await primeBridge();
    expect(backendRequestSpy).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: expect.arrayContaining(['workspace:displayStatus-changed']),
    });
  });

  it('merges every wire displayStatus value onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    for (const value of [
      'not_started',
      'in_progress',
      'complete',
      'pr_ready',
      'pr_open',
      'pr_merged',
    ]) {
      handler(displayStatusChangedNotification(value));
      const ws = await readWorkspace();
      expect(ws.displayStatus).toBe(value);
    }
  });

  it('is a no-op when the displayStatus value is not a wire value', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(displayStatusChangedNotification('in_progress'));
    let ws = await readWorkspace();
    expect(ws.displayStatus).toBe('in_progress');

    handler(displayStatusChangedNotification('InProgress'));
    ws = await readWorkspace();
    expect(ws.displayStatus).toBe('in_progress');
  });

  it('is a no-op when data or displayStatus is missing', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(displayStatusChangedNotification('pr_open'));
    let ws = await readWorkspace();
    expect(ws.displayStatus).toBe('pr_open');

    // displayStatus missing (data present but empty)
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-display-status-empty-data',
          workspaceId: WS_DS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:displayStatus-changed',
          actor: { type: 'system' },
          data: {},
        },
      },
    });

    ws = await readWorkspace();
    expect(ws.displayStatus).toBe('pr_open');

    // data key absent entirely (the `!data` early return)
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-display-status-no-data',
          workspaceId: WS_DS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:displayStatus-changed',
          actor: { type: 'system' },
        },
      },
    });

    ws = await readWorkspace();
    expect(ws.displayStatus).toBe('pr_open');
  });

  it('prefers data.workspaceId over the envelope workspaceId (self-sufficient payload)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Envelope points at a different (nonexistent) workspace; the payload's
    // own workspaceId targets the seeded one — the payload id must win, like
    // the tokenUsage/context handlers.
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-display-status-data-id',
          workspaceId: 'ws-display-status-other',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:displayStatus-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_DS,
            displayStatus: 'pr_merged',
          },
        },
      },
    });

    const ws = await readWorkspace();
    expect(ws.displayStatus).toBe('pr_merged');
  });
});

describe('daemonEventsBridge (completion-watch refresh routing)', () => {
  beforeEach(() => {
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    refreshWorkspaceSubscriptionEntriesSpy.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it.each([
    'agent:idle',
    'agent:failed',
    'agent:deleted',
    'agent:created',
    'agent:subscriptions-changed',
  ])(
    "%s triggers refreshWorkspaceSubscriptionEntries for the event's workspace",
    async (eventType) => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(notification(eventType, { agentId: AGENT }));

      expect(refreshWorkspaceSubscriptionEntriesSpy).toHaveBeenCalledWith(WS);
    },
  );

  it('non-completion agent events do not trigger a subscription refresh (except status-changed/idle which trigger agent list refresh instead)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:renamed', { agentId: AGENT, name: 'Renamed' }));

    expect(refreshWorkspaceSubscriptionEntriesSpy).not.toHaveBeenCalled();
  });
});

describe('daemonEventsBridge (STAB-9 — agent:status-changed / agent:idle trigger agent list refresh)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    // Ensure store is initialized (idempotent if already initialized)
    appStore.init();
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  it('agent:status-changed dispatches hydrateAgentsRequested(workspaceId)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Get hydrateAgentsRequested before creating spy to avoid import timing issues
    const hydrateAgentsRequested =
      await import('$store/renderer/slices/workspace-agents/workspace-agents-slice').then(
        (m) => m.hydrateAgentsRequested,
      );

    // Capture the dispatch function directly to preserve this binding
    const originalDispatch = appStore.dispatch;
    const dispatchSpy = vi.fn(originalDispatch);
    const dispatchGetterSpy = vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatchSpy);

    handler(notification('agent:status-changed', { agentId: AGENT, status: 'responding' }));

    expect(dispatchSpy).toHaveBeenCalledWith(hydrateAgentsRequested(WS));

    // Restore the getter to prevent leakage
    dispatchGetterSpy.mockRestore();
  });

  it('agent:idle dispatches hydrateAgentsRequested(workspaceId)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Get hydrateAgentsRequested before creating spy to avoid import timing issues
    const hydrateAgentsRequested =
      await import('$store/renderer/slices/workspace-agents/workspace-agents-slice').then(
        (m) => m.hydrateAgentsRequested,
      );

    // Capture the dispatch function directly to preserve this binding
    const originalDispatch = appStore.dispatch;
    const dispatchSpy = vi.fn(originalDispatch);
    const dispatchGetterSpy = vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatchSpy);

    handler(notification('agent:idle', { agentId: AGENT }));

    expect(dispatchSpy).toHaveBeenCalledWith(hydrateAgentsRequested(WS));

    // Restore the getter to prevent leakage
    dispatchGetterSpy.mockRestore();
  });
});

describe('daemonEventsBridge (STAB-22 — agent:message triggers transcript hydration for unopened agents)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    appStore.init();
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    loadChatTranscriptSpy.mockClear();
    hasLiveChatSubscriptionSpy.mockReturnValue(false);
  });

  it('agent:message with role=assistant triggers loadChatTranscript when session has no messages', async () => {
    // Seed a session with no messages (unopened agent)
    seedSession({ messages: [] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-1', role: 'assistant' }),
    );

    expect(loadChatTranscriptSpy).toHaveBeenCalledWith(AGENT);
    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
  });

  it('agent:message skips the echo refetch while the standing chat.subscribe stream is live for the agent', async () => {
    // The standing subscription (chat-subscribe-service) is the sole
    // transcript writer while live — it delivers the persisted row itself,
    // so the STAB-22 echo refetch would be redundant.
    hasLiveChatSubscriptionSpy.mockReturnValue(true);
    seedSession({ messages: [] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-1', role: 'assistant' }),
    );

    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('agent:message with role=assistant skips loadChatTranscript when the messageId is already present', async () => {
    // Seed a session already holding the persisted assistant row.
    const existingMessage: AgentMessage = {
      id: 'msg-2',
      role: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'existing message' }],
    } as AgentMessage;
    seedSession({ messages: [existingMessage] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-2', role: 'assistant' }),
    );

    // Should not call loadChatTranscript because the messageId is already present
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('agent:message with role=assistant refetches when the session holds only the user message (#1019)', async () => {
    // Hydration race: the transcript hydrated before the assistant row
    // persisted, so the session holds only the user message.
    const userMessage: AgentMessage = {
      id: 'msg-user-1',
      role: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'hello' }],
    } as AgentMessage;
    seedSession({ messages: [userMessage] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', {
        agentId: AGENT,
        messageId: 'msg_assistant-1',
        role: 'assistant',
      }),
    );

    // The persisted assistant row is missing from the transcript — refetch.
    expect(loadChatTranscriptSpy).toHaveBeenCalledWith(AGENT);
    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
  });

  it('agent:message with role=assistant skips loadChatTranscript when the messageId matches an appMessageId', async () => {
    // The persisted row can land in the transcript under its logical
    // appMessageId (message-dedup merges compare both ids).
    const existingMessage: AgentMessage = {
      id: 'optimistic-1',
      appMessageId: 'msg_assistant-1',
      role: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'existing message' }],
    } as AgentMessage;
    seedSession({ messages: [existingMessage] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', {
        agentId: AGENT,
        messageId: 'msg_assistant-1',
        role: 'assistant',
      }),
    );

    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('agent:message with role=assistant and no messageId skips refetch for a non-empty session', async () => {
    // Without a messageId there is nothing to verify against the transcript;
    // preserve the empty-session-only refetch to avoid refetch storms.
    const existingMessage: AgentMessage = {
      id: 'msg-existing',
      role: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'existing message' }],
    } as AgentMessage;
    seedSession({ messages: [existingMessage] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:message', { agentId: AGENT, role: 'assistant' }));

    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it("agent:message with role=assistant loads transcript when session doesn't exist yet", async () => {
    // Don't seed any session - agent doesn't exist in state yet
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', {
        agentId: 'agent-new',
        messageId: 'msg-1',
        role: 'assistant',
      }),
    );

    // Should call loadChatTranscript because session doesn't exist (undefined check)
    expect(loadChatTranscriptSpy).toHaveBeenCalledWith('agent-new');
    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
  });

  it('agent:message with role=user and messageId not in session triggers loadChatTranscript', async () => {
    // Seed a session with one existing user message
    const existingMessage: AgentMessage = {
      id: 'msg-existing',
      role: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'existing user message' }],
    } as AgentMessage;
    seedSession({ messages: [existingMessage] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // New user message with a different messageId (not in transcript)
    handler(notification('agent:message', { agentId: AGENT, messageId: 'msg-new', role: 'user' }));

    // Should call loadChatTranscript because messageId is not present in session
    expect(loadChatTranscriptSpy).toHaveBeenCalledWith(AGENT);
    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
  });

  it('agent:message with role=user and present messageId skips loadChatTranscript', async () => {
    // Seed a session with a user message that has the same messageId
    const existingMessage: AgentMessage = {
      id: 'msg-1',
      role: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'existing user message' }],
    } as AgentMessage;
    seedSession({ messages: [existingMessage] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // User message event with messageId that already exists in transcript
    handler(notification('agent:message', { agentId: AGENT, messageId: 'msg-1', role: 'user' }));

    // Should not call loadChatTranscript because messageId is already present
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it("agent:message with role=user loads transcript when session doesn't exist yet", async () => {
    // Don't seed any session - agent doesn't exist in state yet
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', {
        agentId: 'agent-new',
        messageId: 'msg-1',
        role: 'user',
      }),
    );

    // Should call loadChatTranscript because session doesn't exist (undefined check)
    expect(loadChatTranscriptSpy).toHaveBeenCalledWith('agent-new');
    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
  });
});

describe('daemonEventsBridge (STAB-8 — task:status-changed triggers task refetch)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    // Ensure store is initialized (idempotent if already initialized)
    appStore.init();
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  it('task:status-changed dispatches loadWorkspaceTasksRequested(workspaceId) for task list refetch', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Get loadWorkspaceTasksRequested before creating spy to avoid import timing issues
    const loadWorkspaceTasksRequested =
      await import('$store/renderer/slices/workspace-tasks/workspace-tasks-slice').then(
        (m) => m.loadWorkspaceTasksRequested,
      );

    // Capture the dispatch function directly to preserve this binding
    const originalDispatch = appStore.dispatch;
    const dispatchSpy = vi.fn(originalDispatch);
    const dispatchGetterSpy = vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatchSpy);

    handler(
      notification('task:status-changed', {
        noteId: 'task-note-123',
        newStatus: 'in_progress',
      }),
    );

    expect(dispatchSpy).toHaveBeenCalledWith(loadWorkspaceTasksRequested(WS));

    // Restore the getter to prevent leakage
    dispatchGetterSpy.mockRestore();
  });
});

describe('daemonEventsBridge (RESUB-1 — daemon-restart replay + coarse-state refresh)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    // Ensure store is initialized (idempotent if already initialized)
    appStore.init();
    appStore.dispatch(clearAllSessions());
    // Reset workspace/agent focus so a preceding test's setActiveWorkspaceId
    // does not leak into the "no active workspace" case.
    const { clearActiveWorkspace } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    const { setActiveAgentId } =
      await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');
    appStore.dispatch(clearActiveWorkspace());
    appStore.dispatch(setActiveAgentId(WS, null));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    loadChatTranscriptSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    capturedReconnectHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  it("registers a reconnect listener on install so `onBackendReconnected` fires the bridge's replay", async () => {
    await primeBridge();
    // Exactly one reconnect listener installed alongside the notification
    // listener — install is a one-shot; consumers of the bridge must not
    // register additional listeners against the shared client.
    expect(capturedReconnectHandlers).toHaveLength(1);
  });

  it('re-issues events.subscribe with the identical eventTypes filter after reconnect', async () => {
    await primeBridge();
    const initialSubscribeCalls = backendRequestSpy.mock.calls.filter(
      ([method]) => method === 'events.subscribe',
    );
    expect(initialSubscribeCalls).toHaveLength(1);

    // Simulate the main-process JsonRpcClient successfully reconnecting.
    capturedReconnectHandlers[0]!();
    await flush();

    const afterReconnect = backendRequestSpy.mock.calls.filter(
      ([method]) => method === 'events.subscribe',
    );
    expect(afterReconnect).toHaveLength(2);
    // Replay uses the same filter list — a divergence would silently drop
    // event families after a daemon restart.
    expect(afterReconnect[1][1]).toEqual(initialSubscribeCalls[0][1]);
  });

  it('keeps the initial notification listener registered across reconnect (no double-processing)', async () => {
    await primeBridge();
    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    expect(capturedHandlers).toHaveLength(1);

    capturedReconnectHandlers[0]!();
    await flush();

    // Replay only re-issues subscribe; the notification listener persists on
    // the same singleton transport (mirrors the main-process consumer
    // pattern — a second registration would double-apply every event).
    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    expect(capturedHandlers).toHaveLength(1);
  });

  it('fires loadChatTranscript for the active agent after reconnect (LEAK-1: pinned to active-at-completion)', async () => {
    // Seed enough store state for the reconnect refresh to have a target:
    // an active workspace and an active agent in that workspace. The
    // hydrateAgentsRequested dispatch is fire-and-forget (saga-only trigger,
    // no reducer entry — AGENTS.md §8), so we assert the observable seam:
    // `loadChatTranscript` runs against the active agent. The workspace-less
    // sibling below proves the whole refresh path is gated on activeWorkspaceId.
    const { setActiveWorkspaceId } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    const { setActiveAgentId } =
      await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');
    appStore.dispatch(setActiveWorkspaceId(WS));
    appStore.dispatch(setActiveAgentId(WS, AGENT));

    await primeBridge();

    capturedReconnectHandlers[0]!();
    await flush();

    expect(loadChatTranscriptSpy).toHaveBeenCalledWith(AGENT);
    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
  });

  it('skips coarse-state refresh when no workspace is active (nothing to hydrate)', async () => {
    // No `setActiveWorkspaceId` dispatched → activeWorkspaceId stays null.
    await primeBridge();

    capturedReconnectHandlers[0]!();
    await flush();

    // With no active workspace, the refresh path exits early — no chat load.
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it("accepts a fresh fan-out envelope after reconnect (the bridge's own subscriptionId is re-armed)", async () => {
    // The mock's `events.subscribe` always resolves with "sub-1", so this
    // asserts the bridge does not lock onto the initial id in a way that
    // would reject a fresh replay's envelope. If the replay path forgot to
    // reset `ownSubscriptionId`, a foreign envelope on the same wire could
    // still leak through (see the fan-out scope-gate suite).
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    capturedReconnectHandlers[0]!();
    await flush();

    handler(
      notificationWithSub(
        'agent:stream:status',
        {
          agentId: AGENT,
          workspaceId: WS,
          phase: 'prompt',
          message: 'post-reconnect',
          level: 'info',
          timestamp: 1000,
        },
        'sub-1',
      ),
    );

    const events = readStatusEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ phase: 'prompt' });
  });

  describe('agent:failed → chatSendFailed', () => {
    it('dispatches chatSendFailed when agent:failed carries an error message', async () => {
      const agentId = 'agent-failed-1';
      const messageId = 'msg-failed-1';
      const errorMsg = 'Agent spawn failed after 3 retries';

      appStore.dispatch(upsertSession({ id: agentId, name: 'Test Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0];

      // Start a stream so there's something for agent:failed to finalize
      handler!(
        notification('agent:stream:activity', {
          agentId,
          messageId,
          lastAgentResponse: 'Working',
        }),
      );

      handler!(
        notification('agent:failed', {
          agentId,
          error: errorMsg,
          status: 'error',
        }),
      );

      const chatState = appStore.state.chatState.byAgentId[agentId];
      expect(chatState).toBeDefined();
      expect(chatState.error).toBe(errorMsg);
    });

    it('sets default error message when agent:failed has no explicit error', async () => {
      const agentId = 'agent-failed-2';
      const messageId = 'msg-failed-2';

      appStore.dispatch(upsertSession({ id: agentId, name: 'Test Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0];

      // Start a stream so there's something for agent:failed to finalize
      handler!(
        notification('agent:stream:activity', {
          agentId,
          messageId,
          lastAgentResponse: 'Working',
        }),
      );

      handler!(
        notification('agent:failed', {
          agentId,
          status: 'error',
        }),
      );

      const chatState = appStore.state.chatState.byAgentId[agentId];
      // When no explicit error is provided, the reducer supplies a default message
      expect(chatState?.error).toBe('The response was interrupted. Please try again.');
    });

    it('dispatches chatSendFailed even when no stream state exists for the agent', async () => {
      const agentId = 'agent-failed-no-stream';
      const errorMsg = 'Agent spawn failed before streaming started';

      appStore.dispatch(upsertSession({ id: agentId, name: 'Test Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0];

      // Send agent:failed WITHOUT any prior stream chunks
      handler!(
        notification('agent:failed', {
          agentId,
          error: errorMsg,
          status: 'error',
        }),
      );

      const chatState = appStore.state.chatState.byAgentId[agentId];
      expect(chatState).toBeDefined();
      expect(chatState.error).toBe(errorMsg);
    });

    it('skips recordAgentFailure when the payload carries parentAgentId, but still dispatches streamFailed/chatSendFailed', async () => {
      const agentId = 'agent-failed-delegated';
      const errorMsg = 'session/prompt idle timeout (1800s of silence)';
      clearAgentFailureRegistry();

      appStore.dispatch(upsertSession({ id: agentId, name: 'Delegated Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0];

      // PROTOCOL §6.5: optional parentAgentId, present for delegated agents.
      handler!(
        notification('agent:failed', {
          agentId,
          error: errorMsg,
          status: 'error',
          turnId: 'turn-delegated-1',
          parentAgentId: 'agent-parent-1',
        }),
      );

      // No failure-registry entry → no failure toast for the delegated agent.
      expect(listAgentFailureEntries()).toHaveLength(0);
      // The in-conversation error + Retry button keep working.
      const chatState = appStore.state.chatState.byAgentId[agentId];
      expect(chatState).toBeDefined();
      expect(chatState.error).toBe(errorMsg);
    });

    it('records the failure when parentAgentId is absent or empty (parentless agent / older daemon)', async () => {
      const agentId = 'agent-failed-parentless';
      const errorMsg = 'boom';
      clearAgentFailureRegistry();

      appStore.dispatch(upsertSession({ id: agentId, name: 'Parentless Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0];

      handler!(
        notification('agent:failed', {
          agentId,
          error: errorMsg,
          status: 'error',
          parentAgentId: '',
        }),
      );

      const entries = listAgentFailureEntries();
      expect(entries.map((entry) => entry.agentId)).toEqual([agentId]);
      expect(entries[0]!.workspaceId).toBe(WS);
      expect(entries[0]!.error).toBe(errorMsg);
      clearAgentFailureRegistry();
    });
  });
});

describe('daemonEventsBridge (daemon-side redrive clears stale error banner — monorepo#1106)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  function readChatAgent() {
    return appStore.state.chatState.byAgentId[AGENT];
  }

  it('agent:status-changed error→active clears the stale error and modelUnavailable', async () => {
    seedSession({ status: AgentStatus.Error });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    appStore.dispatch(chatSendFailed(AGENT, 'previous turn failed'));
    expect(readChatAgent()?.error).toBe('previous turn failed');

    // Daemon-side redrive (coordinator sendMessage / another client's retry)
    // flips the agent back to active — a turn this FE never initiated.
    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'active', isActive: true }),
    );

    expect(readChatAgent()?.error).toBeNull();
    expect(readChatAgent()?.modelUnavailable).toBeNull();
  });

  it('agent.retry wire sequence (error→pending isActive:false, then pending→active) clears the banner', async () => {
    // agent_retry persists Pending BEFORE draining (persist_retry_status), so
    // the redrive arrives as error→pending with isActive:false, then
    // pending→active. The pending edge consumes the error prior status, so it
    // must clear the banner itself — the later active tick reads
    // priorStatus 'pending' and cannot.
    seedSession({ status: AgentStatus.Error });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    appStore.dispatch(chatSendFailed(AGENT, 'previous turn failed'));

    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'pending', isActive: false }),
    );
    expect(readChatAgent()?.error).toBeNull();

    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'active', isActive: true }),
    );
    expect(readChatAgent()?.error).toBeNull();
  });

  it('failure-toast agent.retry repro: agent:failed → error → pending → active → queue:processing clears the banner', async () => {
    // Second live repro on monorepo#1106: the failure-toast Retry is
    // FE-initiated but routes through `agent.retry`, NOT
    // chat-send-service.dispatchToLifecycle, so the #1044 enqueue-success
    // clear never fires. Confirmed daemon sequence: agent:failed (banner up)
    // → status-changed {error} → status-changed {pending} → {active,
    // isActive:true} → agent:queue:processing carrying the failed turn's
    // ORIGINAL turnId (#1022 stable-across-requeue). The banner must be gone
    // once the redriven turn is running.
    const turnId = 'user-msg-792780f7';
    seedSession({ status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:failed', {
        agentId: AGENT,
        error: 'session/prompt idle timeout (1800s of silence)',
        status: 'error',
        turnId,
      }),
    );
    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'error', isActive: false }),
    );
    expect(readChatAgent()?.error).toBe('session/prompt idle timeout (1800s of silence)');

    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'pending', isActive: false }),
    );
    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'active', isActive: true }),
    );
    handler(
      notification('agent:queue:processing', {
        agentId: AGENT,
        messageId: 'queued-msg-1',
        content: 'retried message',
        turnId,
      }),
    );

    expect(readChatAgent()?.error).toBeNull();
    expect(readChatAgent()?.modelUnavailable).toBeNull();
  });

  it('clears on error→(isActive:true) even when the payload omits a string status', async () => {
    seedSession({ status: AgentStatus.Error });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    appStore.dispatch(chatSendFailed(AGENT, 'previous turn failed'));

    handler(notification('agent:status-changed', { agentId: AGENT, isActive: true }));

    expect(readChatAgent()?.error).toBeNull();
  });

  it('agent:status-changed error→idle (no new turn) keeps the banner', async () => {
    seedSession({ status: AgentStatus.Error });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    appStore.dispatch(chatSendFailed(AGENT, 'previous turn failed'));

    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'idle', isActive: false }),
    );

    expect(readChatAgent()?.error).toBe('previous turn failed');
  });

  it('mid-turn active status tick with a non-error prior status never wipes a banner (#1044 semantics)', async () => {
    seedSession({ status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // e.g. an enqueue-failure banner raised while the agent is already active
    appStore.dispatch(chatSendFailed(AGENT, 'enqueue failed'));

    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'active', isActive: true }),
    );

    expect(readChatAgent()?.error).toBe('enqueue failed');
  });

  it('agent:stream:start on an errored agent clears the banner via chatSendStarted', async () => {
    seedSession({ status: AgentStatus.Error });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    appStore.dispatch(chatSendFailed(AGENT, 'previous turn failed'));
    expect(readChatAgent()?.error).toBe('previous turn failed');

    handler(
      notification('agent:stream:start', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        streamId: STREAM_ID,
      }),
    );

    expect(readChatAgent()?.error).toBeNull();
    expect(readChatAgent()?.modelUnavailable).toBeNull();
  });
});

describe('daemonEventsBridge (changes refresh — git:commit/git:pull/changes:tracked → refreshRequested)', () => {
  beforeAll(() => {
    appStore.init();
  });

  let dispatchCalls: any[];

  beforeEach(async () => {
    dispatchCalls = [];
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Restore appStore.dispatch getter overridden by wrapDispatch() to avoid leaking into other suites.
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(appStore), 'dispatch');
    if (original) Object.defineProperty(appStore, 'dispatch', original);
  });

  function wrapDispatch() {
    const originalGetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(appStore),
      'dispatch',
    )!.get!;
    const realDispatch = originalGetter.call(appStore);

    Object.defineProperty(appStore, 'dispatch', {
      get() {
        return (action: any) => {
          dispatchCalls.push(action);
          return realDispatch(action);
        };
      },
      configurable: true,
    });
  }

  it('git:commit event triggers debounced refreshRequested with the right workspaceId', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Use fake timers BEFORE dispatching the event
    vi.useFakeTimers();

    // Wrap dispatch to track calls
    wrapDispatch();

    // Feed a PROTOCOL §6.3 git:commit envelope
    handler(
      notification('git:commit', {
        sha: 'abc123',
        message: 'feat: add feature',
      }),
    );

    // Debounce should not have dispatched yet
    const refreshCallsBefore = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested',
    );
    expect(refreshCallsBefore).toHaveLength(0);

    // Fast-forward past the debounce timeout
    vi.advanceTimersByTime(1000);

    // Now refreshRequested should be dispatched with the right workspaceId
    const refreshCalls = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested',
    );
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]).toMatchObject({
      type: 'changes/refreshRequested',
      payload: [WS],
    });
  });

  it('git:pull event triggers debounced refreshRequested', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    wrapDispatch();

    handler(
      notification('git:pull', {
        branch: 'main',
      }),
    );

    vi.advanceTimersByTime(1000);

    const refreshCalls = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested',
    );
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]).toMatchObject({
      type: 'changes/refreshRequested',
      payload: [WS],
    });
  });

  it('changes:tracked event triggers debounced refreshRequested', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    wrapDispatch();

    handler(
      notification('changes:tracked', {
        path: 'src/lib.rs',
      }),
    );

    vi.advanceTimersByTime(1000);

    const refreshCalls = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested',
    );
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]).toMatchObject({
      type: 'changes/refreshRequested',
      payload: [WS],
    });
  });

  it('rapid changes:tracked events for the same workspace are debounced into a single refreshRequested', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    wrapDispatch();

    // Fire 5 rapid events
    for (let i = 0; i < 5; i++) {
      handler(
        notification('changes:tracked', {
          path: `src/file${i}.rs`,
        }),
      );
      vi.advanceTimersByTime(200); // Less than the 1s debounce
    }

    // Advance past the final debounce
    vi.advanceTimersByTime(1000);

    // Should only have dispatched once
    const refreshCalls = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested',
    );
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]).toMatchObject({
      type: 'changes/refreshRequested',
      payload: [WS],
    });
  });

  it('events for different workspaces are debounced independently', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    wrapDispatch();

    const WS2 = 'ws-bridge-2';

    // Fire event for workspace 1
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-1',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'git:commit',
          actor: { type: 'system' },
          data: { sha: 'abc123' },
        },
      },
    });

    vi.advanceTimersByTime(500);

    // Fire event for workspace 2
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-2',
          workspaceId: WS2,
          timestamp: '2026-01-02T00:00:01.000Z',
          type: 'git:commit',
          actor: { type: 'system' },
          data: { sha: 'def456' },
        },
      },
    });

    // Advance to trigger workspace 1's debounce
    vi.advanceTimersByTime(500);

    const refreshCalls1 = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested' && action.payload[0] === WS,
    );
    expect(refreshCalls1).toHaveLength(1);

    // Advance to trigger workspace 2's debounce
    vi.advanceTimersByTime(500);

    const refreshCalls2 = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested' && action.payload[0] === WS2,
    );
    expect(refreshCalls2).toHaveLength(1);
  });

  it('unrelated event types do not trigger refreshRequested', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    wrapDispatch();

    handler(
      notification('file:changed', {
        path: 'src/lib.rs',
      }),
    );

    vi.advanceTimersByTime(1000);

    const refreshCalls = dispatchCalls.filter(
      (action) => action.type === 'changes/refreshRequested',
    );
    expect(refreshCalls).toHaveLength(0);
  });
});

describe('daemonEventsBridge (activity reconciliation → missed edges)', () => {
  const WS_RECON = 'ws-reconcile-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    backendRequestSpy.mockReset(); // Reset implementation too, not just call history
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  async function seedWorkspace(activity?: 'idle' | 'agent_running'): Promise<void> {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS_RECON,
        title: 'Reconcile ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activity,
      } as never),
    );
  }

  async function readWorkspace(): Promise<{
    activity?: 'idle' | 'agent_running';
  }> {
    const { getItem } = await import('$lib/store-shim/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return (getItem(state.workspace.workspaces as never, WS_RECON) ?? {}) as never;
  }

  function agentStatusChangedNotification(isResponding: boolean, isStreaming = false) {
    return {
      method: 'events.event',
      params: {
        event: {
          id: 'evt-status-1',
          workspaceId: WS_RECON,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:status-changed',
          actor: { type: 'system' },
          data: {
            agentId: 'agent-1',
            status: isResponding ? 'responding' : 'idle',
            previousStatus: 'idle',
            isResponding,
            isStreaming,
            isActive: true,
            isProcessing: false,
            activationState: null,
            stopReason: null,
          },
        },
      },
    };
  }

  function agentIdleNotification() {
    return {
      method: 'events.event',
      params: {
        event: {
          id: 'evt-idle-1',
          workspaceId: WS_RECON,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:idle',
          actor: { type: 'system' },
          data: {
            agentId: 'agent-1',
            agentName: 'Agent 1',
            reason: 'stream_complete',
            status: null,
            isActive: false,
            isStreaming: false,
            isProcessing: false,
            isResponding: false,
            activationState: null,
            stopReason: null,
          },
        },
      },
    };
  }

  function agentStreamActivityNotification() {
    return {
      method: 'events.event',
      params: {
        event: {
          id: 'evt-activity-1',
          workspaceId: WS_RECON,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:stream:activity',
          actor: { type: 'system' },
          data: {
            agentId: 'agent-1',
            messageId: 'msg-1',
            lastAgentResponse: 'streamed-so-far text',
          },
        },
      },
    };
  }

  function agentStreamStatusNotification() {
    return {
      method: 'events.event',
      params: {
        event: {
          id: 'evt-stream-status-1',
          workspaceId: WS_RECON,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:stream:status',
          actor: { type: 'system' },
          data: {
            agentId: 'agent-1',
            phase: 'prompt',
            message: 'Sent prompt',
            level: 'info',
            timestamp: Date.now(),
          },
        },
      },
    };
  }

  it('reconciles activity to agent_running when agent:status-changed shows isResponding and entity is idle', async () => {
    await seedWorkspace('idle');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Mock workspace.get to return agent_running. primeBridge calls events.subscribe and
    // the agent:status-changed handler also triggers agent.list (hydrateAgentsRequested),
    // so we need to mock those calls too or use mockResolvedValue to apply to all calls.
    const { WorkspaceStatus } = await import('$shared/types');
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'workspace.get') {
        return {
          workspace: {
            id: WS_RECON,
            title: 'Reconcile ws',
            branch: 'main',
            status: WorkspaceStatus.Active,
            changesets: [],
            timeline: [],
            conversationInfo: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            activity: 'agent_running',
          },
        };
      }
      if (method === 'agent.list') {
        return { agents: [] };
      }
      return { subscriptionId: 'sub-1' };
    });

    handler(agentStatusChangedNotification(true, false));

    // Wait for the async reconciliation to complete (longer for first-time imports)
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_RECON });
    const ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');
  });

  it('reconciles activity to agent_running when agent:stream:activity arrives and entity is idle', async () => {
    await seedWorkspace('idle');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const { WorkspaceStatus } = await import('$shared/types');
    backendRequestSpy.mockResolvedValueOnce({
      workspace: {
        id: WS_RECON,
        title: 'Reconcile ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activity: 'agent_running',
      },
    });

    handler(agentStreamActivityNotification());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_RECON });
    const ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');
  });

  it('reconciles activity to agent_running when agent:stream:status arrives and entity is idle', async () => {
    await seedWorkspace('idle');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const { WorkspaceStatus } = await import('$shared/types');
    backendRequestSpy.mockResolvedValueOnce({
      workspace: {
        id: WS_RECON,
        title: 'Reconcile ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activity: 'agent_running',
      },
    });

    handler(agentStreamStatusNotification());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_RECON });
    const ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');
  });

  it('does not refetch when agent:status-changed shows busy and entity is already agent_running', async () => {
    await seedWorkspace('agent_running');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(agentStatusChangedNotification(true, false));

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not call workspace.get because activity is already agent_running
    expect(backendRequestSpy).not.toHaveBeenCalledWith('workspace.get', expect.anything());
    const ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');
  });

  it('refetches on agent:idle even when other agents may be busy', async () => {
    await seedWorkspace('agent_running');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Mock workspace.get to return agent_running (another agent still busy)
    const { WorkspaceStatus } = await import('$shared/types');
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'workspace.get') {
        return {
          workspace: {
            id: WS_RECON,
            title: 'Reconcile ws',
            branch: 'main',
            status: WorkspaceStatus.Active,
            changesets: [],
            timeline: [],
            conversationInfo: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            activity: 'agent_running',
          },
        };
      }
      if (method === 'agent.list') {
        return { agents: [] };
      }
      return { subscriptionId: 'sub-1' };
    });

    handler(agentIdleNotification());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_RECON });
    const ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');
  });

  it('updates to idle when agent:idle arrives and no agents remain busy', async () => {
    await seedWorkspace('agent_running');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Mock workspace.get to return idle (no more busy agents)
    const { WorkspaceStatus } = await import('$shared/types');
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'workspace.get') {
        return {
          workspace: {
            id: WS_RECON,
            title: 'Reconcile ws',
            branch: 'main',
            status: WorkspaceStatus.Active,
            changesets: [],
            timeline: [],
            conversationInfo: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            activity: 'idle',
          },
        };
      }
      if (method === 'agent.list') {
        return { agents: [] };
      }
      return { subscriptionId: 'sub-1' };
    });

    handler(agentIdleNotification());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_RECON });
    const ws = await readWorkspace();
    expect(ws.activity).toBe('idle');
  });

  it('seeds entity when busy event arrives before workspace entity exists', async () => {
    // Do not seed the workspace entity — simulate event arriving before entity exists
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const { WorkspaceStatus } = await import('$shared/types');
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'workspace.get') {
        return {
          workspace: {
            id: WS_RECON,
            title: 'Reconcile ws',
            branch: 'main',
            status: WorkspaceStatus.Active,
            changesets: [],
            timeline: [],
            conversationInfo: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            activity: 'agent_running',
          },
        };
      }
      if (method === 'agent.list') {
        return { agents: [] };
      }
      return { subscriptionId: 'sub-1' };
    });

    handler(agentStatusChangedNotification(true, false));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_RECON });
    const ws = await readWorkspace();
    expect(ws.activity).toBe('agent_running');
  });

  it('ignores workspace.get errors gracefully', async () => {
    await seedWorkspace('idle');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Mock workspace.get to reject (workspace deleted or transport error)
    backendRequestSpy.mockRejectedValueOnce(new Error('Workspace not found'));

    handler(agentStatusChangedNotification(true, false));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_RECON });
    // Entity should remain unchanged (still idle)
    const ws = await readWorkspace();
    expect(ws.activity).toBe('idle');
  });
});

describe('DaemonEventsBridge — app-UI events', () => {
  const { navigateToRouteSpy } = vi.hoisted(() => ({
    navigateToRouteSpy: vi.fn(() => Promise.resolve()),
  }));

  vi.mock('$lib/utils/navigation.client', () => ({
    navigateToRoute: navigateToRouteSpy,
  }));

  beforeAll(() => appStore.init());
  beforeEach(() => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset());
    __resetDaemonEventsBridgeForTests();
    navigateToRouteSpy.mockClear();
    invokeSpy.mockClear();
    backendRequestSpy.mockClear();
    capturedHandlers.length = 0;
    // Reset UI highlight state by replacing with initial state
    const state = appStore.state as Record<string, unknown>;
    if (state.uiHighlight) {
      state.uiHighlight = { activeById: {}, durationMsById: {} };
    }
    seedSession();
  });

  afterEach(() => {
    resetMockIpcRouter();
    vi.clearAllMocks();
  });

  function appUiNavigateNotification(route: string, highlightId?: string, durationMs?: number) {
    const data: Record<string, unknown> = { route };
    if (highlightId) data.highlightId = highlightId;
    if (durationMs !== undefined) data.durationMs = durationMs;
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-app-ui-navigate-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'app:ui-navigate',
          actor: { type: 'agent', id: AGENT },
          data,
        },
      },
    };
  }

  function appUiHighlightNotification(id: string, durationMs?: number) {
    const data: Record<string, unknown> = { id };
    if (durationMs !== undefined) data.durationMs = durationMs;
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-app-ui-highlight-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'app:ui-highlight',
          actor: { type: 'agent', id: AGENT },
          data,
        },
      },
    };
  }

  function appWorkspaceOpenNotification(workspaceId: string, openInNewWindow?: boolean) {
    const data: Record<string, unknown> = { workspaceId };
    if (openInNewWindow !== undefined) data.openInNewWindow = openInNewWindow;
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-app-workspace-open-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'app:workspace-open',
          actor: { type: 'agent', id: AGENT },
          data,
        },
      },
    };
  }

  describe('app:ui-navigate', () => {
    it('navigates to route without highlight', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiNavigateNotification('/settings'));
      await flush();

      expect(navigateToRouteSpy).toHaveBeenCalledWith('/settings');
    });

    it('navigates to route and dispatches highlight after navigation', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiNavigateNotification('/settings?tab=agents#specialists', 'specialists', 750));
      await flush();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(navigateToRouteSpy).toHaveBeenCalledWith('/settings?tab=agents#specialists');
      // Check that requestUiHighlight was dispatched
      const state = appStore.state as {
        uiHighlight?: {
          activeById: Record<string, number>;
          durationMsById: Record<string, number>;
        };
      };
      expect(state.uiHighlight?.activeById['specialists']).toBeGreaterThan(0);
      expect(state.uiHighlight?.durationMsById['specialists']).toBe(750);
    });

    it('ignores blank routes', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiNavigateNotification('   '));
      await flush();

      expect(navigateToRouteSpy).not.toHaveBeenCalled();
    });

    it('handles navigation errors gracefully', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;
      navigateToRouteSpy.mockRejectedValueOnce(new Error('Navigation failed'));

      handler(appUiNavigateNotification('/invalid'));
      await flush();

      expect(navigateToRouteSpy).toHaveBeenCalledWith('/invalid');
      // Should not throw
    });
  });

  describe('app:ui-highlight', () => {
    it('dispatches highlight action with default duration', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiHighlightNotification('theme'));
      await flush();

      const state = appStore.state as {
        uiHighlight?: {
          activeById: Record<string, number>;
          durationMsById: Record<string, number>;
        };
      };
      expect(state.uiHighlight?.activeById['theme']).toBeGreaterThan(0);
      expect(state.uiHighlight?.durationMsById['theme']).toBeUndefined();
    });

    it('dispatches highlight action with custom duration', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiHighlightNotification('mcp-servers', 1500));
      await flush();

      const state = appStore.state as {
        uiHighlight?: {
          activeById: Record<string, number>;
          durationMsById: Record<string, number>;
        };
      };
      expect(state.uiHighlight?.activeById['mcp-servers']).toBeGreaterThan(0);
      expect(state.uiHighlight?.durationMsById['mcp-servers']).toBe(1500);
    });

    it('ignores blank highlight IDs', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiHighlightNotification('   '));
      await flush();

      const state = appStore.state as {
        uiHighlight?: { activeById: Record<string, number> };
      };
      expect(Object.keys(state.uiHighlight?.activeById ?? {})).toHaveLength(0);
    });
  });

  describe('app:workspace-open', () => {
    it('navigates in current window when openInNewWindow is false', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appWorkspaceOpenNotification('ws-123', false));
      await flush();

      expect(navigateToRouteSpy).toHaveBeenCalledWith('/workspace/ws-123');
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it('navigates in current window when openInNewWindow is omitted', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appWorkspaceOpenNotification('ws-456'));
      await flush();

      expect(navigateToRouteSpy).toHaveBeenCalledWith('/workspace/ws-456');
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it('opens in new window when openInNewWindow is true', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appWorkspaceOpenNotification('ws-789', true));
      await flush();

      expect(invokeSpy).toHaveBeenCalledWith('window:open-new', { route: '/workspace/ws-789' });
      expect(navigateToRouteSpy).not.toHaveBeenCalled();
    });

    it('falls back to navigation when new window fails', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;
      invokeSpy.mockRejectedValueOnce(new Error('Window creation failed'));

      handler(appWorkspaceOpenNotification('ws-fallback', true));
      await flush();

      expect(invokeSpy).toHaveBeenCalledWith('window:open-new', {
        route: '/workspace/ws-fallback',
      });
      expect(navigateToRouteSpy).toHaveBeenCalledWith('/workspace/ws-fallback');
    });

    it('ignores blank workspace IDs', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appWorkspaceOpenNotification('   '));
      await flush();

      expect(navigateToRouteSpy).not.toHaveBeenCalled();
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it('falls back to navigation when invoke resolves {success:false}', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;
      invokeSpy.mockResolvedValueOnce({ success: false, error: 'Window creation blocked' });

      handler(appWorkspaceOpenNotification('ws-success-false', true));
      await flush();

      expect(invokeSpy).toHaveBeenCalledWith('window:open-new', {
        route: '/workspace/ws-success-false',
      });
      expect(navigateToRouteSpy).toHaveBeenCalledWith('/workspace/ws-success-false');
    });
  });
});
