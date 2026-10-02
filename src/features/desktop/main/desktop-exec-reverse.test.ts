import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { registerDesktopExecReverseHandler } from './desktop-exec-reverse';
import { DesktopExecutor } from './desktop-executor';
import type { DesktopReportStore } from './desktop-stop-reports';

vi.mock('./desktop-overlay', () => ({ getDesktopOverlay: vi.fn() }));
class Socket extends EventEmitter {
  writes: string[] = [];
  write(s: string) {
    this.writes.push(s);
    return true;
  }
  destroy() {}
  receive(value: unknown) {
    this.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
describe('desktop reverse RPC wire and private diagnostics', () => {
  it('passes daemon binding through the real JSON-RPC channel and emits structured failures', async () => {
    const socket = new Socket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
    });
    const executor = new DesktopExecutor(
      {
        identity: async () => ({
          computerId: 'computer',
          computerName: 'Desk',
          platform: 'windows',
        }),
        acquire: async () => {},
        release: async () => {},
        check: async () => {},
        validateExclusion: async () => {},
        layout: async () => [],
        capture: async () => [],
        input: async () => {},
      },
      {
        activate: async () => {},
        deactivate: async () => {},
        pulse: () => {},
        excludedWindows: () => ['1'],
      },
      { retain: async () => {}, queue: async () => {} },
    );
    const reports = { connect: vi.fn(), disconnect: vi.fn() } as unknown as DesktopReportStore;
    const dispose = registerDesktopExecReverseHandler(client, 'backend', { executor, reports });
    client.start();
    socket.emit('connect');
    await flush();
    socket.receive({
      jsonrpc: '2.0',
      id: 'rev-1',
      method: 'desktop.control',
      params: {
        operation: 'prepare',
        workspaceId: 'ws',
        agentId: 'agent',
        principalId: 'human',
        connectionEpoch: 'epoch',
      },
    });
    await flush();
    expect(JSON.parse(socket.writes.at(-1)!)).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      result: { computerId: 'computer', computerName: 'Desk', platform: 'windows' },
    });
    socket.receive({
      jsonrpc: '2.0',
      id: 'rev-2',
      method: 'desktop.control',
      params: {
        operation: 'execute',
        workspaceId: 'ws',
        agentId: 'agent',
        principalId: 'human',
        connectionEpoch: 'epoch',
        computerId: 'computer',
        sessionId: 's',
        commandId: 'c',
        sequence: 1,
        deadlineId: 'd',
      },
    });
    await flush();
    expect(JSON.parse(socket.writes.at(-1)!)).toMatchObject({
      id: 'rev-2',
      error: { code: -32602, data: { code: 'desktop-not-active', execution: 'not_started' } },
    });
    dispose();
    client.dispose();
  });
  it('never exposes Stop credentials or input text to traffic observers', async () => {
    const socket = new Socket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
    });
    const observer = vi.fn();
    client.observeTraffic(observer);
    client.registerMethod('desktop.control', () => ({ ready: true }));
    client.start();
    socket.emit('connect');
    await flush();
    socket.receive({
      jsonrpc: '2.0',
      id: 'rev-1',
      method: 'desktop.control',
      params: { operation: 'startControl', stopReportToken: 'never-log-token' },
    });
    socket.receive({
      jsonrpc: '2.0',
      id: 'rev-2',
      method: 'desktop.control',
      params: { operation: 'prepareCommand', action: { kind: 'type', text: 'never-log-text' } },
    });
    await flush();
    const pending = client.request('desktop.revoke', {
      stopReport: { stopReportToken: 'never-log-token' },
    });
    await flush();
    const request = JSON.parse(socket.writes.at(-1)!);
    socket.receive({ jsonrpc: '2.0', id: request.id, result: { reported: true, revoked: true } });
    await pending;
    expect(JSON.stringify(observer.mock.calls)).not.toContain('never-log-token');
    expect(JSON.stringify(observer.mock.calls)).not.toContain('never-log-text');
    expect(request.params.stopReport.stopReportToken).toBe('never-log-token');
    client.dispose();
  });
});
