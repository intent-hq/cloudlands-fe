import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = loggerMocks.info;
    warn = loggerMocks.warn;
  },
}));

import { AuthRejectedError, type BackendConnectionConfig } from './backend-connection';
import { JsonRpcClient } from './json-rpc-client';

class FakeSocket extends EventEmitter {
  write(): boolean {
    return true;
  }

  destroy(): void {}
}

const config: BackendConnectionConfig = {
  transport: 'ws',
  wsUrl:
    'ws://backend-user:backend-password@backend.example:5181/ws/metadata?token=query-token&secret=query-secret#fragment-secret',
  token: 'config-token',
  fingerprint: 'config-fingerprint',
};
const safeTarget = 'ws:ws://backend.example:5181/ws/metadata';
const secrets = [
  'backend-user',
  'backend-password',
  'query-token',
  'query-secret',
  'fragment-secret',
  'config-token',
  'config-fingerprint',
];

function makeClient(): { client: JsonRpcClient; socket: FakeSocket } {
  const socket = new FakeSocket();
  const client = new JsonRpcClient({
    config,
    socketFactory: () => socket as unknown as Duplex,
    heartbeatIntervalMs: 0,
  });
  client.on('error', () => {});
  return { client, socket };
}

function expectNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

describe('backend connection logging redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redacts the connect log target', () => {
    const { client } = makeClient();
    client.start();

    expect(loggerMocks.info).toHaveBeenCalledWith('Connecting to backend', { target: safeTarget });
    expectNoSecrets(loggerMocks.info.mock.calls);
    client.dispose();
  });

  it('redacts the connected log target', () => {
    const { client, socket } = makeClient();
    client.start();
    socket.emit('connect');

    expect(loggerMocks.info).toHaveBeenCalledWith('Backend connected', {
      target: safeTarget,
      reconnected: false,
    });
    expectNoSecrets(loggerMocks.info.mock.calls);
    client.dispose();
  });

  it('redacts the auth-rejected log target', () => {
    const { client, socket } = makeClient();
    client.start();
    socket.emit('error', new AuthRejectedError(401));

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Backend rejected authentication; automatic reconnect halted',
      { target: safeTarget, statusCode: 401 },
    );
    expectNoSecrets(loggerMocks.warn.mock.calls);
    client.dispose();
  });
});
