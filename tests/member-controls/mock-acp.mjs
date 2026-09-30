// Explicit synthetic ACP reply fixture; no external account or authority/RPC injection.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const sessions = new Set();
const send = (f) => process.stdout.write(`${JSON.stringify(f)}\n`);
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('ACP frame bound');
  const f = JSON.parse(line);
  if (f.id === undefined) continue;
  switch (f.method) {
    case 'initialize':
      result(f.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        authMethods: [],
      });
      break;
    case 'authenticate':
      result(f.id, {});
      break;
    case 'session/new': {
      const sessionId = randomUUID();
      sessions.add(sessionId);
      result(f.id, { sessionId });
      break;
    }
    case 'session/prompt':
      if (!sessions.has(f.params.sessionId)) throw new Error('unknown ACP session');
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: f.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'MEMBER_FIXTURE_REPLY' },
          },
        },
      });
      result(f.id, { stopReason: 'end_turn' });
      break;
    default:
      send({
        jsonrpc: '2.0',
        id: f.id,
        error: { code: -32601, message: 'unsupported synthetic ACP method' },
      });
  }
}
