/**
 * A local pairing credential (protocol §5.58) is refused with 401 while the
 * other Intent's tunnel runs and admitted again once it stops: the client
 * keeps retrying on a slow cadence, while an owner token rejection halts.
 */
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRejectedError, type BackendConnectionConfig } from './backend-connection';
import { JsonRpcClient } from './json-rpc-client';

class FakeSocket extends EventEmitter {
  write(): boolean {
    return true;
  }
  destroy(): void {}
}

function make(config: BackendConnectionConfig) {
  const sockets: FakeSocket[] = [];
  const client = new JsonRpcClient({
    config,
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as Duplex;
    },
    heartbeatIntervalMs: 0,
    reconnectDelayMs: 100,
    maxReconnectDelayMs: 100,
    helloParams: () => ({ clientId: 'desktop' }),
  });
  client.on('error', () => {});
  return { client, sockets };
}

const WSS: BackendConnectionConfig = {
  transport: 'wss',
  host: '127.0.0.1',
  port: 51234,
  token: 'ab'.repeat(32),
  fingerprint: 'AA:BB',
};

describe('JsonRpcClient local pairing credential refusal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries a refused local pairing credential after the slow delay', async () => {
    const { client, sockets } = make({ ...WSS, localPairingCredential: true });
    client.start();
    sockets[0].emit('error', new AuthRejectedError(401));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sockets).toHaveLength(2);
    client.dispose();
  });

  it('still stops reconnecting after an owner token is rejected', async () => {
    const { client, sockets } = make(WSS);
    client.start();
    sockets[0].emit('error', new AuthRejectedError(401));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    client.dispose();
  });
});
