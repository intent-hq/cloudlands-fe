import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage, AgentSession, Note } from '$shared/types';

const { reportStreamLifecycleSpy } = vi.hoisted(() => ({ reportStreamLifecycleSpy: vi.fn() }));

vi.mock('$lib/utils/stream-lifecycle-telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/stream-lifecycle-telemetry')>()),
  reportStreamLifecycle: reportStreamLifecycleSpy,
}));

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

// Fake the live backend transport so the bridge installs against in-memory
// fakes (no Electron). `vi.hoisted` keeps the spies visible to the hoisted
// vi.mock factory.
const {
  onBackendNotificationSpy,
  backendRequestSpy,
  applyNoteFromEventSpy,
  applyCommentFromEventSpy,
  workspaceServiceListSpy,
  capturedHandlers,
  capturedReconnectHandlers,
} = vi.hoisted(() => ({
  onBackendNotificationSpy: vi.fn(),
  backendRequestSpy: vi.fn(),
  applyNoteFromEventSpy: vi.fn(),
  applyCommentFromEventSpy: vi.fn(),
  workspaceServiceListSpy: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
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
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { list: workspaceServiceListSpy },
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
const { ensureAgentSessionSpy, refreshAgentSessionAfterEventSpy } = vi.hoisted(() => ({
  ensureAgentSessionSpy: vi.fn(() => Promise.resolve()),
  refreshAgentSessionAfterEventSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('$features/agent/agent-read-service', () => ({
  ensureAgentSession: ensureAgentSessionSpy,
  refreshAgentSessionAfterEvent: refreshAgentSessionAfterEventSpy,
  createAgentReadMiddleware: () => () => (next: (a: unknown) => unknown) => (a: unknown) => next(a),
}));

// Fake the interrupted-agents service so the bridge's `agent:updated` →
// cross-window reconcile notify (monorepo#1728) is observable without the real
// modal/appClient choreography.
const { notifyInterruptedAgentUpdatedSpy } = vi.hoisted(() => ({
  notifyInterruptedAgentUpdatedSpy: vi.fn(),
}));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  notifyInterruptedAgentUpdated: notifyInterruptedAgentUpdatedSpy,
}));

// Fake the navigate-away helper so the bridge's `workspace:deleted` navigation
// routing is observable without jsdom location/tab-state choreography. This is
// the live-mode path for #766: the `events.event` firehose fires in both live
// and legacy modes, unlike the workspace-list snapshot diff (monorepo#775).
const { navigateAwayIfViewingSpy } = vi.hoisted(() => ({
  navigateAwayIfViewingSpy: vi.fn(() => Promise.resolve()),
}));
// `closeWorkspaceTabAndNavigateAway` stays REAL so the archive-transition
// suite can assert actual tab-state changes (jsdom is never viewing the
// workspace route, so its goto leg is inert here).
vi.mock('$features/workspace/navigate-away-if-viewing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/workspace/navigate-away-if-viewing')>()),
  navigateAwayIfViewing: navigateAwayIfViewingSpy,
}));

// Fake the mark-workspace-seen helper so the attention suite can assert the
// bridge never auto-clears an unread raise (unread persists until each agent
// conversation is read — the bridge must not call `workspace.markSeen`).
const { markWorkspaceSeenSpy } = vi.hoisted(() => ({
  markWorkspaceSeenSpy: vi.fn(),
}));
vi.mock('$features/workspace/mark-workspace-seen', () => ({
  markWorkspaceSeen: markWorkspaceSeenSpy,
}));

// The bridge now dispatches refreshWorkspaceSubscriptionEntriesRequested instead
// of calling the service directly — the saga handles the actual fetch. No mock needed.

// Negative seam: the bridge must NEVER page a transcript (reconnect rides the
// standing chat.subscribe seq-0 snapshot; agent:message rides
// agent:last-message / the light agent.get fallback). The mock keeps the spy
// observable so the suites can assert it stays uncalled.
const { loadChatTranscriptSpy } = vi.hoisted(() => ({
  loadChatTranscriptSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('$features/agent/chat-read-service', () => ({
  loadChatTranscript: loadChatTranscriptSpy,
  createChatReadMiddleware: () => () => (next: (a: unknown) => unknown) => (a: unknown) => next(a),
}));

// Fake the attention-toast service so the bridge's `agent:attention-requested`
// routing (monorepo#1709) and the `workspace:updated` auto-unarchive toast are
// observable without a real Sonner/toast-component import chain.
const { showAgentAttentionToastSpy, showWorkspaceAutoUnarchiveToastSpy } = vi.hoisted(() => ({
  showAgentAttentionToastSpy: vi.fn(() => Promise.resolve()),
  showWorkspaceAutoUnarchiveToastSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('$features/agent/agent-attention-toast-service', () => ({
  showAgentAttentionToast: showAgentAttentionToastSpy,
  showWorkspaceAutoUnarchiveToast: showWorkspaceAutoUnarchiveToastSpy,
}));

// Fake the terminal manager (dynamically imported by the bridge) so the
// `terminal:exit` handler's disposal call is observable without a real
// TerminalAdapter/xterm instance.
const { disposeExitedTerminalSpy } = vi.hoisted(() => ({
  disposeExitedTerminalSpy: vi.fn(),
}));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { disposeExitedTerminal: disposeExitedTerminalSpy },
}));

// Mock electron-bridge to avoid Electron dependency in tests. Provides stubs
// for all exports; tests that need specific behavior (e.g., app-UI events suite)
// can override via mockImplementation/mockReturnValue.
const { invokeSpy } = vi.hoisted(() => ({
  invokeSpy: vi.fn(() => Promise.resolve({ success: true })),
}));
const { navigateToRouteSpy } = vi.hoisted(() => ({
  navigateToRouteSpy: vi.fn(() => Promise.resolve()),
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
vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: navigateToRouteSpy,
}));

import { store as appStore } from '$store/renderer/store';
import { agentStreamSaga } from '$store/renderer/slices/agent-session/sagas/agent-stream-saga';
import { githubAuthSaga } from '$store/renderer/slices/github-auth/sagas/github-auth-saga';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import {
  bulkUpsertSessions,
  clearAllSessions,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentIsResponding } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { selectEnabledProviderIds } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import {
  DAEMON_EVENTS_SUBSCRIBE_TYPES,
  __resetDaemonEventsBridgeForTests,
  refreshDaemonEventsAfterReconnect,
  routeDaemonEventsNotification,
} from '$features/events/daemon-events-bridge.client';
import { selectContextItems } from '$store/renderer/slices/context/context-selectors';
import { selectLockedAgentIds } from '$store/renderer/slices/agent-lock/agent-lock-selectors';
import {
  chatQueuedRetryRecordSet,
  chatReset,
  chatSendFailed,
  chatSendStarted,
  chatStopCompleted,
  chatStopInitiated,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  clearAgentFailureRegistry,
  listAgentFailureEntries,
  recordAgentFailure,
} from '$features/agent/agent-failure-registry';
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
  setWorkspaceDisabledMcpServers,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import type { McpServerStatus } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import { upsertScript } from '$store/renderer/slices/scripts/scripts-slice';
import type { ScriptOutputBuffer } from '$store/renderer/slices/scripts/scripts-types';
import { addTerminal } from '$store/renderer/slices/terminals/terminals-slice';
import { selectTerminalsForWorkspace } from '$store/renderer/slices/terminals/terminals-selectors';
import {
  beginWorkspaceCreateProgress,
  clearWorkspaceCreateProgress,
} from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
import { selectWorkspaceCreateProgress } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-selectors';
import {
  resolveFinishReasonNotice,
  resolveStoppedIndicatorLabel,
  shouldShowStoppedIndicator,
} from '$lib/components/chat/message-display-utils';
import { derivePendingQuestions } from '$lib/components/chat/questions/pending-questions';
import { QUESTION_RESOURCE_MIME_TYPE, type Question } from '$shared/types/question-resource';
import { refreshWorkspaceSubscriptionEntriesRequested } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import {
  setAgents,
  setRetiredCount,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { selectRetiredCount } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';

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
const stopRouterDependencies: Array<() => void> = [];

function inheritedPropertyDescriptor(target: object, key: PropertyKey): PropertyDescriptor {
  let prototype = Object.getPrototypeOf(target);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor) return descriptor;
    prototype = Object.getPrototypeOf(prototype);
  }
  throw new Error(`Missing inherited property descriptor for ${String(key)}`);
}

beforeAll(() => {
  appStore.init();
  stopRouterDependencies.push(
    appStore.runSaga(agentStreamSaga),
    appStore.runSaga(lifecycleReadSaga),
    appStore.runSaga(githubAuthSaga),
  );
});

afterAll(() => {
  for (const stop of stopRouterDependencies) stop();
  appStore.dispose();
});

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

/** Install a direct router adapter; subscription ownership is tested by the saga suite. */
async function primeBridge(): Promise<void> {
  capturedHandlers[0] ??= (notification) => {
    routeDaemonEventsNotification(notification.method, notification.params, 'sub-1');
  };
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
    // ("all slots active") per PROTOCOL §6.5. The wire payload carries
    // reason: 'slots' (intent-hq/intentd#1196).
    handler(
      notification('agent:process:queued', {
        agentId: AGENT,
        used: 3,
        cap: 3,
        reason: 'slots',
      }),
    );

    expect(readSession()?.processQueueHint).toEqual({
      waiting: true,
      used: 3,
      cap: 3,
      reason: 'slots',
    });

    // Deliver agent:process:resumed event — should clear processQueueHint.
    // Include used/cap/reason to match PROTOCOL §6.5 (AgentProcessResumedEvent
    // carries { agentId, used, cap, reason }) even though the handler only uses
    // agentId.
    handler(
      notification('agent:process:resumed', {
        agentId: AGENT,
        used: 2,
        cap: 3,
        reason: 'slots',
      }),
    );

    expect(readSession()?.processQueueHint).toBeUndefined();
  });

  it('routes agent:process:queued with reason memory-budget into processQueueHint.reason', async () => {
    seedSession();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Budget-queued spawn (PROTOCOL §6.5): used/cap still count agent slots,
    // but the admission constraint is the aggregate memory budget.
    handler(
      notification('agent:process:queued', {
        agentId: AGENT,
        used: 2,
        cap: 8,
        reason: 'memory-budget',
      }),
    );

    expect(readSession()?.processQueueHint).toEqual({
      waiting: true,
      used: 2,
      cap: 8,
      reason: 'memory-budget',
    });
  });

  it('normalizes an absent agent:process:queued reason (older daemon) to slots', async () => {
    seedSession();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Pre-#1196 daemons omit `reason`; the bridge treats absence as 'slots'
    // (the only queueing constraint that existed before the memory budget).
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
      reason: 'slots',
    });
  });

  it('falls back to slots for an unrecognized agent:process:queued reason', async () => {
    seedSession();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // A hypothetical future constraint the FE doesn't know yet: fall back to
    // 'slots' (a stale label beats a broken render) — the bridge logs a
    // warning so the divergence is observable rather than silently absorbed.
    handler(
      notification('agent:process:queued', {
        agentId: AGENT,
        used: 3,
        cap: 3,
        reason: 'gpu-budget',
      }),
    );

    expect(readSession()?.processQueueHint).toEqual({
      waiting: true,
      used: 3,
      cap: 3,
      reason: 'slots',
    });
  });

  it('clears the queue hint and stale busy flags on agent:process:evicted (idle-ttl reap, monorepo#3040)', async () => {
    // A stale optimistic "Thinking" state: the daemon only evicts idle
    // processes (intent-hq/intentd#1356), so any busy indicator at eviction
    // time is provably stale — the bridge must clear it, not leave a phantom
    // spinner until the next canonical event.
    seedSession({
      status: AgentStatus.Active,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      liveTurnOpen: true,
      liveTurnOpenedAt: '2026-01-01T12:00:00.000Z',
      processQueueHint: { waiting: true, used: 3, cap: 3, reason: 'slots' },
    } as Partial<AgentSession>);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // PROTOCOL §6.5: AgentProcessEvictedEvent carries { agentId, used, cap,
    // reason }; reason "idle-ttl" is the TTL sweep (intent-hq/intentd#1356).
    handler(
      notification('agent:process:evicted', {
        agentId: AGENT,
        used: 2,
        cap: 3,
        reason: 'idle-ttl',
      }),
    );

    const session = readSession();
    expect(session?.processQueueHint).toBeUndefined();
    expect(session?.isStreaming).toBe(false);
    expect(session?.isProcessing).toBe(false);
    expect(session?.isResponding).toBe(false);
    expect((session as { liveTurnOpen?: boolean })?.liveTurnOpen).toBe(false);
    // §6.5 guarantees the evicted process was idle, so the stale RUNNING
    // status is demoted to 'idle' — otherwise isAgentRunningState (and the
    // Thinking indicator) would stay true on the status alone. Eviction is
    // still NOT an "agent ended" transition (next send auto-restores).
    expect(session?.status).toBe(AgentStatus.RuntimeIdle);
    // The canonical Thinking driver is genuinely resolved.
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it('ignores non-events.event methods, and forwards non-lifecycle events.event notifications into workspaceEvents without changing agent-session flags', async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Unrelated method — no-op.
    handler({ method: 'agent.stream:chunk', params: { agentId: AGENT } });
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

describe('daemonEventsBridge (live stream wire contract — agent:stream:* → transcript)', () => {
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

  it('accumulates agent:stream:chunk into a live assistant message and finalizes on stream:end + idle', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Two consecutive text chunks at the same blockIndex must coalesce into a
    // single text block, mirroring the BE's Transcript.push_text behaviour.
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Hello ',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );

    let assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].isStreaming).toBe(true);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'Hello ',
    });

    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'world',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );

    assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'Hello world',
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));
    const terminalTelemetry = reportStreamLifecycleSpy.mock.calls
      .map(([diagnostic]) => diagnostic)
      .filter((diagnostic) =>
        ['agent-stream-end-received', 'stream-complete-dispatched'].includes(diagnostic.event),
      );
    expect(terminalTelemetry).toEqual([
      expect.objectContaining({
        event: 'agent-stream-end-received',
        callbackResult: 'received',
      }),
      expect.objectContaining({
        event: 'stream-complete-dispatched',
        callbackResult: 'dispatched',
      }),
    ]);
    expect(terminalTelemetry[0]).not.toHaveProperty('storeStreamState');

    assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);

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

  it('renders agent:tool:call as tool_use + tool_result blocks after the tool completes', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Looking',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
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

    let blocks = readAssistantMessages()[0]?.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool_use']);
    expect(blocks[1]).toMatchObject({
      type: 'tool_use',
      toolCallId: 't1',
      name: 'Read',
    });

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

    blocks = readAssistantMessages()[0]?.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_result']);
    expect(blocks[2]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', output: 'ok' });

    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));
    handler(
      notification('agent:idle', {
        agentId: AGENT,
        status: 'idle',
        isActive: false,
        reason: 'stream_complete',
      }),
    );

    expect(readAssistantMessages()[0]?.isStreaming).toBe(false);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it('does not replace chat.subscribe prose with a tool-only legacy candidate', async () => {
    seedSession({
      isStreaming: true,
      status: AgentStatus.Active,
      messages: [
        {
          id: MESSAGE_ID,
          role: 'assistant',
          isStreaming: true,
          contentBlocks: [
            { type: 'text', id: `${MESSAGE_ID}:0`, text: 'I will inspect the logs first.' },
            {
              type: 'tool_use',
              id: `${MESSAGE_ID}:1`,
              name: 'Read',
              input: { path: 'src/lib.rs' },
              toolCallId: 't1',
              metadata: { toolKind: 'file', status: 'started' },
            },
          ],
        } as AgentMessage,
      ],
    });
    await primeBridge();

    capturedHandlers[0]!(
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

    expect(readAssistantMessages()[0]?.contentBlocks).toEqual([
      { type: 'text', id: `${MESSAGE_ID}:0`, text: 'I will inspect the logs first.' },
      {
        type: 'tool_use',
        id: `${MESSAGE_ID}:1`,
        name: 'Read',
        input: { path: 'src/lib.rs' },
        toolCallId: 't1',
        metadata: { toolKind: 'file', status: 'started' },
      },
    ]);

    capturedHandlers[0]!(
      notification('agent:stream:end', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        streamId: STREAM_ID,
      }),
    );

    expect(readAssistantMessages()[0]).toMatchObject({
      isStreaming: false,
      contentBlocks: [
        { type: 'text', id: `${MESSAGE_ID}:0`, text: 'I will inspect the logs first.' },
        {
          type: 'tool_use',
          id: `${MESSAGE_ID}:1`,
          name: 'Read',
          input: { path: 'src/lib.rs' },
          toolCallId: 't1',
          metadata: { toolKind: 'file', status: 'started' },
        },
      ],
    });
  });

  // Regression: the daemon's `map_tool_call_update` (crates/intent-acp) emits
  // `agent:tool:call` events on every ACP `tool_call_update` where unchanged
  // fields default to empty (`toolName: ""`, `toolKind: "other"`, `input: null`)
  // — only `status` (and sometimes `output`) is authoritative on updates.
  // Mirroring the daemon-side `record_tool` (crates/intent-services/agent_session.rs),
  // which only patches `metadata.status` on repeated `toolCallId`s, the FE
  // bridge must preserve the initial name/input/toolKind so the classifier
  // keeps rendering a rich label instead of falling through to the generic
  // "Run" row (bug 19).
  it('preserves the initial name/input/toolKind when a tool_call_update event omits them', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't1',
        input: { path: 'src/lib.rs' },
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );

    // Mid-flight update the daemon emits from `map_tool_call_update` when the
    // ACP provider reports a progress-only tick: title/kind/rawInput are None
    // upstream, so the wire payload defaults them out.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: '',
        toolKind: 'other',
        toolCallId: 't1',
        input: null,
        status: 'started',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );

    // Completion update: only `status` (and `output`) are authoritative.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: '',
        toolKind: 'other',
        toolCallId: 't1',
        input: null,
        status: 'completed',
        output: 'ok',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
      }),
    );

    const blocks = readAssistantMessages()[0]?.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['tool_use', 'tool_result']);
    expect(blocks[0]).toMatchObject({
      type: 'tool_use',
      toolCallId: 't1',
      name: 'Read',
      input: { path: 'src/lib.rs' },
      metadata: { toolKind: 'file', status: 'completed' },
    });
    expect(blocks[1]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
      output: 'ok',
    });
  });

  it('does not duplicate the assistant message when getConversation hydration follows the live stream', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Done.',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));
    handler(
      notification('agent:idle', {
        agentId: AGENT,
        status: 'idle',
        isActive: false,
        reason: 'stream_complete',
      }),
    );

    // Simulate the chat-read-service.getConversation hydration: a session
    // upsert carrying the BE-canonical assistant message with the same id.
    const session = readSession();
    expect(session).toBeDefined();
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...session!,
          messages: [
            ...(session!.messages ?? []).filter((m) => m.role !== 'assistant'),
            {
              id: MESSAGE_ID,
              role: 'assistant',
              contentBlocks: [{ type: 'text', text: 'Done.' }],
              timestamp: '2026-01-02T00:00:00.001Z',
            } as AgentMessage,
          ],
        },
      ]),
    );

    expect(readAssistantMessages()).toHaveLength(1);
    expect(readAssistantMessages()[0].id).toBe(MESSAGE_ID);
  });

  it('agent:failed finalizes the in-flight stream and clears the spinner', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Working',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
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

    const assistant = readAssistantMessages()[0];
    expect(assistant).toBeDefined();
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.streamingComplete).toBe(true);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("emits status hint transitions: 'Streaming response…' on first chunk → 'Calling tool' on tool:call started → 'Awaiting tool response' on tool:call completed → 'Streaming response…' on next chunk → cleared on stream:end/idle", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // First text chunk arms the "Streaming response…" status entry via the
    // chunk reducer (no explicit dispatch needed from the bridge).
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Looking',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
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
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Done.',
        messageId: MESSAGE_ID,
        blockIndex: 2,
        blockId: `${MESSAGE_ID}:2`,
        blockType: 'text',
        streamId: STREAM_ID,
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

  it('maps agent:stream:status without rewriting the daemon message; first chunk still clears it via the chunk reducer', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const promptAt = 1_700_000_000_000;
    // `agent:stream:status` (PROTOCOL §6.5 / §7 pre-first-token family)
    // arrives before any chunk with the daemon-authoritative phase and message.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'prompt',
        message: 'Daemon prompt is ready',
        level: 'info',
        timestamp: promptAt,
      }),
    );

    let events = readStatusEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: 'prompt',
      message: 'Daemon prompt is ready',
      level: 'info',
      timestamp: promptAt,
    });

    // Subsequent phase appends with every daemon-authored field intact.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'session-load',
        message: 'Loading the saved daemon session',
        level: 'warn',
        timestamp: promptAt + 5,
      }),
    );
    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message, level: e.level }))).toEqual([
      { phase: 'prompt', message: 'Daemon prompt is ready', level: 'info' },
      { phase: 'session-load', message: 'Loading the saved daemon session', level: 'warn' },
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

    // First `agent:stream:chunk` appends the chunk reducer's "Streaming
    // response…" entry after the startup hints — the bridge itself does NOT
    // clear anything on the way in (mirrors the existing tool-call bridge
    // path). The terminal reducer paths below own the clear.
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Hi',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: 'prompt', message: 'Daemon prompt is ready' },
      { phase: 'session-load', message: 'Loading the saved daemon session' },
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

  it('agent:stream:status preserves all usable messages and drops events without one', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const at = 1_700_000_000_000;

    // A phase without a daemon message has nothing to render and is dropped.
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
    expect(events).toHaveLength(0);

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

    // Info-level launch also keeps dynamic daemon progress text.
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
      message: 'Still downloading model\u2026',
    });

    const countBefore = readStatusEvents().length;

    // Unknown phases keep their daemon message too.
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

  it('agent:stream:status carries silentMs through on stalled events and omits it elsewhere', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const at = 1_700_000_000_000;

    // `stalled` (monorepo#3402) carries the additive `silentMs` — the silence
    // already measured at emission — so the UI can anchor its live counter at
    // `timestamp - silentMs` instead of starting at 1s.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'stalled',
        message: 'No model activity for 90s',
        level: 'warn',
        silentMs: 90_000,
        timestamp: at,
      }),
    );
    let events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({
      phase: 'stalled',
      level: 'warn',
      timestamp: at,
      silentMs: 90_000,
    });

    // A non-numeric silentMs is dropped rather than stored.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'stalled',
        message: 'No model activity for 90s',
        level: 'warn',
        silentMs: 'not-a-number',
        timestamp: at + 1,
      }),
    );
    events = readStatusEvents();
    expect(events[events.length - 1].silentMs).toBeUndefined();

    // Events without the field (resumed, startup phases) carry no silentMs.
    handler(
      notification('agent:stream:status', {
        agentId: AGENT,
        workspaceId: WS,
        phase: 'resumed',
        message: 'Model activity resumed',
        level: 'info',
        timestamp: at + 2,
      }),
    );
    events = readStatusEvents();
    expect(events[events.length - 1]).toMatchObject({ phase: 'resumed' });
    expect(events[events.length - 1].silentMs).toBeUndefined();
  });

  it('agent:stream:status preserves the daemon message for every canonical startup phase', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const at = 1_700_000_000_000;

    const phaseExpectations: Array<{ phase: string; message: string }> = [
      { phase: 'launch', message: 'Daemon launch progress' },
      { phase: 'init', message: 'Daemon protocol progress' },
      { phase: 'session-create', message: 'Daemon session creation progress' },
      { phase: 'session-load', message: 'Daemon session load progress' },
      { phase: 'prompt', message: 'Daemon prompt progress' },
    ];

    phaseExpectations.forEach(({ phase, message }, i) => {
      handler(
        notification('agent:stream:status', {
          agentId: AGENT,
          workspaceId: WS,
          phase,
          message,
          level: 'info',
          timestamp: at + i,
        }),
      );
    });

    let events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual(phaseExpectations);

    // The streaming state (first chunk) is also a catalog string, appended by
    // the chunk reducer — completing the full pre-first-token → streaming set.
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Hi',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
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
// chatSendStarted) and prime the accumulator under the wake turn's messageId.
// Prompt (user-initiated) turns never emit this event.
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

  it('opens the busy/Thinking state on an idle session WITHOUT adding a user message row', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    streamStart(handler);

    // Busy state opens exactly like a user-initiated turn…
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
    const session = readSession();
    expect(session?.isStreaming).toBe(true);
    expect(session?.isProcessing).toBe(true);

    // …but with NO phantom/optimistic user row above it.
    const userMessages = (session?.messages ?? []).filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(0);

    // The in-flight assistant placeholder exists under the wake messageId.
    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(WAKE_MESSAGE_ID);
    expect(assistantMessages[0].isStreaming).toBe(true);
  });

  it('grows the wake turn live on subsequent chunks and finalizes on stream:end + idle', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamStart(handler);
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Waking up: ',
        messageId: WAKE_MESSAGE_ID,
        blockIndex: 0,
        blockId: `${WAKE_MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'child finished.',
        messageId: WAKE_MESSAGE_ID,
        blockIndex: 0,
        blockId: `${WAKE_MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );

    let assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(WAKE_MESSAGE_ID);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'Waking up: child finished.',
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: WAKE_MESSAGE_ID,
      }),
    );
    handler(
      notification('agent:idle', {
        agentId: AGENT,
        status: 'idle',
        isActive: false,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        reason: 'stream_complete',
        finishReason: 'stop',
      }),
    );

    assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it('an interrupted wake turn honors agent.stop: stream:end(stopReason=interrupted) stamps the Stopped indicator', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamStart(handler);
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Partial wake…',
        messageId: WAKE_MESSAGE_ID,
        blockIndex: 0,
        blockId: `${WAKE_MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        messageId: WAKE_MESSAGE_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'Partial wake…',
    });
    expect(assistantMessages[0].metadata).toMatchObject({
      interrupted: true,
      stopReason: 'interrupted',
    });
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false })).toBe(
      true,
    );
  });

  it('finalizes a stale prior-turn accumulator (old message stops streaming) and primes a fresh slot under the wake messageId', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // A previous turn left chunks in the accumulator (no stream:end arrived).
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'old turn',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );

    streamStart(handler);
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'fresh wake',
        messageId: WAKE_MESSAGE_ID,
        blockIndex: 0,
        blockId: `${WAKE_MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );

    const wakeMessage = readAssistantMessages().find((m) => m.id === WAKE_MESSAGE_ID);
    expect(wakeMessage).toBeDefined();
    expect(wakeMessage!.contentBlocks?.[0]).toMatchObject({ type: 'text', text: 'fresh wake' });

    // The stale prior-turn message is finalized as-is (mirrors stream:end's
    // different-turn path) instead of staying isStreaming until reconcile.
    const oldMessage = readAssistantMessages().find((m) => m.id === MESSAGE_ID);
    expect(oldMessage).toBeDefined();
    expect(oldMessage!.isStreaming).toBe(false);
    expect(oldMessage!.streamingComplete).toBe(true);
    expect(oldMessage!.contentBlocks?.[0]).toMatchObject({ type: 'text', text: 'old turn' });
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
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Waking…',
        messageId: WAKE_MESSAGE_ID,
        blockIndex: 0,
        blockId: `${WAKE_MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    const statusEventsBefore = readStatusEvents();
    expect(statusEventsBefore.length).toBeGreaterThan(0);

    // At-least-once delivery (e.g. across a reconnect) replays the start event.
    streamStart(handler);

    // Busy state stays open, streamed content survives, and the mid-turn
    // status/timer state is NOT wiped by a second chatSendStarted.
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
    expect(readStatusEvents()).toEqual(statusEventsBefore);
    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(WAKE_MESSAGE_ID);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'Waking…',
    });
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

// Restore of the pre-Themis `agent:stream:activity` handling (monorepo#1708):
// the content-free liveness ping (PROTOCOL §7) push-applies the server-derived
// live-preview fields onto the agent-session slice and feeds the chat-state
// bookkeeping — independent of the (unused today) chunk-accumulator paths
// above.
describe('daemonEventsBridge (agent:stream:activity — push-applied live preview)', () => {
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

  function readAgentSessionField<K extends keyof AgentSession>(field: K): AgentSession[K] {
    return readSession()?.[field];
  }

  it('push-applies lastAgentResponse/digest and flips receivedFirstChunk on a text-bearing ping', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'streamed so far',
        digest: 'Working on it',
      }),
    );

    expect(readAgentSessionField('lastAgentResponse')).toBe('streamed so far');
    expect(readAgentSessionField('digest')).toBe('Working on it');
    const state = appStore.state as {
      chatState?: { byAgentId: Record<string, { receivedFirstChunk: boolean }> };
    };
    expect(state.chatState?.byAgentId[AGENT]?.receivedFirstChunk).toBe(true);
  });

  it('applies the tool-arm lastToolUse without flipping receivedFirstChunk (no response text)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastToolUse: { name: 'read_file', status: 'started' },
      }),
    );

    expect(readAgentSessionField('lastToolUse')).toEqual({ name: 'read_file', status: 'started' });
    const state = appStore.state as {
      chatState?: { byAgentId: Record<string, { receivedFirstChunk: boolean }> };
    };
    expect(state.chatState?.byAgentId[AGENT]?.receivedFirstChunk).toBe(false);
  });

  it('clears the previous turn digest/lastToolUse on a fresh messageId (monorepo#1327)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        digest: 'Turn one summary',
        lastToolUse: { name: 'read_file' },
      }),
    );
    expect(readAgentSessionField('digest')).toBe('Turn one summary');
    expect(readAgentSessionField('lastToolUse')).toEqual({ name: 'read_file' });

    // New turn, fresh messageId: stale digest/lastToolUse must be dropped
    // before this ping's own (absent) fields apply.
    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: 'msg_assistant_2',
      }),
    );

    expect(readAgentSessionField('digest')).toBeUndefined();
    expect(readAgentSessionField('lastToolUse')).toBeUndefined();
  });

  it('applies the terminal lastAgentResponse/digest and clears lastToolUse on agent:stream:end', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastToolUse: { name: 'read_file' },
      }),
    );
    expect(readAgentSessionField('lastToolUse')).toEqual({ name: 'read_file' });

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'final answer',
        digest: 'Done',
      }),
    );

    expect(readAgentSessionField('lastAgentResponse')).toBe('final answer');
    expect(readAgentSessionField('digest')).toBe('Done');
    expect(readAgentSessionField('lastToolUse')).toBeUndefined();
  });

  it('hydrates a session unknown to the agent-session slice instead of dropping the ping', async () => {
    appStore.dispatch(clearAllSessions());
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'text for an unhydrated agent',
      }),
    );

    expect(ensureAgentSessionSpy).toHaveBeenCalledWith(AGENT);
  });

  it('ignores malformed agent:stream:activity payloads (missing/empty agentId or messageId)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:stream:activity', { messageId: MESSAGE_ID, digest: 'x' }));
    handler(notification('agent:stream:activity', { agentId: AGENT, digest: 'x' }));
    handler(
      notification('agent:stream:activity', { agentId: '', messageId: MESSAGE_ID, digest: 'x' }),
    );
    handler(notification('agent:stream:activity', { agentId: AGENT, messageId: '', digest: 'x' }));

    expect(readAgentSessionField('digest')).toBeUndefined();
  });

  // Regression: `ensureAgentSession` hydration is async, so a ping for an
  // agent unknown to the store must not silently drop its preview fields —
  // they should apply once hydration settles instead of only firing the
  // fetch-and-forget.
  it('applies the push-applied preview fields once ensureAgentSession hydrates an unknown session', async () => {
    appStore.dispatch(clearAllSessions());
    await primeBridge();
    const handler = capturedHandlers[0]!;

    ensureAgentSessionSpy.mockImplementationOnce(async () => {
      appStore.dispatch(
        bulkUpsertSessions([
          {
            id: AGENT,
            backendSessionId: 'backend-1',
            workspaceId: WS,
            name: 'A',
            status: AgentStatus.Active,
            messages: [],
            isStreaming: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          } as AgentSession,
        ]),
      );
    });

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'text for an unhydrated agent',
        digest: 'Hydrated preview',
      }),
    );
    await flush();

    expect(ensureAgentSessionSpy).toHaveBeenCalledWith(AGENT);
    expect(readAgentSessionField('lastAgentResponse')).toBe('text for an unhydrated agent');
    expect(readAgentSessionField('digest')).toBe('Hydrated preview');
  });

  // Regression: previewTurnMessageIdByAgent was only stamped by activity
  // pings, so a same-turn activity ping delivered out-of-order AFTER the
  // terminal stream:end looked like a new turn (no tracked messageId change
  // recorded by stream:end) and wiped the just-applied terminal digest.
  it('a same-turn activity straggler delivered after stream:end does not wipe the terminal digest', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastAgentResponse: 'final answer',
        digest: 'Final summary',
      }),
    );
    expect(readAgentSessionField('digest')).toBe('Final summary');

    // Same turn's own activity ping, delivered late (no digest of its own —
    // a mid-turn ping snapshot from before the turn's own completion).
    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
      }),
    );

    expect(readAgentSessionField('digest')).toBe('Final summary');
  });

  // Regression: a delayed/out-of-order stream:end for an EARLIER turn than
  // the one already tracked (a newer turn has already started streaming)
  // must not clobber the newer turn's live preview.
  it('an out-of-order stream:end for a stale earlier turn does not clobber a newer turn preview', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const OLDER_MESSAGE_ID = 'm-1000';
    const NEWER_MESSAGE_ID = 'm-2000';

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: OLDER_MESSAGE_ID,
        digest: 'Turn A digest',
      }),
    );
    expect(readAgentSessionField('digest')).toBe('Turn A digest');

    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: NEWER_MESSAGE_ID,
        digest: 'Turn B digest',
      }),
    );
    expect(readAgentSessionField('digest')).toBe('Turn B digest');

    // Turn A's terminal event arrives late, after turn B has already started.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        messageId: OLDER_MESSAGE_ID,
        digest: 'Turn A final (stale)',
      }),
    );

    expect(readAgentSessionField('digest')).toBe('Turn B digest');
  });

  function readLiveTurnFields(): {
    liveTurnOpen?: boolean;
    liveTurnOpenedAt?: string;
    updatedAt?: string;
  } {
    const session = readSession() as
      (AgentSession & { liveTurnOpen?: boolean; liveTurnOpenedAt?: string }) | undefined;
    return {
      liveTurnOpen: session?.liveTurnOpen,
      liveTurnOpenedAt: session?.liveTurnOpenedAt,
      updatedAt: session?.updatedAt as string | undefined,
    };
  }

  // The ping is self-sufficient evidence of a live turn: a delegated agent
  // whose running `agent:status-changed` edge predates hydration (or was
  // missed) must still read as live while pings stream in, so the footer
  // preview animates without an `agent.get` refetch.
  it('an activity ping opens the sticky liveTurnOpen bit on a non-live session (updatedAt untouched)', async () => {
    appStore.dispatch(clearAllSessions());
    seedSession({ status: AgentStatus.RuntimeIdle, isStreaming: false });
    await primeBridge();
    const handler = capturedHandlers[0]!;
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    handler(notification('agent:stream:activity', { agentId: AGENT, messageId: MESSAGE_ID }));

    const fields = readLiveTurnFields();
    expect(fields.liveTurnOpen).toBe(true);
    // Stamped from the event envelope's own daemon timestamp.
    expect(fields.liveTurnOpenedAt).toBe('2026-01-02T00:00:00.000Z');
    // updatedAt is daemon-owned and per-turn (STAB-19) — the ping must not
    // synthesize or advance it.
    expect(fields.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
  });

  it('agent:idle still closes the bit, and a straggler same-turn ping cannot re-open it', async () => {
    appStore.dispatch(clearAllSessions());
    seedSession({ status: AgentStatus.RuntimeIdle, isStreaming: false });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:stream:activity', { agentId: AGENT, messageId: MESSAGE_ID }));
    expect(readLiveTurnFields().liveTurnOpen).toBe(true);

    // Terminal choreography: stream:end then the canonical idle fold.
    handler(notification('agent:stream:end', { agentId: AGENT, messageId: MESSAGE_ID }));
    handler(notification('agent:idle', { agentId: AGENT, status: 'idle', isActive: false }));
    expect(readLiveTurnFields().liveTurnOpen).toBe(false);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    // A same-turn activity straggler delivered after the terminal event must
    // not resurrect the liveness bit the choreography just closed — even when
    // it carries a lastToolUse.status "running" hint, which
    // isAgentRunningState would otherwise read as active evidence.
    handler(
      notification('agent:stream:activity', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        lastToolUse: { name: 'shell', status: 'running' },
      }),
    );
    expect(readLiveTurnFields().liveTurnOpen).toBe(false);
    expect(readAgentSessionField('lastToolUse')).toBeUndefined();
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    // A genuinely NEW turn's ping re-opens it.
    handler(
      notification('agent:stream:activity', { agentId: AGENT, messageId: 'msg_assistant_2' }),
    );
    expect(readLiveTurnFields().liveTurnOpen).toBe(true);
  });

  // Interleaving hardening: the arrival-time straggler check passes for a
  // mid-turn ping, but `withHydratedSession` defers the dispatch across the
  // async hydration fetch — if the turn's terminal `agent:stream:end` lands
  // (stamping the ended-turn map synchronously) before hydration resolves,
  // the deferred callback must re-check at execution time rather than
  // re-open the liveness the terminal fold just closed.
  it('a ping deferred across hydration does not re-open liveness once the turn ended mid-flight', async () => {
    appStore.dispatch(clearAllSessions());
    await primeBridge();
    const handler = capturedHandlers[0]!;

    let resolveHydration!: () => void;
    ensureAgentSessionSpy.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveHydration = resolve;
      });
      appStore.dispatch(
        bulkUpsertSessions([
          {
            id: AGENT,
            backendSessionId: 'backend-1',
            workspaceId: WS,
            name: 'A',
            status: AgentStatus.RuntimeIdle,
            messages: [],
            isStreaming: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          } as AgentSession,
        ]),
      );
    });

    // Mid-turn ping for an unknown session: arrival-time guard passes, the
    // dispatch is parked behind the hydration fetch.
    handler(notification('agent:stream:activity', { agentId: AGENT, messageId: MESSAGE_ID }));
    // The turn ends while hydration is still in flight (the map stamp in
    // handleStreamEndEvent is synchronous).
    handler(notification('agent:stream:end', { agentId: AGENT, messageId: MESSAGE_ID }));

    resolveHydration();
    await flush();

    expect(readLiveTurnFields().liveTurnOpen).not.toBe(true);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });
});

// Regression (intentd#336): a user interrupt (agent.stop, or agent.sendMessage
// with priority:interrupt) mid-stream must NOT erase the streamed-so-far
// deltas. The daemon persists the partial turn as an interrupted assistant row
// (`metadata.interrupted: true` + `metadata.stopReason: "interrupted"`) and
// emits the terminal `agent:stream:end` + `agent:idle { reason: "interrupted" }`
// pair from `interrupt_inner`. The FE must keep the partial content visible
// through that terminal choreography and, once the persisted row reconciles in,
// render the Stopped indicator (`shouldShowStoppedIndicator`).
describe('daemonEventsBridge (interrupt regression — interrupted deltas stay visible + Stopped indicator)', () => {
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

  /** Stream two text chunks + a completed tool call into the bridge. */
  function streamPartialTurn(handler: (n: { method: string; params?: unknown }) => void): void {
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Partial ',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        toolName: 'Read',
        toolKind: 'file',
        toolCallId: 't-int',
        input: { path: 'src/lib.rs' },
        status: 'completed',
        output: 'ok',
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'answer',
        messageId: MESSAGE_ID,
        blockIndex: 2,
        blockId: `${MESSAGE_ID}:2`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
  }

  const expectPartialBlocksIntact = (message: AgentMessage | undefined): void => {
    expect(message).toBeDefined();
    const blocks = message!.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_result', 'text']);
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'Partial ' });
    expect(blocks[3]).toMatchObject({ type: 'text', text: 'answer' });
  };

  it('user stop mid-stream: terminal stream:end + idle(reason=interrupted) finalize in place — streamed deltas stay visible', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamPartialTurn(handler);
    expectPartialBlocksIntact(readAssistantMessages()[0]);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    // The Stop button path (`dispatchStopChat` in chat-send-service.ts)
    // dispatches `chatStopInitiated` before calling `agent.stop` — the local
    // stop dispatch must NOT remove the in-flight partial message.
    appStore.dispatch(chatStopInitiated(AGENT));
    expectPartialBlocksIntact(readAssistantMessages()[0]);

    // `interrupt_inner` emits the single terminal `agent:stream:end` (the
    // aborted worker no longer reaches its own emit) — now carrying
    // `stopReason: "interrupted"` + `interruptReason` (§7.2) + the turn's
    // `messageId` — followed by the STAB-28 `agent:idle { reason: "interrupted" }`.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        interruptReason: 'user_stop',
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
    // either. It resets chat-state flags and session runtime flags
    // (`isStreaming`/`isProcessing`/`isResponding`) but never touches
    // session messages, so the response racing ahead of the event pushes
    // is equally safe for the streamed blocks.
    appStore.dispatch(chatStopCompleted(AGENT));

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expectPartialBlocksIntact(assistantMessages[0]);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);

    // The wire `stopReason: "interrupted"` + `interruptReason` apply the
    // interrupted metadata at stream:end time — exactly what the daemon
    // persists on the row (§7.2; no `interruptedBy` on a plain user stop) —
    // so the Stopped indicator renders LIVE, no rehydrate needed.
    expect(assistantMessages[0].metadata).toEqual({
      interrupted: true,
      stopReason: 'interrupted',
      interruptReason: 'user_stop',
    });
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false })).toBe(
      true,
    );
    expect(resolveStoppedIndicatorLabel(assistantMessages[0])).toEqual({ kind: 'stopped' });
  });

  it('user preemption mid-stream (§7.2 preempted_by_message + interruptedBy user): the live metadata mirrors the persisted row', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamPartialTurn(handler);
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
        interruptedBy: { kind: 'user' },
        messageId: MESSAGE_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expectPartialBlocksIntact(assistantMessages[0]);
    expect(assistantMessages[0].metadata).toEqual({
      interrupted: true,
      stopReason: 'interrupted',
      interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'user' },
    });
    expect(resolveStoppedIndicatorLabel(assistantMessages[0])).toEqual({
      kind: 'preempted-by-message',
    });
  });

  it('agent preemption mid-stream (§7.2 interruptedBy agent): the reason-specific label resolves LIVE without a reload', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamPartialTurn(handler);
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
        interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
        messageId: MESSAGE_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expectPartialBlocksIntact(assistantMessages[0]);
    expect(assistantMessages[0].metadata).toEqual({
      interrupted: true,
      stopReason: 'interrupted',
      interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
    });
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false })).toBe(
      true,
    );
    expect(resolveStoppedIndicatorLabel(assistantMessages[0])).toEqual({
      kind: 'preempted-by-agent',
      name: 'Child',
    });
  });

  it('normal agent:stream:end (no stopReason) finalizes WITHOUT interrupted metadata — no Stopped indicator', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamPartialTurn(handler);
    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expectPartialBlocksIntact(assistantMessages[0]);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);
    expect(assistantMessages[0].metadata?.interrupted).toBeUndefined();
    expect(assistantMessages[0].metadata?.interruptReason).toBeUndefined();
    expect(assistantMessages[0].metadata?.interruptedBy).toBeUndefined();
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false })).toBe(
      false,
    );
  });

  it.each([
    ['unknown kind', { kind: 'system' }],
    ['non-string agentId', { kind: 'agent', agentId: 42, name: 'Child' }],
    ['non-string name', { kind: 'agent', agentId: 'agent-child', name: { first: 'Child' } }],
    ['non-object value', 'agent-child'],
  ])(
    'malformed interruptedBy (%s) is dropped whole — interruptReason still lands, no partial attribution',
    async (_label, interruptedBy) => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      streamPartialTurn(handler);
      handler(
        notification('agent:stream:end', {
          agentId: AGENT,
          streamId: STREAM_ID,
          stopReason: 'interrupted',
          interruptReason: 'preempted_by_message',
          interruptedBy,
          messageId: MESSAGE_ID,
        }),
      );

      const assistantMessages = readAssistantMessages();
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].metadata).toEqual({
        interrupted: true,
        stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
      });
      expect(
        shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false }),
      ).toBe(true);
    },
  );

  it('thinking-only turn stopped: interrupted metadata lands and the Stopped indicator shows despite no visible content', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Only a thinking block streamed before the stop.
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: { type: 'thinking', id: `${MESSAGE_ID}:0`, thinking: 'planning…' },
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'thinking',
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        messageId: MESSAGE_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.map((b) => b.type)).toEqual(['thinking']);
    expect(assistantMessages[0].metadata).toMatchObject({
      interrupted: true,
      stopReason: 'interrupted',
    });
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false })).toBe(
      true,
    );
  });

  it('pre-first-token stop: interrupted stream:end with messageId and NO local stream state creates the empty interrupted placeholder', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Nothing streamed — the daemon persisted a synthetic empty interrupted
    // row under the turn's minted messageId and emits the terminal stream:end
    // with stopReason + messageId. The bridge must NOT early-return here.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        interruptReason: 'user_stop',
        messageId: MESSAGE_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].contentBlocks).toEqual([]);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);
    expect(assistantMessages[0].metadata).toEqual({
      interrupted: true,
      stopReason: 'interrupted',
      interruptReason: 'user_stop',
    });
    expect(shouldShowStoppedIndicator({ message: assistantMessages[0], isStreaming: false })).toBe(
      true,
    );
  });

  it('pre-first-token agent preemption (§7.2): the empty placeholder carries interruptReason + interruptedBy so the reason-specific label resolves live', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
        interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
        messageId: MESSAGE_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].contentBlocks).toEqual([]);
    expect(assistantMessages[0].metadata).toEqual({
      interrupted: true,
      stopReason: 'interrupted',
      interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
    });
    expect(resolveStoppedIndicatorLabel(assistantMessages[0])).toEqual({
      kind: 'preempted-by-agent',
      name: 'Child',
    });
  });

  it('normal agent:stream:end with NO local stream state stays a no-op (no phantom placeholder)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
      }),
    );

    expect(readAssistantMessages()).toHaveLength(0);
    const terminalTelemetry = reportStreamLifecycleSpy.mock.calls
      .map(([diagnostic]) => diagnostic)
      .filter((diagnostic) => diagnostic.event.startsWith('agent-stream-end'));
    expect(terminalTelemetry).toEqual([
      expect.objectContaining({
        event: 'agent-stream-end-received',
        callbackResult: 'received',
      }),
      expect.objectContaining({
        event: 'agent-stream-end-ignored',
        callbackResult: 'ignored',
      }),
    ]);
  });

  it('persisted interrupted row reconciles in: blocks stay intact and the Stopped indicator shows', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamPartialTurn(handler);
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

  it('interrupt-send (priority:interrupt): the next turn streams under a NEW message id without erasing the interrupted partial', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Turn 1 streams, then the daemon preempts it (agent.sendMessage with
    // priority:interrupt): terminal stream:end arrives; agent:idle is
    // SUPPRESSED on the interrupt-with-message path (suppress_idle_emit).
    streamPartialTurn(handler);
    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));

    // Turn 2 streams under the daemon's next minted message id.
    const nextMessageId = 'msg_assistant_2';
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'New turn',
        messageId: nextMessageId,
        blockIndex: 0,
        blockId: `${nextMessageId}:0`,
        blockType: 'text',
        streamId: 'stream_2',
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages.map((m) => m.id)).toEqual([MESSAGE_ID, nextMessageId]);
    expectPartialBlocksIntact(assistantMessages[0]);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[1].isStreaming).toBe(true);
    expect(assistantMessages[1].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'New turn',
    });
  });
});

// Abnormal turn endings (PROTOCOL §7.3): the terminal `agent:stream:end`
// carries `finishReason` when the turn completed with a non-`end_turn` ACP
// stop reason (`refusal` | `max_tokens` | `max_turn_requests`), and the daemon
// persists the same value as `metadata.finishReason` on the assistant row
// (empty marker row on zero-output turns). The bridge must stamp the metadata
// live so the notice renders without a reconcile, and rehydrated rows must
// resolve the same notice.
describe('daemonEventsBridge (abnormal finishReason on agent:stream:end)', () => {
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

  function streamTextChunk(handler: (n: { method: string; params?: unknown }) => void): void {
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Partial answer',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
  }

  it.each(['refusal', 'max_tokens', 'max_turn_requests'] as const)(
    'stream:end with finishReason=%s stamps metadata.finishReason on the streamed turn — the notice resolves LIVE',
    async (finishReason) => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      streamTextChunk(handler);
      handler(
        notification('agent:stream:end', {
          agentId: AGENT,
          streamId: STREAM_ID,
          messageId: MESSAGE_ID,
          finishReason,
        }),
      );

      const assistantMessages = readAssistantMessages();
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
        type: 'text',
        text: 'Partial answer',
      });
      expect(assistantMessages[0].isStreaming).toBe(false);
      expect(assistantMessages[0].streamingComplete).toBe(true);
      expect(assistantMessages[0].metadata).toMatchObject({ finishReason });
      // Abnormal finish is NOT an interruption — no Stopped indicator.
      expect(assistantMessages[0].metadata?.interrupted).toBeUndefined();
      expect(resolveFinishReasonNotice(assistantMessages[0])).toBeDefined();
    },
  );

  it('zero-output abnormal turn: finishReason stream:end with messageId and NO local stream state creates the empty marker row', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Nothing streamed — the daemon persisted an empty marker row under the
    // turn's minted messageId with metadata.finishReason and emits the
    // terminal stream:end. The bridge must NOT early-return here.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        finishReason: 'refusal',
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].contentBlocks).toEqual([]);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);
    expect(assistantMessages[0].metadata).toMatchObject({ finishReason: 'refusal' });
    expect(resolveFinishReasonNotice(assistantMessages[0])).toEqual({ kind: 'refusal' });
  });

  it('normal stream:end (no finishReason) finalizes WITHOUT finishReason metadata — no notice', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    streamTextChunk(handler);
    handler(notification('agent:stream:end', { agentId: AGENT, streamId: STREAM_ID }));

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].metadata?.finishReason).toBeUndefined();
    expect(resolveFinishReasonNotice(assistantMessages[0])).toBeUndefined();
  });

  it('persisted finishReason row reconciles in after reload: the notice resolves from row metadata', async () => {
    await primeBridge();

    // Simulate the chat-read-service hydration reconcile: agents.getConversation
    // returns the persisted row with metadata.finishReason (PROTOCOL §7.3) and
    // bulkUpsertSessions upserts it — no live stream events at all.
    const session = readSession();
    expect(session).toBeDefined();
    const persistedRow = {
      id: MESSAGE_ID,
      role: 'assistant',
      timestamp: '2026-01-02T00:00:01.000Z',
      contentBlocks: [{ type: 'text', id: `${MESSAGE_ID}:0`, text: 'Partial answer' }],
      metadata: { finishReason: 'max_tokens' },
    } as unknown as AgentMessage;
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...session!,
          isStreaming: false,
          status: AgentStatus.Idle,
          messages: [persistedRow],
        },
      ]),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].metadata).toMatchObject({ finishReason: 'max_tokens' });
    expect(resolveFinishReasonNotice(assistantMessages[0])).toEqual({ kind: 'max-tokens' });
  });
});

describe('daemonEventsBridge (Agent Q&A live delivery — trailingBlocks on agent:stream:end)', () => {
  const QUESTION: Question = {
    attachmentId: 'tar-aaa111bbb222',
    header: 'Auth method',
    question: 'Which authentication method should the new endpoint use?',
    options: [
      { label: 'OAuth', description: 'Standard OAuth 2.0 flow' },
      { label: 'API key', description: 'Static key in header' },
    ],
    multiSelect: false,
  };

  /** Question resource block exactly as the daemon persists/emits it (§7.1). */
  function questionBlock(q: Question = QUESTION): Record<string, unknown> {
    return {
      type: 'resource',
      resource: {
        uri: `intent-question://${q.attachmentId}`,
        name: q.header,
        mimeType: QUESTION_RESOURCE_MIME_TYPE,
        text: JSON.stringify(q),
      },
    };
  }

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

  it('appends trailingBlocks to the streamed turn on stream:end and the wizard derivation goes live (no refetch)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Before I proceed:',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        trailingBlocks: [questionBlock()],
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].contentBlocks?.map((b) => b.type)).toEqual(['text', 'resource']);

    // The wizard derivation reads the finalized transcript directly — the
    // questions pend LIVE off the stream:end delivery, no reconcile needed.
    const pending = derivePendingQuestions(readSession()?.messages ?? [], false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe(MESSAGE_ID);
    expect(pending!.questions.map((q) => q.header)).toEqual(['Auth method']);
  });

  it('pre-first-token question turn: trailingBlocks with NO local stream state finalize a question-only placeholder', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // A turn whose ONLY content is questions: no chunk/tool events ever fire,
    // so the accumulator is empty when the terminal stream:end lands.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        trailingBlocks: [questionBlock()],
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);
    expect(assistantMessages[0].contentBlocks?.map((b) => b.type)).toEqual(['resource']);

    const pending = derivePendingQuestions(readSession()?.messages ?? [], false);
    expect(pending).not.toBeNull();
    expect(pending!.questions).toHaveLength(1);
  });

  it('is idempotent against a later reconcile delivering the same canonical blocks (no duplicates)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Question:',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        trailingBlocks: [questionBlock()],
      }),
    );

    // Simulate the chat-read-service hydration reconcile: the persisted row
    // carries the SAME canonical trailing block under the SAME message id.
    // The live-finalized assistant row is KEPT in the incoming list so this
    // exercises the upsert-path dedupe (same-id collapse), not a constructed
    // end state.
    const session = readSession()!;
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...session,
          isStreaming: false,
          status: AgentStatus.Idle,
          messages: [
            ...(session.messages ?? []),
            {
              id: MESSAGE_ID,
              role: 'assistant',
              timestamp: '2026-01-02T00:00:01.000Z',
              contentBlocks: [
                { type: 'text', id: `${MESSAGE_ID}:0`, text: 'Question:' },
                questionBlock(),
              ],
            } as unknown as AgentMessage,
          ],
        },
      ]),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.map((b) => b.type)).toEqual(['text', 'resource']);

    const pending = derivePendingQuestions(readSession()?.messages ?? [], false);
    expect(pending).not.toBeNull();
    // dedupeResourceBlocks in the derivation collapses any residual duplicate
    // by the stamped nonce — exactly one question pends.
    expect(pending!.questions).toHaveLength(1);
  });

  it('duplicate trailingBlocks entries for the same canonical nonce collapse to one block', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        trailingBlocks: [questionBlock(), questionBlock()],
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.map((b) => b.type)).toEqual(['resource']);
  });

  it('messageId-mismatch stream:end: the stale accumulated turn finalizes WITHOUT the stopReason — only the event messageId gets the interrupted metadata', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const OTHER_MESSAGE_ID = 'msg_assistant_2';

    // Accumulator holds turn A (chunks under MESSAGE_ID)…
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Turn A text',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );
    // …but the terminal stream:end targets a DIFFERENT turn B with an
    // interrupt stopReason + §7.2 attribution. Turn A must finalize clean;
    // turn B's placeholder carries the full interrupted metadata.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: 'stream_2',
        stopReason: 'interrupted',
        interruptReason: 'preempted_by_message',
        interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
        messageId: OTHER_MESSAGE_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages.map((m) => m.id)).toEqual([MESSAGE_ID, OTHER_MESSAGE_ID]);
    const [turnA, turnB] = assistantMessages;
    expect(turnA.metadata?.interrupted).toBeUndefined();
    expect(turnA.metadata?.interruptReason).toBeUndefined();
    expect(turnA.metadata?.interruptedBy).toBeUndefined();
    expect(shouldShowStoppedIndicator({ message: turnA, isStreaming: false })).toBe(false);
    expect(turnB.metadata).toEqual({
      interrupted: true,
      stopReason: 'interrupted',
      interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'agent', agentId: 'agent-child', name: 'Child' },
    });
    expect(shouldShowStoppedIndicator({ message: turnB, isStreaming: false })).toBe(true);
  });

  it('normal stream:end without trailingBlocks and no local stream state stays a no-op', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
      }),
    );

    expect(readAssistantMessages()).toHaveLength(0);
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
    Object.defineProperty(appStore, 'dispatch', inheritedPropertyDescriptor(appStore, 'dispatch'));
  });

  /** Track dispatches — the action is a stub with no reducer case yet. */
  function wrapDispatch() {
    const originalGetter = inheritedPropertyDescriptor(appStore, 'dispatch').get!;
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
      expect.objectContaining({
        payload: [AGENT, 'boom', 'turn-failed-1', { turnIdCorrelation: '12c09885d6571b4e' }],
      }),
    ]);
  });

  it('chatSendFailed carries turnId undefined when agent:failed omits it (older daemons)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    wrapDispatch();

    handler(notification('agent:failed', { agentId: AGENT, error: 'boom', status: 'error' }));

    const failedCalls = dispatchCalls.filter((a) => a.type === 'chatState/sendFailed');
    expect(failedCalls).toEqual([
      expect.objectContaining({ payload: [AGENT, 'boom', undefined, undefined] }),
    ]);
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

  it('applies a chunk exactly once when the daemon fans the same chunk out across N subscriptions on the socket', async () => {
    // Mock backendRequest resolves events.subscribe with `{ subscriptionId: "sub-1" }`
    // (top-of-file vi.mock factory). That id is the bridge's own subscription.
    // The daemon emits ONE `events.event` notification per matching subscription
    // on the socket (PROTOCOL §6.3 / intent-transport `build_event_notification`),
    // each carrying that subscription's id. If another live-* client subscribes
    // to an overlapping `agent:*` filter, the chunk is delivered three times to
    // the socket-level notification handler — once tagged "sub-1" (ours), once
    // "sub-foreign-a", once "sub-foreign-b". Without the scope gate the bridge
    // would `priorText + content` three times and echo as "TodayTodayToday" —
    // the symptom this fix targets.
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const data = {
      agentId: AGENT,
      content: 'Today',
      messageId: MESSAGE_ID,
      blockIndex: 0,
      blockId: `${MESSAGE_ID}:0`,
      blockType: 'text',
      streamId: STREAM_ID,
    };

    handler(notificationWithSub('agent:stream:chunk', data, 'sub-1'));
    handler(notificationWithSub('agent:stream:chunk', data, 'sub-foreign-a'));
    handler(notificationWithSub('agent:stream:chunk', data, 'sub-foreign-b'));

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'Today',
    });
  });

  it("drops a notification whose envelope subscriptionId does not match the bridge's own", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Foreign subscription on the same socket — another consumer's overlapping
    // `agent:*` subscribe. The bridge must NOT append text from these copies.
    handler(
      notificationWithSub(
        'agent:stream:chunk',
        {
          agentId: AGENT,
          content: 'leaked',
          messageId: MESSAGE_ID,
          blockIndex: 0,
          blockId: `${MESSAGE_ID}:0`,
          blockType: 'text',
          streamId: STREAM_ID,
        },
        'sub-foreign',
      ),
    );

    expect(readAssistantMessages()).toHaveLength(0);
  });

  it('still applies legacy/flat envelopes with no subscriptionId (back-compat)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // No `params.subscriptionId` on the envelope — older transports / tests
    // never tagged the wire copy. Must continue to apply.
    handler(
      notification('agent:stream:chunk', {
        agentId: AGENT,
        content: 'Legacy ok',
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: 'text',
        streamId: STREAM_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: 'text',
      text: 'Legacy ok',
    });
  });

  function readWorkspaceEventIds(): string[] {
    const state = appStore.state as {
      workspaceEvents: { byWorkspaceId: Record<string, { events: Array<{ id: string }> }> };
    };
    return state.workspaceEvents.byWorkspaceId[WS]?.events.map((event) => event.id) ?? [];
  }

  it('routes a file event tagged with the scoped subscription id when the gate holds a set of ids (monorepo#1853)', async () => {
    // The daemon-events-saga owns TWO subscriptions: the global firehose and
    // the active-workspace-scoped `file:*` lease. A file event fans out tagged
    // with the scoped lease's id and must still reach the activity timeline
    // (`eventReceived`).
    const envelope = notificationWithSub('file:changed', { path: 'src/lib.rs' }, 'sub-file');
    routeDaemonEventsNotification(envelope.method, envelope.params, ['sub-1', 'sub-file']);

    expect(readWorkspaceEventIds()).toContain(envelope.params.event.id);
  });

  it('drops a file event tagged with a foreign subscription id (inactive-workspace copy)', async () => {
    // A copy fanned out for another consumer's subscription — e.g. file events
    // of a NON-active workspace on a foreign lease — must not reach the store.
    const envelope = notificationWithSub('file:changed', { path: 'src/lib.rs' }, 'sub-foreign');
    routeDaemonEventsNotification(envelope.method, envelope.params, ['sub-1', 'sub-file']);

    expect(readWorkspaceEventIds()).not.toContain(envelope.params.event.id);
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

describe('daemonEventsBridge (agent-locks wire contract — changes:agent-locks → agent-lock slice)', () => {
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

  it('folds the §6.5 snapshot arrays into lockedAgentIds/lockedFilePaths (gating engages)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    handler!(
      notification('changes:agent-locks', {
        workspaceId: WS,
        autoCommitEnabled: true,
        lockedAgentIds: ['agent-a', 'agent-b'],
        lockedFilePaths: ['src/a.ts', 'src/b.ts'],
      }),
    );

    // The FileChangesSection gates on `agentId in $lockedAgentIds$` — assert
    // through the same selector the component uses.
    expect(selectLockedAgentIds.select(appStore.state, WS)).toEqual({
      'agent-a': true,
      'agent-b': true,
    });
    const lockState = (appStore.state as { agentLock: { byWorkspaceId: Record<string, unknown> } })
      .agentLock.byWorkspaceId[WS];
    expect(lockState).toEqual({
      lockedAgentIds: { 'agent-a': true, 'agent-b': true },
      lockedFilePaths: { 'src/a.ts': true, 'src/b.ts': true },
    });
  });

  it('clears the snapshot on empty arrays (auto-commit off / no active agents)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    handler!(
      notification('changes:agent-locks', {
        workspaceId: WS,
        autoCommitEnabled: true,
        lockedAgentIds: ['agent-a'],
        lockedFilePaths: ['src/a.ts'],
      }),
    );
    handler!(
      notification('changes:agent-locks', {
        workspaceId: WS,
        autoCommitEnabled: false,
        lockedAgentIds: [],
        lockedFilePaths: [],
      }),
    );

    expect(selectLockedAgentIds.select(appStore.state, WS)).toEqual({});
  });

  it('prefers the payload workspaceId over the envelope id', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    // The notification helper stamps the envelope with WS; the payload names
    // a different workspace, which must win (same convention as the
    // tokenUsage/context handlers).
    handler!(
      notification('changes:agent-locks', {
        workspaceId: 'ws-locks-other',
        autoCommitEnabled: true,
        lockedAgentIds: ['agent-x'],
        lockedFilePaths: [],
      }),
    );

    expect(selectLockedAgentIds.select(appStore.state, 'ws-locks-other')).toEqual({
      'agent-x': true,
    });
  });

  it('ignores a malformed payload (missing arrays)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    handler!(
      notification('changes:agent-locks', {
        workspaceId: 'ws-locks-malformed',
        autoCommitEnabled: true,
      }),
    );

    const state = appStore.state as { agentLock: { byWorkspaceId: Record<string, unknown> } };
    expect(state.agentLock.byWorkspaceId['ws-locks-malformed']).toBeUndefined();
  });

  it('subscribes to changes:agent-locks on the firehose', () => {
    expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).toContain('changes:agent-locks');
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

  it('re-emits each status-changing git event as git:status-changed { workspaceId }', async () => {
    await primeBridge();
    const seen = listenOn('git:status-changed');

    capturedHandlers[0]!(notification('git:commit', { operation: 'commit' }));
    capturedHandlers[0]!(notification('git:pull', { operation: 'pull' }));
    capturedHandlers[0]!(notification('changes:git-status', { status: { files: [] } }));

    expect(seen).toEqual([{ workspaceId: WS }, { workspaceId: WS }, { workspaceId: WS }]);
  });

  it('re-emits changes:tracked as file-tracking:changes-updated { workspaceId }', async () => {
    await primeBridge();
    const seen = listenOn('file-tracking:changes-updated');
    const gitSeen = listenOn('git:status-changed');

    capturedHandlers[0]!(notification('changes:tracked', { workspaceId: WS, changes: [] }));

    expect(seen).toEqual([{ workspaceId: WS }]);
    expect(gitSeen).toEqual([{ workspaceId: WS }]);
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
  let scriptSequence = 0;
  let SCRIPT_ID = '';

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
    scripts: Record<
      string,
      {
        runtime: {
          status: string;
          pid?: number;
          detectedUrl?: string;
          previouslyRunning?: boolean;
        };
      }
    >;
    outputBuffers: Record<string, ScriptOutputBuffer>;
  } {
    const state = appStore.state as {
      scripts: {
        byWorkspaceId: Record<
          string,
          {
            scripts: Record<
              string,
              {
                runtime: {
                  status: string;
                  pid?: number;
                  detectedUrl?: string;
                  previouslyRunning?: boolean;
                };
              }
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
    SCRIPT_ID = `script-bridge-${++scriptSequence}`;
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
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

  it.each(['created', 'updated', 'removed'] as const)(
    'refreshes script.list after a script definition is %s',
    async (action) => {
      await primeBridge();
      const refreshScripts = await import('$store/renderer/slices/scripts/scripts-slice').then(
        (module) => module.refreshScripts,
      );
      const dispatchSpy = vi.fn();
      const dispatchGetterSpy = vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatchSpy);

      capturedHandlers[0]!(notification('script:changed', { scriptId: SCRIPT_ID, action }));

      expect(dispatchSpy).toHaveBeenCalledWith(refreshScripts(WS));
      dispatchGetterSpy.mockRestore();
    },
  );

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

  it('mirrors previouslyRunning from script:state into the runtime state', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('script:state', {
        scriptId: SCRIPT_ID,
        status: 'idle',
        restartCount: 0,
        previouslyRunning: true,
      }),
    );

    expect(readScriptsState().scripts[SCRIPT_ID].runtime.previouslyRunning).toBe(true);
  });

  it('clears a stale previouslyRunning marker when a script:state snapshot omits it', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('script:state', {
        scriptId: SCRIPT_ID,
        status: 'idle',
        restartCount: 0,
        previouslyRunning: true,
      }),
    );
    expect(readScriptsState().scripts[SCRIPT_ID].runtime.previouslyRunning).toBe(true);

    // The daemon cleared the marker (e.g. the script was started): the full
    // snapshot no longer carries the key, so the mirrored runtime drops it.
    handler(
      notification('script:state', {
        scriptId: SCRIPT_ID,
        status: 'running',
        pid: 4242,
        restartCount: 0,
      }),
    );

    expect(readScriptsState().scripts[SCRIPT_ID].runtime.previouslyRunning).toBe(false);
    expect(readScriptsState().scripts[SCRIPT_ID].runtime.status).toBe('running');
  });
});

describe('daemonEventsBridge (terminal wire contract — terminal:exit → terminals slice)', () => {
  const TERMINAL_ID = 'terminal-bridge-1';

  function readTerminalIds(): string[] {
    return selectTerminalsForWorkspace.select(appStore.state, WS).map((t) => t.id);
  }

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    disposeExitedTerminalSpy.mockClear();
    appStore.dispatch(addTerminal(WS, TERMINAL_ID));
  });

  afterEach(() => vi.clearAllMocks());

  it('removes the exited terminal from the terminals slice and releases its adapter', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    expect(readTerminalIds()).toContain(TERMINAL_ID);

    // PROTOCOL §6.5 payload: { terminalId } — the daemon's PTY exited.
    handler(notification('terminal:exit', { terminalId: TERMINAL_ID }));
    await flush();

    expect(readTerminalIds()).not.toContain(TERMINAL_ID);
    expect(disposeExitedTerminalSpy).toHaveBeenCalledWith(TERMINAL_ID);
  });

  it('ignores terminal:exit payloads without a terminalId', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('terminal:exit', {}));
    await flush();

    expect(readTerminalIds()).toContain(TERMINAL_ID);
    expect(disposeExitedTerminalSpy).not.toHaveBeenCalled();
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

describe('daemonEventsBridge (agent:attention-requested → showAgentAttentionToast, monorepo#1709)', () => {
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

  it('shows the attention toast on a valid discussion payload, preferring payload workspaceId/timestamp', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        workspaceId: 'ws-payload-1',
        agentId: AGENT,
        agentName: 'auggie',
        kind: 'discussion',
        reason: 'Need a decision on approach',
        timestamp: '2026-02-03T04:05:06.000Z',
      }),
    );
    await flush();

    expect(showAgentAttentionToastSpy).toHaveBeenCalledTimes(1);
    expect(showAgentAttentionToastSpy).toHaveBeenCalledWith({
      workspaceId: 'ws-payload-1',
      agentId: AGENT,
      agentName: 'auggie',
      kind: 'discussion',
      reason: 'Need a decision on approach',
      timestamp: '2026-02-03T04:05:06.000Z',
    });
  });

  it('shows the attention toast on a valid blocker payload', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        workspaceId: WS,
        agentId: AGENT,
        agentName: 'auggie',
        kind: 'blocker',
        reason: 'Sandbox is broken',
      }),
    );
    await flush();

    expect(showAgentAttentionToastSpy).toHaveBeenCalledTimes(1);
    expect(showAgentAttentionToastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'blocker', reason: 'Sandbox is broken' }),
    );
  });

  it('falls back to the envelope workspaceId/timestamp when the payload omits them', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        agentId: AGENT,
        agentName: 'auggie',
        kind: 'discussion',
        reason: 'Need input',
      }),
    );
    await flush();

    expect(showAgentAttentionToastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, timestamp: '2026-01-02T00:00:00.000Z' }),
    );
  });

  it.each([
    ['missing agentId', { agentName: 'auggie', kind: 'discussion', reason: 'x' }],
    ['missing agentName', { agentId: AGENT, kind: 'discussion', reason: 'x' }],
    ['invalid kind', { agentId: AGENT, agentName: 'auggie', kind: 'oops', reason: 'x' }],
    ['empty reason', { agentId: AGENT, agentName: 'auggie', kind: 'blocker', reason: '' }],
    ['missing reason', { agentId: AGENT, agentName: 'auggie', kind: 'blocker' }],
  ])('drops a malformed payload (%s) without showing a toast', async (_label, data) => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:attention-requested', data));
    await flush();

    expect(showAgentAttentionToastSpy).not.toHaveBeenCalled();
  });

  it('suppresses the toast when parentAgentId is present and non-empty (delegated agent)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        agentId: AGENT,
        agentName: 'auggie',
        kind: 'blocker',
        reason: 'Delegated blocker',
        parentAgentId: 'agent-parent-1',
      }),
    );
    await flush();

    expect(showAgentAttentionToastSpy).not.toHaveBeenCalled();
  });

  it('still shows the toast when parentAgentId is an empty string (treated as absent)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:attention-requested', {
        agentId: AGENT,
        agentName: 'auggie',
        kind: 'discussion',
        reason: 'Top-level agent',
        parentAgentId: '',
      }),
    );
    await flush();

    expect(showAgentAttentionToastSpy).toHaveBeenCalledTimes(1);
  });

  it('still dispatches eventReceived (activity-timeline fall-through) alongside the toast', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const before = appStore.state.workspaceEvents?.byWorkspaceId?.[WS]?.events?.length ?? 0;

    handler(
      notification('agent:attention-requested', {
        agentId: AGENT,
        agentName: 'auggie',
        kind: 'discussion',
        reason: 'Fall-through check',
      }),
    );
    await flush();

    const after = appStore.state.workspaceEvents?.byWorkspaceId?.[WS]?.events?.length ?? 0;
    expect(after).toBe(before + 1);
    expect(showAgentAttentionToastSpy).toHaveBeenCalledTimes(1);
  });

  it('re-reads through the trailing event seam so the sidebar/footer indicator converges', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    refreshAgentSessionAfterEventSpy.mockClear();

    handler(
      notification('agent:attention-requested', {
        agentId: AGENT,
        agentName: 'auggie',
        kind: 'blocker',
        reason: 'Session refresh check',
      }),
    );
    await flush();

    expect(refreshAgentSessionAfterEventSpy).toHaveBeenCalledWith(AGENT);
    expect(showAgentAttentionToastSpy).toHaveBeenCalledTimes(1);
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

describe('daemonEventsBridge (wire contract — mcpServerToggled on workspace:updated §5.22/§6.5)', () => {
  const WS_TOGGLE = 'ws-mcp-toggle-1';

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    appStore.dispatch(setServers([]));
    appStore.dispatch(setWorkspaceDisabledMcpServers(WS_TOGGLE, {}));
  });

  afterEach(() => vi.clearAllMocks());

  function seedMcpServer(id: string, name: string): void {
    appStore.dispatch(setServers([{ id, name, type: 'stdio', command: 'npx' }]));
  }

  function toggledNotification(changes: Record<string, unknown>) {
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-ws-mcp-${Math.random().toString(36).slice(2, 8)}`,
          workspaceId: WS_TOGGLE,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:updated',
          actor: { type: 'system', id: 'daemon' },
          data: { workspaceId: WS_TOGGLE, changes },
        },
      },
    };
  }

  function readDisabled(): Record<string, true> {
    return appStore.state.mcpSettings.byWorkspaceId[WS_TOGGLE]?.disabledServers ?? {};
  }

  it('disable delta → resolves serverId to name and marks it disabled in byWorkspaceId', async () => {
    seedMcpServer('srv-fs', 'filesystem');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      toggledNotification({ mcpServerToggled: { serverId: 'srv-fs', workspaceDisabled: true } }),
    );

    expect(readDisabled()).toEqual({ filesystem: true });
  });

  it('re-enable delta → clears the name from byWorkspaceId', async () => {
    seedMcpServer('srv-fs', 'filesystem');
    appStore.dispatch(setWorkspaceDisabledMcpServers(WS_TOGGLE, { filesystem: true }));
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      toggledNotification({ mcpServerToggled: { serverId: 'srv-fs', workspaceDisabled: false } }),
    );

    expect(readDisabled()).toEqual({});
  });

  it('drops a delta whose serverId is not in the loaded server list (mount hydrate converges later)', async () => {
    seedMcpServer('srv-known', 'known');
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const before = appStore.state.mcpSettings.byWorkspaceId;

    handler(
      toggledNotification({ mcpServerToggled: { serverId: 'srv-ghost', workspaceDisabled: true } }),
    );

    expect(appStore.state.mcpSettings.byWorkspaceId).toEqual(before);
  });

  it('ignores malformed payloads (missing serverId or non-boolean workspaceDisabled)', async () => {
    seedMcpServer('srv-x', 'x');
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const before = appStore.state.mcpSettings.byWorkspaceId;

    handler(toggledNotification({ mcpServerToggled: { workspaceDisabled: true } }));
    handler(toggledNotification({ mcpServerToggled: { serverId: 'srv-x' } }));
    handler(
      toggledNotification({ mcpServerToggled: { serverId: 'srv-x', workspaceDisabled: 'yes' } }),
    );
    handler(toggledNotification({ mcpServerToggled: 'not-an-object' }));

    expect(appStore.state.mcpSettings.byWorkspaceId).toEqual(before);
  });

  it('a workspace:updated delta without mcpServerToggled leaves byWorkspaceId untouched', async () => {
    seedMcpServer('srv-x', 'x');
    appStore.dispatch(setWorkspaceDisabledMcpServers(WS_TOGGLE, { x: true }));
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(toggledNotification({ title: 'Renamed' }));

    expect(readDisabled()).toEqual({ x: true });
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
    refreshAgentSessionAfterEventSpy.mockReset();
    refreshAgentSessionAfterEventSpy.mockImplementation(() => Promise.resolve());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    // Prime the direct router without seeding a session (agent:created runs
    // against an empty store to prove it surfaces a brand-new sidebar entry).
    await primeBridge();
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

    expect(refreshAgentSessionAfterEventSpy).toHaveBeenCalledWith(AGENT);
    expect(ensureAgentSessionSpy).not.toHaveBeenCalled();
    const state = appStore.state as {
      agentSessions: { byAgentId: Record<string, AgentSession> };
    };
    // The bridge itself must not dispatch anything that clears the messages;
    // any refresh goes through ensureAgentSession, which preserves the
    // transcript on metadata-only reads (see FE 69f8c74c).
    expect(state.agentSessions.byAgentId[AGENT]?.messages).toHaveLength(1);
    expect(state.agentSessions.byAgentId[AGENT]?.messages[0].id).toBe('asst-keep');
  });

  it('forwards an agent:updated event that arrives while the prior refresh is in flight', async () => {
    let resolveFirst!: () => void;
    refreshAgentSessionAfterEventSpy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const handler = capturedHandlers[0]!;

    handler(notification('agent:updated', { agentId: AGENT }));
    handler(notification('agent:updated', { agentId: AGENT }));

    expect(refreshAgentSessionAfterEventSpy).toHaveBeenCalledTimes(2);
    expect(refreshAgentSessionAfterEventSpy).toHaveBeenNthCalledWith(1, AGENT);
    expect(refreshAgentSessionAfterEventSpy).toHaveBeenNthCalledWith(2, AGENT);

    resolveFirst();
    await flush();
  });

  // monorepo#1728: #584 dropped the notifyInterruptedAgentUpdated call, so a
  // real agent:updated (emitted per agent by agent.resolveInterrupted,
  // PROTOCOL §5.35) could never schedule the cross-window modal reconcile.
  it('agent:updated notifies the interrupted-agents service so a cross-window resolve reconciles the modal', async () => {
    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-updated-interrupted',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:updated',
          actor: { type: 'system', id: 'daemon' },
          data: { agentId: AGENT },
        },
      },
    });
    await flush();

    expect(notifyInterruptedAgentUpdatedSpy).toHaveBeenCalledWith(AGENT);
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
    expect(refreshAgentSessionAfterEventSpy).not.toHaveBeenCalled();
    expect(notifyInterruptedAgentUpdatedSpy).not.toHaveBeenCalled();
  });
});
describe('daemonEventsBridge (agent:retired/restored/deleted → lazy Retired bin count, §5.5 v8.2)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    refreshAgentSessionAfterEventSpy.mockReset();
    refreshAgentSessionAfterEventSpy.mockImplementation(() => Promise.resolve());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    await primeBridge();
  });

  afterEach(() => vi.clearAllMocks());

  const retiredCountOf = (wsId: string) => selectRetiredCount.select(appStore.state, wsId);

  it('agent:retired nudges the count up and agent:restored back down alongside the metadata refresh', async () => {
    appStore.dispatch(setRetiredCount(WS, 1));
    const handler = capturedHandlers[0]!;

    handler(notification('agent:retired', { agentId: AGENT }));
    await flush();
    expect(retiredCountOf(WS)).toBe(2);
    expect(refreshAgentSessionAfterEventSpy).toHaveBeenCalledWith(AGENT);

    handler(notification('agent:restored', { agentId: AGENT }));
    await flush();
    expect(retiredCountOf(WS)).toBe(1);
  });

  it('clamps the count at 0 when agent:restored arrives before the count was baselined', async () => {
    const handler = capturedHandlers[0]!;

    handler(notification('agent:restored', { agentId: AGENT }));
    await flush();

    expect(retiredCountOf(WS)).toBe(0);
    expect(refreshAgentSessionAfterEventSpy).toHaveBeenCalledWith(AGENT);
  });

  it('agent:deleted on a known retired row nudges the count down in lockstep with its removal', async () => {
    seedSession({ retiredAt: '2026-01-01T12:00:00.000Z' });
    appStore.dispatch(setRetiredCount(WS, 2));
    const handler = capturedHandlers[0]!;

    handler(notification('agent:deleted', { agentId: AGENT }));
    await flush();

    expect(retiredCountOf(WS)).toBe(1);
    const state = appStore.state as { agentSessions: { byAgentId: Record<string, unknown> } };
    expect(state.agentSessions.byAgentId[AGENT]).toBeUndefined();
  });

  it('agent:deleted for an id with no local session re-baselines via a hydrate (never-loaded retired row)', async () => {
    appStore.dispatch(setRetiredCount(WS, 2));
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();

    handler(notification('agent:deleted', { agentId: 'agent-unknown-retired' }));
    await flush();

    // The re-baseline rides the canonical default read (`agent.list`, which
    // serves `retiredCount` on every read) — not a local guess.
    expect(backendRequestSpy).toHaveBeenCalledWith('agent.list', { workspaceId: WS });
  });

  it('agent:deleted on a known NON-retired row leaves the retired count alone without a refetch', async () => {
    seedSession();
    appStore.dispatch(setRetiredCount(WS, 2));
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();

    handler(notification('agent:deleted', { agentId: AGENT }));
    await flush();

    expect(retiredCountOf(WS)).toBe(2);
    expect(backendRequestSpy).not.toHaveBeenCalledWith('agent.list', { workspaceId: WS });
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

  // monorepo#1732: #584 dropped the `task:created` arm, so the §6.5 edge that
  // exists precisely so subscribers need not infer task-ness from a note
  // payload no longer refreshed the BE-owned task.list rollup.
  it('task:created on an initialized workspace triggers the debounced task.list refetch', async () => {
    const CREATED_WS = 'ws-bridge-task-created';
    const { loadWorkspaceTasksSucceeded } =
      await import('$store/renderer/slices/workspace-tasks/workspace-tasks-slice');
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(CREATED_WS, [], { total: 0, completed: 0, inProgress: 0 }),
    );
    await primeBridge();
    const handler = capturedHandlers[0]!;

    backendRequestSpy.mockImplementation((method: string) =>
      method === 'task.list'
        ? Promise.resolve({
            tasks: [{ id: 'task-new', title: 'New Task', status: 'not_started' }],
            stats: { total: 1, completed: 0, inProgress: 0 },
          })
        : undefined,
    );

    vi.useFakeTimers();
    // PROTOCOL §6.5 task:created payload.
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-task-created-1',
          workspaceId: CREATED_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'task:created',
          actor: { type: 'agent', id: AGENT },
          data: {
            noteId: 'task-new',
            noteTitle: 'New Task',
            status: 'not_started',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    });

    // Debounced: no wire call before the ~1s window elapses.
    expect(taskListCalls(CREATED_WS)).toHaveLength(0);
    vi.advanceTimersByTime(1000);

    expect(taskListCalls(CREATED_WS)).toHaveLength(1);
    expect(backendRequestSpy).toHaveBeenCalledWith('task.list', { workspaceId: CREATED_WS });

    vi.useRealTimers();
    await flush();
    const wsState = (
      appStore.state as {
        workspaceTasks: { byWorkspaceId: Record<string, { stats: unknown }> };
      }
    ).workspaceTasks.byWorkspaceId[CREATED_WS];
    expect(wsState.stats).toEqual({ total: 1, completed: 0, inProgress: 0 });
  });

  it('task:created on a workspace whose tasks slice is not initialized does NOT trigger a task.list fetch', async () => {
    const UNINIT_WS = 'ws-bridge-task-created-uninit';
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-task-created-uninit',
          workspaceId: UNINIT_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'task:created',
          actor: { type: 'agent', id: AGENT },
          data: {
            noteId: 'task-x',
            noteTitle: 'X',
            status: 'not_started',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    });
    vi.advanceTimersByTime(2000);

    expect(taskListCalls(UNINIT_WS)).toHaveLength(0);
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

  it('drops the panel layout entry and clears main registrations for owned tabs (monorepo#2857)', async () => {
    const { initializeLayout, closeTab } =
      await import('$store/renderer/slices/panel-layout/panel-layout-slice');
    appStore.dispatch(
      initializeLayout(WS, {
        root: { type: 'panel', panelId: 'p1' },
        panels: {
          p1: {
            id: 'p1',
            tabs: [
              {
                id: 'owned-del',
                type: 'browser',
                title: 'O',
                closable: true,
                browserUrl: 'http://o/',
                ownerAgentId: 'agent-del-owner',
              },
            ],
            activeTabId: 'owned-del',
          },
        },
        focusedPanelId: 'p1',
      } as never),
    );
    // Hide it so the purge is proven to cover hiddenTabs too.
    appStore.dispatch(closeTab(WS, 'owned-del', 'p1', 1000));

    await primeBridge();
    const handler = capturedHandlers[0]!;
    invokeSpy.mockClear();

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-deleted-owned-tabs',
          workspaceId: WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:deleted',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: WS },
        },
      },
    });

    const state = appStore.state as {
      panelLayout: { byWorkspaceId: Record<string, unknown> };
    };
    expect(state.panelLayout.byWorkspaceId[WS]).toBeUndefined();
    const clearCalls = invokeSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'browser:clear-agent-tabs',
    );
    expect(clearCalls.map((call: unknown[]) => call[1])).toEqual([{ agentId: 'agent-del-owner' }]);
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

  it('skips the purge + agent-list refetch when the created ID has no local agent state', async () => {
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

  // intent-hq/monorepo#3558: a workspace created/imported by ANOTHER client on
  // the same daemon is unknown to this window's workspace collection — the
  // bridge must refetch the list so the new row appears without a reload.
  it('refetches the workspace list when the created ID is unknown to the workspace collection', async () => {
    // UUID-shaped: the live client's normalizeWorkspace validates via
    // createWorkspaceId when folding the workspace.list response.
    const REMOTE_WS = '99999999-9999-4999-8999-999999999999';
    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();
    workspaceServiceListSpy.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: REMOTE_WS,
          title: 'Created elsewhere',
          branch: 'main',
          status: 'Active',
        },
      ],
    });

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-created-elsewhere',
          workspaceId: REMOTE_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:created',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: REMOTE_WS },
        },
      },
    });
    // loadWorkspacesRequested → lifecycle-read-saga → appClient.workspaces.list
    // (live client → mocked backendRequest); let the async refetch settle.
    await flush();

    expect(workspaceServiceListSpy).toHaveBeenCalledWith({ lite: true });
    const state = appStore.state as { workspace: { workspaces: { ids: string[] } } };
    expect(state.workspace.workspaces.ids).toContain(REMOTE_WS);
  });

  it('does not refetch the workspace list when the created ID is already in the collection', async () => {
    const KNOWN_WS = 'ws-bridge-created-known';
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: KNOWN_WS,
        title: 'Known ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    );

    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-created-known',
          workspaceId: KNOWN_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:created',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: KNOWN_WS },
        },
      },
    });
    await flush();

    expect(backendRequestSpy).not.toHaveBeenCalledWith('workspace.list', expect.anything());
    expect(backendRequestSpy).not.toHaveBeenCalledWith('workspace.list', undefined);
  });

  it('does not refetch the workspace list for a pending creation this window originated', async () => {
    const PENDING_WS = 'ws-bridge-created-pending';
    const { setPendingCreation, clearPendingCreation } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setPendingCreation({
        id: PENDING_WS,
        title: 'Pending ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    );

    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();

    try {
      handler({
        method: 'events.event',
        params: {
          event: {
            id: 'evt-workspace-created-pending',
            workspaceId: PENDING_WS,
            timestamp: '2026-01-02T00:00:00.000Z',
            type: 'workspace:created',
            actor: { type: 'user', id: 'u1' },
            data: { workspaceId: PENDING_WS },
          },
        },
      });
      await flush();

      expect(backendRequestSpy).not.toHaveBeenCalledWith('workspace.list', expect.anything());
      expect(backendRequestSpy).not.toHaveBeenCalledWith('workspace.list', undefined);
    } finally {
      appStore.dispatch(clearPendingCreation(PENDING_WS));
    }
  });

  it('lifts the deletion tombstone so the recycled ID can be stored again', async () => {
    const TOMBSTONED_WS = 'ws-bridge-tombstoned';
    const { markWorkspacePendingDeletion } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    // Simulate a committed delete whose post-delete grace tombstone is still
    // active when the id is recycled by a new create.
    appStore.dispatch(markWorkspacePendingDeletion(TOMBSTONED_WS));

    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-workspace-created-tombstoned',
          workspaceId: TOMBSTONED_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:created',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: TOMBSTONED_WS },
        },
      },
    });
    await flush();

    const state = appStore.state as { workspace: { pendingDeletions: Record<string, boolean> } };
    expect(state.workspace.pendingDeletions[TOMBSTONED_WS]).toBeUndefined();
  });

  it('disarms the pending-delete tombstone timer on a recycled ID', async () => {
    const TIMER_WS = 'ws-bridge-recycled-timer';
    const { markWorkspacePendingDeletion, clearWorkspacePendingDeletion } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    try {
      // A schedule event arms the self-lift timer…
      handler({
        method: 'events.event',
        params: {
          event: {
            id: 'evt-ws-del-scheduled-recycle-timer',
            workspaceId: TIMER_WS,
            timestamp: new Date().toISOString(),
            type: 'workspace:delete-scheduled',
            actor: { type: 'user', id: 'u1' },
            data: { workspaceId: TIMER_WS, deleteAt: new Date(Date.now() + 15_000).toISOString() },
          },
        },
      });
      // …then the ID is recycled by a new create, which must disarm it.
      handler({
        method: 'events.event',
        params: {
          event: {
            id: 'evt-workspace-created-recycle-timer',
            workspaceId: TIMER_WS,
            timestamp: new Date().toISOString(),
            type: 'workspace:created',
            actor: { type: 'user', id: 'u1' },
            data: { workspaceId: TIMER_WS },
          },
        },
      });

      // A later delete of the recycled workspace sets a fresh tombstone; the
      // stale timer (had it survived) would fire and wrongly lift it.
      appStore.dispatch(markWorkspacePendingDeletion(TIMER_WS));
      vi.advanceTimersByTime(15_000 + 60_000 + 1);

      const state = appStore.state as { workspace: { pendingDeletions: Record<string, boolean> } };
      expect(state.workspace.pendingDeletions[TIMER_WS]).toBe(true);
      appStore.dispatch(clearWorkspacePendingDeletion(TIMER_WS));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('daemonEventsBridge (delete grace window schedule/cancel events, monorepo#1977)', () => {
  const PENDING_WS = 'ws-bridge-pending-del';
  const PENDING_AGENT = 'agent-bridge-pending-del';
  const DELETE_AT = new Date(Date.now() + 15_000).toISOString();

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    const { clearPendingAgentDeletions } =
      await import('$features/agent/utils/pending-agent-deletions');
    clearPendingAgentDeletions();
    appStore.dispatch(clearAllSessions());
    const { clearWorkspacePendingDeletion, removeWorkspaceEntity } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    appStore.dispatch(clearWorkspacePendingDeletion(PENDING_WS));
    appStore.dispatch(removeWorkspaceEntity(PENDING_WS));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    navigateAwayIfViewingSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  function makeWorkspace(overrides: Record<string, unknown> = {}) {
    return {
      id: PENDING_WS,
      title: 'Pending WS',
      path: '/tmp/pending-ws',
      status: 'Active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  async function workspaceRow(): Promise<unknown> {
    const { selectWorkspaceById } =
      await import('$store/renderer/slices/workspace/workspace-selectors');
    return selectWorkspaceById.select(appStore.state, PENDING_WS);
  }

  it('workspace:delete-scheduled hides the row, sets the tombstone, and blocks a stale entity write', async () => {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    appStore.dispatch(setWorkspaceEntity(makeWorkspace() as never));
    expect(await workspaceRow()).toBeDefined();

    await primeBridge();
    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-ws-del-scheduled',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:delete-scheduled',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: PENDING_WS, deleteAt: DELETE_AT },
        },
      },
    });

    expect(await workspaceRow()).toBeUndefined();
    const state = appStore.state as { workspace: { pendingDeletions: Record<string, boolean> } };
    expect(state.workspace.pendingDeletions[PENDING_WS]).toBe(true);
    expect(navigateAwayIfViewingSpy).toHaveBeenCalledWith(PENDING_WS);

    // Second-window stale-read race (monorepo#1977): a workspace.get/list
    // response generated BEFORE the schedule (no pendingDeleteAt on the row)
    // that lands after must NOT resurrect the row — the tombstone blocks it.
    appStore.dispatch(setWorkspaceEntity(makeWorkspace() as never));
    expect(await workspaceRow()).toBeUndefined();
  });

  it('workspace:delete-cancelled lifts the tombstone and refetches the row', async () => {
    const { markWorkspacePendingDeletion, removeWorkspaceEntity } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    appStore.dispatch(removeWorkspaceEntity(PENDING_WS));
    appStore.dispatch(markWorkspacePendingDeletion(PENDING_WS));
    backendRequestSpy.mockImplementation((method: string) => {
      if (method === 'workspace.get') {
        return Promise.resolve({ workspace: makeWorkspace() });
      }
      return Promise.resolve({ subscriptionId: 'sub-1' });
    });

    await primeBridge();
    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-ws-del-cancelled',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:delete-cancelled',
          actor: { type: 'user', id: 'u1' },
          data: { workspaceId: PENDING_WS },
        },
      },
    });
    await flush();

    const state = appStore.state as { workspace: { pendingDeletions: Record<string, boolean> } };
    expect(state.workspace.pendingDeletions[PENDING_WS]).toBeUndefined();
    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: PENDING_WS });
    expect(await workspaceRow()).toBeDefined();
  });

  it('agent:delete-scheduled soft-hides the hydrated session and registers the pending entry', async () => {
    const { isAgentDeletionPending } =
      await import('$features/agent/utils/pending-agent-deletions');
    const pendingSession: AgentSession = {
      id: PENDING_AGENT,
      backendSessionId: 'backend-pending',
      workspaceId: PENDING_WS,
      name: 'Pending',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AgentSession;
    appStore.dispatch(bulkUpsertSessions([pendingSession]));
    appStore.dispatch(upsertSession(pendingSession));

    await primeBridge();
    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-del-scheduled',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:delete-scheduled',
          actor: { type: 'user', id: 'u1' },
          data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS, deleteAt: DELETE_AT },
        },
      },
    });

    const state = appStore.state as {
      agentSessions: { byAgentId: Record<string, unknown> };
      workspaceAgents: { byWorkspaceId: Record<string, { agentIds?: string[] }> };
    };
    expect(state.agentSessions.byAgentId[PENDING_AGENT]).toBeUndefined();
    expect(state.workspaceAgents.byWorkspaceId[PENDING_WS]?.agentIds ?? []).not.toContain(
      PENDING_AGENT,
    );
    // The registry entry doubles as the read-path guard so refetches
    // (ensureAgentSession, transcript loads) cannot resurrect the row.
    expect(isAgentDeletionPending(PENDING_AGENT)).toBe(true);
  });

  it('agent:delete-scheduled registers the tombstone even without a hydrated session', async () => {
    const { isAgentDeletionPending, getPendingAgentDeletion } =
      await import('$features/agent/utils/pending-agent-deletions');
    // No session hydrated locally for PENDING_AGENT: an agent.get/list begun
    // before the schedule (row without pendingDeleteAt) could still resolve
    // after it — the snapshot-less tombstone must block that stale read.
    await primeBridge();
    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-del-scheduled-nosnap',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:delete-scheduled',
          actor: { type: 'user', id: 'u1' },
          data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS, deleteAt: DELETE_AT },
        },
      },
    });

    expect(isAgentDeletionPending(PENDING_AGENT)).toBe(true);
    expect(getPendingAgentDeletion(PENDING_AGENT)?.snapshot).toBeUndefined();
  });

  it('agent:delete-scheduled with an existing registry entry is a no-op (originating window)', async () => {
    const { setPendingAgentDeletion, getPendingAgentDeletion } =
      await import('$features/agent/utils/pending-agent-deletions');
    const snapshot: AgentSession = {
      id: PENDING_AGENT,
      backendSessionId: 'backend-own',
      workspaceId: PENDING_WS,
      name: 'Own window',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AgentSession;
    const sagaEntry = { wsId: PENDING_WS, agentId: PENDING_AGENT, snapshot };
    setPendingAgentDeletion(sagaEntry);

    await primeBridge();
    const handler = capturedHandlers[0]!;
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-del-scheduled-own',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:delete-scheduled',
          actor: { type: 'user', id: 'u1' },
          data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS, deleteAt: DELETE_AT },
        },
      },
    });

    // The saga's entry (with its own lifecycle) stays authoritative.
    expect(getPendingAgentDeletion(PENDING_AGENT)).toBe(sagaEntry);
  });

  it('bridge tombstones self-lift at deleteAt + grace, sparing a newer entry', async () => {
    const { isAgentDeletionPending, setPendingAgentDeletion, getPendingAgentDeletion } =
      await import('$features/agent/utils/pending-agent-deletions');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    try {
      const deleteAt = new Date(Date.now() + 15_000).toISOString();
      handler({
        method: 'events.event',
        params: {
          event: {
            id: 'evt-agent-del-scheduled-lift',
            workspaceId: PENDING_WS,
            timestamp: new Date().toISOString(),
            type: 'agent:delete-scheduled',
            actor: { type: 'user', id: 'u1' },
            data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS, deleteAt },
          },
        },
      });
      handler({
        method: 'events.event',
        params: {
          event: {
            id: 'evt-ws-del-scheduled-lift',
            workspaceId: PENDING_WS,
            timestamp: new Date().toISOString(),
            type: 'workspace:delete-scheduled',
            actor: { type: 'user', id: 'u1' },
            data: { workspaceId: PENDING_WS, deleteAt },
          },
        },
      });
      expect(isAgentDeletionPending(PENDING_AGENT)).toBe(true);

      // A newer entry (e.g. a re-delete's own saga registration) replaces the
      // bridge's — the armed timer must leave it alone when it fires.
      const newerEntry = { wsId: PENDING_WS, agentId: PENDING_AGENT };
      setPendingAgentDeletion(newerEntry);

      // deleteAt (15s) + tombstone TTL (60s).
      vi.advanceTimersByTime(15_000 + 60_000 + 1);

      expect(getPendingAgentDeletion(PENDING_AGENT)).toBe(newerEntry);
      const state = appStore.state as {
        workspace: { pendingDeletions: Record<string, boolean> };
      };
      expect(state.workspace.pendingDeletions[PENDING_WS]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposeDaemonEventsRoutingState clears armed tombstone timers', async () => {
    const { isAgentDeletionPending } =
      await import('$features/agent/utils/pending-agent-deletions');
    const { disposeDaemonEventsRoutingState } =
      await import('$features/events/daemon-events-bridge.client');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    try {
      handler({
        method: 'events.event',
        params: {
          event: {
            id: 'evt-agent-del-scheduled-dispose',
            workspaceId: PENDING_WS,
            timestamp: new Date().toISOString(),
            type: 'agent:delete-scheduled',
            actor: { type: 'user', id: 'u1' },
            data: {
              agentId: PENDING_AGENT,
              workspaceId: PENDING_WS,
              deleteAt: new Date(Date.now() + 15_000).toISOString(),
            },
          },
        },
      });
      expect(isAgentDeletionPending(PENDING_AGENT)).toBe(true);

      disposeDaemonEventsRoutingState();

      // The cancelled timer never fires; the registry entry is left for the
      // owning window's lifecycle (dispose only tears down bridge-owned state).
      vi.advanceTimersByTime(15_000 + 60_000 + 1);
      expect(isAgentDeletionPending(PENDING_AGENT)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('agent:delete-cancelled restores the snapshot and refetches the canonical list', async () => {
    const { setPendingAgentDeletion } =
      await import('$features/agent/utils/pending-agent-deletions');
    const snapshot: AgentSession = {
      id: PENDING_AGENT,
      backendSessionId: 'backend-pending',
      workspaceId: PENDING_WS,
      name: 'Restored',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AgentSession;
    setPendingAgentDeletion({ wsId: PENDING_WS, agentId: PENDING_AGENT, snapshot });
    backendRequestSpy.mockImplementation((method: string) => {
      if (method === 'agent.list') {
        return Promise.resolve({ agents: [snapshot] });
      }
      return Promise.resolve({ subscriptionId: 'sub-1' });
    });

    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-del-cancelled',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:delete-cancelled',
          actor: { type: 'user', id: 'u1' },
          data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS },
        },
      },
    });
    await flush();

    const { isAgentDeletionPending } =
      await import('$features/agent/utils/pending-agent-deletions');
    expect(isAgentDeletionPending(PENDING_AGENT)).toBe(false);
    const state = appStore.state as {
      agentSessions: { byAgentId: Record<string, { name?: string }> };
      workspaceAgents: { byWorkspaceId: Record<string, { agentIds?: string[] }> };
    };
    expect(state.agentSessions.byAgentId[PENDING_AGENT]?.name).toBe('Restored');
    expect(state.workspaceAgents.byWorkspaceId[PENDING_WS]?.agentIds ?? []).toContain(
      PENDING_AGENT,
    );
    // Reconcile refetch also runs — covers a window that never held a snapshot.
    expect(backendRequestSpy).toHaveBeenCalledWith('agent.list', {
      workspaceId: PENDING_WS,
    });
  });

  it('agent:delete-cancelled without a local snapshot still refetches the canonical list', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockClear();
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-del-cancelled-nosnap',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:delete-cancelled',
          actor: { type: 'user', id: 'u1' },
          data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS },
        },
      },
    });
    await flush();

    expect(backendRequestSpy).toHaveBeenCalledWith('agent.list', {
      workspaceId: PENDING_WS,
    });
  });

  // Owned-tab lifecycle (monorepo#2857): the deletion COMMIT destroys the
  // agent's owned browser tabs (visible + hidden) and clears main's
  // registrations; the SCHEDULE (grace window — cancelDelete must restore
  // tabs intact) does not.
  it('agent:deleted destroys owned tabs (visible + hidden) and clears main registrations', async () => {
    const { initializeLayout, closeTab } =
      await import('$store/renderer/slices/panel-layout/panel-layout-slice');
    appStore.dispatch(
      initializeLayout(PENDING_WS, {
        root: { type: 'panel', panelId: 'p1' },
        panels: {
          p1: {
            id: 'p1',
            tabs: [
              {
                id: 'owned-vis',
                type: 'browser',
                title: 'V',
                closable: true,
                browserUrl: 'http://v/',
                ownerAgentId: PENDING_AGENT,
              },
              {
                id: 'owned-hid',
                type: 'browser',
                title: 'H',
                closable: true,
                browserUrl: 'http://h/',
                ownerAgentId: PENDING_AGENT,
              },
              { id: 'keep', type: 'note', title: 'K', closable: true },
            ],
            activeTabId: 'owned-vis',
          },
        },
        focusedPanelId: 'p1',
      } as never),
    );
    appStore.dispatch(closeTab(PENDING_WS, 'owned-hid', 'p1', 1000));

    await primeBridge();
    const handler = capturedHandlers[0]!;
    invokeSpy.mockClear();

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-deleted-owned-tabs',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:deleted',
          actor: { type: 'user', id: 'u1' },
          data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS },
        },
      },
    });

    const state = appStore.state as {
      panelLayout: {
        byWorkspaceId: Record<
          string,
          { panels: Record<string, { tabs: { id: string }[] }>; hiddenTabs: { ids: string[] } }
        >;
      };
    };
    const ws = state.panelLayout.byWorkspaceId[PENDING_WS];
    expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['keep']);
    expect(ws.hiddenTabs.ids).toHaveLength(0);
    const clearCalls = invokeSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'browser:clear-agent-tabs',
    );
    expect(clearCalls.map((call: unknown[]) => call[1])).toEqual([{ agentId: PENDING_AGENT }]);
  });

  it('agent:delete-scheduled leaves owned tabs alive (grace window, cancel restores intact)', async () => {
    const { initializeLayout } =
      await import('$store/renderer/slices/panel-layout/panel-layout-slice');
    appStore.dispatch(
      initializeLayout(PENDING_WS, {
        root: { type: 'panel', panelId: 'p1' },
        panels: {
          p1: {
            id: 'p1',
            tabs: [
              {
                id: 'owned-grace',
                type: 'browser',
                title: 'G',
                closable: true,
                browserUrl: 'http://g/',
                ownerAgentId: PENDING_AGENT,
              },
            ],
            activeTabId: 'owned-grace',
          },
        },
        focusedPanelId: 'p1',
      } as never),
    );

    await primeBridge();
    const handler = capturedHandlers[0]!;
    invokeSpy.mockClear();

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-del-scheduled-tabs',
          workspaceId: PENDING_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:delete-scheduled',
          actor: { type: 'user', id: 'u1' },
          data: { agentId: PENDING_AGENT, workspaceId: PENDING_WS, deleteAt: DELETE_AT },
        },
      },
    });

    const state = appStore.state as {
      panelLayout: {
        byWorkspaceId: Record<string, { panels: Record<string, { tabs: { id: string }[] }> }>;
      };
    };
    expect(state.panelLayout.byWorkspaceId[PENDING_WS].panels.p1.tabs.map((t) => t.id)).toEqual([
      'owned-grace',
    ]);
    expect(
      invokeSpy.mock.calls.filter((call: unknown[]) => call[0] === 'browser:clear-agent-tabs'),
    ).toHaveLength(0);
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

    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
    const state = appStore.state as {
      workspaceTasks: {
        byWorkspaceId: Record<string, { tasks: unknown }>;
      };
    };
    const task = getItem(state.workspaceTasks.byWorkspaceId[TASK_WS].tasks as never, 'note-t1') as
      { status: string } | undefined;
    expect(task?.status).toBe('in_progress');
  });

  // intent#4362: the context sidebar (NotesPanel) renders task icons from
  // `note.metadata.task.status` on the workspace-notes slice, so a
  // `task:status-changed` edge must land there too — not only on the
  // workspace-tasks slice — or the row icon stays stale until the note is
  // opened and refetched.
  it('applies task:status-changed onto the workspace-notes slice so sidebar task icons update live', async () => {
    const NOTES_WS = 'ws-task-notes-icon';
    const { ContentType, NoteVisibility } = await import('$shared/types');
    const { loadWorkspaceNotesSucceeded } =
      await import('$store/renderer/slices/workspace-notes/workspace-notes-slice');
    const { selectNoteById } =
      await import('$store/renderer/slices/workspace-notes/workspace-notes-selectors');
    const taskNote = {
      id: 'task-note-icon-1',
      workspaceId: NOTES_WS,
      title: 'Task icon',
      content: '',
      contentType: ContentType.Markdown,
      tags: [],
      isPinned: false,
      isArchived: false,
      visibility: NoteVisibility.Private,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      metadata: { task: { status: 'not_started' } },
    } as unknown as Note;
    appStore.dispatch(loadWorkspaceNotesSucceeded([NOTES_WS], { [NOTES_WS]: [taskNote] }));

    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-task-notes-icon-1',
          workspaceId: NOTES_WS,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'task:status-changed',
          actor: { type: 'agent', id: AGENT },
          data: {
            noteId: 'task-note-icon-1',
            noteTitle: 'Task icon',
            previousStatus: 'not_started',
            newStatus: 'in_progress',
            changedAt: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    });

    expect(
      selectNoteById.select(appStore.state, NOTES_WS, 'task-note-icon-1')?.metadata?.task?.status,
    ).toBe('in_progress');
  });

  it('a burst of task:status-changed events lands every status on the workspace-notes slice', async () => {
    const BURST_WS = 'ws-task-notes-burst';
    const { ContentType, NoteVisibility } = await import('$shared/types');
    const { loadWorkspaceNotesSucceeded } =
      await import('$store/renderer/slices/workspace-notes/workspace-notes-slice');
    const { selectNoteById } =
      await import('$store/renderer/slices/workspace-notes/workspace-notes-selectors');
    const mkTaskNote = (id: string) =>
      ({
        id,
        workspaceId: BURST_WS,
        title: id,
        content: '',
        contentType: ContentType.Markdown,
        tags: [],
        isPinned: false,
        isArchived: false,
        visibility: NoteVisibility.Private,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        metadata: { task: { status: 'not_started' } },
      }) as unknown as Note;
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([BURST_WS], {
        [BURST_WS]: [mkTaskNote('burst-a'), mkTaskNote('burst-b'), mkTaskNote('burst-c')],
      }),
    );

    await primeBridge();
    const handler = capturedHandlers[0]!;

    const edges: Array<[string, string]> = [
      ['burst-a', 'in_progress'],
      ['burst-b', 'complete'],
      ['burst-a', 'complete'],
      ['burst-c', 'blocked'],
    ];
    for (const [noteId, newStatus] of edges) {
      handler({
        method: 'events.event',
        params: {
          event: {
            id: `evt-${noteId}-${newStatus}`,
            workspaceId: BURST_WS,
            timestamp: '2026-01-02T00:00:00.000Z',
            type: 'task:status-changed',
            actor: { type: 'agent', id: AGENT },
            data: {
              noteId,
              noteTitle: noteId,
              previousStatus: 'not_started',
              newStatus,
              changedAt: '2026-01-02T00:00:00.000Z',
            },
          },
        },
      });
    }

    const statusOf = (id: string) =>
      selectNoteById.select(appStore.state, BURST_WS, id)?.metadata?.task?.status;
    expect(statusOf('burst-a')).toBe('complete');
    expect(statusOf('burst-b')).toBe('complete');
    expect(statusOf('burst-c')).toBe('blocked');
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
    // The union merge semantics on setWorkspaceEntity (monorepo#2951) mean PR
    // pools survive re-seeding — reset the slice so tests stay independent.
    const { resetWorkspaceState } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    appStore.dispatch(resetWorkspaceState());
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
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
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
    // The entity had no pullRequests pool yet, so the pr:updated payload's
    // list is adopted as-is (the union with an empty pool is the incoming list).
    expect(ws.pullRequests).toEqual([{ number: 42, status: 'Merged' }]);
  });

  it('pr:updated preserves merged-pool entries absent from the stored list (monorepo#2951)', async () => {
    // A background workspace whose entity holds the daemon-MERGED pool from a
    // workspace.list emit: the stored PR plus a git-root PR and a monitored
    // cross-repo PR that only workspace.list folds in.
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
        pullRequests: [
          { number: 42, url: 'https://github.com/acme/app/pull/42', status: 'Open' },
          { number: 7, url: 'https://github.com/acme/submodule/pull/7', status: 'Open' },
          { number: 9, url: 'https://github.com/other/repo/pull/9', status: 'Open' },
        ],
      } as never),
    );
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // pr:updated carries the narrower STORED list (§6.9) — only the linked PR.
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-pr-updated-2951',
          workspaceId: PR_WS,
          timestamp: '2026-01-02T00:00:01.000Z',
          type: 'pr:updated',
          actor: { type: 'system' },
          data: {
            workspaceId: PR_WS,
            prNumber: 42,
            prStatus: 'Merged',
            activePullRequest: { number: 42, merged: true },
            pullRequests: [
              { number: 42, url: 'https://github.com/acme/app/pull/42', status: 'Merged' },
            ],
          },
        },
      },
    });

    const ws = await readWorkspace();
    // The stored entry is refreshed in place; the git-root and monitored
    // entries survive — the "+N" badge count must not drop.
    expect(ws.pullRequests).toEqual([
      { number: 42, url: 'https://github.com/acme/app/pull/42', status: 'Merged' },
      { number: 7, url: 'https://github.com/acme/submodule/pull/7', status: 'Open' },
      { number: 9, url: 'https://github.com/other/repo/pull/9', status: 'Open' },
    ]);
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
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
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

  it('destroys agent-owned browser tabs (visible + hidden) and clears main registrations on archive (monorepo#2857)', async () => {
    await seedWorkspace();
    const { initializeLayout, closeTab } =
      await import('$store/renderer/slices/panel-layout/panel-layout-slice');
    appStore.dispatch(
      initializeLayout(WS_UPD, {
        root: { type: 'panel', panelId: 'p1' },
        panels: {
          p1: {
            id: 'p1',
            tabs: [
              {
                id: 'owned-visible',
                type: 'browser',
                title: 'V',
                closable: true,
                browserUrl: 'http://v/',
                ownerAgentId: 'agent-arch-1',
              },
              {
                id: 'owned-hideme',
                type: 'browser',
                title: 'H',
                closable: true,
                browserUrl: 'http://h/',
                ownerAgentId: 'agent-arch-2',
              },
              {
                id: 'plain',
                type: 'browser',
                title: 'P',
                closable: true,
                browserUrl: 'http://p/',
              },
            ],
            activeTabId: 'owned-visible',
          },
        },
        focusedPanelId: 'p1',
      } as never),
    );
    // User-hide one owned tab so both lifecycle states are covered.
    appStore.dispatch(closeTab(WS_UPD, 'owned-hideme', 'p1', 1000));
    await primeBridge();
    const handler = capturedHandlers[0]!;
    invokeSpy.mockClear();

    handler(updatedNotification({ archived: true, status: 'Archived' }));

    const layout = (
      appStore.state as {
        panelLayout: {
          byWorkspaceId: Record<
            string,
            {
              panels: Record<string, { tabs: Array<{ id: string }> }>;
              hiddenTabs: { ids: string[] };
            }
          >;
        };
      }
    ).panelLayout.byWorkspaceId[WS_UPD];
    expect(layout.hiddenTabs.ids).toHaveLength(0);
    expect(layout.panels.p1.tabs.map((t) => t.id)).toEqual(['plain']);
    const clearCalls = invokeSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'browser:clear-agent-tabs',
    );
    expect(clearCalls.map((call: unknown[]) => call[1])).toEqual(
      expect.arrayContaining([{ agentId: 'agent-arch-1' }, { agentId: 'agent-arch-2' }]),
    );
    expect(clearCalls).toHaveLength(2);
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

describe('daemonEventsBridge (workspace:updated → tab bar archive sync)', () => {
  const WS_TAB = 'ws-updated-tab-1';
  const OTHER_TAB = 'ws-updated-tab-other';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    resetMockIpcRouter();
    capturedHandlers.length = 0;
    // Tab state persists across tests via appStore — clear the whole strip
    // (openTabs, currentTabId, stacks, recently-closed) before each test.
    const { loadWorkspaceTabsState } =
      await import('$store/renderer/slices/tab-state/tab-state-slice');
    appStore.dispatch(
      loadWorkspaceTabsState({
        openTabs: [],
        currentTabId: null,
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: [],
      }),
    );
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
        id: WS_TAB,
        title: 'Tab ws',
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

  async function openTab(workspaceId: string): Promise<void> {
    const { openWorkspaceTab } = await import('$store/renderer/slices/tab-state/tab-state-slice');
    appStore.dispatch(openWorkspaceTab(workspaceId));
  }

  function readTabState(): {
    openTabs: Record<string, boolean>;
    currentTabId: string | null;
    workspaceStacks: string[][];
  } {
    const state = appStore.state as {
      tabState: {
        openTabs: Record<string, boolean>;
        currentTabId: string | null;
        workspaceStacks: string[][];
      };
    };
    return state.tabState;
  }

  function updatedNotification(changes: Record<string, unknown>): {
    method: string;
    params?: unknown;
  } {
    return {
      method: 'events.event',
      params: {
        event: {
          id: `evt-ws-updated-tab-${Math.random().toString(36).slice(2, 8)}`,
          workspaceId: WS_TAB,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:updated',
          actor: { type: 'system' },
          data: { workspaceId: WS_TAB, changes },
        },
      },
    };
  }

  it('closes the open tab on an archived delta', async () => {
    await seedWorkspace();
    await openTab(WS_TAB);
    await primeBridge();

    capturedHandlers[0]!(
      updatedNotification({
        archived: true,
        status: 'Archived',
        archivedAt: '2026-07-25T12:00:00.000Z',
      }),
    );
    // `closeWorkspaceTabAndNavigateAway` dispatches after dynamic imports.
    await flush();

    const tabs = readTabState();
    expect(tabs.openTabs[WS_TAB]).toBeUndefined();
    expect(tabs.workspaceStacks.flat()).not.toContain(WS_TAB);
    // The delete-path helper is a different route and must not fire here.
    expect(navigateAwayIfViewingSpy).not.toHaveBeenCalled();
  });

  it('is a tab-state no-op when the archived workspace has no open tab', async () => {
    await seedWorkspace();
    await primeBridge();
    const before = readTabState();

    capturedHandlers[0]!(updatedNotification({ archived: true, status: 'Archived' }));
    await flush();

    expect(readTabState()).toBe(before);
  });

  it('restores the tab in the background on an unarchive delta (no focus steal)', async () => {
    await seedWorkspace();
    await openTab(OTHER_TAB);
    await primeBridge();

    capturedHandlers[0]!(
      updatedNotification({ archived: false, status: 'Active', archivedAt: null }),
    );
    await flush();

    const tabs = readTabState();
    expect(tabs.openTabs[WS_TAB]).toBe(true);
    expect(tabs.workspaceStacks.flat()).toContain(WS_TAB);
    expect(tabs.currentTabId).toBe(OTHER_TAB);
  });

  it('is a tab-state no-op when the unarchived workspace tab is already open', async () => {
    await seedWorkspace();
    await openTab(WS_TAB);
    await primeBridge();
    const before = readTabState();

    capturedHandlers[0]!(
      updatedNotification({ archived: false, status: 'Active', archivedAt: null }),
    );
    await flush();

    expect(readTabState()).toBe(before);
  });

  it('leaves tab state untouched for deltas without archive fields', async () => {
    await seedWorkspace();
    await openTab(WS_TAB);
    await primeBridge();
    const before = readTabState();

    capturedHandlers[0]!(updatedNotification({ title: 'Renamed' }));
    await flush();

    expect(readTabState()).toBe(before);
  });

  it('fires the auto-unarchive toast when the unarchive delta carries the autoUnarchive stamp', async () => {
    await seedWorkspace();
    await primeBridge();

    capturedHandlers[0]!(
      updatedNotification({
        archived: false,
        status: 'Active',
        archivedAt: null,
        autoUnarchive: { reason: 'agent_activity', agentId: 'agent-77', agentName: 'Builder' },
      }),
    );
    await flush();

    expect(showWorkspaceAutoUnarchiveToastSpy).toHaveBeenCalledTimes(1);
    expect(showWorkspaceAutoUnarchiveToastSpy).toHaveBeenCalledWith({
      workspaceId: WS_TAB,
      agentId: 'agent-77',
      agentName: 'Builder',
    });
    // The background tab restore still runs alongside the toast.
    expect(readTabState().openTabs[WS_TAB]).toBe(true);
  });

  it('shows NO toast on a manual unarchive delta (no autoUnarchive stamp)', async () => {
    await seedWorkspace();
    await primeBridge();

    capturedHandlers[0]!(
      updatedNotification({ archived: false, status: 'Active', archivedAt: null }),
    );
    await flush();

    expect(showWorkspaceAutoUnarchiveToastSpy).not.toHaveBeenCalled();
  });

  it('ignores malformed autoUnarchive stamps safely (tab restore unaffected)', async () => {
    await seedWorkspace();
    await primeBridge();

    // Non-object stamp, unknown reason, and missing agent fields must all be
    // dropped without firing the toast or breaking the unarchive handling.
    capturedHandlers[0]!(
      updatedNotification({ archived: false, status: 'Active', autoUnarchive: 'agent_activity' }),
    );
    capturedHandlers[0]!(
      updatedNotification({
        archived: false,
        status: 'Active',
        autoUnarchive: { reason: 'something_else', agentId: 'agent-77', agentName: 'Builder' },
      }),
    );
    capturedHandlers[0]!(
      updatedNotification({
        archived: false,
        status: 'Active',
        autoUnarchive: { reason: 'agent_activity' },
      }),
    );
    await flush();

    expect(showWorkspaceAutoUnarchiveToastSpy).not.toHaveBeenCalled();
    expect(readTabState().openTabs[WS_TAB]).toBe(true);
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
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
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
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
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

  it('merges every wire displayStatus value onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    for (const value of [
      'not_started',
      'in_progress',
      'complete',
      'pr_queued',
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

describe('daemonEventsBridge (workspace:attention-changed → workspace slice)', () => {
  const WS_ATT = 'ws-attention-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    markWorkspaceSeenSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  async function seedWorkspace(): Promise<void> {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS_ATT,
        title: 'Attention ws',
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
    attention?: 'none' | 'unread' | 'review_required';
  }> {
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return (getItem(state.workspace.workspaces as never, WS_ATT) ?? {}) as never;
  }

  function attentionChangedNotification(attention: 'none' | 'unread' | 'review_required') {
    return {
      method: 'events.event',
      params: {
        event: {
          id: `evt-attention-${attention}`,
          workspaceId: WS_ATT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:attention-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_ATT,
            attention,
          },
        },
      },
    };
  }

  it('subscribes to workspace:attention-changed in the bridge firehose filter', () => {
    // The actual `events.subscribe` wire call is owned by the daemon-events
    // saga (see daemon-events-saga.test.ts), which subscribes using this
    // exported constant — assert the type is present in the shared filter
    // list so a divergence between the bridge's routing and the saga's
    // subscription is caught here.
    expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).toContain('workspace:attention-changed');
  });

  it('merges attention=unread onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(attentionChangedNotification('unread'));

    const ws = await readWorkspace();
    expect(ws.attention).toBe('unread');
  });

  it('merges attention=none onto the workspace entity (markSeen round-trip)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(attentionChangedNotification('unread'));
    let ws = await readWorkspace();
    expect(ws.attention).toBe('unread');

    handler(attentionChangedNotification('none'));
    ws = await readWorkspace();
    expect(ws.attention).toBe('none');
  });

  it('merges attention=review_required onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(attentionChangedNotification('review_required'));

    const ws = await readWorkspace();
    expect(ws.attention).toBe('review_required');
  });

  it('is a no-op when the attention value is invalid', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(attentionChangedNotification('unread'));
    let ws = await readWorkspace();
    expect(ws.attention).toBe('unread');

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-attention-bad',
          workspaceId: WS_ATT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:attention-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_ATT,
            attention: 'invalid_value',
          },
        },
      },
    });

    ws = await readWorkspace();
    expect(ws.attention).toBe('unread');
  });

  it('is a no-op when data or attention is missing', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(attentionChangedNotification('unread'));
    let ws = await readWorkspace();
    expect(ws.attention).toBe('unread');

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-attention-no-data',
          workspaceId: WS_ATT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:attention-changed',
          actor: { type: 'system' },
        },
      },
    });

    ws = await readWorkspace();
    expect(ws.attention).toBe('unread');
  });

  it('never marks the workspace seen on an unread raise — even while viewing it', async () => {
    // Unread is daemon-derived from per-agent seen markers (§5.1): the badge
    // persists until each unread agent conversation is read, so the bridge
    // must not fire `workspace.markSeen` for the on-screen workspace.
    window.history.pushState({}, '', `/workspace/${WS_ATT}`);
    try {
      await seedWorkspace();
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(attentionChangedNotification('unread'));

      const ws = await readWorkspace();
      expect(ws.attention).toBe('unread');
      expect(markWorkspaceSeenSpy).not.toHaveBeenCalled();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('does not mark the workspace seen for non-unread attention values either', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(attentionChangedNotification('none'));
    handler(attentionChangedNotification('review_required'));

    expect(markWorkspaceSeenSpy).not.toHaveBeenCalled();
  });

  it('prefers data.workspaceId over the envelope workspaceId (self-sufficient payload)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Envelope points at a different (nonexistent) workspace; the payload's
    // own workspaceId must win so the correct entity is updated.
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-attention-data-id',
          workspaceId: 'ws-attention-other',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:attention-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_ATT,
            attention: 'unread',
          },
        },
      },
    });

    const ws = await readWorkspace();
    expect(ws.attention).toBe('unread');
  });
});

describe('daemonEventsBridge (workspace:waiting-changed → workspace slice)', () => {
  const WS_WAIT = 'ws-waiting-1';

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
        id: WS_WAIT,
        title: 'Waiting ws',
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

  async function readWorkspace(): Promise<{ waiting?: boolean }> {
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return (getItem(state.workspace.workspaces as never, WS_WAIT) ?? {}) as never;
  }

  function waitingChangedNotification(waiting: boolean) {
    return {
      method: 'events.event',
      params: {
        event: {
          id: `evt-waiting-${waiting}`,
          workspaceId: WS_WAIT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:waiting-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_WAIT,
            waiting,
          },
        },
      },
    };
  }

  it('subscribes to workspace:waiting-changed in the bridge firehose filter', () => {
    expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).toContain('workspace:waiting-changed');
  });

  it('merges waiting=true onto the workspace entity', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(waitingChangedNotification(true));

    const ws = await readWorkspace();
    expect(ws.waiting).toBe(true);
  });

  it('merges waiting=false onto the workspace entity (transition back)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(waitingChangedNotification(true));
    let ws = await readWorkspace();
    expect(ws.waiting).toBe(true);

    handler(waitingChangedNotification(false));
    ws = await readWorkspace();
    expect(ws.waiting).toBe(false);
  });

  it('is a no-op when the waiting value is not a boolean', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(waitingChangedNotification(true));
    let ws = await readWorkspace();
    expect(ws.waiting).toBe(true);

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-waiting-bad',
          workspaceId: WS_WAIT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:waiting-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_WAIT,
            waiting: 'yes',
          },
        },
      },
    });

    ws = await readWorkspace();
    expect(ws.waiting).toBe(true);
  });

  it('is a no-op when data is missing', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(waitingChangedNotification(true));
    let ws = await readWorkspace();
    expect(ws.waiting).toBe(true);

    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-waiting-no-data',
          workspaceId: WS_WAIT,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:waiting-changed',
          actor: { type: 'system' },
        },
      },
    });

    ws = await readWorkspace();
    expect(ws.waiting).toBe(true);
  });

  it('prefers data.workspaceId over the envelope workspaceId (self-sufficient payload)', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Envelope points at a different (nonexistent) workspace; the payload's
    // own workspaceId must win so the correct entity is updated.
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-waiting-data-id',
          workspaceId: 'ws-waiting-other',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:waiting-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_WAIT,
            waiting: true,
          },
        },
      },
    });

    const ws = await readWorkspace();
    expect(ws.waiting).toBe(true);
  });

  it('applies a self-sufficient payload even when the envelope workspaceId is absent', async () => {
    await seedWorkspace();
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // A relay that strips the envelope workspaceId must not gate out the
    // event — the payload carries its own workspaceId (§6.7).
    handler({
      method: 'events.event',
      params: {
        event: {
          id: 'evt-waiting-no-envelope-id',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'workspace:waiting-changed',
          actor: { type: 'system' },
          data: {
            workspaceId: WS_WAIT,
            waiting: true,
          },
        },
      },
    });

    const ws = await readWorkspace();
    expect(ws.waiting).toBe(true);
  });
});

// A workspace:attention-changed / waiting-changed / displayStatus-changed
// delta targeting a workspace this window has not hydrated yet used to be
// silently dropped (the bulkUpdateWorkspaceEntities reducer is a no-op for
// unknown ids). The bridge must recover via a targeted single-flight
// workspace.get that seeds the entity carrying the fresh flag.
describe('daemonEventsBridge (dropped deltas for unhydrated workspaces → targeted refetch)', () => {
  beforeAll(() => appStore.init());

  beforeEach(() => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  async function makeWorkspace(
    id: string,
    extra: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { WorkspaceStatus } = await import('$shared/types');
    return {
      id,
      title: 'Unhydrated ws',
      branch: 'main',
      status: WorkspaceStatus.Active,
      changesets: [],
      timeline: [],
      conversationInfo: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...extra,
    };
  }

  async function readWorkspace(id: string): Promise<Record<string, unknown> | undefined> {
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    return getItem(state.workspace.workspaces as never, id as never) as never;
  }

  function changedNotification(type: string, workspaceId: string, data: Record<string, unknown>) {
    return {
      method: 'events.event',
      params: {
        event: {
          id: `evt-${type}-${workspaceId}`,
          workspaceId,
          timestamp: '2026-01-02T00:00:00.000Z',
          type,
          actor: { type: 'system' },
          data: { workspaceId, ...data },
        },
      },
    };
  }

  function mockWorkspaceGet(workspace: Record<string, unknown>): void {
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'workspace.get') return { workspace };
      return { subscriptionId: 'sub-1' };
    });
  }

  it('workspace:attention-changed for an unknown workspace refetches workspace.get and seeds the entity with the flag', async () => {
    const WS = 'ws-unhydrated-attention';
    await primeBridge();
    const handler = capturedHandlers[0]!;
    mockWorkspaceGet(await makeWorkspace(WS, { attention: 'unread' }));

    expect(await readWorkspace(WS)).toBeUndefined();
    handler(changedNotification('workspace:attention-changed', WS, { attention: 'unread' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS });
    expect((await readWorkspace(WS))?.attention).toBe('unread');
  });

  it('workspace:waiting-changed for an unknown workspace refetches workspace.get and seeds the entity with the flag', async () => {
    const WS = 'ws-unhydrated-waiting';
    await primeBridge();
    const handler = capturedHandlers[0]!;
    mockWorkspaceGet(await makeWorkspace(WS, { waiting: true }));

    expect(await readWorkspace(WS)).toBeUndefined();
    handler(changedNotification('workspace:waiting-changed', WS, { waiting: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS });
    expect((await readWorkspace(WS))?.waiting).toBe(true);
  });

  it('workspace:displayStatus-changed for an unknown workspace refetches workspace.get and seeds the entity with the flag', async () => {
    const WS = 'ws-unhydrated-display-status';
    await primeBridge();
    const handler = capturedHandlers[0]!;
    mockWorkspaceGet(await makeWorkspace(WS, { displayStatus: 'pr_merged' }));

    expect(await readWorkspace(WS)).toBeUndefined();
    handler(
      changedNotification('workspace:displayStatus-changed', WS, { displayStatus: 'pr_merged' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS });
    expect((await readWorkspace(WS))?.displayStatus).toBe('pr_merged');
  });

  it('does not refetch when the entity is already hydrated (direct merge path)', async () => {
    const WS = 'ws-hydrated-no-refetch';
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    appStore.dispatch(setWorkspaceEntity((await makeWorkspace(WS, {})) as never));
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(changedNotification('workspace:attention-changed', WS, { attention: 'unread' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(backendRequestSpy).not.toHaveBeenCalledWith('workspace.get', expect.anything());
    expect((await readWorkspace(WS))?.attention).toBe('unread');
  });

  it('does not refetch a workspace with a pending local deletion (no tombstone resurrection)', async () => {
    const WS = 'ws-unhydrated-pending-deletion';
    const { markWorkspacePendingDeletion, clearWorkspacePendingDeletion } =
      await import('$store/renderer/slices/workspace/workspace-slice');
    appStore.dispatch(markWorkspacePendingDeletion(WS));
    try {
      await primeBridge();
      const handler = capturedHandlers[0]!;
      mockWorkspaceGet(await makeWorkspace(WS, { attention: 'unread' }));

      handler(changedNotification('workspace:attention-changed', WS, { attention: 'unread' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(backendRequestSpy).not.toHaveBeenCalledWith('workspace.get', expect.anything());
      expect(await readWorkspace(WS)).toBeUndefined();
    } finally {
      appStore.dispatch(clearWorkspacePendingDeletion(WS));
    }
  });

  it('ignores workspace.get errors gracefully', async () => {
    const WS = 'ws-unhydrated-fetch-error';
    await primeBridge();
    const handler = capturedHandlers[0]!;
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'workspace.get') throw new Error('Workspace not found');
      return { subscriptionId: 'sub-1' };
    });

    handler(changedNotification('workspace:attention-changed', WS, { attention: 'unread' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS });
    expect(await readWorkspace(WS)).toBeUndefined();
  });

  // AGENTS.md "Event-driven refetches — single-flight and coalesced": a burst
  // of deltas for one missing workspace must not fan out one independent
  // workspace.get per event — an unordered resolution could let a stale
  // response landing last overwrite a newer flag value.
  it('a burst of deltas for one unknown workspace collapses to one immediate fetch plus at most one trailing fetch', async () => {
    const WS = 'ws-unhydrated-burst';
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const fresh = await makeWorkspace(WS, { attention: 'unread', waiting: true });

    // Every workspace.get stays pending until explicitly resolved below, so
    // extra fetches a regressed implementation would start are counted
    // deterministically.
    const pendingFetches: Array<(value: unknown) => void> = [];
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method !== 'workspace.get') return { subscriptionId: 'sub-1' };
      return new Promise((resolve) => {
        pendingFetches.push(resolve);
      });
    });

    handler(changedNotification('workspace:attention-changed', WS, { attention: 'unread' }));
    handler(changedNotification('workspace:waiting-changed', WS, { waiting: true }));
    handler(
      changedNotification('workspace:displayStatus-changed', WS, { displayStatus: 'pr_merged' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Leading edge: exactly one immediate fetch despite three triggers.
    expect(pendingFetches).toHaveLength(1);

    pendingFetches[0]!({ workspace: fresh });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Trailing coalesce: the triggers that arrived mid-flight collapsed into
    // exactly one follow-up fetch.
    expect(pendingFetches).toHaveLength(2);
    pendingFetches[1]!({ workspace: fresh });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(pendingFetches).toHaveLength(2);
    expect((await readWorkspace(WS))?.attention).toBe('unread');
    expect((await readWorkspace(WS))?.waiting).toBe(true);
  });

  // Regression (PR #1814 review): the in-flight check must run before the
  // entity-presence check. If another path hydrates the entity while a
  // missing-entity fetch is in flight, a delta arriving afterwards merges into
  // the now-present entity — but the older in-flight fetch can resolve last
  // and overwrite the merged flag with its stale projection. The delta must
  // queue a trailing fetch (whose projection postdates it) so the store
  // converges on the fresh value.
  it('queues a trailing fetch when a delta arrives after another path hydrated the entity mid-flight', async () => {
    const WS = 'ws-hydrated-mid-flight';
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const stale = await makeWorkspace(WS, {});
    const fresh = await makeWorkspace(WS, { attention: 'unread' });

    const pendingFetches: Array<(value: unknown) => void> = [];
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method !== 'workspace.get') return { subscriptionId: 'sub-1' };
      return new Promise((resolve) => {
        pendingFetches.push(resolve);
      });
    });

    // Delta for a missing workspace starts the leading fetch (stays pending).
    handler(changedNotification('workspace:waiting-changed', WS, { waiting: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pendingFetches).toHaveLength(1);

    // Another path (e.g. a workspace.list response) hydrates the entity.
    appStore.dispatch(setWorkspaceEntity(stale as never));

    // A newer delta merges into the now-present entity and — despite the
    // presence — must queue a trailing fetch because one is still in flight.
    handler(changedNotification('workspace:attention-changed', WS, { attention: 'unread' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await readWorkspace(WS))?.attention).toBe('unread');

    // The stale leading fetch resolves LAST and clobbers the merged flag…
    pendingFetches[0]!({ workspace: stale });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // …but the trailing fetch (post-delta projection) restores convergence.
    expect(pendingFetches).toHaveLength(2);
    pendingFetches[1]!({ workspace: fresh });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await readWorkspace(WS))?.attention).toBe('unread');
  });
});

describe('daemonEventsBridge (completion-watch refresh routing)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    appStore.init();
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it.each([
    'agent:idle',
    'agent:failed',
    'agent:deleted',
    'agent:created',
    'agent:subscriptions-changed',
  ])(
    "%s dispatches refreshWorkspaceSubscriptionEntriesRequested for the event's workspace",
    async (eventType) => {
      await primeBridge();
      const handler = capturedHandlers[0]!;
      const dispatchSpy = vi.spyOn(appStore, 'dispatch');

      handler(notification(eventType, { agentId: AGENT }));

      expect(dispatchSpy).toHaveBeenCalledWith(refreshWorkspaceSubscriptionEntriesRequested(WS));
      dispatchSpy.mockRestore();
    },
  );

  it('non-completion agent events do not trigger a subscription refresh (except status-changed/idle which refresh the changed agent instead)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');

    handler(notification('agent:renamed', { agentId: AGENT, name: 'Renamed' }));

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: refreshWorkspaceSubscriptionEntriesRequested.type }),
    );
    dispatchSpy.mockRestore();
  });
});

describe('daemonEventsBridge (STAB-9 — agent:status-changed / agent:idle refresh only the changed agent)', () => {
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

  it('agent:status-changed refreshes only the changed agent (no whole-list hydrate)', async () => {
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

    expect(refreshAgentSessionAfterEventSpy).toHaveBeenCalledWith(AGENT);
    expect(dispatchSpy).not.toHaveBeenCalledWith(hydrateAgentsRequested(WS));

    // Restore the getter to prevent leakage
    dispatchGetterSpy.mockRestore();
  });

  it('agent:idle refreshes only the changed agent (no whole-list hydrate)', async () => {
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

    expect(refreshAgentSessionAfterEventSpy).toHaveBeenCalledWith(AGENT);
    expect(dispatchSpy).not.toHaveBeenCalledWith(hydrateAgentsRequested(WS));

    // Restore the getter to prevent leakage
    dispatchGetterSpy.mockRestore();
  });

  it('falls back to hydrateAgentsRequested(workspaceId) when the payload carries no agentId', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const hydrateAgentsRequested =
      await import('$store/renderer/slices/workspace-agents/workspace-agents-slice').then(
        (m) => m.hydrateAgentsRequested,
      );

    const originalDispatch = appStore.dispatch;
    const dispatchSpy = vi.fn(originalDispatch);
    const dispatchGetterSpy = vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatchSpy);

    handler(notification('agent:idle', {}));

    expect(refreshAgentSessionAfterEventSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(hydrateAgentsRequested(WS));

    dispatchGetterSpy.mockRestore();
  });
});

describe('daemonEventsBridge (agent:last-message §6.5 — preview projections applied with zero RPCs)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    appStore.init();
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    loadChatTranscriptSpy.mockClear();
    ensureAgentSessionSpy.mockClear();
  });

  it('applies ALL preview projections from an assistant echo with zero follow-up RPCs', async () => {
    seedSession({
      lastAgentResponse: 'old response',
      lastUserMessage: 'old user line',
      lastMessageRole: 'user',
    });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a1',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a1',
        lastAgentResponse: 'fresh assistant text',
        lastToolUse: { name: 'view', input: { path: 'src/a.ts' } },
      }),
    );
    await flush();

    const session = appStore.state.agentSessions.byAgentId[AGENT]!;
    expect(session.lastAgentResponse).toBe('fresh assistant text');
    expect(session.lastMessageRole).toBe('assistant');
    expect(session.lastMessageId).toBe('msg-a1');
    expect(session.lastToolUse).toEqual({ name: 'view', input: { path: 'src/a.ts' } });
    // ZERO RPCs: no transcript page walk, no agent.get refresh.
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
    expect(ensureAgentSessionSpy).not.toHaveBeenCalled();
  });

  it('applies the user-row echo (lastUserMessage + role) and derives hasUnread=false', async () => {
    seedSession({
      lastAgentResponse: 'prior response',
      lastMessageRole: 'assistant',
      lastMessageId: 'msg-a0',
      hasUnread: true,
    });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-u1',
        role: 'user',
        lastMessageRole: 'user',
        lastMessageId: 'msg-u1',
        lastUserMessage: 'follow-up question',
      }),
    );
    await flush();

    const session = appStore.state.agentSessions.byAgentId[AGENT]!;
    expect(session.lastUserMessage).toBe('follow-up question');
    expect(session.lastMessageRole).toBe('user');
    expect(session.lastMessageId).toBe('msg-u1');
    // Newest message is the user's own — not unread.
    expect(session.hasUnread).toBe(false);
    // The prior assistant preview is untouched (metadata-only merge).
    expect(session.lastAgentResponse).toBe('prior response');
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
    expect(ensureAgentSessionSpy).not.toHaveBeenCalled();
  });

  it('derives hasUnread=true from an assistant echo when no seen marker matches', async () => {
    seedSession({ hasUnread: false });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a2',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a2',
        lastAgentResponse: 'done',
      }),
    );
    await flush();

    expect(appStore.state.agentSessions.byAgentId[AGENT]!.hasUnread).toBe(true);
  });

  it('keeps hasUnread=false for a background agent on an assistant echo', async () => {
    seedSession({ isBackground: true, hasUnread: false });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a3',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a3',
        lastAgentResponse: 'background work done',
      }),
    );
    await flush();

    expect(appStore.state.agentSessions.byAgentId[AGENT]!.hasUnread).toBe(false);
  });

  it('keeps hasUnread=false for a background agent (metadata.isBackground, the wire location per PROTOCOL §5.5) on an assistant echo', async () => {
    seedSession({ metadata: { isBackground: true }, hasUnread: false });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a5',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a5',
        lastAgentResponse: 'background work done',
      }),
    );
    await flush();

    expect(appStore.state.agentSessions.byAgentId[AGENT]!.hasUnread).toBe(false);
  });

  it('keeps hasUnread=false for a delegated child agent on an assistant echo', async () => {
    seedSession({
      metadata: { createdByAgentId: 'agent-parent' },
      hasUnread: false,
    });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a4',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a4',
        lastAgentResponse: 'child work done',
      }),
    );
    await flush();

    expect(appStore.state.agentSessions.byAgentId[AGENT]!.hasUnread).toBe(false);
  });

  it('clears lastToolUse when the echo omits it (persisted preview cleared)', async () => {
    seedSession({ lastToolUse: { name: 'str-replace-editor' } });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a3',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a3',
        lastAgentResponse: 'plain text answer',
      }),
    );
    await flush();

    expect(appStore.state.agentSessions.byAgentId[AGENT]!.lastToolUse).toBeUndefined();
  });

  it('clears a stale lastAgentResponse on a tool-only assistant echo (absence means cleared)', async () => {
    // A text-free assistant row (tool_use only) omits lastAgentResponse on the
    // echo because the daemon overwrote the persisted preview column with an
    // empty derivation. Retaining the previous turn's response here would
    // outrank the fresh tool chip on every preview surface.
    seedSession({
      lastAgentResponse: 'previous turn response',
      lastUserMessage: 'kept user line',
      lastMessageRole: 'assistant',
    });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-tool-only',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-tool-only',
        lastToolUse: { name: 'launch-process', input: { command: 'ls' } },
      }),
    );
    await flush();

    const session = appStore.state.agentSessions.byAgentId[AGENT]!;
    expect(session.lastAgentResponse).toBeUndefined();
    expect(session.lastToolUse).toEqual({ name: 'launch-process', input: { command: 'ls' } });
    // The user preview column was untouched by the assistant append.
    expect(session.lastUserMessage).toBe('kept user line');
  });

  it('leaves lastUserMessage alone on an assistant echo and vice versa (other-role column untouched)', async () => {
    seedSession({
      lastAgentResponse: 'assistant kept',
      lastUserMessage: 'user kept',
    });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // A user echo omitting lastUserMessage (text-free user row) clears the
    // user preview but never the assistant one.
    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-u-empty',
        role: 'user',
        lastMessageRole: 'user',
        lastMessageId: 'msg-u-empty',
      }),
    );
    await flush();

    const session = appStore.state.agentSessions.byAgentId[AGENT]!;
    expect(session.lastUserMessage).toBeUndefined();
    expect(session.lastAgentResponse).toBe('assistant kept');
  });

  it('does not clobber a loaded transcript (metadata-only merge)', async () => {
    const loaded: AgentMessage[] = [
      {
        id: 'msg-old',
        role: 'assistant',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'text', text: 'loaded transcript row' }],
      } as AgentMessage,
    ];
    seedSession({ messages: loaded });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a4',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a4',
        lastAgentResponse: 'newer preview',
      }),
    );
    await flush();

    const session = appStore.state.agentSessions.byAgentId[AGENT]!;
    expect(session.messages.map((message) => message.id)).toEqual(['msg-old']);
    expect(session.lastAgentResponse).toBe('newer preview');
  });

  it('defers the apply through ensureAgentSession for an unknown session', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: 'agent-unknown',
        messageId: 'msg-a5',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a5',
        lastAgentResponse: 'hello',
      }),
    );
    await flush();

    // The withHydratedSession seam fetches the session shell once — never a
    // transcript page walk.
    expect(ensureAgentSessionSpy).toHaveBeenCalledWith('agent-unknown');
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('ignores a system-role echo beyond flipping the daemon-capability flag', async () => {
    seedSession({ lastAgentResponse: 'kept' });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-sys',
        role: 'system',
      }),
    );
    await flush();

    expect(appStore.state.agentSessions.byAgentId[AGENT]!.lastAgentResponse).toBe('kept');
    // The flag flipped: a subsequent agent:message no longer refreshes.
    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-x', role: 'assistant' }),
    );
    await flush();
    expect(ensureAgentSessionSpy).not.toHaveBeenCalled();
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed lastToolUse payload whole (missing name)', async () => {
    seedSession({ lastToolUse: { name: 'old-tool' } });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-a6',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-a6',
        lastToolUse: { input: { path: 'x' } },
      }),
    );
    await flush();

    expect(appStore.state.agentSessions.byAgentId[AGENT]!.lastToolUse).toBeUndefined();
  });
});

describe('daemonEventsBridge (STAB-22 back-compat — agent:message falls back to a light agent.get refresh)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    appStore.init();
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    loadChatTranscriptSpy.mockClear();
    ensureAgentSessionSpy.mockClear();
  });

  it('agent:message on an older daemon triggers the ensureAgentSession refresh — never a transcript walk', async () => {
    seedSession({ messages: [] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-1', role: 'assistant' }),
    );
    await flush();

    expect(ensureAgentSessionSpy).toHaveBeenCalledWith(AGENT);
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('coalesces refreshes single-flight: N events during one in-flight fetch produce at most 1 follow-up', async () => {
    seedSession({ messages: [] });
    let resolveFirst: (() => void) | undefined;
    ensureAgentSessionSpy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = () => resolve();
        }) as never,
    );
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-1', role: 'assistant' }),
    );
    handler(notification('agent:message', { agentId: AGENT, messageId: 'msg-2', role: 'user' }));
    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-3', role: 'assistant' }),
    );
    expect(ensureAgentSessionSpy).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flush();
    // Trailing coalesce: the burst collapsed into exactly one follow-up.
    expect(ensureAgentSessionSpy).toHaveBeenCalledTimes(2);
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('retires the fallback once the daemon emits agent:last-message', async () => {
    seedSession({ messages: [] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:last-message', {
        agentId: AGENT,
        messageId: 'msg-1',
        role: 'assistant',
        lastMessageRole: 'assistant',
        lastMessageId: 'msg-1',
        lastAgentResponse: 'text',
      }),
    );
    await flush();
    ensureAgentSessionSpy.mockClear();

    handler(
      notification('agent:message', { agentId: AGENT, messageId: 'msg-1', role: 'assistant' }),
    );
    await flush();

    expect(ensureAgentSessionSpy).not.toHaveBeenCalled();
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('ignores system-role agent:message echoes (no refresh)', async () => {
    seedSession({ messages: [] });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(notification('agent:message', { agentId: AGENT, messageId: 'msg-1', role: 'system' }));
    await flush();

    expect(ensureAgentSessionSpy).not.toHaveBeenCalled();
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
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
    // Reset workspace/agent focus so a preceding test's openWorkspaceTab
    // does not leak into the "no active workspace" case.
    const { loadWorkspaceTabsState } =
      await import('$store/renderer/slices/tab-state/tab-state-slice');
    const { setActiveAgentId } =
      await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');
    appStore.dispatch(
      loadWorkspaceTabsState({
        openTabs: [],
        currentTabId: null,
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: [],
      }),
    );
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

  it('issues NO transcript fetch on reconnect — the standing chat.subscribe seq-0 snapshot owns it', async () => {
    // Seed enough store state for the reconnect refresh to have a target:
    // an active workspace and an active agent in that workspace. The
    // standing chat.subscribe registration re-registers on the same reconnect
    // signal and its fresh seq-0 snapshot IS the reconciled transcript, so
    // the refresh path must not page agent.getConversation on top of it.
    const { openWorkspaceTab } = await import('$store/renderer/slices/tab-state/tab-state-slice');
    const { setActiveAgentId } =
      await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');
    appStore.dispatch(openWorkspaceTab(WS));
    appStore.dispatch(setActiveAgentId(WS, AGENT));

    await refreshDaemonEventsAfterReconnect(WS);

    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  it('skips coarse-state refresh when no workspace is active (nothing to hydrate)', async () => {
    // No workspace tab opened, so the explicit reconnect scope stays null.
    await refreshDaemonEventsAfterReconnect(null);

    // With no active workspace, the refresh path exits early — no chat load.
    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
  });

  describe('failure-registry reconciliation on reconnect (#2806)', () => {
    beforeEach(() => clearAgentFailureRegistry());
    afterEach(() => clearAgentFailureRegistry());

    it('drops registry entries whose agent no longer exists on the daemon', async () => {
      // agent:deleted fired while the connection was down — the registry
      // still holds the stale entry. The reconnect refresh must verify
      // surviving entries against agent.list and drop the vanished one.
      recordAgentFailure({ agentId: 'agent-gone', workspaceId: WS, error: 'spawn failed' });
      recordAgentFailure({ agentId: 'agent-alive', workspaceId: WS, error: 'spawn failed' });
      backendRequestSpy.mockImplementation((method: string) => {
        if (method === 'agent.list') {
          return Promise.resolve({ agents: [{ id: 'agent-alive', workspaceId: WS }] });
        }
        return Promise.resolve({});
      });

      await refreshDaemonEventsAfterReconnect(null);

      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-alive']);
    });

    it('issues ONE agent.list per distinct workspace — no per-entry fan-out', async () => {
      recordAgentFailure({ agentId: 'agent-a', workspaceId: 'ws-multi-1', error: 'boom' });
      recordAgentFailure({ agentId: 'agent-b', workspaceId: 'ws-multi-1', error: 'boom' });
      recordAgentFailure({ agentId: 'agent-c', workspaceId: 'ws-multi-2', error: 'boom' });
      backendRequestSpy.mockImplementation((method: string) => {
        if (method === 'agent.list') return Promise.resolve({ agents: [] });
        return Promise.resolve({});
      });

      await refreshDaemonEventsAfterReconnect(null);

      const listCalls = backendRequestSpy.mock.calls.filter(([method]) => method === 'agent.list');
      expect(listCalls.map(([, params]) => params)).toEqual(
        expect.arrayContaining([{ workspaceId: 'ws-multi-1' }, { workspaceId: 'ws-multi-2' }]),
      );
      expect(listCalls).toHaveLength(2);
      expect(listAgentFailureEntries()).toHaveLength(0);
    });

    it('keeps a failure recorded while agent.list was in flight (mid-flight addition race)', async () => {
      // An agent spawned + failed during the post-reconnect burst is absent
      // from the in-flight list result; the identity guard (snapshot
      // convention, same as retryAgent's) must keep it — dropping it would
      // silently dismiss a legitimate failure toast.
      recordAgentFailure({ agentId: 'agent-stale', workspaceId: WS, error: 'boom' });
      let resolveList: ((value: unknown) => void) | undefined;
      backendRequestSpy.mockImplementation((method: string) => {
        if (method === 'agent.list') {
          return new Promise((resolve) => {
            resolveList = resolve;
          });
        }
        return Promise.resolve({});
      });

      const refresh = refreshDaemonEventsAfterReconnect(null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // New failure lands while the list is in flight — not in survivorIds.
      recordAgentFailure({ agentId: 'agent-new', workspaceId: WS, error: 'boom' });
      resolveList!({ agents: [] });
      await refresh;

      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-new']);
    });

    it('keeps an entry replaced mid-flight (re-failure while the list was pending)', async () => {
      recordAgentFailure({ agentId: 'agent-re', workspaceId: WS, error: 'first failure' });
      let resolveList: ((value: unknown) => void) | undefined;
      backendRequestSpy.mockImplementation((method: string) => {
        if (method === 'agent.list') {
          return new Promise((resolve) => {
            resolveList = resolve;
          });
        }
        return Promise.resolve({});
      });

      const refresh = refreshDaemonEventsAfterReconnect(null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The same agent re-fails mid-flight: the registry now holds a FRESH
      // entry object the stale list result must not erase.
      recordAgentFailure({ agentId: 'agent-re', workspaceId: WS, error: 'second failure' });
      resolveList!({ agents: [] });
      await refresh;

      const entries = listAgentFailureEntries();
      expect(entries.map((entry) => entry.agentId)).toEqual(['agent-re']);
      expect(entries[0]!.error).toBe('second failure');
    });

    it('keeps entries when agent.list resolves without a verifiable agents array', async () => {
      // A malformed response (missing/non-array `agents`) proves nothing
      // about deletion — treating it as a verified empty list would drop
      // every entry in the workspace. Unverifiable ≠ deleted.
      recordAgentFailure({ agentId: 'agent-a', workspaceId: 'ws-mal-1', error: 'boom' });
      recordAgentFailure({ agentId: 'agent-b', workspaceId: 'ws-mal-2', error: 'boom' });
      backendRequestSpy.mockImplementation((method: string, params?: unknown) => {
        if (method === 'agent.list') {
          const { workspaceId } = params as { workspaceId: string };
          return Promise.resolve(workspaceId === 'ws-mal-1' ? {} : { agents: null });
        }
        return Promise.resolve({});
      });

      await refreshDaemonEventsAfterReconnect(null);

      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual([
        'agent-a',
        'agent-b',
      ]);
    });

    it('keeps entries when agent.list fails for their workspace (fail-safe)', async () => {
      recordAgentFailure({ agentId: 'agent-unknown', workspaceId: WS, error: 'boom' });
      backendRequestSpy.mockImplementation((method: string) => {
        if (method === 'agent.list') return Promise.reject(new Error('transport down'));
        return Promise.resolve({});
      });

      await refreshDaemonEventsAfterReconnect(null);

      // Unverifiable ≠ deleted: the entry survives and live events converge it.
      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-unknown']);
    });

    it('skips the reconciliation entirely when the registry is empty', async () => {
      await refreshDaemonEventsAfterReconnect(null);

      const listCalls = backendRequestSpy.mock.calls.filter(([method]) => method === 'agent.list');
      expect(listCalls).toHaveLength(0);
    });
  });

  describe('agent:failed → chatSendFailed', () => {
    it('dispatches chatSendFailed when agent:failed carries an error message', async () => {
      const agentId = 'agent-failed-1';
      const messageId = 'msg-failed-1';
      const streamId = 'stream-failed-1';
      const turnId = 'turn-failed-1';
      const errorMsg = 'Agent spawn failed after 3 retries';

      appStore.dispatch(upsertSession({ id: agentId, name: 'Test Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0];

      // Start a stream so there's something for agent:failed to finalize
      handler!(
        notification('agent:stream:chunk', {
          agentId,
          content: 'Working',
          messageId,
          blockIndex: 0,
          blockId: `${messageId}:0`,
          blockType: 'text',
          streamId,
        }),
      );

      handler!(
        notification('agent:failed', {
          agentId,
          turnId,
          error: errorMsg,
          status: 'error',
        }),
      );

      const failureTelemetry = reportStreamLifecycleSpy.mock.calls
        .map(([diagnostic]) => diagnostic)
        .filter((diagnostic) => diagnostic.event.startsWith('agent-failed'));
      expect(failureTelemetry).toEqual([
        expect.objectContaining({
          event: 'agent-failed-received',
          turnCorrelation: '66637f77eb5cec86',
          turnIdCorrelation: '12c09885d6571b4e',
          callbackResult: 'received',
        }),
        expect.objectContaining({
          event: 'agent-failed-dispatched',
          turnCorrelation: '66637f77eb5cec86',
          turnIdCorrelation: '12c09885d6571b4e',
          callbackResult: 'dispatched',
        }),
      ]);
      expect(failureTelemetry[0]).not.toHaveProperty('storeStreamState');

      const chatState = appStore.state.chatState.byAgentId[agentId];
      expect(chatState).toBeDefined();
      expect(chatState.error).toBe(errorMsg);
      expect(chatState.failureCorrelation).toEqual({
        turnCorrelation: '66637f77eb5cec86',
        turnIdCorrelation: '12c09885d6571b4e',
      });
    });

    it('keeps turn-only correlation across receipt, dispatch, and store before output', async () => {
      const agentId = 'agent-failed-preoutput';
      const turnId = 'turn-failed-preoutput';
      appStore.dispatch(upsertSession({ id: agentId, name: 'Test Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(
        notification('agent:failed', {
          agentId,
          turnId,
          error: 'failed before output',
          status: 'error',
        }),
      );

      const failureTelemetry = reportStreamLifecycleSpy.mock.calls
        .map(([diagnostic]) => diagnostic)
        .filter((diagnostic) => diagnostic.event.startsWith('agent-failed'));
      expect(failureTelemetry).toEqual([
        expect.objectContaining({
          event: 'agent-failed-received',
          turnIdCorrelation: '1b48e6bf735176c9',
          correlationBasis: 'turn',
          callbackResult: 'received',
        }),
        expect.objectContaining({
          event: 'agent-failed-dispatched',
          turnIdCorrelation: '1b48e6bf735176c9',
          correlationBasis: 'turn',
          callbackResult: 'dispatched',
        }),
      ]);
      expect(failureTelemetry[0]).not.toHaveProperty('turnCorrelation');
      expect(appStore.state.chatState.byAgentId[agentId]?.failureCorrelation).toEqual({
        turnIdCorrelation: '1b48e6bf735176c9',
      });
    });

    it('sets default error message when agent:failed has no explicit error', async () => {
      const agentId = 'agent-failed-2';
      const messageId = 'msg-failed-2';
      const streamId = 'stream-failed-2';

      appStore.dispatch(upsertSession({ id: agentId, name: 'Test Agent', workspaceId: WS }));
      await primeBridge();
      const handler = capturedHandlers[0];

      // Start a stream so there's something for agent:failed to finalize
      handler!(
        notification('agent:stream:chunk', {
          agentId,
          content: 'Working',
          messageId,
          blockIndex: 0,
          blockId: `${messageId}:0`,
          blockType: 'text',
          streamId,
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

    it('skips recordAgentFailure when the payload carries parentAgentId, but still dispatches chatSendFailed', async () => {
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

    it('records the failure when parentAgentId is absent (parentless agent)', async () => {
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
        }),
      );

      const entries = listAgentFailureEntries();
      expect(entries.map((entry) => entry.agentId)).toEqual([agentId]);
      expect(entries[0]!.workspaceId).toBe(WS);
      expect(entries[0]!.error).toBe(errorMsg);
      expect(appStore.state.chatState.byAgentId[agentId]?.error).toBe(errorMsg);
      clearAgentFailureRegistry();
    });

    it('records the failure when parentAgentId is an empty string (older daemon)', async () => {
      const agentId = 'agent-failed-empty-parent';
      const errorMsg = 'boom';
      clearAgentFailureRegistry();

      appStore.dispatch(
        upsertSession({ id: agentId, name: 'Empty-parent Agent', workspaceId: WS }),
      );
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
      expect(appStore.state.chatState.byAgentId[agentId]?.error).toBe(errorMsg);
      clearAgentFailureRegistry();
    });
  });
});

describe('daemonEventsBridge (daemon-side redrive clears stale error banner — monorepo#1106/#1989)', () => {
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
    // FE-initiated but routes through `agent.retry`, NOT the chat-send
    // lifecycle, so the #1044 enqueue-success clear never fires. Confirmed
    // daemon sequence: agent:failed (banner up) → status-changed {error} →
    // status-changed {pending} → {active, isActive:true} →
    // agent:queue:processing carrying the failed turn's ORIGINAL turnId
    // (#1022 stable-across-requeue). The banner must be gone once the
    // redriven turn is running.
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

  it('monorepo#1989 redrive repro: already-promoted record, requeued entry under a new id, no stream:start', async () => {
    // Observed live wire sequence (monorepo#1989): the parked retry record
    // was already promoted at the FIRST drain, the failed message is
    // requeued under a NEW entry id (same turnId), and user-message turns
    // never emit agent:stream:start — so the redrive drain is a documented
    // no-op for record promotion (#1057) and the status edge is the ONLY
    // remaining path that can clear the banner.
    const turnId = 'user-msg-bfa0b72f';
    seedSession({ status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // First drain promotes the parked record (#1057) — nothing stays parked.
    appStore.dispatch(
      chatQueuedRetryRecordSet(AGENT, turnId, { text: 'original message' }, turnId),
    );
    handler(
      notification('agent:queue:processing', {
        agentId: AGENT,
        messageId: turnId,
        content: 'original message',
        turnId,
      }),
    );

    handler(
      notification('agent:failed', {
        agentId: AGENT,
        error: 'JSON-RPC error -32603: Internal error: HTTP error: 400 Bad Request',
        status: 'error',
        turnId,
      }),
    );
    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'error', isActive: false }),
    );
    expect(readChatAgent()?.error).toContain('400 Bad Request');

    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'pending', isActive: false }),
    );
    handler(
      notification('agent:status-changed', { agentId: AGENT, status: 'active', isActive: true }),
    );
    // Redrive drain: requeued entry under a NEW id, original turnId.
    handler(
      notification('agent:queue:processing', {
        agentId: AGENT,
        messageId: 'user-msg-5c11d46e',
        content: 'original message',
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
    clearAgentFailureRegistry();

    // Parentless failure: inline banner + failure-registry entry (toast).
    handler(
      notification('agent:failed', {
        agentId: AGENT,
        error: 'previous turn failed',
        status: 'error',
      }),
    );
    expect(readChatAgent()?.error).toBe('previous turn failed');
    expect(listAgentFailureEntries()).toHaveLength(1);

    handler(notification('agent:status-changed', { agentId: AGENT, isActive: true }));

    expect(readChatAgent()?.error).toBeNull();
    // The registry entry drops on the same edge — grouped toast and inline
    // banner never diverge on a status-less isActive:true redrive.
    expect(listAgentFailureEntries()).toHaveLength(0);
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

describe('daemonEventsBridge (changes refresh — git/changes events → refreshRequested)', () => {
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
    Object.defineProperty(appStore, 'dispatch', inheritedPropertyDescriptor(appStore, 'dispatch'));
  });

  function wrapDispatch() {
    const originalGetter = inheritedPropertyDescriptor(appStore, 'dispatch').get!;
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

  it('invalidates accept status immediately for the named event families only', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    wrapDispatch();

    handler(notification('git:commit', { sha: 'abc123' }));
    handler(notification('changes:git-status', { status: { files: [] } }));
    handler(notification('changes:tracked', { changes: [] }));

    expect(
      dispatchCalls.filter((action) => action.type === 'git/acceptChangesStatusInvalidated'),
    ).toEqual([
      { type: 'git/acceptChangesStatusInvalidated', payload: [WS] },
      { type: 'git/acceptChangesStatusInvalidated', payload: [WS] },
    ]);
  });

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

  it('changes:git-status event triggers a debounced refresh for its workspace', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    vi.useFakeTimers();
    wrapDispatch();
    handler(notification('changes:git-status', { workspaceId: WS, status: { files: [] } }));
    vi.advanceTimersByTime(1000);

    expect(dispatchCalls.filter((action) => action.type === 'changes/refreshRequested')).toEqual([
      expect.objectContaining({ type: 'changes/refreshRequested', payload: [WS] }),
    ]);
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
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
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
            messageId: 'msg-recon-1',
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

    // Mock workspace.get to return agent_running. primeBridge calls
    // events.subscribe, so mock the non-workspace.get calls too (the STAB-9
    // per-agent refresh goes through the mocked agent-read-service, not the
    // wire).
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

  // monorepo#1771 / AGENTS.md "Event-driven refetches — single-flight and
  // coalesced": a burst of agent events for one workspace (e.g. an N-agent
  // idle burst when a delegation group settles, plus stream liveness pings)
  // must not fan out one independent workspace.get per event — an unordered
  // resolution could let a stale response landing last overwrite a newer
  // activity value.
  it('a burst of agent:idle / agent:stream:activity events collapses to one immediate fetch plus at most one trailing fetch', async () => {
    await seedWorkspace('idle');
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const { WorkspaceStatus } = await import('$shared/types');
    function workspaceResponse(activity: 'idle' | 'agent_running', updatedAt: string) {
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
          updatedAt,
          activity,
        },
      };
    }

    // Every workspace.get stays pending until explicitly resolved below, so
    // the extra fetches a regressed implementation would start are counted
    // deterministically instead of slipping past a wall-clock sampling
    // window (they'd otherwise land behind awaited dynamic imports).
    const pendingFetches: Array<(value: unknown) => void> = [];
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'agent.list') return { agents: [] };
      if (method !== 'workspace.get') return { subscriptionId: 'sub-1' };
      return new Promise((resolve) => {
        pendingFetches.push(resolve);
      });
    });

    // Drain the microtask/macrotask chains behind the handlers' awaited
    // dynamic imports, so any fetch the implementation would start has
    // actually reached the mock before each count assertion.
    async function settle(): Promise<void> {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Leading edge: exactly one immediate fetch.
    handler(agentIdleNotification());
    await settle();
    expect(pendingFetches.length).toBe(1);

    // Burst of further agent events while that fetch is in flight — they
    // must collapse into the trailing-follow-up flag, never start parallel
    // fetches (unfixed code fans out one fetch per event here).
    handler(agentIdleNotification());
    handler(agentStreamActivityNotification());
    handler(agentIdleNotification());
    await settle();
    expect(pendingFetches.length).toBe(1);

    // Settle the leading-edge fetch with a (now-stale) agent_running
    // snapshot; exactly one trailing fetch fires for the whole burst.
    pendingFetches[0]!(workspaceResponse('agent_running', '2026-01-01T00:00:01.000Z'));
    await settle();
    expect(pendingFetches.length).toBe(2);

    // Events arriving while the TRAILING fetch is in flight must also keep
    // coalescing — the in-flight marker survives into the trailing fetch —
    // instead of starting a parallel fetch.
    handler(agentIdleNotification());
    handler(agentIdleNotification());
    await settle();
    expect(pendingFetches.length).toBe(2);

    // The trailing fetch also resolves stale; the two triggers above
    // collapse into exactly one post-trailing follow-up.
    pendingFetches[1]!(workspaceResponse('agent_running', '2026-01-01T00:00:02.000Z'));
    await settle();
    expect(pendingFetches.length).toBe(3);

    // The follow-up resolves last with the freshest daemon state; its idle
    // result is what lands in the store even though stale agent_running
    // responses resolved before it.
    pendingFetches[2]!(workspaceResponse('idle', '2026-01-02T00:00:00.000Z'));
    await settle();
    expect(pendingFetches.length).toBe(3);
    const ws = await readWorkspace();
    expect(ws.activity).toBe('idle');
  });
});

// monorepo#1712: the HUD card's agent rows are built from
// `workspace.agentSummary.agents` (`agentInfosOf` in hud-selectors.ts), which
// the per-agent `agent.get` refresh path (STAB-9, above) does NOT touch — without a
// `workspace.get` refetch on `agent:deleted` a deleted agent lingers on its
// card until an unrelated workspace refetch.
describe('daemonEventsBridge (agent:deleted → reconcileWorkspaceAgentSummary)', () => {
  const WS_SUMMARY = 'ws-agent-summary-1';

  beforeAll(() => appStore.init());

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    backendRequestSpy.mockReset();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    // The agent:deleted arm registers a pending-deletion tombstone — clear it
    // so it cannot leak across tests.
    const { clearPendingAgentDeletions } =
      await import('$features/agent/utils/pending-agent-deletions');
    clearPendingAgentDeletions();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    const { clearPendingAgentDeletions } =
      await import('$features/agent/utils/pending-agent-deletions');
    clearPendingAgentDeletions();
  });

  async function seedWorkspace(agentIds: string[]): Promise<void> {
    const { setWorkspaceEntity } = await import('$store/renderer/slices/workspace/workspace-slice');
    const { WorkspaceStatus } = await import('$shared/types');
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS_SUMMARY,
        title: 'Agent summary ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        agentSummary: { agentIds },
      } as never),
    );
  }

  async function readAgentSummary(): Promise<{ agentIds: string[] } | undefined> {
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    const ws = getItem(state.workspace.workspaces as never, WS_SUMMARY) as
      { agentSummary?: { agentIds: string[] } } | undefined;
    return ws?.agentSummary;
  }

  function agentDeletedNotification() {
    return {
      method: 'events.event',
      params: {
        event: {
          id: 'evt-agent-deleted-1',
          workspaceId: WS_SUMMARY,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'agent:deleted',
          actor: { type: 'system' },
          data: { agentId: 'agent-deleted-1' },
        },
      },
    };
  }

  it('refetches workspace.get and merges the fresh agentSummary into the store', async () => {
    await seedWorkspace(['agent-deleted-1', 'agent-kept-1']);
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const { WorkspaceStatus } = await import('$shared/types');
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === 'workspace.get') {
        return {
          workspace: {
            id: WS_SUMMARY,
            title: 'Agent summary ws',
            branch: 'main',
            status: WorkspaceStatus.Active,
            changesets: [],
            timeline: [],
            conversationInfo: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            agentSummary: { agentIds: ['agent-kept-1'] },
          },
        };
      }
      return { subscriptionId: 'sub-1' };
    });

    handler(agentDeletedNotification());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_SUMMARY });
    const agentSummary = await readAgentSummary();
    expect(agentSummary?.agentIds).toEqual(['agent-kept-1']);
  });

  it('ignores workspace.get errors gracefully', async () => {
    await seedWorkspace(['agent-deleted-1']);
    await primeBridge();
    const handler = capturedHandlers[0]!;

    backendRequestSpy.mockRejectedValueOnce(new Error('Workspace not found'));

    handler(agentDeletedNotification());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_SUMMARY });
    const agentSummary = await readAgentSummary();
    expect(agentSummary?.agentIds).toEqual(['agent-deleted-1']);
  });

  // An immediate delete (no agent:delete-scheduled grace window) must clean
  // the local slices synchronously — mirroring handleAgentDeleteScheduledEvent
  // — AND still fire the agentSummary reconcile (monorepo#1712).
  it('removes the tracked session/agent from the slices and still reconciles agentSummary', async () => {
    const DELETED = 'agent-deleted-1';
    const session: AgentSession = {
      id: DELETED,
      backendSessionId: 'backend-del',
      workspaceId: WS_SUMMARY,
      name: 'Doomed',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AgentSession;
    appStore.dispatch(bulkUpsertSessions([session]));
    appStore.dispatch(upsertSession(session));
    appStore.dispatch(setAgents(WS_SUMMARY, [session]));
    await seedWorkspace([DELETED, 'agent-kept-1']);
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const before = appStore.state as {
      agentSessions: { byAgentId: Record<string, unknown> };
      workspaceAgents: { byWorkspaceId: Record<string, { agentIds?: string[] }> };
    };
    expect(before.agentSessions.byAgentId[DELETED]).toBeDefined();
    expect(before.workspaceAgents.byWorkspaceId[WS_SUMMARY]?.agentIds ?? []).toContain(DELETED);

    handler(agentDeletedNotification());

    // Slice cleanup is synchronous — no refetch needed to converge.
    const after = appStore.state as typeof before;
    expect(after.agentSessions.byAgentId[DELETED]).toBeUndefined();
    expect(after.workspaceAgents.byWorkspaceId[WS_SUMMARY]?.agentIds ?? []).not.toContain(DELETED);

    // The agentSummary reconcile still fires (monorepo#1712 regression guard).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(backendRequestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: WS_SUMMARY });
  });

  // An `agent.list`/`agent.get` begun before agent:deleted can return the
  // pre-delete row after the synchronous removals; without a tombstone the
  // hydration path would resurrect the agent. Immediate deletes have no
  // agent:delete-scheduled entry, so the deleted arm must register one.
  it('registers a pending-deletion tombstone so a stale refetch cannot resurrect the agent', async () => {
    const DELETED = 'agent-deleted-1';
    const { isAgentDeletionPending } =
      await import('$features/agent/utils/pending-agent-deletions');
    expect(isAgentDeletionPending(DELETED)).toBe(false);

    await seedWorkspace([DELETED]);
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(agentDeletedNotification());

    expect(isAgentDeletionPending(DELETED)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  // AGENTS.md "Event-driven refetches — single-flight and coalesced": a burst
  // of agent:deleted events must not fan out one independent workspace.get
  // per event — an unordered resolution could let a stale response landing
  // last restore an already-deleted agent into agentSummary.
  it('a burst of agent:deleted events collapses to one immediate fetch plus at most one trailing fetch', async () => {
    await seedWorkspace(['agent-deleted-1', 'agent-deleted-2', 'agent-kept-1']);
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const { WorkspaceStatus } = await import('$shared/types');
    function workspaceResponse(agentIds: string[], updatedAt: string) {
      return {
        workspace: {
          id: WS_SUMMARY,
          title: 'Agent summary ws',
          branch: 'main',
          status: WorkspaceStatus.Active,
          changesets: [],
          timeline: [],
          conversationInfo: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt,
          agentSummary: { agentIds },
        },
      };
    }

    let resolveFirstFetch: ((value: unknown) => void) | undefined;
    let workspaceGetCalls = 0;
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method !== 'workspace.get') return { subscriptionId: 'sub-1' };
      workspaceGetCalls += 1;
      if (workspaceGetCalls === 1) {
        // The leading-edge fetch stays pending until we explicitly resolve
        // it below, so every burst event below fires while it's in flight.
        return new Promise((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      // Trailing fetch: freshest state, reflecting BOTH deletions.
      return workspaceResponse(['agent-kept-1'], '2026-01-02T00:00:00.000Z');
    });

    // Leading edge: starts the first (still-pending) fetch immediately. The
    // in-flight flag is set synchronously inside the handler, but the mocked
    // `backendRequest` call itself lands after a microtask (dynamic import),
    // so give it a tick to actually fire before asserting the count.
    handler(agentDeletedNotification());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(workspaceGetCalls).toBe(1);

    // Burst of further agent:deleted events while the fetch is in flight —
    // must collapse into at most one trailing fetch, not one per event.
    handler(agentDeletedNotification());
    handler(agentDeletedNotification());
    handler(agentDeletedNotification());
    expect(workspaceGetCalls).toBe(1);

    // Settle the leading-edge fetch with a (now-stale) single-deletion
    // snapshot; the trailing fetch should fire immediately after and its
    // fresher result must be what lands in the store.
    resolveFirstFetch?.(
      workspaceResponse(['agent-deleted-2', 'agent-kept-1'], '2026-01-01T00:00:01.000Z'),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(workspaceGetCalls).toBe(2);
    const agentSummary = await readAgentSummary();
    expect(agentSummary?.agentIds).toEqual(['agent-kept-1']);
  });
});

describe('DaemonEventsBridge — app-UI events', () => {
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

  function appWorkspaceOpenNotification(
    workspaceId: string,
    openInNewWindow?: boolean,
    eventId = `evt-app-workspace-open-${Math.random().toString(36).slice(2, 8)}`,
  ) {
    const data: Record<string, unknown> = { workspaceId };
    if (openInNewWindow !== undefined) data.openInNewWindow = openInNewWindow;
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: eventId,
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

      handler(
        appUiNavigateNotification('/settings?tab=connections#mcp-servers', 'mcp-servers', 750),
      );
      await flush();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(navigateToRouteSpy).toHaveBeenCalledWith('/settings?tab=connections#mcp-servers');
      // Check that requestUiHighlight was dispatched
      const state = appStore.state as {
        uiHighlight?: {
          activeById: Record<string, number>;
          durationMsById: Record<string, number>;
        };
      };
      expect(state.uiHighlight?.activeById['mcp-servers']).toBeGreaterThan(0);
      expect(state.uiHighlight?.durationMsById['mcp-servers']).toBe(750);
    });

    it('resolves a legacy highlight alias to the registry target id', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(
        appUiNavigateNotification(
          '/settings?tab=agents#default-model',
          'quickActions.defaultModel',
          500,
        ),
      );
      await flush();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const state = appStore.state as {
        uiHighlight?: {
          activeById: Record<string, number>;
          durationMsById: Record<string, number>;
        };
      };
      expect(state.uiHighlight?.activeById['utility-default-model']).toBeGreaterThan(0);
      expect(state.uiHighlight?.durationMsById['utility-default-model']).toBe(500);
      expect(state.uiHighlight?.activeById['quickActions.defaultModel']).toBeUndefined();
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

      handler(appUiHighlightNotification('notifications'));
      await flush();

      const state = appStore.state as {
        uiHighlight?: {
          activeById: Record<string, number>;
          durationMsById: Record<string, number>;
        };
      };
      expect(state.uiHighlight?.activeById['notifications']).toBeGreaterThan(0);
      expect(state.uiHighlight?.durationMsById['notifications']).toBeUndefined();
    });

    it('resolves legacy highlight aliases to the registry target id', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiHighlightNotification('quickActions.defaultModel', 900));
      handler(appUiHighlightNotification('theme'));
      await flush();

      const state = appStore.state as {
        uiHighlight?: {
          activeById: Record<string, number>;
          durationMsById: Record<string, number>;
        };
      };
      expect(state.uiHighlight?.activeById['utility-default-model']).toBeGreaterThan(0);
      expect(state.uiHighlight?.durationMsById['utility-default-model']).toBe(900);
      expect(state.uiHighlight?.activeById['quickActions.defaultModel']).toBeUndefined();
      expect(state.uiHighlight?.activeById['appearance']).toBeGreaterThan(0);
      expect(state.uiHighlight?.activeById['theme']).toBeUndefined();
    });

    it('falls back to the raw id when no registry target matches', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;

      handler(appUiHighlightNotification('not-a-registered-target'));
      await flush();

      const state = appStore.state as {
        uiHighlight?: { activeById: Record<string, number> };
      };
      expect(state.uiHighlight?.activeById['not-a-registered-target']).toBeGreaterThan(0);
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

      handler(appWorkspaceOpenNotification('ws-789', true, 'evt-open-ws-789'));
      await flush();

      expect(invokeSpy).toHaveBeenCalledWith('window:open-new', {
        route: '/workspace/ws-789',
        requestId: 'evt-open-ws-789',
      });
      expect(navigateToRouteSpy).not.toHaveBeenCalled();
    });

    it('falls back to navigation when new window fails', async () => {
      await primeBridge();
      const handler = capturedHandlers[0]!;
      invokeSpy.mockRejectedValueOnce(new Error('Window creation failed'));

      handler(appWorkspaceOpenNotification('ws-fallback', true, 'evt-open-ws-fallback'));
      await flush();

      expect(invokeSpy).toHaveBeenCalledWith('window:open-new', {
        route: '/workspace/ws-fallback',
        requestId: 'evt-open-ws-fallback',
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

      handler(appWorkspaceOpenNotification('ws-success-false', true, 'evt-open-ws-failure'));
      await flush();

      expect(invokeSpy).toHaveBeenCalledWith('window:open-new', {
        route: '/workspace/ws-success-false',
        requestId: 'evt-open-ws-failure',
      });
      expect(navigateToRouteSpy).toHaveBeenCalledWith('/workspace/ws-success-false');
    });
  });
});

describe('daemonEventsBridge (create-progress wire contract — git:clone:progress/done → workspaceCreateProgress slice)', () => {
  const PROGRESS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  /**
   * PROTOCOL §5.1/§6.5 create-scoped clone frame: the envelope `workspaceId`
   * is the server-minted id the FE does not know mid-create, so the bridge
   * must correlate by `data.progressId` alone. An empty workspaceId (the
   * standalone `git.clone` shape) exercises the pre-gate routing.
   */
  function cloneNotification(
    eventType: 'git:clone:progress' | 'git:clone:done',
    data: Record<string, unknown>,
    workspaceId = '',
  ) {
    return {
      method: 'events.event' as const,
      params: {
        event: {
          id: `evt-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
          workspaceId,
          timestamp: '2026-01-02T00:00:00.000Z',
          type: eventType,
          actor: { type: 'system' },
          data,
        },
      },
    };
  }

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    appStore.dispatch(clearWorkspaceCreateProgress(PROGRESS_ID));
  });

  afterEach(() => vi.clearAllMocks());

  it('folds a progress frame into the registered entry despite an empty envelope workspaceId', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    appStore.dispatch(beginWorkspaceCreateProgress(PROGRESS_ID));

    handler(
      cloneNotification('git:clone:progress', {
        progressId: PROGRESS_ID,
        phase: 'receiving',
        percent: 45,
        message: 'Receiving objects: 45%',
      }),
    );

    expect(selectWorkspaceCreateProgress.select(appStore.state, PROGRESS_ID)).toEqual({
      phase: 'receiving',
      percent: 45,
      message: 'Receiving objects: 45%',
      sawFrame: true,
      done: false,
    });
  });

  it('folds a progress frame scoped to the server-minted workspaceId too', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    appStore.dispatch(beginWorkspaceCreateProgress(PROGRESS_ID));

    handler(
      cloneNotification(
        'git:clone:progress',
        { progressId: PROGRESS_ID, phase: 'submodules', percent: 72 },
        'ws-server-minted',
      ),
    );

    expect(selectWorkspaceCreateProgress.select(appStore.state, PROGRESS_ID)).toMatchObject({
      phase: 'submodules',
      percent: 72,
    });
  });

  it('marks the entry terminal on git:clone:done with ok', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    appStore.dispatch(beginWorkspaceCreateProgress(PROGRESS_ID));

    handler(cloneNotification('git:clone:done', { progressId: PROGRESS_ID, ok: true }));

    expect(selectWorkspaceCreateProgress.select(appStore.state, PROGRESS_ID)).toMatchObject({
      done: true,
      ok: true,
    });
  });

  it('carries error + errorCode on a failed done frame', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    appStore.dispatch(beginWorkspaceCreateProgress(PROGRESS_ID));

    handler(
      cloneNotification('git:clone:done', {
        progressId: PROGRESS_ID,
        ok: false,
        error: 'fatal: could not read Username',
        errorCode: 'auth-required',
      }),
    );

    expect(selectWorkspaceCreateProgress.select(appStore.state, PROGRESS_ID)).toMatchObject({
      done: true,
      ok: false,
      error: 'fatal: could not read Username',
      errorCode: 'auth-required',
    });
  });

  it('ignores frames whose progressId was never registered (no create in flight)', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      cloneNotification('git:clone:progress', {
        progressId: 'never-registered',
        phase: 'receiving',
        percent: 10,
      }),
    );

    expect(selectWorkspaceCreateProgress.select(appStore.state, 'never-registered')).toBeNull();
  });

  it('leaves frames without a progressId (plain git.clone / older daemon) to the legacy path', async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;
    appStore.dispatch(beginWorkspaceCreateProgress(PROGRESS_ID));

    handler(
      cloneNotification('git:clone:progress', {
        requestId: 'clone-1',
        phase: 'receiving',
        percent: 45,
      }),
    );

    expect(selectWorkspaceCreateProgress.select(appStore.state, PROGRESS_ID)).toEqual({
      phase: 'starting',
      percent: 0,
      sawFrame: false,
      done: false,
    });
  });
});
