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
 * Fix under test: `seedStreamFromSnapshot` seeds TOOL_USE blocks only — the
 * accumulator's sole remaining job is status-hint dedup for `agent:tool:call`
 * ticks — and the firehose never dispatches content blocks at all: the
 * standing chat.subscribe stream is the transcript's sole content writer, so
 * a tool tick leaves the subscription-owned row untouched and its only
 * store-visible effect is the `chatState` status hint.
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
import { chatReset } from '$store/renderer/slices/chat-state/chat-state-slice';
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

function readStatusPhases(): string[] {
  const state = appStore.state as {
    chatState?: { byAgentId: Record<string, { statusEvents: Array<{ phase?: string }> }> };
  };
  return (state.chatState?.byAgentId[AGENT]?.statusEvents ?? []).map((e) => e.phase ?? '');
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
    appStore.dispatch(chatReset(AGENT));
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

  it('characterization: the seeded tool is recognised as already started (status-hint dedup), row untouched', () => {
    const handler = capturedHandlers[0]!;
    const before = readAssistantMessage()!.contentBlocks;

    // Completion tick for the SEEDED tool (status-only: empty toolName, the
    // daemon mapper's default). The seed recorded it as `started`, so the
    // bridge must emit the "awaiting tool response" hint — without the seed
    // there is no prior `started` and the hint is suppressed.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
        toolCallId: 'toolu_01',
        toolName: '',
        status: 'completed',
      }),
    );

    expect(readStatusPhases()).toEqual(['tool-waiting']);
    // The subscription-owned row is never rewritten by a firehose tick.
    expect(readAssistantMessage()!.contentBlocks).toEqual(before);
  });

  it('seeding keys by the id suffix even when array position diverges from daemon blockIndex', () => {
    const handler = capturedHandlers[0]!;

    // Rejoin AFTER the first tool completed LATE: text (:2) and a second
    // tool_use (:3) streamed before toolu_01's output arrived, so its
    // tool_result persisted at daemon index 4 (§7.1: the result never derives
    // from its use — resultBlockId is whatever index the durable transcript
    // actually assigned; monorepo#2029). The daemon's index space is shared
    // by all block kinds (text, tool_use, tool_result, resource —
    // `Transcript::block_id`, agent_session.rs), so a faithful snapshot array
    // has position == id suffix; this fixture deliberately reorders the
    // result next to its paired use to prove seeding keys by the STABLE ID
    // and stays correct even if a snapshot array is ever partial or reordered
    // relative to daemon indices:
    //
    //   position: 0        1          2            3         4
    //   id:       :0 text  :1 use     :4 result    :2 text   :3 use
    //
    // Positional seeding keyed blocksByIndex by position: under this ordering
    // the mid-flight toolu_02 sat at key 4 while its live ticks carry
    // blockIndex 3 (where the seeded text block sat) — a completion tick then
    // found no prior `started` tool_use and the status hint was suppressed.
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
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
        id: `${MESSAGE_ID}:4`,
        tool_use_id: 'toolu_01',
        output: 'edited file',
        is_error: false,
      },
      { type: 'text', id: `${MESSAGE_ID}:2`, text: 'Now running the tests.' },
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

    // Status-only completion tick for the mid-flight tool (empty toolName —
    // the daemon mapper's default): it must find the SEEDED `started` block at
    // daemon blockIndex 3 and emit the "awaiting tool response" hint. Pre-fix
    // that key held the seeded text block (position 3), so no prior `started`
    // was found and the hint was suppressed.
    handler(
      notification('agent:tool:call', {
        agentId: AGENT,
        messageId: MESSAGE_ID,
        blockIndex: 3,
        blockId: `${MESSAGE_ID}:3`,
        toolCallId: 'toolu_02',
        toolName: '',
        status: 'completed',
      }),
    );
    expect(readStatusPhases()).toEqual(['tool-waiting']);

    // The completed tick for toolu_01 REPLAYS (duplicate delivery / late
    // re-emit) carrying the persisted result identity. The seed already holds
    // it as `completed`, so the replay is deduped: no second hint.
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
        resultBlockIndex: 4,
        resultBlockId: `${MESSAGE_ID}:4`,
      }),
    );

    expect(readStatusPhases()).toEqual(['tool-waiting']);

    // Neither tick touched the subscription-owned row: the firehose writes
    // no transcript content, so the snapshot blocks stand exactly as seeded.
    expect(readAssistantMessage()!.contentBlocks).toEqual(rejoinBlocks);
  });
});
