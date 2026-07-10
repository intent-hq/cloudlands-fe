/**
 * Tests for the `browser.exec` FE-served reverse-intent handler (GAP-2b,
 * PROTOCOL §5.14). We register the handler on a real `JsonRpcClient` driven by
 * an in-memory fake socket, feed it a daemon-shaped inbound request, and assert
 * the wire response matches the `{ success, results, error? }` envelope
 * GAP-2a's daemon-side `browser_ops::shape_result` expects.
 */

import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonRpcClient } from '../../backend/main/json-rpc-client';
import {
  BROWSER_EXEC_METHOD,
  registerBrowserExecReverseHandler,
  type ExecuteBrowserActionsFn,
} from '../main/browser-exec-reverse';

class FakeSocket extends EventEmitter {
  writes: string[] = [];
  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }
  destroy(): void {}
  receive(chunk: string): void {
    this.emit('data', Buffer.from(chunk));
  }
  open(): void {
    this.emit('connect');
  }
}

function makeClient() {
  const socket = new FakeSocket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    heartbeatIntervalMs: 0,
  });
  client.start();
  socket.open();
  return { client, socket };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('registerBrowserExecReverseHandler', () => {
  let executor: ReturnType<typeof vi.fn<Parameters<ExecuteBrowserActionsFn>, ReturnType<ExecuteBrowserActionsFn>>>;

  beforeEach(() => {
    executor = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers under the "browser.exec" method name', () => {
    const { client } = makeClient();
    const registerSpy = vi.spyOn(client, 'registerMethod');
    registerBrowserExecReverseHandler(client, { executor });
    expect(registerSpy).toHaveBeenCalledWith(BROWSER_EXEC_METHOD, expect.any(Function));
    client.dispose();
  });

  it('happy path: invokes executor with parsed params and returns the FE envelope verbatim', async () => {
    const { client, socket } = makeClient();
    const envelope = {
      success: true,
      results: [{ action: 'listTabs', success: true, result: [{ tabId: 'a' }] }],
    };
    executor.mockResolvedValue(envelope);
    registerBrowserExecReverseHandler(client, { executor });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-1',
        method: BROWSER_EXEC_METHOD,
        params: {
          actions: [{ action: 'listTabs' }],
          tabId: 't-1',
          agentId: 'agent-1',
          workspaceId: 'ws-1',
        },
      })}\n`,
    );
    await flush();

    expect(executor).toHaveBeenCalledWith(
      [{ action: 'listTabs' }],
      't-1',
      'agent-1',
      'ws-1',
    );
    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      result: envelope,
    });
    client.dispose();
  });

  it('passes executor-error envelopes through unchanged (GAP-2a shapes the wire error)', async () => {
    const { client, socket } = makeClient();
    const envelope = {
      success: false,
      results: [{ action: 'evaluate', success: false, error: 'boom' }],
      error: "Action 'evaluate' failed: boom",
    };
    executor.mockResolvedValue(envelope);
    registerBrowserExecReverseHandler(client, { executor });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-2',
        method: BROWSER_EXEC_METHOD,
        params: { actions: [{ action: 'evaluate', expression: 'x' }] },
      })}\n`,
    );
    await flush();

    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-2',
      result: envelope,
    });
    client.dispose();
  });

  it('surfaces invalid params as -32603 (executor never called)', async () => {
    const { client, socket } = makeClient();
    registerBrowserExecReverseHandler(client, { executor });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-3',
        method: BROWSER_EXEC_METHOD,
        params: { actions: [] },
      })}\n`,
    );
    await flush();

    expect(executor).not.toHaveBeenCalled();
    const response = JSON.parse(socket.writes[0]);
    expect(response.id).toBe('rev-3');
    expect(response.error.code).toBe(-32603);
    expect(response.error.message).toMatch(/actions must not be empty/);
    client.dispose();
  });

  it('rewrites screenshot base64 to an assetUrl when workspaceId + saveAsset are provided', async () => {
    const { client, socket } = makeClient();
    executor.mockResolvedValue({
      success: true,
      results: [
        {
          action: 'screenshot',
          success: true,
          result: { base64: 'AAAA', width: 10, height: 20 },
        },
      ],
    });
    const saveAsset = vi.fn().mockResolvedValue({ url: 'workspace-asset://ws-1/abc.jpg' });
    registerBrowserExecReverseHandler(client, { executor, saveAsset });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-4',
        method: BROWSER_EXEC_METHOD,
        params: {
          actions: [{ action: 'screenshot' }],
          workspaceId: 'ws-1',
        },
      })}\n`,
    );
    await flush();

    expect(saveAsset).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      data: 'AAAA',
      mimeType: 'image/jpeg',
      originalName: expect.stringMatching(/^screenshot-\d+\.jpg$/),
    });
    const response = JSON.parse(socket.writes[0]);
    expect(response.result.results[0].result).toEqual({
      assetUrl: 'workspace-asset://ws-1/abc.jpg',
      width: 10,
      height: 20,
    });
    client.dispose();
  });
});
