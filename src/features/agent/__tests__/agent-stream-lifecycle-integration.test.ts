/**
 * Agent Stream Lifecycle Integration Tests
 *
 * Tests the REAL agent-stream-lifecycle.ts module exports:
 * - dispatchStreamEvent
 * - registerDomHandler / unregisterDomHandler
 * - replayPendingEvents / clearPendingEvents
 *
 * Mocks only external dependencies (window.electronAPI, DOM, Redux, etc.),
 * never the module under test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock('$lib/electron-bridge', async () =>
  await import('$lib/store/utils/test-helpers/electron-bridge-mock'),
);
vi.mock('$lib/utils/client-logger', async () =>
  await import('$lib/store/utils/test-helpers/client-logger-mock'),
);
vi.mock('$shared/types/branded-ids', () => ({
  createMessageId: (id: string) => id,
  WorkspaceId: (id: string) => id,
}));
vi.mock('$shared/types', () => ({
  AgentStatus: { Active: 'active', Idle: 'idle' },
  normalizeContentBlocks: (blocks: any[]) => blocks,
}));
vi.mock('$shared/utils/content-block-utils', () => ({
  buildOrderedContentBlocks: vi.fn(() => []),
}));
vi.mock('$shared/types/agent-session', () => ({
  AgentActivationState: { ACTIVE: 'active', ACTIVATING: 'activating' },
}));
vi.mock('$features/agent/services/performance-optimizer', () => ({
  performanceOptimizer: { track: vi.fn((_k: string, fn: () => any) => fn()) },
}));
vi.mock('../browser', () => ({
  agentIpcProxy: { activateAgent: vi.fn() },
  errorBoundary: { wrap: vi.fn((fn: any) => fn()) },
  persistenceService: { saveSession: vi.fn() },
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-slice', () => ({
  upsertAgentSession: vi.fn(),
  setAgentStreaming: vi.fn(),
  addAgentMessage: vi.fn(),
  updateAgentMessage: vi.fn(),
  triggerStreamingSafetyCheck: vi.fn(),
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentById: { select: vi.fn() },
  selectAllWorkspaceAgents: { select: vi.fn(() => []) },
}));
vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: { select: vi.fn() },
}));
vi.mock('../browser/services/error-recovery.service', () => ({
  errorRecovery: { executeWithRecovery: vi.fn() },
  DEFAULT_STRATEGIES: {},
}));
vi.mock('$shared/constants/agent-streaming', () => ({ AGENT_STREAMING_CONFIG: {} }));
vi.mock('../browser/services/request-deduplicator.service', () => ({
  requestDeduplicator: { deduplicate: vi.fn(), clearKey: vi.fn() },
  generateMessageKey: vi.fn(() => 'key'),
}));
vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: vi.fn(() => ({
    getState: vi.fn(() => ({ workspaceAgents: { byWorkspaceId: {} } })),
    dispatch: vi.fn(),
  })),
}));
vi.mock('$lib/store/slices/unread-tracking/unread-tracking-slice', () => ({
  newAssistantMessage: vi.fn(),
}));
vi.mock('$lib/services/analytics', () => ({ track: vi.fn() }));
vi.mock('$lib/logging/logger.svelte', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  LogCategory: { AGENT: 'agent' },
}));
vi.mock('$features/agent/services/error-handler', () => ({
  errorHandler: { handleError: vi.fn() },
  AgentError: class extends Error {},
  ErrorCode: {},
  ErrorCategory: {},
  ErrorSeverity: {},
}));
vi.mock('../../observability/event-collector-client', () => ({
  eventCollector: { collect: vi.fn() },
  AgentEventType: {},
}));
vi.mock('$lib/store/slices/workspace/utils/workspace-metrics', () => ({
  workspaceMetrics: { track: vi.fn() },
}));
vi.mock('../agent-ipc-bridge', () => ({
  resumeSession: vi.fn(),
  saveSession: vi.fn(),
}));
vi.mock('../utils/streaming-invariants', () => ({
  assertStreamingInvariant: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are in place
// ---------------------------------------------------------------------------

import {
  dispatchStreamEvent,
  registerDomHandler,
  unregisterDomHandler,
  replayPendingEvents,
  clearPendingEvents,
} from '../agent-stream-lifecycle';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let dispatchedEvents: CustomEvent[] = [];

function setupWindow() {
  (global as any).window = {
    electronAPI: {
      on: vi.fn(() => 'listener-id'),
      off: vi.fn(),
      offById: vi.fn(),
      removeAllListeners: vi.fn(),
      invoke: vi.fn(),
      send: vi.fn(),
    },
    dispatchEvent: vi.fn((evt: CustomEvent) => {
      dispatchedEvents.push(evt);
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Stream Lifecycle Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupWindow();
    dispatchedEvents = [];
  });

  afterEach(() => {
    // Clean up module-level state
    for (const id of ['session-A', 'session-B', 'session-new', 'session-1']) {
      unregisterDomHandler(id);
      clearPendingEvents(id);
    }
    vi.useRealTimers();
    delete (global as any).window;
  });

  // 1. Queue event before handler registration → replay on register
  it('replays queued events when handler is registered after events arrive', () => {
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'hello' });
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: ' world' });
    expect(dispatchedEvents.length).toBe(0);

    registerDomHandler('session-A');
    replayPendingEvents('session-A');

    expect(dispatchedEvents.length).toBe(2);
    expect(dispatchedEvents[0].detail).toMatchObject({
      type: 'chunk',
      content: 'hello',
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    });
    expect(dispatchedEvents[1].detail).toMatchObject({
      type: 'chunk',
      content: ' world',
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    });
  });

  // 2. Event arrives during replay → newly queued event survives
  it('events arriving after replay go directly to handler', () => {
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'first' });

    registerDomHandler('session-A');
    replayPendingEvents('session-A');
    expect(dispatchedEvents.length).toBe(1);

    // After replay, handler is registered so new events dispatch directly
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'second' });
    expect(dispatchedEvents.length).toBe(2);
    expect(dispatchedEvents[1].detail).toMatchObject({
      type: 'chunk',
      content: 'second',
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    });
  });

  // 3. Unregister → event queued → re-register → both queue and live dispatch preserved
  it('unregister → queue → re-register preserves queued events and live dispatch', () => {
    registerDomHandler('session-A');
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'live1' });
    expect(dispatchedEvents.length).toBe(1);

    unregisterDomHandler('session-A');
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'queued1' });
    expect(dispatchedEvents.length).toBe(1); // queued, not dispatched

    registerDomHandler('session-A');
    replayPendingEvents('session-A');
    expect(dispatchedEvents.length).toBe(2);
    expect(dispatchedEvents[1].detail).toMatchObject({
      type: 'chunk',
      content: 'queued1',
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    });

    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'live2' });
    expect(dispatchedEvents.length).toBe(3);
  });

  // 4. Queue processing triggers re-registration → direct send works
  it('queued-message re-registration triggers direct send during handler wait window', () => {
    dispatchStreamEvent('session-A', 'status', { type: 'status', statusData: 'processing' });
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'data' });
    expect(dispatchedEvents.length).toBe(0);

    registerDomHandler('session-A');
    replayPendingEvents('session-A');
    expect(dispatchedEvents.length).toBe(2);
    expect(dispatchedEvents[0].detail.type).toBe('status');
    expect(dispatchedEvents[1].detail.type).toBe('chunk');

    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'more' });
    expect(dispatchedEvents.length).toBe(3);
  });

  // 5. maxAge boundary: event at T0+29.9s succeeds; at T0+30.1s does not replay
  it('maxAge boundary: event replays at T0+29.9s but not at T0+30.1s', () => {
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'old' });
    vi.advanceTimersByTime(29_900);

    registerDomHandler('session-A');
    replayPendingEvents('session-A');
    expect(dispatchedEvents.length).toBe(1);

    // Second scenario: expired
    unregisterDomHandler('session-A');
    clearPendingEvents('session-A');
    dispatchedEvents = [];

    dispatchStreamEvent('session-B', 'chunk', { type: 'chunk', content: 'expired' });
    vi.advanceTimersByTime(30_100);

    registerDomHandler('session-B');
    replayPendingEvents('session-B');
    expect(dispatchedEvents.length).toBe(0);
  });

  // 6. Mount → unmount → remount does not leak or double-register handlers
  it('mount/unmount/remount does not leak or double-register handlers', () => {
    registerDomHandler('session-A');
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'a' });
    expect(dispatchedEvents.length).toBe(1);

    // Unmount
    unregisterDomHandler('session-A');

    // Remount
    registerDomHandler('session-A');
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'b' });

    // Should get exactly 1 new dispatch (no double-delivery)
    expect(dispatchedEvents.length).toBe(2);
    expect(dispatchedEvents[1].detail).toMatchObject({
      type: 'chunk',
      content: 'b',
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    });

    // Unmount + remount again
    unregisterDomHandler('session-A');
    registerDomHandler('session-A');
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'c' });
    expect(dispatchedEvents.length).toBe(3);
  });

  // 7. Stream ID change mid-session → verify isolation via separate session IDs
  it('stream ID change: events for different sessions are isolated', () => {
    registerDomHandler('session-A');
    registerDomHandler('session-B');

    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'A-data' });
    dispatchStreamEvent('session-B', 'chunk', { type: 'chunk', content: 'B-data' });

    expect(dispatchedEvents.length).toBe(2);
    // Verify events have correct session-specific event names
    expect(dispatchedEvents[0].type).toBe('agent:stream:session-A');
    expect(dispatchedEvents[1].type).toBe('agent:stream:session-B');
  });

  // 8. dispatchStreamEvent with no handler → pending queue → handler registers → events delivered in order
  it('dispatchStreamEvent→queue→handler delivery preserves order across event types', () => {
    // Queue multiple event types with no handler
    dispatchStreamEvent('session-1', 'status', { type: 'status', statusData: 'init' });
    dispatchStreamEvent('session-1', 'chunk', { type: 'chunk', content: 'hello' });
    dispatchStreamEvent('session-1', 'chunk', { type: 'chunk', content: ' world' });
    dispatchStreamEvent('session-1', 'status', { type: 'status', statusData: 'done' });
    expect(dispatchedEvents.length).toBe(0);

    registerDomHandler('session-1');
    replayPendingEvents('session-1');

    expect(dispatchedEvents.length).toBe(4);
    expect(dispatchedEvents[0].detail.type).toBe('status');
    expect(dispatchedEvents[0].detail.statusData).toBe('init');
    expect(dispatchedEvents[1].detail.content).toBe('hello');
    expect(dispatchedEvents[2].detail.content).toBe(' world');
    expect(dispatchedEvents[3].detail.statusData).toBe('done');
  });

  it('adds canonical status fields to dynamic stream events', () => {
    registerDomHandler('session-A');

    dispatchStreamEvent('session-A', 'start', { type: 'start' });
    dispatchStreamEvent('session-A', 'chunk', { type: 'chunk', content: 'hello' });
    dispatchStreamEvent('session-A', 'end', { type: 'end', finishReason: 'provider_stopped' });

    expect(dispatchedEvents[0].detail).toMatchObject({
      type: 'start',
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    });
    expect(dispatchedEvents[1].detail).toMatchObject({
      type: 'chunk',
      content: 'hello',
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    });
    expect(dispatchedEvents[2].detail).toMatchObject({
      type: 'end',
      status: 'idle',
      activationState: null,
      isActive: false,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      stopReason: 'provider_stopped',
    });
  });
});
