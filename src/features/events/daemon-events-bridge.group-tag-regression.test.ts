/**
 * Regression: grouped/ungrouped rendering flip during a streaming turn
 * (intent-hq/monorepo#2814).
 *
 * Post-intentd#775 the firehose carries no assistant text: `agent:tool:call`
 * is the only content-bearing `agent:*` event, so the bridge's per-turn
 * accumulator is text-starved (tool_use blocks only). When `chat.subscribe`
 * (the transcript's canonical writer, PROTOCOL §7.1) has already written
 * the in-flight assistant message — block 0 being the text block that carries
 * the `<group:Name>` open tag — a wholesale contentBlocks replace by an
 * `agent:tool:call` dispatch deleted the leading text block; the next
 * subscription emit restored it, flipping the transcript grouped ↔ ungrouped
 * once per tool call.
 *
 * This test drives the PROTOCOL §7-shaped `agent:tool:call` notification
 * against a store whose in-flight assistant row was seeded exactly as the
 * chat-subscribe saga's `replaceMessages` leaves it, and asserts the leading
 * group-tag text block survives. Guarded by the merge-by-block-identity fix
 * (`mergeStreamContentBlocks` in stream-content-blocks.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage, AgentSession } from '$shared/types';

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
  clearAllSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  __resetDaemonEventsBridgeForTests,
  routeDaemonEventsNotification,
} from '$features/events/daemon-events-bridge.client';
import { groupContentBlocks } from '$lib/utils/messageParser';

const WS = 'ws-group-regression';
const AGENT = 'agent-group-regression';
const MESSAGE_ID = '01a014bc-beb5-7ac1-aea7-ac220436f7ca';

/** PROTOCOL §6.3 `events.event` notification envelope. */
function notification(eventType: string, data: Record<string, unknown>) {
  return {
    method: 'events.event' as const,
    params: {
      event: {
        id: `evt-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: WS,
        timestamp: '2026-08-18T11:58:43.000Z',
        type: eventType,
        actor: { type: 'agent', id: AGENT },
        data,
      },
    },
  };
}

function readAssistantMessage(): AgentMessage | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return (state.agentSessions?.byAgentId[AGENT]?.messages ?? []).find(
    (m) => m.role === 'assistant',
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

describe('group-tag flip regression (monorepo#2814)', () => {
  beforeEach(() => {
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    capturedHandlers[0] = (n) => routeDaemonEventsNotification(n.method, n.params, 'sub-1');

    // The in-flight assistant message EXACTLY as the chat-subscribe saga's
    // replaceMessages leaves it after §7.1 deltas: block 0 is the text block
    // carrying the group open tag (daemon blockIndex 0), block 1 the tool_use
    // (daemon blockIndex 1) the upcoming agent:tool:call event updates.
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AGENT,
          backendSessionId: 'backend-1',
          workspaceId: WS,
          status: AgentStatus.Active,
          isStreaming: true,
          createdAt: '2026-08-18T11:58:25.000Z',
          updatedAt: '2026-08-18T11:58:43.000Z',
          messages: [
            {
              id: MESSAGE_ID,
              role: 'assistant',
              timestamp: '2026-08-18T11:58:40.000Z',
              isStreaming: true,
              streamingComplete: false,
              contentBlocks: [
                {
                  type: 'text',
                  id: `${MESSAGE_ID}:0`,
                  text: "<group:Researching>\n\nI'll audit both sides.",
                },
                {
                  type: 'tool_use',
                  id: `${MESSAGE_ID}:1`,
                  name: 'codebase-retrieval',
                  toolCallId: 'toolu_01',
                  input: { information_request: 'chat.subscribe lifecycle' },
                  metadata: { toolKind: 'search', status: 'started' },
                },
              ],
            } as unknown as AgentMessage,
          ],
        } as unknown as AgentSession,
      ]),
    );
  });

  afterEach(() => vi.clearAllMocks());

  it('an agent:tool:call progress tick must not delete the leading group-tag text block', () => {
    const handler = capturedHandlers[0]!;

    // PROTOCOL §7 agent:tool:call — the completed tick for the tool at daemon
    // blockIndex 1 (text blocks occupy even indices and never travel on the
    // firehose post-intentd#775; live DB repro carried indices 1,3,5,…).
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
        toolCallId: 'toolu_01',
        toolName: 'codebase-retrieval',
        toolKind: 'search',
        status: 'completed',
        output: 'retrieved code sections',
      }),
    );

    const message = readAssistantMessage();
    expect(message).toBeDefined();
    const blocks = message!.contentBlocks ?? [];

    // ROOT CAUSE (fails today): the bridge's text-starved accumulator replaced
    // the message's contentBlocks wholesale — the leading text block carrying
    // <group:Researching> is gone, so the transcript renders ungrouped until
    // the next chat.subscribe emit restores it (the visible flip).
    const leadingText = blocks[0];
    expect(leadingText?.type).toBe('text');
    expect((leadingText as { text?: string })?.text?.startsWith('<group:Researching>')).toBe(true);

    // The rendering consequence: with the group tag intact the tool_use nests
    // inside the content_group; without it the tool card pops to top level.
    const grouped = groupContentBlocks(blocks, true);
    expect(grouped[0]?.type).toBe('content_group');
  });

  it('characterization: the tool tick itself still lands (status merge on the tool_use block)', () => {
    const handler = capturedHandlers[0]!;

    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
        toolCallId: 'toolu_01',
        toolName: 'codebase-retrieval',
        toolKind: 'search',
        status: 'completed',
        output: 'retrieved code sections',
      }),
    );

    const message = readAssistantMessage();
    const toolUse = (message?.contentBlocks ?? []).find(
      (b) => b.type === 'tool_use' && (b as { toolCallId?: string }).toolCallId === 'toolu_01',
    );
    expect(toolUse).toBeDefined();
    expect((toolUse as { metadata?: { status?: string } })?.metadata?.status).toBe('completed');
  });
});
