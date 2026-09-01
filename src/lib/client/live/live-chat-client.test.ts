import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendNotification } from './backend-transport';

const { reportStreamLifecycleSpy } = vi.hoisted(() => ({ reportStreamLifecycleSpy: vi.fn() }));

vi.mock('$lib/utils/stream-lifecycle-telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/stream-lifecycle-telemetry')>()),
  reportStreamLifecycle: reportStreamLifecycleSpy,
}));

// FAKE transport only: no request/notification reaches the real daemon. Tests
// assert the JSON-RPC method + params `chat.subscribe`/`chat.unsubscribe` emit
// and that PROTOCOL §7.1-shaped pushes (seq-0 snapshot + block deltas) are
// ingested verbatim.
vi.mock('./backend-transport', () => {
  const listeners: Array<(n: BackendNotification) => void> = [];
  const reconnectListeners: Array<() => void> = [];
  return {
    backendRequest: vi.fn(),
    onBackendNotification: vi.fn((handler: (n: BackendNotification) => void) => {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    onBackendReconnected: vi.fn((handler: () => void) => {
      reconnectListeners.push(handler);
      return () => {
        const idx = reconnectListeners.indexOf(handler);
        if (idx >= 0) reconnectListeners.splice(idx, 1);
      };
    }),
    __emit: (n: BackendNotification) => {
      // Snapshot the listener list — some handlers dispose synchronously.
      for (const l of [...listeners]) l(n);
    },
    __emitReconnect: () => {
      for (const l of [...reconnectListeners]) l();
    },
    __reset: () => {
      listeners.length = 0;
      reconnectListeners.length = 0;
    },
  };
});

import * as transport from './backend-transport';
import { LiveChatClient } from './live-chat-client';

const mockedRequest = vi.mocked(transport.backendRequest);
const emit = (transport as unknown as { __emit: (n: BackendNotification) => void }).__emit;
const emitReconnect = (transport as unknown as { __emitReconnect: () => void }).__emitReconnect;
const reset = (transport as unknown as { __reset: () => void }).__reset;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Standing subscription: chat.subscribe stays open and the block-granularity
// delta stream (PROTOCOL §7.1) is reduced onto the seq-0 message page.
// ---------------------------------------------------------------------------

/** Sequentially-minted subscriptionIds for each `chat.subscribe` call. */
function mockChatSubscribe(prefix = 'sub'): void {
  let n = 0;
  mockedRequest.mockImplementation(async (method: string) => {
    if (method === 'chat.subscribe') {
      n += 1;
      return { subscriptionId: `${prefix}-${n}` };
    }
    return {};
  });
}

function snapshotPush(subscriptionId: string, seq: number, snapshot: unknown): void {
  emit({
    method: 'subscription.push',
    params: { subscriptionId, kind: 'snapshot', seq, snapshot },
  });
}

function deltaPush(subscriptionId: string, seq: number, delta: unknown): void {
  emit({ method: 'subscription.push', params: { subscriptionId, kind: 'delta', seq, delta } });
}

/** The §7.1 seq-0 snapshot object for one persisted user message. */
const SEEDED_SNAPSHOT = {
  agentId: 'agent-1',
  messages: [
    {
      id: '0190a1b2-user',
      agentId: 'agent-1',
      seq: 0,
      role: 'user',
      contentBlocks: [{ type: 'text', id: '0190a1b2-user:0', text: 'Run the tests' }],
      timestamp: '2026-06-27T01:00:00.000Z',
    },
  ],
  truncated: false,
  totalMessages: 1,
  nextToken: null,
};

describe('LiveChatClient.subscribe (standing §7.1 subscription)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it('registers chat.subscribe, emits the seq-0 snapshot, and unsubscribes on dispose', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    expect(mockedRequest).toHaveBeenCalledWith('chat.subscribe', {
      agentId: 'agent-1',
      deltaEncoding: 'incremental',
      projection: 'slim',
    });
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    expect(seen).toHaveLength(1);
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(['0190a1b2-user']);
    expect(seen[0].isStreaming).toBe(false);

    off();
    expect(mockedRequest).toHaveBeenCalledWith('chat.unsubscribe', { subscriptionId: 'sub-1' });
  });

  it('preserves minimal supported snapshot messages without fabricating sequence order', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t as (typeof seen)[number]));
    await flush();

    snapshotPush('sub-1', 0, {
      agentId: 'agent-1',
      messages: [
        {
          id: 'minimal-user',
          role: 'user',
          timestamp: '2026-06-27T01:00:00.000Z',
          contentBlocks: [{ type: 'text', id: 'minimal-user:0', text: 'Question' }],
        },
        {
          id: 'minimal-assistant',
          role: 'assistant',
          timestamp: '2026-06-27T01:00:01.000Z',
          contentBlocks: [
            { type: 'thinking', id: 'minimal-assistant:0', text: 'Reasoning' },
            { type: 'text', id: 'minimal-assistant:1', text: 'Answer' },
          ],
        },
        {
          id: 'minimal-system',
          role: 'system',
          timestamp: '2026-06-27T01:00:02.000Z',
          contentBlocks: [{ type: 'text', id: 'minimal-system:0', text: 'Notice' }],
        },
      ],
      truncated: false,
      totalMessages: 3,
    });

    expect(seen[0].messages.map(({ id, role, agentId }) => ({ id, role, agentId }))).toEqual([
      { id: 'minimal-user', role: 'user', agentId: 'agent-1' },
      { id: 'minimal-assistant', role: 'assistant', agentId: 'agent-1' },
      { id: 'minimal-system', role: 'system', agentId: 'agent-1' },
    ]);
    expect(seen[0].messages.every((message) => !('seq' in message))).toBe(true);
    expect(seen[0].messages[1].contentBlocks).toEqual([
      { type: 'thinking', id: 'minimal-assistant:0', text: 'Reasoning' },
      { type: 'text', id: 'minimal-assistant:1', text: 'Answer' },
    ]);
    off();
  });

  it('drops invalid message envelopes without discarding unrelated valid snapshot messages', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t as (typeof seen)[number]));
    await flush();

    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        null,
        { ...SEEDED_SNAPSHOT.messages[0], id: '' },
        SEEDED_SNAPSHOT.messages[0],
        { ...SEEDED_SNAPSHOT.messages[0], id: 'tool-message', seq: 1, role: 'tool' },
        { ...SEEDED_SNAPSHOT.messages[0], id: 'bad-role', role: 'operator' },
        { ...SEEDED_SNAPSHOT.messages[0], id: 'bad-seq', seq: '1' },
        { ...SEEDED_SNAPSHOT.messages[0], id: 'negative-seq', seq: -1 },
        { ...SEEDED_SNAPSHOT.messages[0], id: 'missing-timestamp', timestamp: undefined },
        { ...SEEDED_SNAPSHOT.messages[0], id: 'cross-agent', agentId: 'agent-2' },
      ],
    });

    expect(seen[0].messages).toHaveLength(2);
    expect(seen[0].messages).toEqual([
      expect.objectContaining({
        id: '0190a1b2-user',
        agentId: 'agent-1',
        seq: 0,
        role: 'user',
      }),
      expect.objectContaining({
        id: 'tool-message',
        agentId: 'agent-1',
        seq: 1,
        role: 'tool',
      }),
    ]);
    off();
  });

  it('rejects a snapshot for another agent without borrowing its identity', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, {
      agentId: 'agent-2',
      messages: [
        {
          id: 'foreign-assistant',
          role: 'assistant',
          timestamp: '2026-06-27T01:00:00.000Z',
          contentBlocks: [{ type: 'text', id: 'foreign-assistant:0', text: 'Foreign' }],
        },
      ],
      truncated: false,
      totalMessages: 1,
    });

    expect(seen[0].messages).toEqual([]);
    off();
  });

  it('normalizes null and non-array contentBlocks without dropping their valid messages', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ id: string; contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        { ...SEEDED_SNAPSHOT.messages[0], id: 'null-blocks', contentBlocks: null },
        {
          ...SEEDED_SNAPSHOT.messages[0],
          id: 'array-like-blocks',
          seq: 1,
          contentBlocks: { length: 1, 0: { type: 'text', text: 'unsafe' } },
        },
      ],
    });

    expect(seen[0].messages).toEqual([
      expect.objectContaining({ id: 'null-blocks', contentBlocks: [] }),
      expect.objectContaining({ id: 'array-like-blocks', contentBlocks: [] }),
    ]);
    off();
  });

  it('isolates malformed blocks and plan entries while preserving safe sibling content', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{
      messages: Array<{ id: string; contentBlocks?: Array<Record<string, unknown>> }>;
    }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    const validPlan = {
      type: 'plan',
      id: '0190a1b2-user:5',
      entries: [
        {
          content: 'Keep the valid plan',
          priority: 'high',
          status: 'in_progress',
          providerExtension: true,
        },
      ],
    };
    const resource = {
      type: 'resource',
      id: '0190a1b2-user:6',
      resource: { uri: 'file:///tmp/result.txt', text: 'safe forward-compatible content' },
    };
    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        {
          ...SEEDED_SNAPSHOT.messages[0],
          contentBlocks: [
            { type: 'text', id: '0190a1b2-user:0', text: 'Keep me' },
            null,
            { type: 'plan', id: '0190a1b2-user:2', entries: { length: 1 } },
            { type: 'thinking', id: '0190a1b2-user:3', text: 'Keep this too' },
            { type: 'plan', id: '0190a1b2-user:4', entries: [{}] },
            validPlan,
            resource,
          ],
        },
      ],
    });

    expect(seen[0].messages[0].contentBlocks).toEqual([
      { type: 'text', id: '0190a1b2-user:0', text: 'Keep me' },
      { type: 'thinking', id: '0190a1b2-user:3', text: 'Keep this too' },
      {
        type: 'plan',
        id: '0190a1b2-user:5',
        entries: [{ content: 'Keep the valid plan', priority: 'high', status: 'in_progress' }],
      },
      resource,
    ]);
    off();
  });

  it('migrates supported legacy snapshot blocks at ingress', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        {
          ...SEEDED_SNAPSHOT.messages[0],
          contentBlocks: [
            {
              kind: 'nav-link',
              id: '0190a1b2-user:0',
              target: '/settings',
              label: 'Settings',
            },
          ],
        },
      ],
    });

    expect(seen[0].messages[0].contentBlocks).toEqual([
      {
        type: 'nav-link',
        kind: 'nav-link',
        id: '0190a1b2-user:0',
        target: '/settings',
        label: 'Settings',
        metadata: undefined,
      },
    ]);
    off();
  });

  it('preserves valid empty and non-empty plan snapshots', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    const plans = [
      { type: 'plan', id: 'empty-plan', entries: [] },
      {
        type: 'plan',
        id: 'active-plan',
        entries: [{ content: 'Run tests', priority: 'medium', status: 'pending' }],
      },
    ];
    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [{ ...SEEDED_SNAPSHOT.messages[0], contentBlocks: plans }],
    });

    expect(seen[0].messages[0].contentBlocks).toEqual(plans);
    off();
  });

  it('stamps fromSnapshot: true on snapshot emits and omits it on delta emits', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ fromSnapshot?: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Hi' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    expect(seen).toHaveLength(2);
    expect(seen[0].fromSnapshot).toBe(true);
    expect('fromSnapshot' in seen[1]).toBe(false);
    off();
  });

  it("derives isStreaming from the snapshot's in-flight message and activity flags", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: '0190a200-asst',
          agentId: 'agent-1',
          seq: 1,
          role: 'assistant',
          isStreaming: true,
          contentBlocks: [{ type: 'text', id: '0190a200-asst:0', text: 'Let me check' }],
          timestamp: '2026-06-27T01:00:00.500Z',
        },
      ],
      totalMessages: 2,
      turnInFlight: true,
    });

    expect(seen[0].isStreaming).toBe(true);
    off();
  });

  it('folds added/updated block deltas into the owning message (created on first appearance)', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    // First chunk: `added` creates the in-flight assistant message.
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Let me' },
        },
      ],
      updated: [],
      removedIds: [],
    });
    // Growth: `updated` carries the FULL current block.
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Let me check the logs first.' },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const asst = last.messages[1] as {
      id: string;
      isStreaming?: boolean;
      contentBlocks: Array<{ id: string; text: string }>;
    };
    expect(asst.id).toBe('0190a200-asst');
    expect(asst.isStreaming).toBe(true);
    expect(asst.contentBlocks).toEqual([
      { type: 'text', id: '0190a200-asst:0', text: 'Let me check the logs first.' },
    ]);
    expect(last.isStreaming).toBe(true);
    off();
  });

  it('replaces a live plan snapshot by stable block id and does not duplicate it at terminal reconciliation', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    const initialEntries = [
      { content: 'Inspect the code', priority: 'high', status: 'in_progress' },
      { content: 'Run tests', priority: 'medium', status: 'pending' },
    ];
    deltaPush('sub-1', 1, {
      added: [
        {
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Working' },
        },
        {
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'thinking', id: '0190a200-asst:1', text: 'Checking' },
        },
        {
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'plan', id: '0190a200-asst:2', entries: initialEntries },
        },
        {
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'tool_use', id: '0190a200-asst:3', name: 'test', input: {} },
        },
      ],
      updated: [],
      removedIds: [],
    });

    const finalEntries = [
      { content: 'Inspect the code', priority: 'high', status: 'completed' },
      { content: 'Run tests', priority: 'medium', status: 'completed' },
    ];
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'plan', id: '0190a200-asst:2', entries: finalEntries },
        },
      ],
      removedIds: [],
    });
    deltaPush('sub-1', 3, {
      added: [],
      updated: [
        {
          messageId: '0190a200-asst',
          role: 'assistant',
          messageSeq: 1,
          timestamp: '2026-06-27T01:00:05.000Z',
          streamingComplete: true,
          block: { type: 'plan', id: '0190a200-asst:2', entries: finalEntries },
        },
      ],
      removedIds: [],
    });

    const assistant = seen.at(-1)!.messages[1] as {
      contentBlocks: Array<{ id: string; type: string; entries?: unknown[] }>;
    };
    expect(assistant.contentBlocks.map((block) => block.type)).toEqual([
      'text',
      'thinking',
      'plan',
      'tool_use',
    ]);
    expect(assistant.contentBlocks.filter((block) => block.type === 'plan')).toEqual([
      { type: 'plan', id: '0190a200-asst:2', entries: finalEntries },
    ]);
    expect(seen.at(-1)!.isStreaming).toBe(false);
    off();
  });

  it('applies the terminal reconcile: authoritative fields, orphan removedIds, streaming off', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Working' },
        },
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          // A mispredicted tool_result id the persisted message won't contain.
          block: { type: 'tool_result', id: '0190a200-asst:2', tool_use_id: 'call-1', output: [] },
        },
      ],
      updated: [],
      removedIds: [],
    });
    // Terminal frame after agent:stream:end (§7.1): persisted blocks as
    // `updated` with messageSeq/timestamp/streamingComplete, orphan removed.
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          messageSeq: 1,
          timestamp: '2026-06-27T01:00:05.000Z',
          streamingComplete: true,
          block: { type: 'text', id: '0190a200-asst:0', text: 'Working' },
        },
      ],
      removedIds: ['0190a200-asst:2'],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as {
      isStreaming?: boolean;
      streamingComplete?: boolean;
      seq?: number;
      timestamp: string;
      contentBlocks: Array<{ id: string }>;
    };
    expect(asst.isStreaming).toBe(false);
    expect(asst.streamingComplete).toBe(true);
    expect(asst.seq).toBe(1);
    expect(asst.timestamp).toBe('2026-06-27T01:00:05.000Z');
    expect(asst.contentBlocks.map((b) => b.id)).toEqual(['0190a200-asst:0']);
    expect(last.isStreaming).toBe(false);
    off();
  });

  it('resnapshots on a sequence gap (unsubscribe + fresh chat.subscribe) and recovers', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    // seq jumps 1 → 3: a gap. The client must self-heal via re-registration.
    deltaPush('sub-1', 3, { added: [], updated: [], removedIds: [] });
    await flush();

    expect(mockedRequest).toHaveBeenCalledWith('chat.unsubscribe', { subscriptionId: 'sub-1' });
    expect(mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe')).toHaveLength(2);
    expect(reportStreamLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'subscription',
        event: 'push',
        pushKind: 'delta',
        pushSeq: 3,
        reconcilerResult: 'gap',
        callbackResult: 'not-invoked',
      }),
    );

    // Recovery seq-0 snapshot on the fresh registration rebuilds the transcript.
    snapshotPush('sub-2', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        {
          id: 'recovered-minimal',
          role: 'assistant',
          timestamp: '2026-06-27T01:00:03.000Z',
          contentBlocks: [{ type: 'thinking', id: 'recovered-minimal:0', text: 'Recovered' }],
        },
      ],
      totalMessages: 3,
    });
    const last = seen[seen.length - 1] as {
      messages: Array<Record<string, unknown>>;
      totalMessages?: number;
    };
    expect(last.totalMessages).toBe(3);
    expect(last.messages[0]).toMatchObject({
      id: 'recovered-minimal',
      agentId: 'agent-1',
    });
    expect(last.messages[0]).not.toHaveProperty('seq');
    off();
  });

  it('ignores stale duplicate deltas without resnapshotting', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: unknown[] = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Hi' },
        },
      ],
      updated: [],
      removedIds: [],
    });
    const emitsBefore = seen.length;

    // Re-delivery of seq 1 (already applied): silently ignored — not a gap.
    deltaPush('sub-1', 1, { added: [], updated: [], removedIds: [] });
    await flush();

    expect(seen.length).toBe(emitsBefore);
    expect(mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe')).toHaveLength(1);
    expect(mockedRequest).not.toHaveBeenCalledWith('chat.unsubscribe', expect.anything());
    expect(reportStreamLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'subscription',
        event: 'push',
        pushKind: 'delta',
        pushSeq: 1,
        reconcilerResult: 'stale',
        callbackResult: 'not-invoked',
      }),
    );
    off();
  });

  it('ignores an exact-duplicate seq-0 snapshot before the first delta', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ totalMessages: number }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    // A distinct object with identical content: the duplicate check is
    // content-based (payload fingerprint), not reference identity.
    snapshotPush('sub-1', 0, structuredClone(SEEDED_SNAPSHOT));

    expect(seen).toHaveLength(1);
    expect(seen[0].totalMessages).toBe(1);
    expect(mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe')).toHaveLength(1);
    off();
  });

  it('buffers pushes that race the subscribe reply and replays them post-ack', async () => {
    // Hold the chat.subscribe reply so the seq-0 push arrives pre-ack.
    let resolveSubscribe: ((r: { subscriptionId: string }) => void) | undefined;
    mockedRequest.mockImplementation((method: string) => {
      if (method === 'chat.subscribe') {
        return new Promise((resolve) => {
          resolveSubscribe = resolve as typeof resolveSubscribe;
        });
      }
      return Promise.resolve({});
    });

    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));

    // The push lands BEFORE the subscribe reply resolves.
    snapshotPush('sub-early', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(0);

    resolveSubscribe?.({ subscriptionId: 'sub-early' });
    await flush();

    expect(seen).toHaveLength(1);
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(['0190a1b2-user']);
    off();
  });

  it('re-registers on transport reconnect without unsubscribing the dead id', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    emitReconnect();
    await flush();

    // The restarted daemon dropped its registry: no chat.unsubscribe frame
    // for the stale id, just a fresh chat.subscribe.
    expect(mockedRequest).not.toHaveBeenCalledWith('chat.unsubscribe', expect.anything());
    expect(mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe')).toHaveLength(2);

    // Pushes for the dead id no longer match; the fresh seq-0 reseeds.
    snapshotPush('sub-2', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        {
          id: 'reconnected-minimal',
          role: 'user',
          timestamp: '2026-06-27T01:00:04.000Z',
          contentBlocks: [{ type: 'text', id: 'reconnected-minimal:0', text: 'Back' }],
        },
      ],
      totalMessages: 5,
    });
    const last = seen[seen.length - 1] as {
      messages: Array<Record<string, unknown>>;
      totalMessages?: number;
    };
    expect(last.totalMessages).toBe(5);
    expect(last.messages[0]).toMatchObject({
      id: 'reconnected-minimal',
      agentId: 'agent-1',
    });
    expect(last.messages[0]).not.toHaveProperty('seq');
    off();
  });

  it('stops emitting and unsubscribes after dispose', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: unknown[] = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(1);

    off();
    expect(mockedRequest).toHaveBeenCalledWith('chat.unsubscribe', { subscriptionId: 'sub-1' });

    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    deltaPush('sub-1', 1, { added: [], updated: [], removedIds: [] });
    expect(seen).toHaveLength(1);
  });

  it('preserves prior tool_use name/input on a progress-only (empty-name) tick', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: {
            type: 'tool_use',
            id: '0190a200-asst:0',
            name: 'run_tests',
            input: { suite: 'unit' },
            toolCallId: 'call-1',
            metadata: { toolKind: 'execute', status: 'started' },
          },
        },
      ],
      updated: [],
      removedIds: [],
    });
    // Sparse progress tick: the daemon's mapper defaults unset fields.
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: {
            type: 'tool_use',
            id: '0190a200-asst:0',
            name: '',
            input: {},
            toolCallId: 'call-1',
            metadata: { toolKind: 'other', status: 'in_progress' },
          },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as {
      contentBlocks: Array<{ name?: string; input?: unknown; metadata?: Record<string, unknown> }>;
    };
    expect(asst.contentBlocks[0].name).toBe('run_tests');
    expect(asst.contentBlocks[0].input).toEqual({ suite: 'unit' });
    expect(asst.contentBlocks[0].metadata?.toolKind).toBe('execute');
    expect(asst.contentBlocks[0].metadata?.status).toBe('in_progress');
    off();
  });

  it('folds a user-row delta into a new user message and upserts on re-delivery', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    // A queued user message lands as an `added` row (intentd#747): complete
    // at birth, so it carries messageSeq/timestamp/streamingComplete like a
    // terminal frame.
    const userRow = {
      agentId: 'agent-1',
      messageId: '0190a1c0-user2',
      role: 'user',
      messageSeq: 1,
      timestamp: '2026-06-27T01:00:02.000Z',
      streamingComplete: true,
      block: { type: 'text', id: '0190a1c0-user2:0', text: 'Also lint it' },
    };
    deltaPush('sub-1', 1, { added: [userRow], updated: [], removedIds: [] });

    let last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const user = last.messages[1] as {
      id: string;
      role: string;
      isStreaming?: boolean;
      seq?: number;
      timestamp: string;
      contentBlocks: Array<{ id: string; text: string }>;
    };
    expect(user.id).toBe('0190a1c0-user2');
    expect(user.role).toBe('user');
    expect(user.isStreaming).toBe(false);
    expect(user.seq).toBe(1);
    expect(user.timestamp).toBe('2026-06-27T01:00:02.000Z');
    expect(user.contentBlocks).toEqual([
      { type: 'text', id: '0190a1c0-user2:0', text: 'Also lint it' },
    ]);
    // The user-row's streamingComplete is not an assistant terminal — no turn
    // was in flight and none starts, so transcript-level streaming stays off.
    expect(last.isStreaming).toBe(false);

    // Re-delivery of the same row as `updated` upserts (same block id) —
    // never a duplicate message or block (intentd#747 semantics).
    deltaPush('sub-1', 2, { added: [], updated: [userRow], removedIds: [] });
    last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const again = last.messages[1] as { contentBlocks: unknown[] };
    expect(again.contentBlocks).toHaveLength(1);
    expect(last.isStreaming).toBe(false);
    off();
  });

  it("carries the user-row entity's metadata onto the materialized message (sender chip live)", async () => {
    // A child→coordinator row is persisted with
    // `metadata: { type: "agent_message", fromAgentId, fromAgentName }` and
    // the daemon lifts it onto the row's delta entities (PROTOCOL §7.1), so
    // the sender attribution chip renders at live delivery — no reload.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    const metadata = {
      type: 'agent_message',
      fromAgentId: 'agent-child',
      fromAgentName: 'Child Agent',
    };
    const childRow = {
      agentId: 'agent-1',
      messageId: '0190a1c0-user3',
      role: 'user',
      messageSeq: 1,
      timestamp: '2026-06-27T01:00:03.000Z',
      streamingComplete: true,
      metadata,
      block: { type: 'text', id: '0190a1c0-user3:0', text: 'Task complete' },
    };
    deltaPush('sub-1', 1, { added: [childRow], updated: [], removedIds: [] });

    let last = seen[seen.length - 1];
    let user = last.messages[1] as { id: string; metadata?: Record<string, unknown> };
    expect(user.id).toBe('0190a1c0-user3');
    expect(user.metadata).toEqual(metadata);

    // Re-delivery upserts keep the metadata (same authoritative entity).
    deltaPush('sub-1', 2, { added: [], updated: [childRow], removedIds: [] });
    last = seen[seen.length - 1];
    user = last.messages[1] as { id: string; metadata?: Record<string, unknown> };
    expect(user.metadata).toEqual(metadata);
    off();
  });

  it("carries the user-row entity's appMessageId onto the materialized message (intentd#781)", async () => {
    // A user row persisted with a client-minted `userAppMessageId` (§5.5) is
    // echoed on the §7.1 delta with `appMessageId` lifted onto each entity, so
    // the optimistic-insert dedup matches by exact appMessageId — no content
    // heuristics. Older daemons omit the field entirely (version skew): the
    // materialized message then carries no appMessageId and dedup falls back
    // to the user-msg- prefix + content match.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    const echoedRow = {
      agentId: 'agent-1',
      messageId: 'user-msg-7c1f4e0a-1111-2222-3333-444455556666',
      role: 'user',
      messageSeq: 1,
      timestamp: '2026-06-27T01:00:05.000Z',
      streamingComplete: true,
      appMessageId: 'app-msg-client-1',
      block: {
        type: 'text',
        id: 'user-msg-7c1f4e0a-1111-2222-3333-444455556666:0',
        text: 'Deploy it',
      },
    };
    deltaPush('sub-1', 1, { added: [echoedRow], updated: [], removedIds: [] });

    let last = seen[seen.length - 1];
    let user = last.messages[1] as { id: string; appMessageId?: string };
    expect(user.id).toBe('user-msg-7c1f4e0a-1111-2222-3333-444455556666');
    expect(user.appMessageId).toBe('app-msg-client-1');

    // Re-delivery upserts keep the appMessageId (same authoritative entity).
    deltaPush('sub-1', 2, { added: [], updated: [echoedRow], removedIds: [] });
    last = seen[seen.length - 1];
    user = last.messages[1] as { id: string; appMessageId?: string };
    expect(user.appMessageId).toBe('app-msg-client-1');

    // Sticky across skewed re-delivery: a later frame for the same row that
    // omits/blanks appMessageId must not clear the previously-stamped value.
    const { appMessageId: _dropped, ...rowWithoutAppId } = echoedRow;
    deltaPush('sub-1', 3, {
      added: [],
      updated: [{ ...rowWithoutAppId, appMessageId: '' }],
      removedIds: [],
    });
    last = seen[seen.length - 1];
    user = last.messages[1] as { id: string; appMessageId?: string };
    expect(user.appMessageId).toBe('app-msg-client-1');

    // Version skew: an older daemon's entity carries no appMessageId — the
    // materialized message must not invent one (empty string reads as absent).
    const legacyRow = {
      agentId: 'agent-1',
      messageId: 'user-msg-legacy-1',
      role: 'user',
      messageSeq: 2,
      timestamp: '2026-06-27T01:00:06.000Z',
      streamingComplete: true,
      appMessageId: '',
      block: { type: 'text', id: 'user-msg-legacy-1:0', text: 'Old daemon row' },
    };
    deltaPush('sub-1', 4, { added: [legacyRow], updated: [], removedIds: [] });
    last = seen[seen.length - 1];
    const legacy = last.messages[2] as { id: string; appMessageId?: string };
    expect(legacy.id).toBe('user-msg-legacy-1');
    expect(legacy.appMessageId).toBeUndefined();
    off();
  });

  it('drops a malformed array-shaped entity metadata (JSON objects only)', async () => {
    // `typeof [] === "object"` — a malformed wire payload carrying an array
    // must not propagate an invalid shape into `message.metadata`.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    const malformedRow = {
      agentId: 'agent-1',
      messageId: '0190a1c0-user4',
      role: 'user',
      messageSeq: 1,
      timestamp: '2026-06-27T01:00:04.000Z',
      streamingComplete: true,
      metadata: ['not', 'an', 'object'],
      block: { type: 'text', id: '0190a1c0-user4:0', text: 'Malformed row' },
    };
    deltaPush('sub-1', 1, { added: [malformedRow], updated: [], removedIds: [] });

    const last = seen[seen.length - 1];
    const user = last.messages[1] as { id: string; metadata?: unknown };
    expect(user.id).toBe('0190a1c0-user4');
    expect(user.metadata).toBeUndefined();
    off();
  });
});

// ---------------------------------------------------------------------------
// Regression scenarios ported from the deleted firehose suites (monorepo#1127)
// onto the chat.subscribe delta path.
// ---------------------------------------------------------------------------

describe('LiveChatClient.subscribe (ported delta-path regressions)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it('interrupt-send terminal reconcile keeps the partial blocks (§7.2: updated, never removedIds)', async () => {
    // cloudlands-fe#132 / intentd#336: a user interrupt persists the partial
    // assistant row BEFORE agent:stream:end, so the terminal reconcile
    // re-emits the streamed blocks as authoritative `updated` entries — the
    // partial output is never wiped via removedIds.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    // Streamed-so-far partial: text + a completed tool pair.
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Partial ' },
        },
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: {
            type: 'tool_use',
            id: '0190a200-asst:1',
            name: 'Read',
            input: { path: 'src/lib.rs' },
            toolCallId: 't-int',
            metadata: { toolKind: 'read', status: 'completed' },
          },
        },
      ],
      updated: [],
      removedIds: [],
    });
    expect(seen[seen.length - 1].isStreaming).toBe(true);

    // Interrupt: the daemon flushed the partial row (§7.2) and the terminal
    // reconcile re-emits every persisted block as `updated` with the
    // authoritative fields. removedIds stays empty — nothing is orphaned.
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          messageSeq: 1,
          timestamp: '2026-06-27T01:00:03.000Z',
          streamingComplete: true,
          block: { type: 'text', id: '0190a200-asst:0', text: 'Partial ' },
        },
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          messageSeq: 1,
          timestamp: '2026-06-27T01:00:03.000Z',
          streamingComplete: true,
          block: {
            type: 'tool_use',
            id: '0190a200-asst:1',
            name: 'Read',
            input: { path: 'src/lib.rs' },
            toolCallId: 't-int',
            metadata: { toolKind: 'read', status: 'completed' },
          },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as {
      isStreaming?: boolean;
      contentBlocks: Array<{ id: string; type: string; text?: string }>;
    };
    // The partial output survives the interrupt — blocks intact, in order.
    expect(asst.contentBlocks.map((b) => b.id)).toEqual(['0190a200-asst:0', '0190a200-asst:1']);
    expect(asst.contentBlocks[0].text).toBe('Partial ');
    expect(asst.isStreaming).toBe(false);
    expect(last.isStreaming).toBe(false);
    off();
  });

  it('carries interruptReason/interruptedBy metadata on the terminal reconcile onto the reconciled message (§7.1/§7.2)', async () => {
    // A preemption persists the interrupted row with the reason metadata and
    // the daemon lifts it onto the terminal delta entities — the fields must
    // survive verbatim onto the materialized message so the reason-specific
    // Stopped label renders live, without a reload.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Partial ' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    const interruptedMetadata = {
      interrupted: true,
      stopReason: 'interrupted',
      interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'agent', agentId: 'agent-sender-1', name: 'Coordinator' },
    };
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          messageSeq: 1,
          timestamp: '2026-06-27T01:00:03.000Z',
          streamingComplete: true,
          metadata: interruptedMetadata,
          block: { type: 'text', id: '0190a200-asst:0', text: 'Partial ' },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as {
      isStreaming?: boolean;
      metadata?: Record<string, unknown>;
    };
    expect(asst.isStreaming).toBe(false);
    expect(asst.metadata).toEqual(interruptedMetadata);
    off();
  });

  it("mid-turn rehydration: the seq-0 snapshot's synthetic in-flight assistant continues via deltas without a gap", async () => {
    // Tab switch / app restart mid-turn: the seq-0 snapshot carries the
    // synthetic in-flight assistant message (partial text preserved) and the
    // live delta stream keeps growing the SAME message by block id.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: '0190a200-asst',
          agentId: 'agent-1',
          seq: 1,
          role: 'assistant',
          isStreaming: true,
          contentBlocks: [{ type: 'text', id: '0190a200-asst:0', text: 'Partial so f' }],
          timestamp: '2026-06-27T01:00:00.500Z',
        },
      ],
      totalMessages: 2,
    });
    expect(seen[0].isStreaming).toBe(true);

    // The next live delta grows the snapshot's in-flight block — same
    // messageId, same block id — with no resnapshot in between.
    deltaPush('sub-1', 1, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Partial so far, and more.' },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const asst = last.messages[1] as { contentBlocks: Array<{ text: string }> };
    expect(asst.contentBlocks).toHaveLength(1);
    expect(asst.contentBlocks[0].text).toBe('Partial so far, and more.');
    // No gap was seen: exactly one chat.subscribe registration.
    expect(mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe')).toHaveLength(1);
    off();
  });

  it('reconnect replay converges (RESUB-1): fresh snapshot + live deltas apply, dead-id pushes are ignored', async () => {
    // cloudlands-fe#15: the daemon restarted and dropped its registry. The
    // client re-registers, the fresh seq-0 snapshot rebuilds, subsequent live
    // deltas apply — and a replayed push for the dead id never writes.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; totalMessages?: number }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    emitReconnect();
    await flush();

    // Fresh registration; the restarted daemon replays a stale-looking push
    // on the DEAD id first — it must be ignored, not resurrect old state.
    const emitsBefore = seen.length;
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: 'ghost-asst',
          role: 'assistant',
          block: { type: 'text', id: 'ghost-asst:0', text: 'stale replay' },
        },
      ],
      updated: [],
      removedIds: [],
    });
    expect(seen.length).toBe(emitsBefore);

    // The new registration's seq-0 snapshot converges the transcript…
    snapshotPush('sub-2', 0, { ...SEEDED_SNAPSHOT, totalMessages: 2 });
    // …and live deltas continue on the new id.
    deltaPush('sub-2', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a300-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a300-asst:0', text: 'post-restart turn' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const ids = last.messages.map((m) => (m as { id: string }).id);
    expect(ids).toEqual(['0190a1b2-user', '0190a300-asst']);
    expect(ids).not.toContain('ghost-asst');
    expect(reportStreamLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'push',
        pushKind: 'snapshot',
        pushSeq: 0,
        subscriptionGeneration: 3,
        transportGeneration: 1,
        reconcilerResult: 'reset',
        callbackResult: 'delivered',
      }),
    );
    off();
  });

  it('truncation/shrink: a recovery snapshot with fewer messages rebuilds the transcript (agent.replaceMessages)', async () => {
    // Edit/regenerate flows swap the transcript via agent.replaceMessages
    // (#505 baseline-merge lineage). On the delta path the convergence
    // guarantee is the §7.1 invariant: a fresh snapshot REBUILDS the message
    // list — dropped rows are gone, not merged back.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; totalMessages?: number }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: '0190a200-asst',
          agentId: 'agent-1',
          seq: 1,
          role: 'assistant',
          contentBlocks: [{ type: 'text', id: '0190a200-asst:0', text: 'Old answer' }],
          timestamp: '2026-06-27T01:00:01.000Z',
        },
      ],
      totalMessages: 2,
    });
    expect(seen[0].messages).toHaveLength(2);

    // The swap invalidates the registration's seq stream: a gap triggers the
    // self-heal resnapshot whose fresh page is the truncated transcript.
    deltaPush('sub-1', 5, { added: [], updated: [], removedIds: [] });
    await flush();
    snapshotPush('sub-2', 0, SEEDED_SNAPSHOT);

    const last = seen[seen.length - 1];
    expect(last.messages.map((m) => (m as { id: string }).id)).toEqual(['0190a1b2-user']);
    expect(last.totalMessages).toBe(1);
    off();
  });

  it('renders daemon-synthesized standalone resource blocks verbatim (proposal + turn-end question, §7.1)', async () => {
    // The FE lift is gone — the daemon synthesizes the standalone
    // proposal-resource block (after the tool_result) and drains AtTurnEnd
    // question blocks into the terminal reconcile as `added`. Both must ride
    // through the reconciler byte-faithfully.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);

    const proposalResource = {
      type: 'resource',
      id: '0190a200-asst:2',
      resource: {
        uri: 'intent-proposal://plan/abc',
        name: 'Plan proposal',
        mimeType: 'application/vnd.intent.proposal+json',
        text: '{"kind":"plan","preview":{"title":"Plan proposal"},"payload":{}}',
      },
    };
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: {
            type: 'tool_result',
            id: '0190a200-asst:1',
            tool_use_id: 'call-1',
            output: [],
            is_error: false,
          },
        },
        // Standalone proposal block, appended by the daemon's tool_delta.
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: proposalResource,
        },
      ],
      updated: [],
      removedIds: [],
    });

    // Terminal reconcile: the AtTurnEnd question block arrives as `added`
    // (never seen live — questions are drained at turn finalization).
    const questionResource = {
      type: 'resource',
      id: '0190a200-asst:3',
      resource: {
        uri: 'intent-question://tar-3f9c2a81d0b4',
        name: 'Auth method',
        mimeType: 'application/vnd.intent.question+json',
        text: '{"attachmentId":"tar-3f9c2a81d0b4","header":"Auth method","question":"Which auth?","options":[{"label":"OAuth"},{"label":"API key"}],"multiSelect":false}',
      },
    };
    deltaPush('sub-1', 2, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          messageSeq: 1,
          timestamp: '2026-06-27T01:00:05.000Z',
          streamingComplete: true,
          block: questionResource,
        },
      ],
      updated: [],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as { contentBlocks: Array<Record<string, unknown>> };
    // Faithful rendering pin: the daemon-synthesized blocks are stored
    // verbatim — no FE healing, renaming, or re-derivation.
    expect(asst.contentBlocks[1]).toEqual(proposalResource);
    expect(asst.contentBlocks[2]).toEqual(questionResource);
    off();
  });

  it("fan-out isolation: a delta on a foreign agent's subscription never mutates the viewed transcript", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seenA: Array<{ messages: unknown[] }> = [];
    const seenB: Array<{ messages: unknown[] }> = [];
    const offA = client.subscribe('agent-1', (t) => seenA.push(t));
    await flush();
    const offB = client.subscribe('agent-2', (t) => seenB.push(t));
    await flush();

    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    snapshotPush('sub-2', 0, {
      agentId: 'agent-2',
      messages: [],
      truncated: false,
      totalMessages: 0,
    });

    // A turn streams on agent-2's subscription only.
    deltaPush('sub-2', 1, {
      added: [
        {
          agentId: 'agent-2',
          messageId: '0190b100-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190b100-asst:0', text: 'foreign turn' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    // agent-1's transcript is untouched — no emit past its snapshot, no
    // foreign message bleed-through.
    expect(seenA).toHaveLength(1);
    expect(seenA[0].messages.map((m) => (m as { id: string }).id)).toEqual(['0190a1b2-user']);
    // agent-2's transcript got exactly the foreign turn.
    const lastB = seenB[seenB.length - 1];
    expect(lastB.messages.map((m) => (m as { id: string }).id)).toEqual(['0190b100-asst']);
    offA();
    offB();
  });
});

describe('LiveChatClient.subscribe phase reporting (onPhase)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    reset();
  });

  it('reports connecting → awaiting-snapshot → live across the happy path', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      () => {},
      (p) => phases.push(p),
    );

    expect(phases).toEqual(['connecting']);
    await flush();
    expect(phases).toEqual(['connecting', 'awaiting-snapshot']);

    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    expect(phases).toEqual(['connecting', 'awaiting-snapshot', 'live']);
    off();
  });

  it('reports resyncing on a sequence gap and live when the recovery snapshot lands', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      () => {},
      (p) => phases.push(p),
    );
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    phases.length = 0;

    // seq jump: 1 expected, 5 arrives → gap → resnapshot registration.
    deltaPush('sub-1', 5, { added: [], updated: [], removedIds: [] });
    expect(phases).toEqual(['resyncing']);
    await flush();
    // Ack of the recovery registration keeps reporting resyncing (no
    // awaiting-snapshot flap mid-recovery).
    expect(phases).toEqual(['resyncing']);

    snapshotPush('sub-2', 0, SEEDED_SNAPSHOT);
    expect(phases).toEqual(['resyncing', 'live']);
    off();
  });

  it('reports delayed when chat.subscribe rejects and keeps delayed across backoff retries', async () => {
    vi.useFakeTimers();
    mockedRequest.mockImplementation(async (method: string) => {
      if (method === 'chat.subscribe') throw new Error('transport down');
      return {};
    });
    const client = new LiveChatClient();
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      () => {},
      (p) => phases.push(p),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(phases).toEqual(['connecting', 'delayed']);

    // The backoff retry re-registers without flapping back to connecting —
    // the phase stays delayed while self-healing.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe')).toHaveLength(2);
    expect(phases).toEqual(['connecting', 'delayed']);
    off();
  });

  it('reports delayed when the seq-0 snapshot times out, then live when it lands before the retry', async () => {
    vi.useFakeTimers();
    mockChatSubscribe();
    const client = new LiveChatClient();
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      () => {},
      (p) => phases.push(p),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(phases).toEqual(['connecting', 'awaiting-snapshot']);

    // SNAPSHOT_TIMEOUT_MS elapses without the seq-0 push: delayed is
    // reported and a resubscribe retry is armed.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(phases).toEqual(['connecting', 'awaiting-snapshot', 'delayed']);

    // The late snapshot (before the retry fires) still hydrates and cancels
    // the pending retry: no unsubscribe/resubscribe ever goes out.
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    expect(phases).toEqual(['connecting', 'awaiting-snapshot', 'delayed', 'live']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe')).toHaveLength(1);
    expect(mockedRequest).not.toHaveBeenCalledWith('chat.unsubscribe', expect.anything());
    off();
  });

  it('re-reports connecting on transport reconnect and never reports past dispose', async () => {
    vi.useFakeTimers();
    mockChatSubscribe();
    const client = new LiveChatClient();
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      () => {},
      (p) => phases.push(p),
    );
    await vi.advanceTimersByTimeAsync(0);
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    phases.length = 0;

    emitReconnect();
    expect(phases).toEqual(['connecting']);
    expect(reportStreamLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'transport-reconnected',
        subscriptionGeneration: 2,
        transportGeneration: 1,
        callbackResult: 'not-invoked',
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(phases).toEqual(['connecting', 'awaiting-snapshot']);

    off();
    phases.length = 0;
    // The armed snapshot timer must not fire a delayed report after dispose.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(phases).toEqual([]);
  });

  it('dedupes phase reports (no repeat for an unchanged phase)', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      () => {},
      (p) => phases.push(p),
    );
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    // Applied delta then a stale duplicate: both leave the phase at live.
    deltaPush('sub-1', 1, {
      added: [
        {
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'hi' },
        },
      ],
      updated: [],
      removedIds: [],
    });
    deltaPush('sub-1', 1, { added: [], updated: [], removedIds: [] });

    expect(phases).toEqual(['connecting', 'awaiting-snapshot', 'live']);
    off();
  });
});

// ---------------------------------------------------------------------------
// Self-heal retry (intent-hq/monorepo#1394): a rejected registration or a
// missing seq-0 snapshot re-registers on an exponential backoff schedule —
// no transport reconnect required. Timers are cancelled by hydration,
// reconnect, and dispose; the backoff resets once healthy.
// ---------------------------------------------------------------------------

describe('LiveChatClient.subscribe self-heal retry (intent-hq/monorepo#1394)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    reset();
  });

  const subscribeCalls = () => mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe');
  const unsubscribeCalls = () => mockedRequest.mock.calls.filter(([m]) => m === 'chat.unsubscribe');

  /** Sequentially-minted ids like `mockChatSubscribe`, rejecting while `fail()`. */
  function mockFlakyChatSubscribe(fail: () => boolean, prefix = 'sub'): void {
    let n = 0;
    mockedRequest.mockImplementation(async (method: string) => {
      if (method === 'chat.subscribe') {
        n += 1;
        if (fail()) throw new Error('transport down');
        return { subscriptionId: `${prefix}-${n}` };
      }
      return {};
    });
  }

  it('recovers from a rejected chat.subscribe via a delayed retry, no reconnect', async () => {
    vi.useFakeTimers();
    let failures = 1;
    mockFlakyChatSubscribe(() => failures-- > 0);
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      (t) => seen.push(t),
      (p) => phases.push(p),
    );
    await vi.advanceTimersByTimeAsync(0);

    // First registration rejected: exactly one wire attempt, phase delayed.
    expect(subscribeCalls()).toEqual([
      ['chat.subscribe', { agentId: 'agent-1', deltaEncoding: 'incremental', projection: 'slim' }],
    ]);
    expect(phases).toEqual(['connecting', 'delayed']);

    // Nothing fires before the 1s initial backoff elapses.
    await vi.advanceTimersByTimeAsync(999);
    expect(subscribeCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribeCalls()).toEqual([
      ['chat.subscribe', { agentId: 'agent-1', deltaEncoding: 'incremental', projection: 'slim' }],
      ['chat.subscribe', { agentId: 'agent-1', deltaEncoding: 'incremental', projection: 'slim' }],
    ]);
    // A rejected registration acked no id — no unsubscribe frame on retry.
    expect(unsubscribeCalls()).toEqual([]);

    // The §7.1 seq-0 recovery snapshot on the retried registration hydrates.
    snapshotPush('sub-2', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(1);
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(['0190a1b2-user']);
    expect(phases).toEqual(['connecting', 'delayed', 'live']);
    off();
  });

  it('backs off exponentially across consecutive rejections, capped at 30s', async () => {
    vi.useFakeTimers();
    mockFlakyChatSubscribe(() => true);
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toHaveLength(1);

    // Delays double per consecutive failure: 1s, 2s, 4s, 8s, 16s, then 30s cap.
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      const before = subscribeCalls().length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(subscribeCalls()).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(subscribeCalls()).toHaveLength(before + 1);
    }
    // 32s would exceed the cap: the next two retries fire at 30s each.
    for (let i = 0; i < 2; i++) {
      const before = subscribeCalls().length;
      await vi.advanceTimersByTimeAsync(29_999);
      expect(subscribeCalls()).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(subscribeCalls()).toHaveLength(before + 1);
    }
    off();
  });

  it('resets the backoff to the initial delay once a snapshot hydrates', async () => {
    vi.useFakeTimers();
    let fail = true;
    mockFlakyChatSubscribe(() => fail);
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {});
    await vi.advanceTimersByTimeAsync(0);

    // Two failures walk the backoff to 4s-next (1s and 2s retries consumed).
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscribeCalls()).toHaveLength(3);

    // Third retry (4s) succeeds and its seq-0 snapshot hydrates → reset.
    fail = false;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(subscribeCalls()).toHaveLength(4);
    snapshotPush('sub-4', 0, SEEDED_SNAPSHOT);

    // A later gap-triggered re-registration fails again: the retry fires at
    // the INITIAL 1s delay, not a continuation of the previous backoff.
    fail = true;
    deltaPush('sub-4', 5, { added: [], updated: [], removedIds: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(999);
    expect(subscribeCalls()).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribeCalls()).toHaveLength(6);
    off();
  });

  it('resubscribes after a seq-0 timeout: unsubscribes the stale registration and hydrates fresh', async () => {
    vi.useFakeTimers();
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const phases: string[] = [];
    const off = client.subscribe(
      'agent-1',
      (t) => seen.push(t),
      (p) => phases.push(p),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toEqual([
      ['chat.subscribe', { agentId: 'agent-1', deltaEncoding: 'incremental', projection: 'slim' }],
    ]);

    // Acked but no seq-0 within SNAPSHOT_TIMEOUT_MS: delayed + retry armed.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(phases).toEqual(['connecting', 'awaiting-snapshot', 'delayed']);
    expect(unsubscribeCalls()).toEqual([]);

    // The retry best-effort releases the stale registration and re-registers.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(unsubscribeCalls()).toEqual([['chat.unsubscribe', { subscriptionId: 'sub-1' }]]);
    expect(subscribeCalls()).toEqual([
      ['chat.subscribe', { agentId: 'agent-1', deltaEncoding: 'incremental', projection: 'slim' }],
      ['chat.subscribe', { agentId: 'agent-1', deltaEncoding: 'incremental', projection: 'slim' }],
    ]);

    // The recovery seq-0 snapshot (§7.1) hydrates the transcript.
    snapshotPush('sub-2', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(1);
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(['0190a1b2-user']);
    expect(phases).toEqual(['connecting', 'awaiting-snapshot', 'delayed', 'live']);

    // Hydration cancelled the timers: nothing further goes on the wire.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribeCalls()).toHaveLength(2);
    expect(unsubscribeCalls()).toHaveLength(1);
    off();
  });

  it('repeated seq-0 timeouts back off on the same schedule (no 5s hammering)', async () => {
    vi.useFakeTimers();
    mockChatSubscribe();
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {});
    await vi.advanceTimersByTimeAsync(0);

    // First timeout (5s) → retry after 1s.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subscribeCalls()).toHaveLength(2);
    expect(unsubscribeCalls()).toEqual([['chat.unsubscribe', { subscriptionId: 'sub-1' }]]);

    // Second timeout → retry after 2s (doubled), not another 1s.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(subscribeCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribeCalls()).toHaveLength(3);
    expect(unsubscribeCalls()).toEqual([
      ['chat.unsubscribe', { subscriptionId: 'sub-1' }],
      ['chat.unsubscribe', { subscriptionId: 'sub-2' }],
    ]);
    off();
  });

  it('cancels a pending retry on dispose — no request fires after off()', async () => {
    vi.useFakeTimers();
    mockFlakyChatSubscribe(() => true);
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toHaveLength(1);

    off();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribeCalls()).toHaveLength(1);
    expect(unsubscribeCalls()).toEqual([]);
  });

  it('a transport reconnect supersedes a pending retry (no duplicate registration)', async () => {
    vi.useFakeTimers();
    let fail = true;
    mockFlakyChatSubscribe(() => fail);
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toHaveLength(1);

    // Reconnect before the 1s retry fires: its registration IS the recovery.
    fail = false;
    emitReconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toHaveLength(2);
    snapshotPush('sub-2', 0, SEEDED_SNAPSHOT);

    // The pre-reconnect retry never fires — no third registration.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribeCalls()).toHaveLength(2);
    off();
  });

  it('a gap-triggered resnapshot supersedes a pending retry (no extra unsubscribe/subscribe cycle)', async () => {
    vi.useFakeTimers();
    mockChatSubscribe();
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toHaveLength(1);

    // Acked but no seq-0 within SNAPSHOT_TIMEOUT_MS: a 1s retry is armed.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(unsubscribeCalls()).toEqual([]);

    // A delta lands before any snapshot: gap → resnapshot re-registers
    // immediately (unsubscribe sub-1 + fresh subscribe) and cancels the
    // pending retry — the resnapshot registration IS the recovery.
    deltaPush('sub-1', 3, { added: [], updated: [], removedIds: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(unsubscribeCalls()).toEqual([['chat.unsubscribe', { subscriptionId: 'sub-1' }]]);
    expect(subscribeCalls()).toHaveLength(2);

    // The superseded retry's deadline passes BEFORE the recovery snapshot
    // arrives: it must not fire an extra unsubscribe/subscribe cycle on top
    // of the resnapshot's registration.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subscribeCalls()).toHaveLength(2);
    expect(unsubscribeCalls()).toHaveLength(1);

    // The resnapshot's seq-0 snapshot hydrates; nothing further on the wire.
    snapshotPush('sub-2', 0, SEEDED_SNAPSHOT);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribeCalls()).toHaveLength(2);
    expect(unsubscribeCalls()).toHaveLength(1);
    off();
  });

  it("a gap-triggered resnapshot clears the prior ack's seq-0 ceiling (no stale timeout retry)", async () => {
    vi.useFakeTimers();
    // First registration acks immediately; the resnapshot's registration is
    // held in flight so the prior ack's 5s deadline can elapse mid-recovery.
    let n = 0;
    let resolveInFlight: (() => void) | undefined;
    mockedRequest.mockImplementation(async (method: string) => {
      if (method === 'chat.subscribe') {
        n += 1;
        const result = { subscriptionId: `sub-${n}` };
        if (n === 1) return result;
        return new Promise((resolve) => {
          resolveInFlight = () => resolve(result);
        });
      }
      return {};
    });
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeCalls()).toHaveLength(1);

    // A gap lands just before the 5s seq-0 deadline: resnapshot unsubscribes
    // sub-1 and re-registers (ack still in flight).
    await vi.advanceTimersByTimeAsync(4_999);
    deltaPush('sub-1', 3, { added: [], updated: [], removedIds: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(unsubscribeCalls()).toEqual([['chat.unsubscribe', { subscriptionId: 'sub-1' }]]);
    expect(subscribeCalls()).toHaveLength(2);

    // The prior ack's deadline (t=5s) elapses while the recovery ack is in
    // flight; its stale timer must NOT fire scheduleRetry() and cause an
    // extra unregister/register (which would also orphan the in-flight ack).
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscribeCalls()).toHaveLength(2);
    expect(unsubscribeCalls()).toHaveLength(1);

    // The recovery ack resolves and its seq-0 snapshot (§7.1) hydrates;
    // nothing further goes on the wire.
    resolveInFlight?.();
    await vi.advanceTimersByTimeAsync(0);
    snapshotPush('sub-2', 0, SEEDED_SNAPSHOT);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribeCalls()).toHaveLength(2);
    expect(unsubscribeCalls()).toHaveLength(1);
    off();
  });
});

// ---------------------------------------------------------------------------
// Resume via sinceMessageId (PROTOCOL §7.1): the registration carries the
// anchor, the seq-0 snapshot's `resumed` disposition rides the emit, and
// internal re-registrations after the first snapshot drop the anchor.
// ---------------------------------------------------------------------------

describe('LiveChatClient.subscribe resume (sinceMessageId, §7.1)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it('sends sinceMessageId on chat.subscribe and stamps resumed: true on the seq-0 emit', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; resumed?: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t), undefined, {
      sinceMessageId: '0190a1b2-user',
    });
    await flush();

    expect(mockedRequest).toHaveBeenCalledWith('chat.subscribe', {
      agentId: 'agent-1',
      deltaEncoding: 'incremental',
      projection: 'slim',
      sinceMessageId: '0190a1b2-user',
    });

    // Resumed delta snapshot: only the post-anchor message, resumed: true.
    snapshotPush('sub-1', 0, {
      agentId: 'agent-1',
      messages: [
        {
          id: '0190a200-asst',
          agentId: 'agent-1',
          seq: 1,
          role: 'assistant',
          contentBlocks: [{ type: 'text', id: '0190a200-asst:0', text: 'Done.' }],
          timestamp: '2026-06-27T01:00:01.000Z',
        },
      ],
      truncated: false,
      totalMessages: 2,
      nextToken: null,
      resumed: true,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].resumed).toBe(true);
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(['0190a200-asst']);

    // Subsequent delta emits carry NO resumed field.
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:1', text: 'More.' },
        },
      ],
      updated: [],
      removedIds: [],
    });
    expect(seen).toHaveLength(2);
    expect('resumed' in (seen[1] as object)).toBe(false);
    off();
  });

  it('stamps resumed: false when the daemon falls back to the full newest page', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ resumed?: boolean; messages: unknown[] }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t), undefined, {
      sinceMessageId: 'pruned-anchor-id',
    });
    await flush();

    snapshotPush('sub-1', 0, { ...SEEDED_SNAPSHOT, resumed: false });

    expect(seen).toHaveLength(1);
    expect(seen[0].resumed).toBe(false);
    // The fallback snapshot is the standard newest page, applied as a rebuild.
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(['0190a1b2-user']);
    off();
  });

  it('omits sinceMessageId entirely when no resume is requested', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ resumed?: boolean }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    expect(mockedRequest).toHaveBeenCalledWith('chat.subscribe', {
      agentId: 'agent-1',
      deltaEncoding: 'incremental',
      projection: 'slim',
    });
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(1);
    expect('resumed' in (seen[0] as object)).toBe(false);
    off();
  });

  it('drops the anchor after the first snapshot: a gap resnapshot re-registers WITHOUT sinceMessageId', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {}, undefined, {
      sinceMessageId: '0190a1b2-user',
    });
    await flush();
    snapshotPush('sub-1', 0, { ...SEEDED_SNAPSHOT, resumed: true });

    // seq gap → resnapshot: the recovery registration must take the FULL
    // newest page (the reconciler holds daemon-served state, not the anchor's
    // baseline), so no sinceMessageId rides the re-register.
    deltaPush('sub-1', 3, { added: [], updated: [], removedIds: [] });
    await flush();

    const subscribes = mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe');
    expect(subscribes).toHaveLength(2);
    expect(subscribes[1][1]).toEqual({
      agentId: 'agent-1',
      deltaEncoding: 'incremental',
      projection: 'slim',
    });
    off();
  });

  it('keeps the anchor for a retry when the FIRST registration is rejected pre-snapshot', async () => {
    vi.useFakeTimers();
    let failures = 1;
    let n = 0;
    mockedRequest.mockImplementation(async (method: string) => {
      if (method === 'chat.subscribe') {
        n += 1;
        if (failures-- > 0) throw new Error('transport down');
        return { subscriptionId: `sub-${n}` };
      }
      return {};
    });
    const client = new LiveChatClient();
    const off = client.subscribe('agent-1', () => {}, undefined, {
      sinceMessageId: '0190a1b2-user',
    });
    await vi.advanceTimersByTimeAsync(0);

    // No snapshot has applied yet — the backoff retry still wants the delta.
    await vi.advanceTimersByTimeAsync(1_000);
    const subscribes = mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe');
    expect(subscribes).toHaveLength(2);
    expect(subscribes[1][1]).toEqual({
      agentId: 'agent-1',
      deltaEncoding: 'incremental',
      projection: 'slim',
      sinceMessageId: '0190a1b2-user',
    });
    vi.useRealTimers();
    off();
  });
});

// ---------------------------------------------------------------------------
// Daemon-side stream restart (intent-hq/monorepo#2627): a harness restart
// re-emits the seq-0 snapshot and restarts the delta seq counter on the SAME
// subscriptionId. The reconciler must rebuild from that snapshot — rejecting
// it as a stale duplicate leaves expectedSeq ahead of the restarted stream,
// so every following delta is silently dropped as 'stale' and the transcript
// freezes until an unrelated seq jump (the user's next message) finally
// forces a gap resnapshot.
// ---------------------------------------------------------------------------

describe('LiveChatClient.subscribe daemon stream restart (intent-hq/monorepo#2627)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    reset();
  });

  const subscribeCalls = () => mockedRequest.mock.calls.filter(([m]) => m === 'chat.subscribe');

  const assistantDelta = (messageId: string, text: string) => ({
    added: [
      {
        messageId,
        role: 'assistant',
        block: { type: 'text', id: `${messageId}:0`, text },
        blockIndex: 0,
        streamingComplete: false,
      },
    ],
    updated: [],
    removedIds: [],
  });

  it('rebuilds from a re-emitted seq-0 snapshot and applies the restarted delta stream', async () => {
    vi.useFakeTimers();
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{
      messages: Array<{ id: string; contentBlocks?: Array<{ text?: string }> }>;
    }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t as never));
    await vi.advanceTimersByTimeAsync(0);

    // Hydrated and advanced: expectedSeq is now 3.
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    deltaPush('sub-1', 1, assistantDelta('a1', 'hello'));
    deltaPush('sub-1', 2, assistantDelta('a1', 'hello world'));
    expect(seen).toHaveLength(3);

    // Harness restart: the daemon re-emits seq-0 and restarts deltas at 1 on
    // the same subscription. The snapshot must re-seed the transcript…
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(4);

    // …and the restarted deltas must render (the frozen-transcript black
    // hole dropped every one of these as 'stale').
    deltaPush('sub-1', 1, assistantDelta('b1', 'recovered'));
    deltaPush('sub-1', 2, assistantDelta('b1', 'recovered turn'));
    expect(seen).toHaveLength(6);
    const last = seen[seen.length - 1];
    expect(last.messages.map((m) => m.id)).toEqual(['0190a1b2-user', 'b1']);
    expect(last.messages[1].contentBlocks?.[0]).toMatchObject({ text: 'recovered turn' });

    // The rebuild is in-place: no unsubscribe/subscribe churn afterwards.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribeCalls()).toHaveLength(1);
    off();
  });

  it('still ignores an exact duplicate re-delivery of the hydration snapshot', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: unknown[] = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(1);

    // Duplicate re-delivery before any delta advanced the stream: no repeat
    // hydration edge. A clone, so equality is content-based, not identity.
    snapshotPush('sub-1', 0, structuredClone(SEEDED_SNAPSHOT));
    expect(seen).toHaveLength(1);

    // The stream continues at seq 1 and applies normally either way.
    deltaPush('sub-1', 1, assistantDelta('a1', 'hi'));
    expect(seen).toHaveLength(2);
    off();
  });

  it('rebuilds from a divergent seq-0 re-emit before the first delta (intent-hq/monorepo#2716)', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{
      messages: Array<{ id: string; contentBlocks?: Array<{ text?: string }> }>;
      totalMessages: number;
    }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t as never));
    await flush();

    // Hydrated, no delta applied yet: expectedSeq is still 1.
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(1);

    // Daemon-side stream restart racing the idle stream: the re-emitted seq-0
    // carries a row persisted while the stream was down (it got no delta and
    // exists only in this snapshot). Treating it as a duplicate hides that
    // row until the next gap resnapshot.
    const divergent = {
      ...SEEDED_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: '0190a1c0-asst',
          agentId: 'agent-1',
          seq: 1,
          role: 'assistant',
          contentBlocks: [{ type: 'text', id: '0190a1c0-asst:0', text: 'persisted while down' }],
          timestamp: '2026-06-27T01:00:05.000Z',
        },
      ],
      totalMessages: 2,
    };
    snapshotPush('sub-1', 0, divergent);
    expect(seen).toHaveLength(2);
    expect(seen[1].messages.map((m) => m.id)).toEqual(['0190a1b2-user', '0190a1c0-asst']);
    expect(seen[1].totalMessages).toBe(2);

    // The restarted delta stream at seq 1 applies onto the rebuilt state.
    deltaPush('sub-1', 1, assistantDelta('b1', 'next turn'));
    expect(seen).toHaveLength(3);
    const last = seen[seen.length - 1];
    expect(last.messages.map((m) => m.id)).toEqual(['0190a1b2-user', '0190a1c0-asst', 'b1']);
    expect(last.messages[2].contentBlocks?.[0]).toMatchObject({ text: 'next turn' });

    // In-place rebuild: no unsubscribe/subscribe churn.
    expect(subscribeCalls()).toHaveLength(1);
    expect(mockedRequest).not.toHaveBeenCalledWith('chat.unsubscribe', expect.anything());
    off();
  });
});

// ---------------------------------------------------------------------------
// Incremental delta encoding (PROTOCOL §7.1 `deltaEncoding`, monorepo#2675):
// the registration opts in, but the SNAPSHOT ECHO decides the reducer — with
// `deltaEncoding: "incremental"` echoed, `textDelta`-bearing text/thinking
// entities APPEND their fragment; without the echo (older daemon ignoring
// the param) every block reduces full-text as before.
// ---------------------------------------------------------------------------

describe('LiveChatClient.subscribe incremental delta encoding (§7.1 deltaEncoding)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    reset();
  });

  const INCREMENTAL_SNAPSHOT = { ...SEEDED_SNAPSHOT, deltaEncoding: 'incremental' };

  function textFragment(kind: 'added' | 'updated', blockType: string, fragment: string) {
    return {
      [kind]: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: blockType, id: '0190a200-asst:0', textDelta: fragment },
        },
      ],
      ...(kind === 'added' ? { updated: [] } : { added: [] }),
      removedIds: [],
    };
  }

  it('appends textDelta fragments: added creates the block, updated appends in seq order', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ id: string; contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, INCREMENTAL_SNAPSHOT);

    // First chunk arrives in `added` carrying only its fragment — the block
    // is created with text equal to the fragment (append onto empty).
    deltaPush('sub-1', 1, textFragment('added', 'text', 'Reading'));
    expect(seen[1].messages[1].contentBlocks?.[0]).toEqual({
      type: 'text',
      id: '0190a200-asst:0',
      text: 'Reading',
    });

    // Growth frames arrive in `updated` carrying only the new fragment.
    deltaPush('sub-1', 2, textFragment('updated', 'text', ' the'));
    deltaPush('sub-1', 3, textFragment('updated', 'text', ' logs'));
    expect(seen[3].messages[1].contentBlocks?.[0]).toEqual({
      type: 'text',
      id: '0190a200-asst:0',
      text: 'Reading the logs',
    });
    off();
  });

  it('thinking fragments share the encoding and append exactly like text', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, INCREMENTAL_SNAPSHOT);
    deltaPush('sub-1', 1, textFragment('added', 'thinking', 'Let me '));
    deltaPush('sub-1', 2, textFragment('updated', 'thinking', 'check.'));

    expect(seen[2].messages[1].contentBlocks?.[0]).toEqual({
      type: 'thinking',
      id: '0190a200-asst:0',
      text: 'Let me check.',
    });
    off();
  });

  it('reduces full-text (no append) when the snapshot carries NO encoding echo', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    // Older daemon: the request param was ignored, no echo on the snapshot.
    snapshotPush('sub-1', 0, SEEDED_SNAPSHOT);
    deltaPush('sub-1', 1, {
      added: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Reading' },
        },
      ],
      updated: [],
      removedIds: [],
    });
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Reading the logs' },
        },
      ],
      removedIds: [],
    });

    // Latest-entity-wins on the full accumulated text — never doubled.
    expect(seen[2].messages[1].contentBlocks?.[0]).toEqual({
      type: 'text',
      id: '0190a200-asst:0',
      text: 'Reading the logs',
    });
    off();
  });

  it('mid-turn snapshot composes: fragments append after the snapshot prefix', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    // The merged in-flight message carries the text accumulated so far.
    snapshotPush('sub-1', 0, {
      ...INCREMENTAL_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: '0190a200-asst',
          agentId: 'agent-1',
          seq: 1,
          role: 'assistant',
          contentBlocks: [{ type: 'text', id: '0190a200-asst:0', text: 'Reading the' }],
          timestamp: '2026-06-27T01:00:01.000Z',
          isStreaming: true,
        },
      ],
      totalMessages: 2,
    });

    // Post-snapshot fragments arrive in `updated` — the block is known.
    deltaPush('sub-1', 1, textFragment('updated', 'text', ' logs'));
    expect(seen[1].messages[1].contentBlocks?.[0]).toEqual({
      type: 'text',
      id: '0190a200-asst:0',
      text: 'Reading the logs',
    });
    off();
  });

  it('terminal reconcile stays authoritative full-text over the appended state', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{
      isStreaming: boolean;
      messages: Array<{ contentBlocks?: unknown[] }>;
    }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, INCREMENTAL_SNAPSHOT);
    deltaPush('sub-1', 1, textFragment('added', 'text', 'Readin'));
    expect(seen[1].isStreaming).toBe(true);

    // Terminal reconcile: FULL block with authoritative `text`, no textDelta
    // — upserted verbatim in both encodings (convergence checkpoint).
    deltaPush('sub-1', 2, {
      added: [],
      updated: [
        {
          agentId: 'agent-1',
          messageId: '0190a200-asst',
          role: 'assistant',
          block: { type: 'text', id: '0190a200-asst:0', text: 'Reading done.' },
          messageSeq: 1,
          timestamp: '2026-06-27T01:00:02.000Z',
          streamingComplete: true,
        },
      ],
      removedIds: [],
    });
    const last = seen[seen.length - 1];
    expect(last.isStreaming).toBe(false);
    expect(last.messages[1].contentBlocks?.[0]).toEqual({
      type: 'text',
      id: '0190a200-asst:0',
      text: 'Reading done.',
    });
    off();
  });

  it('keeps latest-wins for a non-text block carrying its own textDelta field', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, INCREMENTAL_SNAPSHOT);
    // A passthrough block whose payload happens to include a `textDelta`
    // string must NOT take the append path (the daemon gates the fragment
    // encoding on the mapper-owned text/thinking types).
    const foreign = {
      agentId: 'agent-1',
      messageId: '0190a200-asst',
      role: 'assistant',
      block: { type: 'resource', id: '0190a200-asst:0', textDelta: 'not-a-fragment' },
    };
    deltaPush('sub-1', 1, { added: [foreign], updated: [], removedIds: [] });
    deltaPush('sub-1', 2, { added: [], updated: [foreign], removedIds: [] });

    expect(seen[2].messages[1].contentBlocks?.[0]).toEqual({
      type: 'resource',
      id: '0190a200-asst:0',
      textDelta: 'not-a-fragment',
    });
    off();
  });

  it('same-subscription lag-recovery snapshot (seq > 0) re-arms and fragments append onto its prefix', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, INCREMENTAL_SNAPSHOT);
    deltaPush('sub-1', 1, textFragment('added', 'text', 'early'));

    // Daemon-side lag recovery: the SAME subscription emits an echoed
    // snapshot at the next seq, carrying the in-flight message's accumulated
    // prefix (the daemon reseeds its mapper from this snapshot).
    snapshotPush('sub-1', 2, {
      ...INCREMENTAL_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: '0190a200-asst',
          agentId: 'agent-1',
          seq: 1,
          role: 'assistant',
          contentBlocks: [{ type: 'text', id: '0190a200-asst:0', text: 'early recovery' }],
          timestamp: '2026-06-27T01:00:01.000Z',
          isStreaming: true,
        },
      ],
      totalMessages: 2,
    });

    // Post-recovery fragments arrive in `updated` on the same subscription
    // and append onto the recovery snapshot's prefix, not the pre-lag state.
    deltaPush('sub-1', 3, textFragment('updated', 'text', ' prefix'));
    const last = seen[seen.length - 1];
    expect(last.messages[1].contentBlocks?.[0]).toEqual({
      type: 'text',
      id: '0190a200-asst:0',
      text: 'early recovery prefix',
    });
    off();
  });

  it('re-arms from each snapshot echo: a recovery snapshot decides the mode anew', async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: Array<{ contentBlocks?: unknown[] }> }> = [];
    const off = client.subscribe('agent-1', (t) => seen.push(t));
    await flush();

    snapshotPush('sub-1', 0, INCREMENTAL_SNAPSHOT);
    deltaPush('sub-1', 1, textFragment('added', 'text', 'first'));

    // seq gap → resnapshot; the recovery registration's snapshot echoes the
    // encoding again and the append reducer stays armed on the new state.
    deltaPush('sub-1', 3, { added: [], updated: [], removedIds: [] });
    await flush();
    snapshotPush('sub-2', 0, INCREMENTAL_SNAPSHOT);
    deltaPush('sub-2', 1, textFragment('added', 'text', 'fresh'));
    deltaPush('sub-2', 2, textFragment('updated', 'text', ' start'));

    const last = seen[seen.length - 1];
    expect(last.messages[1].contentBlocks?.[0]).toEqual({
      type: 'text',
      id: '0190a200-asst:0',
      text: 'fresh start',
    });
    off();
  });
});
