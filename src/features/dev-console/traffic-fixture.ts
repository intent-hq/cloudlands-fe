/** Synthetic traffic for the development-only preview and real-browser behavior tests. */
import type {
  DevConsoleRecord,
  DevConsolePayload,
  DevConsoleUpdate,
} from '$shared/types/dev-console';
import type { connectDevConsole } from '$store/renderer/dev-console/dev-console-bridge';
function payload(value: unknown, truncate = false): DevConsolePayload {
  const text = JSON.stringify(value);
  return {
    text: truncate ? text.slice(0, 2048) : text,
    state: truncate ? 'truncated' : 'complete',
    originalBytes: text.length,
    retainedBytes: truncate ? 2048 : text.length,
  };
}
export function createTrafficFixture(count = 240) {
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
      upserts: records.map(({ payload: p, response: r, ...row }) => {
        const { text: _p, ...pmeta } = p;
        const response = r ? (({ text: _r, ...meta }) => meta)(r) : undefined;
        return { ...row, payload: pmeta, response };
      }),
      fullCapture,
      retainedPayloadBytes: records.reduce(
        (sum, r) => sum + r.payload.retainedBytes + (r.response?.retainedBytes ?? 0),
        0,
      ),
      evictedRecords: 12,
      droppedRecords: 2,
      oversizePayloads: 2,
      limits: { maxRecords: 10000, maxPayloadBytes: 33554432, previewBytes: 2048 },
    });
  }
  append(count);
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
  return { connect, append };
}
