// @verify-changed-triggers: e2e/mock-workspace-mcp.js, e2e/mock-acp-agent.js
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockChild } from '../e2e/mock-workspace-mcp.js';

vi.mock('node:child_process', () => {
  const spawn = vi.fn();
  return { spawn, default: { spawn } };
});
const server = {
  name: 'workspace-mcp',
  command: '/fixture/intentd',
  args: ['mcp-bridge', '--connect', '127.0.0.1:1'],
  env: [],
};

function bridge(error = false) {
  const calls: any[] = [];
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stdin: new Writable(),
    kill: vi.fn(),
  });
  proc.stdin = new Writable({
    write(chunk, _, done) {
      const request = JSON.parse(String(chunk));
      calls.push(request);
      if (request.id)
        queueMicrotask(() =>
          proc.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result:
                request.method === 'tools/call'
                  ? { isError: error, content: [{ type: 'text', text: 'fixture' }] }
                  : { protocolVersion: '2024-11-05' },
            }) + '\n',
          ),
        );
      done();
    },
    final(done) {
      done();
    },
  });
  proc.stdin.once('finish', () => proc.emit('close', 0));
  vi.mocked(spawn).mockReturnValue(proc as never);
  return { proc, calls };
}

afterEach(() => vi.clearAllMocks());
describe('packaged mock parent MCP delegation', () => {
  it('uses only the daemon-provided bridge and closes its child after one creation', async () => {
    const { calls, proc } = bridge();
    await createMockChild([server], { name: 'Implementor', prompt: 'CHILD_REQUEST: test' });
    expect(spawn).toHaveBeenCalledWith(
      server.command,
      server.args,
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'inherit'] }),
    );
    expect(calls.map((call) => call.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    expect(calls[2].params).toEqual({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.agent.create("Implementor", "CHILD_REQUEST: test", { provider: "mock", skipAutoCommit: true });',
        summary: 'Create packaged smoke fixture child',
      },
    });
    expect(proc.stdin.writableFinished).toBe(true);
    expect(proc.kill).not.toHaveBeenCalled();
  });
  it('refuses missing or ambiguous parent connections without launching anything', async () => {
    for (const servers of [
      [],
      [server, server],
      [{ name: 'external', command: 'other', args: [] }],
    ]) {
      await expect(createMockChild(servers, { name: 'child', prompt: 'fixture' })).rejects.toThrow(
        'unique',
      );
    }
    expect(spawn).not.toHaveBeenCalled();
  });
  it('preserves tool failure, closes the bridge, and never retries creation', async () => {
    const { calls, proc } = bridge(true);
    await expect(createMockChild([server], { name: 'child', prompt: 'fixture' })).rejects.toThrow(
      'isError',
    );
    expect(calls.filter((call) => call.method === 'tools/call')).toHaveLength(1);
    expect(proc.stdin.writableFinished).toBe(true);
  });
});
