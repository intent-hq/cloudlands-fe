import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { registerDesktopExecReverseHandler } from './desktop-exec-reverse';
import { DesktopExecutor } from './desktop-executor';
import { DesktopNativeAdapter } from './desktop-native';
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
  it('returns canonical display and screenshot wire results from helper JSON and full asset replies', async () => {
    // Shape emitted by macOS description()/capture() through JSONSerialization.
    // Deliberately retain native key order and Retina/negative-origin geometry.
    const helperDisplay = JSON.parse(
      '{"scaleFactor":2,"originY":0,"height":2160,"displayId":"1","originX":-3840,"width":3840}',
    );
    const native = new DesktopNativeAdapter(async (operation) => {
      const result =
        operation === 'identity'
          ? { computerId: 'computer', computerName: 'Mac', platform: 'macos' }
          : operation === 'layout'
            ? [helperDisplay]
            : operation === 'capture'
              ? [{ ...helperDisplay, data: 'cG5n' }]
              : { ok: true };
      // The helper's private line envelope is unwrapped by DesktopHelperTransport.
      return JSON.parse(JSON.stringify({ id: 1, result })).result;
    });
    const socket = new Socket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
    });
    const executor = new DesktopExecutor(
      native,
      {
        activate: async () => {},
        deactivate: async () => {},
        pulse: () => {},
        excludedWindows: () => ['123'],
      },
      { retain: async () => {}, queue: async () => {} },
    );
    const reports = { connect: vi.fn(), disconnect: vi.fn() } as unknown as DesktopReportStore;
    const dispose = registerDesktopExecReverseHandler(client, 'backend', { executor, reports });
    const frames = () => socket.writes.map((line) => JSON.parse(line));
    let requestId = 0;
    const call = async (params: Record<string, unknown>) => {
      const id = `native-result-${++requestId}`;
      socket.receive({ jsonrpc: '2.0', id, method: 'desktop.control', params });
      await vi.waitFor(() => expect(frames().some((frame) => frame.id === id)).toBe(true));
      const reply = frames().find((frame) => frame.id === id);
      expect(reply.error).toBeUndefined();
      return reply.result;
    };
    const binding = {
      workspaceId: 'ws',
      agentId: 'agent',
      principalId: 'human',
      connectionEpoch: 'epoch',
    };
    const session = { ...binding, computerId: 'computer', sessionId: 'session' };
    try {
      client.start();
      socket.emit('connect');
      await flush();
      const principal = frames().find((frame) => frame.method === 'principal.me');
      socket.receive({ jsonrpc: '2.0', id: principal.id, result: { id: 'human' } });
      await call({ operation: 'prepare', ...binding });
      await call({
        operation: 'startControl',
        ...session,
        agentName: 'Worker',
        leaseMs: 15000,
        stopReportToken: 'a'.repeat(43),
      });
      const list = await call({
        operation: 'prepareCommand',
        ...session,
        commandId: 'list',
        sequence: 1,
        action: { kind: 'listDisplay' },
      });
      const listed = await call({
        operation: 'execute',
        ...session,
        commandId: 'list',
        sequence: 1,
        deadlineId: list.deadlineId,
      });
      expect(listed).toEqual({
        commandId: 'list',
        sequence: 1,
        result: { layoutId: expect.any(String), displays: [helperDisplay] },
      });
      const ticket = await call({
        operation: 'prepareCommand',
        ...session,
        commandId: 'capture',
        sequence: 2,
        action: { kind: 'screenshot' },
      });
      const captured = call({
        operation: 'execute',
        ...session,
        commandId: 'capture',
        sequence: 2,
        deadlineId: ticket.deadlineId,
      });
      await vi.waitFor(() =>
        expect(frames().some((frame) => frame.method === 'note.saveAsset')).toBe(true),
      );
      const assetRequest = frames().find((frame) => frame.method === 'note.saveAsset');
      expect(assetRequest.params).toEqual({
        workspaceId: 'ws',
        data: 'cG5n',
        mimeType: 'image/png',
        originalName: 'desktop.png',
      });
      // Full intent-core SaveAssetResult, including its private on-disk path.
      socket.receive({
        jsonrpc: '2.0',
        id: assetRequest.id,
        result: {
          assetId: 'asset',
          path: '/private/workspace/assets/asset.png',
          url: 'workspace-asset://ws/asset',
        },
      });
      expect(await captured).toEqual({
        commandId: 'capture',
        sequence: 2,
        result: {
          capturedAt: expect.any(String),
          layoutId: listed.result.layoutId,
          displays: [
            {
              ...helperDisplay,
              assetId: 'asset',
              url: 'workspace-asset://ws/asset',
              mimeType: 'image/png',
            },
          ],
        },
      });
    } finally {
      dispose();
      client.dispose();
    }
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
