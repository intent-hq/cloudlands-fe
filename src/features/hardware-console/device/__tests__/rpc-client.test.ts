import { afterEach, describe, expect, it, vi } from 'vitest';

import { Logger } from '../../../../shared/logger';
import { HardwareRpcClient, type RpcMessagePort, type RpcNotification } from '../rpc-client';
import { flushMicrotasks } from './fake-hid';

afterEach(() => {
  vi.restoreAllMocks();
});

class FakePort implements RpcMessagePort {
  readonly sent: unknown[] = [];
  sendError: Error | null = null;

  sendMessage(message: unknown): Promise<void> {
    if (this.sendError) return Promise.reject(this.sendError);
    this.sent.push(message);
    return Promise.resolve();
  }
}

function makeClient(timeoutMs = 200): { port: FakePort; client: HardwareRpcClient } {
  const port = new FakePort();
  const client = new HardwareRpcClient(port, { requestTimeoutMs: timeoutMs });
  return { port, client };
}

describe('HardwareRpcClient calls', () => {
  it('sends the wire shape {id, method, params} without a jsonrpc member', async () => {
    const { port, client } = makeClient();
    const pending = client.call('sys.version');
    expect(port.sent).toEqual([{ id: 1, method: 'sys.version', params: null }]);
    // Serialized key order matters for fragmented requests: the envelope
    // (id + method) must land in the first 61-byte fragment, matching the
    // live-verified cm2-probe wire order (serde_json alphabetical keys).
    expect(JSON.stringify(port.sent[0])).toBe('{"id":1,"method":"sys.version","params":null}');
    client.handleMessage({ id: 1, result: { fw: '0.6.0' } });
    await expect(pending).resolves.toEqual({ fw: '0.6.0' });
  });

  it('correlates out-of-order responses by id', async () => {
    const { client } = makeClient();
    const first = client.call('a');
    const second = client.call('b');
    client.handleMessage({ id: 2, result: 'B' });
    client.handleMessage({ id: 1, result: 'A' });
    await expect(first).resolves.toBe('A');
    await expect(second).resolves.toBe('B');
  });

  it('rejects on a firmware error member', async () => {
    const { client } = makeClient();
    const pending = client.call('sys.nope');
    client.handleMessage({ id: 1, error: { code: -32601, message: 'Method not found' } });
    await expect(pending).rejects.toThrow(/Method not found/);
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    try {
      const { client } = makeClient(50);
      const pending = client.call('sys.slow');
      const assertion = expect(pending).rejects.toThrow(/timed out after 50ms/);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when the port write fails', async () => {
    const { port, client } = makeClient();
    port.sendError = new Error('device gone');
    await expect(client.call('sys.version')).rejects.toThrow('device gone');
  });

  it('dispose rejects in-flight calls and blocks new ones', async () => {
    const { client } = makeClient();
    const pending = client.call('sys.version');
    client.dispose('device disconnected');
    await expect(pending).rejects.toThrow(/device disconnected/);
    await expect(client.call('sys.version')).rejects.toThrow(/disposed/);
  });

  it('drops responses for unknown or stale ids quietly (no warn)', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const { client } = makeClient();
    expect(() => client.handleMessage({ id: 99, result: null })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('HardwareRpcClient notifications', () => {
  it('delivers abbreviated m/p notifications', () => {
    const { client } = makeClient();
    const seen: RpcNotification[] = [];
    client.onNotification((n) => seen.push(n));
    client.handleMessage({ m: 'v.oai.hid', p: { state: 'listening' } });
    expect(seen).toEqual([{ method: 'v.oai.hid', params: { state: 'listening' } }]);
  });

  it('delivers full method/params notifications and supports unsubscribe', () => {
    const { client } = makeClient();
    const listener = vi.fn();
    const unsubscribe = client.onNotification(listener);
    client.handleMessage({ method: 'log.event', params: { level: 'info' } });
    expect(listener).toHaveBeenCalledWith({ method: 'log.event', params: { level: 'info' } });
    unsubscribe();
    client.handleMessage({ method: 'log.event', params: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('HardwareRpcClient device-originated requests', () => {
  it('answers host.focused_app via the registered handler', async () => {
    const { port, client } = makeClient();
    client.setRequestHandler('host.focused_app', () => ({ name: 'Intent' }));
    client.handleMessage({ method: 'host.focused_app', params: null, id: 17 });
    await flushMicrotasks();
    expect(port.sent).toEqual([{ id: 17, result: { name: 'Intent' } }]);
  });

  it('supports async handlers', async () => {
    const { port, client } = makeClient();
    client.setRequestHandler('host.focused_app', async () => Promise.resolve({ name: 'Async' }));
    client.handleMessage({ m: 'host.focused_app', p: null, id: 3 });
    await flushMicrotasks();
    expect(port.sent).toEqual([{ id: 3, result: { name: 'Async' } }]);
  });

  it('replies method-not-found for unhandled device requests', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const { port, client } = makeClient();
    client.handleMessage({ method: 'host.unknown', params: null, id: 5 });
    await flushMicrotasks();
    expect(port.sent).toEqual([
      { id: 5, error: { code: -32601, message: 'Method not found: host.unknown' } },
    ]);
    expect(warn).toHaveBeenCalledWith('No handler for device request', { method: 'host.unknown' });
  });

  it('answers looped-back host methods (rgbcfg/thstatus) without warn spam', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const { port, client } = makeClient();
    client.handleMessage({ method: 'v.oai.rgbcfg', params: { keys: {} }, id: 721 });
    client.handleMessage({ method: 'v.oai.thstatus', params: [], id: 722 });
    await flushMicrotasks();
    expect(port.sent).toEqual([
      { id: 721, error: { code: -32601, message: 'Method not found: v.oai.rgbcfg' } },
      { id: 722, error: { code: -32601, message: 'Method not found: v.oai.thstatus' } },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('replies with an error when the handler throws', async () => {
    const { port, client } = makeClient();
    client.setRequestHandler('host.focused_app', () => {
      throw new Error('no window');
    });
    client.handleMessage({ method: 'host.focused_app', params: null, id: 6 });
    await flushMicrotasks();
    expect(port.sent).toEqual([
      { id: 6, error: { code: -32000, message: 'Error: no window' } },
    ]);
  });

  it('ignores malformed messages without id or method', () => {
    const { client } = makeClient();
    expect(() => client.handleMessage(null)).not.toThrow();
    expect(() => client.handleMessage([1, 2])).not.toThrow();
    expect(() => client.handleMessage({ foo: 'bar' })).not.toThrow();
  });
});
