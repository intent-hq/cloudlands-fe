/** Synthetic traffic for the development-only preview and real-browser behavior tests. */
import type {
  DevConsoleRecord,
  DevConsoleFrame,
  DevConsolePayload,
  DevConsoleUpdate,
} from '$shared/types/dev-console';
import type { connectDevConsole } from '$store/renderer/dev-console/dev-console-bridge';
function payload(value: unknown, truncate = false): DevConsolePayload {
  const text = JSON.stringify(value);
  return {
    text: truncate ? text.slice(0, 2048) : text,
    state: truncate ? 'truncated' : 'complete',
    originalBytes: new TextEncoder().encode(text).length,
    retainedBytes: new TextEncoder().encode(truncate ? text.slice(0, 2048) : text).length,
  };
}
export type PayloadScenario = 'traffic' | 'nested' | 'oversized' | 'streams';

// Deliberately noncanonical whitespace: Copy payload must preserve captured bytes.
export const nestedRequestText =
  '{ "object": {"needle":"request first"}, "array": [{"needle":"request second"}], "tail": true }';
export const nestedResponseText =
  '{ "object": {"needle":"response first"}, "array": [{"needle":"response second"}], "tail": false }';

export function createTrafficFixture(count = 240, scenario: PayloadScenario = 'traffic') {
  let sequence = 0;
  let records: DevConsoleRecord[] = [];
  let publish: ((update: DevConsoleUpdate) => void) | undefined;
  let fullCapture: DevConsoleUpdate['fullCapture'] = [];
  let revision = 0;
  function append(amount = 1) {
    for (let i = 0; i < amount; i++) {
      const index = sequence++;
      const inbound = index % 3 === 0;
      const event = inbound && index % 9 !== 0;
      const method = inbound
        ? event
          ? ['agent:message', 'workspace:updated', 'terminal:output'][(index % 5) % 3]
          : 'fs.readFile'
        : ['workspace.list', 'agent.sendMessage', 'note.read', 'git.status', 'browser.listTabs'][
            index % 5
          ];
      const error = !event && index % 13 === 0;
      records.push({
        id: `fixture-${index}`,
        backendId: 'local-dev',
        connectionId: 'pooled-main',
        connectionGeneration: 1,
        requestId: event ? undefined : index + 1000,
        direction: inbound ? 'inbound' : 'outbound',
        kind: event ? 'notification' : 'request',
        method,
        rpcMethod: event ? 'events.event' : method,
        timestamp: Date.UTC(2026, 9, 1, 8, 42, 10) + index * 83,
        status: event ? 'received' : error ? 'error' : 'success',
        durationMs: event ? undefined : (index % 71) + 1.7,
        payload: payload(
          event
            ? {
                event: {
                  type: method,
                  workspaceId: 'demo-workspace',
                  data: {
                    text: 'Fixture: inspecting the Dev Console rendering and traffic flow.',
                    sequence: index,
                  },
                },
              }
            : {
                workspaceId: 'demo-workspace',
                ...(method === 'agent.sendMessage'
                  ? {
                      agentId: 'demo-agent',
                      message: 'Inspect the RPC traffic and report any errors.',
                    }
                  : { path: 'src/features/dev-console', includeMetadata: true }),
              },
        ),
        response: event
          ? undefined
          : payload(
              error
                ? {
                    code: -32001,
                    message: 'Fixture: workspace is unavailable',
                    data: { retryable: true },
                  }
                : {
                    ok: true,
                    items: [
                      { id: 'demo-workspace', title: 'Build RPC dev console', status: 'active' },
                    ],
                    ...(index % 17 === 0
                      ? { output: 'Fixture diagnostic output. '.repeat(180) }
                      : {}),
                  },
              !error && index % 17 === 0,
            ),
      });
    }
    update();
  }
  function update() {
    publish?.({
      backendId: 'local-dev',
      sessionId: 'fixture-session',
      revision: ++revision,
      recordIds: records.map((r) => r.id),
      upserts: records.map(({ payload: p, response: r, frames: _frames, ...row }) => {
        const { text: _p, ...pmeta } = p;
        const response = r ? (({ text: _r, ...meta }) => meta)(r) : undefined;
        return { ...row, payload: pmeta, response };
      }),
      fullCapture,
      retainedPayloadBytes: records.reduce(
        (sum, r) =>
          sum +
          (r.frames
            ? r.frames.reduce((bytes, frame) => bytes + frame.payload.retainedBytes, 0)
            : r.payload.retainedBytes + (r.response?.retainedBytes ?? 0)),
        0,
      ),
      evictedRecords: 12,
      droppedRecords: 2,
      oversizePayloads: 2,
      limits: { maxRecords: 10000, maxPayloadBytes: 33554432, previewBytes: 2048 },
    });
  }
  append(scenario === 'traffic' ? count : 2);
  if (scenario !== 'traffic') {
    const captured = (text: string): DevConsolePayload => ({
      text,
      state: 'complete',
      originalBytes: text.length,
      retainedBytes: text.length,
    });
    records = records.map((record, index) => ({
      ...record,
      direction: 'outbound',
      kind: 'request',
      method: index === 0 ? 'fixture.inspect' : 'fixture.pending',
      rpcMethod: index === 0 ? 'fixture.inspect' : 'fixture.pending',
      status: index === 0 ? 'success' : 'pending',
      payload: captured(
        index === 1
          ? '{"pendingRequest":true}'
          : scenario === 'oversized'
            ? JSON.stringify({
                items: Array.from({ length: 100000 }, (_, i) => ({
                  value: i === 99999 ? 'large-payload-last-match' : 1,
                })),
              })
            : nestedRequestText,
      ),
      response: index === 0 ? captured(nestedResponseText) : undefined,
    }));
  }
  if (scenario === 'streams') {
    records = records.map((record, index) => {
      const method = index === 0 ? 'chat.subscribe' : 'host.execStream';
      const request = payload(
        index === 0 ? { agentId: 'demo-agent' } : { command: 'cat', requestId: 'demo-exec' },
      );
      const response = payload(
        index === 0 ? { subscriptionId: 'demo-chat' } : { requestId: 'demo-exec' },
      );
      return {
        ...record,
        method,
        rpcMethod: method,
        status: 'success',
        streamState: 'open',
        payload: request,
        response,
        durationMs: 5,
        frameCount: 2,
        droppedFrames: 0,
        totalBytes: (request.originalBytes ?? 0) + (response.originalBytes ?? 0),
        frames: [
          {
            sequence: 0,
            side: 'request',
            rpcMethod: method,
            timestamp: record.timestamp,
            intervalMs: 0,
            intervalFromRequest: true,
            payload: request,
          },
          {
            sequence: 1,
            side: 'response',
            rpcMethod: method,
            timestamp: record.timestamp + 5,
            intervalMs: 5,
            intervalFromRequest: true,
            payload: response,
          },
        ],
      };
    });
  }
  let streamSequence = 0;
  function stream() {
    const seq = streamSequence++;
    records = records.map((record) => {
      if (!record.frames) return record;
      const frames = [...record.frames];
      const elapsed = 40 + seq * 75;
      function add(side: DevConsoleFrame['side'], method: string, value: unknown, offset: number) {
        const timestamp = record.timestamp + elapsed + offset;
        const previous = frames.findLast((frame) => frame.side === side);
        frames.push({
          sequence: frames.length,
          side,
          rpcMethod: method,
          timestamp,
          intervalFromRequest: !previous,
          intervalMs: timestamp - (previous?.timestamp ?? record.timestamp),
          payload: payload(value),
        });
      }
      if (record.method === 'chat.subscribe') {
        add(
          'response',
          'subscription.push',
          seq === 0
            ? {
                subscriptionId: 'demo-chat',
                kind: 'snapshot',
                seq,
                snapshot: {
                  agentId: 'demo-agent',
                  messages: [],
                  truncated: false,
                  totalMessages: 0,
                  nextToken: null,
                },
              }
            : {
                subscriptionId: 'demo-chat',
                kind: 'delta',
                seq,
                delta: {
                  updated: [
                    {
                      agentId: 'demo-agent',
                      messageId: 'demo-message',
                      role: 'assistant',
                      block: { type: 'text', id: 'demo-message:0', text: `Live message ${seq}` },
                    },
                  ],
                },
              },
          0,
        );
      } else {
        add(
          'request',
          'host.execStream.write',
          { requestId: 'demo-exec', stdin: `input ${seq}\n` },
          0,
        );
        add('response', 'host.execStream.write', { ok: true }, 3);
        add(
          'response',
          'events.event',
          {
            subscriptionId: 'demo-events',
            event: {
              type: 'host:exec:stdout',
              id: `event-${seq}`,
              workspaceId: 'demo-workspace',
              timestamp: '2026-10-02T10:00:00Z',
              actor: { type: 'system' },
              data: { requestId: 'demo-exec', chunk: btoa(`output ${seq}\n`) },
            },
          },
          8,
        );
      }
      return {
        ...record,
        frames,
        frameCount: frames.length,
        durationMs: elapsed + (record.method === 'chat.subscribe' ? 0 : 8),
        totalBytes: frames.reduce((sum, frame) => sum + (frame.payload.originalBytes ?? 0), 0),
      };
    });
    update();
  }
  if (scenario === 'streams') stream();
  function reply() {
    records = records.map((record) =>
      record.method === 'fixture.pending'
        ? {
            ...record,
            status: 'success',
            durationMs: 125,
            response: payload({ delayedReply: { message: 'arrived after selection' } }),
          }
        : record,
    );
    update();
  }
  const connect: typeof connectDevConsole = (onUpdate) => {
    publish = onUpdate;
    queueMicrotask(update);
    return {
      record: async (id) => records.find((r) => r.id === id) ?? null,
      clear: async () => {
        records = [];
        update();
        return true;
      },
      select: async (choice, enabled) => {
        fullCapture = fullCapture.filter(
          (c) =>
            c.direction !== choice.direction ||
            c.kind !== choice.kind ||
            c.method !== choice.method,
        );
        if (enabled) fullCapture.push(choice);
        update();
        return true;
      },
      dispose: () => {
        publish = undefined;
        records = [];
        fullCapture = [];
      },
    };
  };
  return { connect, append, reply, stream };
}
