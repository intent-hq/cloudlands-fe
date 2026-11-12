// @verify-changed-triggers: e2e/mock-acp-agent.js, e2e/mock-acp-request.js
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';

const agentPath = path.resolve(__dirname, '../e2e/mock-acp-agent.js');
const permissionParams = {
  sessionId: 'mock-session-1',
  toolCall: { toolCallId: 'tc-1', title: 'Run npm test', rawInput: { command: 'npm test' } },
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
};

let agent: ChildProcessWithoutNullStreams | undefined;
afterEach(() => agent?.kill());

/** Spawn the mock agent and expose its stdout as a queue of parsed JSON-RPC messages. */
function startAgent(behavior: unknown) {
  agent = spawn(process.execPath, [agentPath], {
    env: {
      ...process.env,
      MOCK_AGENT_BEHAVIOR: JSON.stringify(behavior),
      MOCK_AGENT_DELAY_MS: '0',
    },
  });
  let stderr = '';
  agent.stderr.on('data', (chunk) => (stderr += chunk));
  const lines = readline.createInterface({ input: agent.stdout })[Symbol.asyncIterator]();
  const proc = agent;
  return {
    send: (msg: object) => proc.stdin.write(JSON.stringify(msg) + '\n'),
    next: async () => JSON.parse((await lines.next()).value as string),
    stderr: () => stderr,
  };
}

describe('mock ACP agent clientCalls', () => {
  it('sends a permission request to the daemon and ends the turn only after the answer', async () => {
    const io = startAgent({
      clientCalls: [{ method: 'session/request_permission', params: permissionParams }],
      response: 'Permission answered.',
    });
    io.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'session/prompt',
      params: { prompt: [{ type: 'text', text: 'go' }] },
    });

    const request = await io.next();
    expect(request).toMatchObject({
      jsonrpc: '2.0',
      method: 'session/request_permission',
      params: permissionParams,
    });
    expect(request.id).toBeDefined();

    io.send({
      jsonrpc: '2.0',
      id: request.id,
      result: { outcome: { outcome: 'selected', optionId: 'allow' } },
    });
    const messages = [];
    for (let msg = await io.next(); msg.id !== 7; msg = await io.next()) messages.push(msg);
    const reply = messages.map((m) => m.params.update.content.text).join('');
    expect(reply).toBe('Permission answered.');
    await expect
      .poll(io.stderr)
      .toContain('client call session/request_permission → {"outcome":{"outcome":"selected"');
  }, 15_000);

  it('finishes the turn when the daemon answers with an error', async () => {
    const io = startAgent({
      clientCalls: [{ method: 'session/request_permission', params: permissionParams }],
    });
    io.send({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { prompt: [] } });
    const request = await io.next();
    io.send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'denied' } });
    let msg = await io.next();
    while (msg.id !== 1) msg = await io.next();
    expect(msg.result).toEqual({ stopReason: 'end_turn' });
    await expect.poll(io.stderr).toContain('client call session/request_permission → error');
  }, 15_000);
});
