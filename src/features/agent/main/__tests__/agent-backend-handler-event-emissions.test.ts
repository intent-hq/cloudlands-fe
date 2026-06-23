/**
 * Audit 2 C2 / C3 — Static regression tests for workspace-event emission sites
 * in `agent-backend-handler.service.ts`.
 *
 * The six lifecycle emit sites (`agent:idle`, `agent:created`, `agent:deleted`,
 * `agent:restored`, `agent:started`, `agent:failed`) used to build raw event
 * literals inline, bypassing `createWorkspaceEvent` and the `WorkspaceEvent`
 * discriminated union. C2 converted all six to use `createWorkspaceEvent`.
 *
 * The four queue events (`agent:queue:updated`, `agent:queue:processing`,
 * `agent:queue:processing-cancelled`, `agent:queue:stale-message`) flow through
 * the typed `emitQueueWorkspaceEvent` helper; C3 added stale-message coverage
 * and tightened the helper signature so the `as any` cast on the event-type
 * argument is no longer needed.
 *
 * These tests scan the source file directly so they remain valid even though
 * the service has no behavioural unit-test harness yet.
 */

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const { mainDispatchMock, loadAgentMock, saveAgentMock, getWindowIdsForWorkspaceMock } = vi.hoisted(
  () => ({
    mainDispatchMock: vi.fn(),
    loadAgentMock: vi.fn(),
    saveAgentMock: vi.fn(),
    getWindowIdsForWorkspaceMock: vi.fn(),
  }),
);

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-intent'),
    getName: vi.fn().mockReturnValue('Intent'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isReady: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {
    getWorkspace: vi.fn(async () => ({ ok: true, data: { title: 'Test Workspace' } })),
  },
}));

vi.mock('../agent-persistence', () => ({
  agentPersistence: {
    loadAgent: loadAgentMock,
    saveAgent: saveAgentMock,
  },
  UnifiedPersistence: {
    getInstance: () => ({ saveAgent: saveAgentMock }),
  },
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: vi.fn(() => ({ agentSubscriptions: { byWorkspaceId: {} } })),
  mainDispatch: mainDispatchMock,
}));

vi.mock(
  '../../../../store/main/slices/workspace-events/workspace-events-slice',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../store/main/slices/workspace-events/workspace-events-slice')
      >();
    return {
      ...actual,
      emitWorkspaceEvent: (event: any) => ({
        type: 'workspaceEvents/emitWorkspaceEvent',
        payload: [event, Date.parse(event.timestamp)],
      }),
    };
  },
);

vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: vi.fn(() => []) },
}));

vi.mock('$shared/main/memory-event-logger', () => ({
  memEvents: {
    agentTurnStart: vi.fn(),
    agentTurnComplete: vi.fn(),
    cleanupStart: vi.fn(),
    cleanupComplete: vi.fn(),
  },
}));

vi.mock('$lib/services/analytics/main', () => ({
  trackMain: vi.fn(),
}));

vi.mock('../../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(),
  getWindowIdsForWorkspace: getWindowIdsForWorkspaceMock,
}));

let HandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

const HANDLER_PATH = path.join(__dirname, '..', 'agent-backend-handler.service.ts');
const SOURCE = readFileSync(HANDLER_PATH, 'utf-8');

function createBehavioralHandler(backendSession: any): any {
  const handler = Object.create(HandlerClass.prototype) as any;
  handler.providers = new Map();
  handler.providerLastUsed = new Map();
  handler.streamStartTimes = new Map();
  handler.streamSessionIds = new Map();
  handler.streamWorkspaceIds = new Map();
  handler.streamAssistantMessageIds = new Map();
  handler.streamAssistantAppMessageIds = new Map();
  handler.streamWindowIds = new Map();
  handler.streamGenerations = new Map();
  handler.streamHealthChecks = new Map();
  handler.lastPongTimes = new Map();
  handler.lastPingSentTimes = new Map();
  handler.messageQueues = new Map();
  handler.processingQueue = new Set();
  handler.pendingQueueProcessing = new Set();
  handler.pendingBackendDeliveries = new Set();
  handler.pendingBackendDeliveryTimeouts = new Map();
  handler.interruptedAgents = new Set();
  handler.interruptedAgentTimeouts = new Map();
  handler.completedStreams = new Map();
  handler.emptyResponseRetries = new Map();
  handler.queueAgentWorkspaceIds = new Map();
  handler.inFlightSessionPrompts = new Set();
  handler.inFlightSessionPromptKeysByAgent = new Map();
  handler.inFlightSessionPromptStreamIds = new Map();
  handler.sendToRenderer = vi.fn();
  handler.sendStreamToRenderer = vi.fn();
  handler.emitStreamEventToWorkspaceEvents = vi.fn();
  handler.emitAgentStartedEvent = vi.fn();
  handler.startStreamHealthCheck = vi.fn();
  handler.getStreamTargetWindowIds = vi.fn(() => []);
  handler.estimateSessionSizeKB = vi.fn(() => 0);
  handler.estimateContentSizeKB = vi.fn(() => 0);
  handler.getBackend = vi.fn(async () => ({
    getSession: vi.fn(() => backendSession),
    getAgent: vi.fn(async () => null),
  }));
  handler.providers.set(backendSession.id, {
    isHealthy: vi.fn(() => true),
    streamMessage: vi.fn(async () => undefined),
    getConfig: vi.fn(() => ({ model: 'test-model' })),
  });
  return handler;
}

beforeAll(async () => {
  ({ AgentBackendHandler: HandlerClass } = await vi.importActual(
    '../agent-backend-handler.service',
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  loadAgentMock.mockResolvedValue({ success: false, error: 'not found' });
  saveAgentMock.mockResolvedValue({ success: true });
  getWindowIdsForWorkspaceMock.mockReturnValue([]);
});

describe('Audit 2 C2 — agent-backend-handler lifecycle emissions', () => {
  it('does not contain raw-literal reduxEmitWorkspaceEvent({ ... type: ... }) calls', () => {
    // Raw literals like `reduxEmitWorkspaceEvent({ id: ..., type: 'agent:idle', ...})`
    // bypass createWorkspaceEvent. Match the helper-call form `reduxEmitWorkspaceEvent({`
    // (an opening brace on the same line) and assert there are zero remaining
    // occurrences in the file.
    const rawLiteralPattern = /reduxEmitWorkspaceEvent\(\s*\{/g;
    const matches = SOURCE.match(rawLiteralPattern) ?? [];
    expect(matches.length).toBe(0);
  });

  const expectedTypes = [
    'agent:idle',
    'agent:created',
    'agent:deleted',
    'agent:restored',
    'agent:started',
    'agent:failed',
  ];

  it.each(expectedTypes)(
    'emits %s via createWorkspaceEvent (not as a raw literal)',
    (eventType) => {
      // For every lifecycle event type we expect a call site like
      //   reduxEmitWorkspaceEvent(createWorkspaceEvent('agent:idle', ...
      // or the same nested call formatted across multiple lines. The helper
      // preserves typed union narrowing and uniform actor normalization.
      const pattern = new RegExp(
        `reduxEmitWorkspaceEvent\\(\\s*createWorkspaceEvent\\(\\s*'${eventType}'`,
      );
      expect(SOURCE).toMatch(pattern);
    },
  );

  it('threads queued/user message IDs into idle and failed lifecycle events', () => {
    expect(SOURCE).toMatch(/this\.emitAgentIdleEvent\([\s\S]{0,300}request\.queuedMessageId/);
    expect(SOURCE).toMatch(/this\.emitAgentFailedEvent\([\s\S]{0,300}request\.queuedMessageId/);
    expect(SOURCE).toMatch(/respondingToMessageId,/);
  });
});

describe('Audit 2 C3 — agent-backend-handler queue emissions', () => {
  it('routes agent:queue:stale-message through emitQueueWorkspaceEvent', () => {
    // C3 made stale-message a workspace event in addition to the existing
    // sendToRenderer IPC channel. The handler must call the helper with the
    // exact event-type string.
    expect(SOURCE).toMatch(/emitQueueWorkspaceEvent\(\s*'agent:queue:stale-message'/);
  });

  it('emitQueueWorkspaceEvent parameter is typed (no `eventType as any` cast)', () => {
    // Tightening the helper signature removed the `eventType as any` cast.
    // Make sure no regression reintroduces it.
    expect(SOURCE).not.toMatch(/emitQueueWorkspaceEvent[\s\S]{0,200}eventType\s+as\s+any/);
  });

  it('still keeps the IPC `agent:queue:stale-message` renderer notification', () => {
    // The IPC `sendToRenderer('agent:queue:stale-message', ...)` path is
    // preserved so existing renderer code keeps working.
    expect(SOURCE).toMatch(/sendToRenderer\(\s*'agent:queue:stale-message'/);
  });

  it('flags the retained-message cancellation as requeued', () => {
    // When a concurrent stream aborts queue processing but the message stays in
    // the queue, the cancelled payload must carry `requeued: true` so the renderer
    // keeps the optimistic user message visible.
    expect(SOURCE).toMatch(/messageId: nextMessage\.id,\s*requeued: true,/);
  });

  it('derives the failed-send cancellation requeued flag from re-add state', () => {
    // The catch path re-adds the message only when a queue still exists; the
    // cancelled payload reflects that via the messageRequeued tracking variable.
    expect(SOURCE).toMatch(/messageId: nextMessage\.id,\s*requeued: messageRequeued,/);
  });
});

describe('agent:user-message:sent appMessageId emission', () => {
  it('emits the canonical user-message workspace event with the renderer appMessageId', async () => {
    const agentId = 'agent-user-message-event';
    const workspaceId = 'ws-user-message-event';
    const userAppMessageId = 'app_msg_renderer_user_1';
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Message Event Agent',
      messages: [],
    };
    const handler = createBehavioralHandler(backendSession);

    const result = await handler.handleBackendStreamMessage(null, {
      agentId,
      sessionId: agentId,
      streamId: `${agentId}:turn-1`,
      content: 'Send this once',
      workspaceId,
      userAppMessageId,
    });

    expect(result).toEqual({ success: true });
    expect(mainDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceEvents/emitWorkspaceEvent',
        payload: [
          expect.objectContaining({
            type: 'agent:user-message:sent',
            workspaceId,
            data: expect.objectContaining({
              agentId,
              appMessageId: userAppMessageId,
              content: 'Send this once',
            }),
          }),
          expect.any(Number),
        ],
      }),
    );
  });
});
