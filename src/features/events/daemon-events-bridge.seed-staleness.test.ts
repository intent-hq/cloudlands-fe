/**
 * Regression: seeded snapshot TEXT blocks go stale and regress fresher
 * subscription-delivered text (intent-hq/monorepo#2818).
 *
 * Post-intentd#775 the `agent:*` firehose carries no assistant text, so a
 * text block seeded into the stream accumulator by `seedStreamFromSnapshot`
 * (mid-turn rejoin, PROTOCOL §7.1) is frozen at its seed-time copy. The
 * standing `chat.subscribe` stream keeps advancing that block in the store;
 * the next `agent:tool:call` dispatch then re-emits the seed-time copy and
 * `mergeStreamContentBlocks` — matching by the stable `{messageId}:{index}`
 * id — overwrites the fresher text with the stale one until the next
 * subscription emit restores it (visible text flicker/regression).
 *
 * Fix under test: `seedStreamFromSnapshot` seeds TOOL blocks only
 * (tool_use / tool_result) — the only block kinds the firehose can advance —
 * and never text/thinking blocks, which are subscription-owned.
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
  clearAllSessions,
  replaceMessages,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  __resetDaemonEventsBridgeForTests,
  routeDaemonEventsNotification,
  seedStreamFromSnapshot,
} from '$features/events/daemon-events-bridge.client';

const WS = 'ws-seed-staleness';
const AGENT = 'agent-seed-staleness';
const MESSAGE_ID = '01b2c3d4-5e6f-7abc-8def-0123456789ab';

const STALE_TEXT = '<group:Implementing>\n\nWriting the fir';
const FRESH_TEXT = '<group:Implementing>\n\nWriting the first draft of the migration.';

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

/** §7.1 snapshot blocks of the in-flight assistant message at rejoin time. */
function seedTimeBlocks(): ContentBlock[] {
  return [
    { type: 'text', id: `${MESSAGE_ID}:0`, text: STALE_TEXT },
    {
      type: 'tool_use',
      id: `${MESSAGE_ID}:1`,
      name: 'str-replace-editor',
      toolCallId: 'toolu_01',
      input: { path: 'src/app.ts' },
      metadata: { toolKind: 'edit', status: 'started' },
    },
  ] as unknown as ContentBlock[];
}

function assistantMessage(blocks: ContentBlock[]): AgentMessage {
  return {
    id: MESSAGE_ID,
    role: 'assistant',
    timestamp: '2026-08-18T12:09:50.000Z',
    isStreaming: true,
    streamingComplete: false,
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

const stops: Array<() => void> = [];

beforeAll(() => {
  appStore.init();
  stops.push(appStore.runSaga(agentStreamSaga));
});

afterAll(() => {
  for (const stop of stops) stop();
  appStore.dispose();
});

describe('seed staleness regression (monorepo#2818)', () => {
  beforeEach(() => {
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    capturedHandlers[0] = (n) => routeDaemonEventsNotification(n.method, n.params, 'sub-1');

    // Mid-turn rejoin: chat-subscribe saga wrote the snapshot's in-flight
    // assistant into the store, then seeded the firehose accumulator with the
    // SAME snapshot blocks.
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
          messages: [assistantMessage(seedTimeBlocks())],
        } as unknown as AgentSession,
      ]),
    );
    seedStreamFromSnapshot(AGENT, { id: MESSAGE_ID, contentBlocks: seedTimeBlocks() }, WS);
  });

  afterEach(() => vi.clearAllMocks());

  it('a seeded text block must not regress fresher subscription-delivered text on a tool tick', () => {
    const handler = capturedHandlers[0]!;

    // The standing chat.subscribe stream advances the text block past the
    // seed-time copy (§6.5 delta → replaceMessages, same stable block id).
    appStore.dispatch(
      replaceMessages(AGENT, [
        assistantMessage([
          { type: 'text', id: `${MESSAGE_ID}:0`, text: FRESH_TEXT },
          seedTimeBlocks()[1],
        ] as unknown as ContentBlock[]),
      ]),
    );

    // PROTOCOL §7 agent:tool:call — the completed tick for the seeded tool.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
        toolCallId: 'toolu_01',
        toolName: 'str-replace-editor',
        toolKind: 'edit',
        status: 'completed',
        output: 'edited file',
      }),
    );

    const message = readAssistantMessage();
    expect(message).toBeDefined();
    const blocks = message!.contentBlocks ?? [];

    // ROOT CAUSE (fails today): the accumulator still holds the seed-time
    // text copy; the tool tick's dispatch re-emits it and the identity merge
    // (same `{messageId}:0` id) regresses the fresher subscription text.
    const textBlock = blocks.find((b) => b.type === 'text');
    expect((textBlock as { text?: string })?.text).toBe(FRESH_TEXT);
  });

  it('characterization: seeded tool identity still survives a progress-only tick', () => {
    const handler = capturedHandlers[0]!;

    // Status-only tick: empty toolName/no input (the daemon mapper's default
    // for a progress tick) — the seeded name/input/toolKind must be retained.
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
    const toolUse = (message?.contentBlocks ?? []).find(
      (b) => b.type === 'tool_use' && (b as { toolCallId?: string }).toolCallId === 'toolu_01',
    ) as { name?: string; input?: unknown; metadata?: { toolKind?: string; status?: string } };
    expect(toolUse).toBeDefined();
    expect(toolUse.name).toBe('str-replace-editor');
    expect(toolUse.input).toEqual({ path: 'src/app.ts' });
    expect(toolUse.metadata?.toolKind).toBe('edit');
    expect(toolUse.metadata?.status).toBe('in_progress');
  });

  it('a seeded tool_result must not duplicate when its completion tick replays', () => {
    const handler = capturedHandlers[0]!;

    // Rejoin AFTER the first tool completed: the snapshot interleaves the
    // tool_result after its tool_use (§7.1 synthesized pairing by
    // toolCallId ↔ tool_use_id), and a second tool is mid-flight at daemon
    // blockIndex 3 (text blocks occupy the even indices).
    appStore.dispatch(clearAllSessions());
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    capturedHandlers[0] = (n) => routeDaemonEventsNotification(n.method, n.params, 'sub-1');
    const rejoinBlocks = [
      { type: 'text', id: `${MESSAGE_ID}:0`, text: STALE_TEXT },
      {
        type: 'tool_use',
        id: `${MESSAGE_ID}:1`,
        name: 'str-replace-editor',
        toolCallId: 'toolu_01',
        input: { path: 'src/app.ts' },
        metadata: { toolKind: 'edit', status: 'completed' },
      },
      {
        type: 'tool_result',
        id: `${MESSAGE_ID}:2`,
        tool_use_id: 'toolu_01',
        output: 'edited file',
        is_error: false,
      },
      {
        type: 'tool_use',
        id: `${MESSAGE_ID}:3`,
        name: 'launch-process',
        toolCallId: 'toolu_02',
        input: { command: 'pnpm vitest run' },
        metadata: { toolKind: 'execute', status: 'started' },
      },
    ] as unknown as ContentBlock[];
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
          messages: [assistantMessage(rejoinBlocks)],
        } as unknown as AgentSession,
      ]),
    );
    seedStreamFromSnapshot(AGENT, { id: MESSAGE_ID, contentBlocks: rejoinBlocks }, WS);

    // The second tool completes: the accumulator dispatches its full block
    // list. The seeded tool_result for toolu_01 must appear exactly once.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        blockIndex: 3,
        blockId: `${MESSAGE_ID}:3`,
        toolCallId: 'toolu_02',
        toolName: 'launch-process',
        toolKind: 'execute',
        status: 'completed',
        output: 'tests passed',
      }),
    );

    const message = readAssistantMessage();
    const blocks = message?.contentBlocks ?? [];
    const firstToolResults = blocks.filter(
      (b) => b.type === 'tool_result' && (b as { tool_use_id?: string }).tool_use_id === 'toolu_01',
    );
    expect(firstToolResults).toHaveLength(1);
    const secondToolResults = blocks.filter(
      (b) => b.type === 'tool_result' && (b as { tool_use_id?: string }).tool_use_id === 'toolu_02',
    );
    expect(secondToolResults).toHaveLength(1);
    // The second tool's status merge landed.
    const secondUse = blocks.find(
      (b) => b.type === 'tool_use' && (b as { toolCallId?: string }).toolCallId === 'toolu_02',
    ) as { metadata?: { status?: string } };
    expect(secondUse?.metadata?.status).toBe('completed');
  });
});
