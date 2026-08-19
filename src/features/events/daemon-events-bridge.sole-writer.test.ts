/**
 * Regression: the firehose accumulator's terminal `complete` dispatch
 * clobbers the transcript the standing chat.subscribe channel already
 * reconciled (missing-turn-tail bug).
 *
 * Post-intentd#775 the `agent:*` firehose carries no assistant text, so by
 * turn end its per-turn accumulator holds a text-starved (tool-only) block
 * set. When `agent:stream:end` fired, `dispatchStreamUpdate` sent that stale
 * set as the terminal `complete` payload; with the turn over there is no
 * later delta to heal the merge result, so the turn's final text tail went
 * missing until a close/reopen rehydration.
 *
 * Fix under test: while a standing chat.subscribe registration covers the
 * agent (chat-subscription-registry), stream dispatches omit content blocks
 * entirely — the subscription is the transcript's SOLE content writer — and
 * keep only flag/metadata bookkeeping. Uncovered (background/unviewed)
 * agents keep the accumulator as their transcript writer, including the
 * terminal trailingBlocks (live Q&A) append.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

const { capturedHandlers } = vi.hoisted(() => ({
  capturedHandlers: [] as Array<(n: { method: string; params?: unknown }) => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendNotification: (handler: (n: { method: string; params?: unknown }) => void) => {
    capturedHandlers.push(handler);
    return () => {
      const idx = capturedHandlers.indexOf(handler);
      if (idx >= 0) capturedHandlers.splice(idx, 1);
    };
  },
  onBackendReconnected: () => () => {},
  backendRequest: () => Promise.resolve({ subscriptionId: 'sub-1' }),
}));

import { store as appStore } from '$store/renderer/store';
import { agentStreamSaga } from '$store/renderer/slices/agent-session/sagas/agent-stream-saga';
import {
  bulkUpsertSessions,
  replaceMessages,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  __resetDaemonEventsBridgeForTests,
  routeDaemonEventsNotification,
  seedStreamFromSnapshot,
} from '$features/events/daemon-events-bridge.client';
import {
  clearAllStandingChatSubscriptions,
  markStandingChatSubscription,
} from '$features/agent/utils/chat-subscription-registry';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';

const WS = 'ws-sole-writer';
const AGENT = 'agent-sole-writer';
const MESSAGE_ID = '01b2c3d4-5e6f-7abc-8def-0123456789ab';
const clearAllSessions = () =>
  workspaceDeleted(WS, Object.keys(appStore.state.agentSessions.byAgentId));
const STREAM_ID = 'stream-sole-writer';

const TAIL_TEXT = 'All checks pass — the migration is complete.';

/** PROTOCOL §6.3 `events.event` notification envelope. */
function notification(eventType: string, data: Record<string, unknown>) {
  return {
    method: 'events.event' as const,
    params: {
      event: {
        id: `evt-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: WS,
        timestamp: '2026-08-18T12:10:00.000Z',
        type: eventType,
        actor: { type: 'agent', id: AGENT },
        data,
      },
    },
  };
}

/** The §7.1-reconciled final transcript: text, tool pair, then the tail. */
function reconciledBlocks(): ContentBlock[] {
  return [
    { type: 'text', id: `${MESSAGE_ID}:0`, text: 'Running the migration now.' },
    {
      type: 'tool_use',
      id: `${MESSAGE_ID}:1`,
      name: 'launch-process',
      toolCallId: 'toolu_01',
      input: { command: 'pnpm vitest run' },
      metadata: { toolKind: 'execute', status: 'completed' },
    },
    {
      type: 'tool_result',
      id: `${MESSAGE_ID}:2`,
      tool_use_id: 'toolu_01',
      output: 'ok',
      is_error: false,
    },
    { type: 'text', id: `${MESSAGE_ID}:3`, text: TAIL_TEXT },
  ] as unknown as ContentBlock[];
}

function assistantMessage(blocks: ContentBlock[], streaming = true): AgentMessage {
  return {
    id: MESSAGE_ID,
    role: 'assistant',
    timestamp: '2026-08-18T12:09:50.000Z',
    isStreaming: streaming,
    streamingComplete: !streaming,
    contentBlocks: blocks,
  } as unknown as AgentMessage;
}

function readAssistantMessage(): AgentMessage | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return (state.agentSessions?.byAgentId[AGENT]?.messages ?? []).find(
    (m) => m.role === 'assistant',
  );
}

function seedSession(messages: AgentMessage[]): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        backendSessionId: 'backend-1',
        workspaceId: WS,
        status: AgentStatus.Active,
        isStreaming: true,
        createdAt: '2026-08-18T12:09:00.000Z',
        updatedAt: '2026-08-18T12:10:00.000Z',
        messages,
      } as unknown as AgentSession,
    ]),
  );
}

const stops: Array<() => void> = [];

beforeAll(() => {
  appStore.init();
  stops.push(appStore.runSaga(agentStreamSaga));
});

afterAll(() => {
  for (const stop of stops) stop();
  appStore.dispose();
});

describe('chat.subscribe sole-writer invariant at stream end', () => {
  beforeEach(() => {
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    clearAllStandingChatSubscriptions();
    capturedHandlers.length = 0;
    capturedHandlers[0] = (n) => routeDaemonEventsNotification(n.method, n.params, 'sub-1');
  });

  afterEach(() => vi.clearAllMocks());

  it('terminal complete must NOT regress the reconciled transcript to the stale accumulator copies', () => {
    const handler = capturedHandlers[0]!;
    markStandingChatSubscription(AGENT);

    // Mid-stream rejoin: the snapshot seeded the accumulator while the tool
    // was still running, so its copy of the tool_use is STALE — in_progress,
    // no result — and text is never seeded (monorepo#2818), so the set is
    // also text-starved.
    const staleToolUse = {
      ...reconciledBlocks()[1],
      metadata: { toolKind: 'execute', status: 'in_progress' },
    } as ContentBlock;
    seedSession([assistantMessage([reconciledBlocks()[0], staleToolUse])]);
    seedStreamFromSnapshot(AGENT, { id: MESSAGE_ID, contentBlocks: [staleToolUse] }, WS);

    // The standing subscription reconciles the FULL final transcript: the
    // tool completed (result attached) and the tail text landed — none of
    // which the firehose accumulator ever saw.
    appStore.dispatch(replaceMessages(AGENT, [assistantMessage(reconciledBlocks())]));

    // Terminal firehose event — pre-fix its `complete` dispatch carried the
    // accumulator's stale set, and the identity merge took the stale copy
    // for every matched block: the completed tool_use regressed to a
    // forever-spinning in_progress with no later emit to heal it.
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
      }),
    );

    const message = readAssistantMessage();
    expect(message).toBeDefined();
    expect(message!.isStreaming).toBe(false);
    expect(message!.streamingComplete).toBe(true);
    expect(message!.contentBlocks).toEqual(reconciledBlocks());
  });

  it('an interrupted turn keeps the reconciled blocks AND stamps the interrupted metadata', () => {
    const handler = capturedHandlers[0]!;
    markStandingChatSubscription(AGENT);

    seedSession([assistantMessage(reconciledBlocks())]);
    seedStreamFromSnapshot(AGENT, { id: MESSAGE_ID, contentBlocks: reconciledBlocks() }, WS);

    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        stopReason: 'interrupted',
      }),
    );

    const message = readAssistantMessage();
    expect(message!.contentBlocks).toEqual(reconciledBlocks());
    expect(message!.metadata).toMatchObject({ interrupted: true, stopReason: 'interrupted' });
    expect(message!.isStreaming).toBe(false);
  });

  it('mid-turn agent:tool:call must not rewrite subscription-owned content (no flicker)', () => {
    const handler = capturedHandlers[0]!;
    markStandingChatSubscription(AGENT);

    seedSession([assistantMessage(reconciledBlocks())]);

    // A tool tick whose accumulator state diverges from the reconciled row
    // (e.g. it missed the earlier prefix) — pre-fix the dispatch merged the
    // accumulator copy over the subscription-owned blocks.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
        toolCallId: 'toolu_01',
        toolName: '',
        status: 'in_progress',
      }),
    );

    const message = readAssistantMessage();
    expect(message!.contentBlocks).toEqual(reconciledBlocks());
  });

  it('Q&A trailingBlocks still render live for a NON-subscribed agent', () => {
    const handler = capturedHandlers[0]!;
    // No standing subscription for this agent: the firehose remains the
    // transcript writer, and the terminal trailingBlocks append must land.
    seedSession([]);

    const questionBlock = {
      type: 'resource',
      resource: {
        mimeType: QUESTION_RESOURCE_MIME_TYPE,
        text: JSON.stringify({
          questions: [
            { id: 'q1', text: 'Which database should the migration target?', type: 'text' },
          ],
        }),
      },
    };
    handler(
      notification('agent:stream:end', {
        agentId: AGENT,
        streamId: STREAM_ID,
        messageId: MESSAGE_ID,
        trailingBlocks: [questionBlock],
      }),
    );

    const message = readAssistantMessage();
    expect(message).toBeDefined();
    expect(message!.id).toBe(MESSAGE_ID);
    expect(message!.streamingComplete).toBe(true);
    expect(message!.contentBlocks).toEqual([questionBlock]);
  });
});
