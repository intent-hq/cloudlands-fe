import { Duplex } from 'stream';
import { describe, expect, it } from 'vitest';
import { AppDisconnectedError, AppRpcError } from './app-bridge';
import { AppConnection } from './app-connection';

/** A socket whose writes the test reads and whose answers the test pushes. */
class FakeDaemonSocket extends Duplex {
  readonly frames: Record<string, unknown>[] = [];
  onFrame: (frame: Record<string, unknown>) => void = () => {};

  _read(): void {}

  _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line) as Record<string, unknown>;
      this.frames.push(frame);
      this.onFrame(frame);
    }
    callback();
  }

  answer(id: unknown, body: Record<string, unknown>): void {
    this.push(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`);
  }
}

const session = {
  sessionId: 'as_1',
  appId: 'pomodoro-timer',
  bundleHash: 'sha256:a',
  level: 2,
  features: ['models'],
  entry: 'index.html',
  window: { width: 960, height: 640, minWidth: null, minHeight: null, resizable: true, alwaysOnTop: false },
};

function socketThatAttaches(): FakeDaemonSocket {
  const socket = new FakeDaemonSocket();
  socket.onFrame = (frame) => {
    if (frame.method === 'app.session.attach') socket.answer(frame.id, { result: session });
  };
  // Emit connect on the next tick, like a fresh net.Socket.
  setImmediate(() => socket.emit('connect'));
  return socket;
}

describe('AppConnection', () => {
  it('sends app.session.attach { token } as the first request, before client.hello', async () => {
    const socket = socketThatAttaches();
    const { connection, session: attached } = await AppConnection.attach(() => socket, 'f'.repeat(64));
    expect(socket.frames[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'app.session.attach',
      params: { token: 'f'.repeat(64) },
    });
    expect(socket.frames.some((frame) => frame.method === 'client.hello')).toBe(false);
    expect(attached).toEqual(session);
    connection.close();
  });

  it('carries app calls and their errors on the attached connection', async () => {
    const socket = socketThatAttaches();
    const { connection } = await AppConnection.attach(() => socket, 't');
    socket.onFrame = (frame) => {
      if (frame.method === 'app.storage.get') {
        socket.answer(frame.id, { result: { found: true, value: 3 } });
      } else {
        socket.answer(frame.id, {
          error: { code: -32602, message: 'bad key', data: { code: 'invalid-key' } },
        });
      }
    };
    await expect(connection.request('app.storage.get', { key: 'k' })).resolves.toEqual({
      found: true,
      value: 3,
    });
    const error = await connection.request('app.storage.set', { key: '' }).catch((e) => e);
    expect(error).toBeInstanceOf(AppRpcError);
    expect(error).toMatchObject({ rpcCode: -32602, data: { code: 'invalid-key' } });
    connection.close();
  });

  it('rejects the attach with the daemon error (session-invalid) and closes', async () => {
    const socket = new FakeDaemonSocket();
    socket.onFrame = (frame) =>
      socket.answer(frame.id, {
        error: { code: -32602, message: 'Invalid session', data: { code: 'session-invalid' } },
      });
    setImmediate(() => socket.emit('connect'));
    const error = await AppConnection.attach(() => socket, 'bad').catch((e) => e);
    expect(error).toMatchObject({ data: { code: 'session-invalid' } });
    expect(socket.destroyed).toBe(true);
  });

  it('rejects pending calls with disconnected and notifies once when the daemon closes it', async () => {
    const socket = socketThatAttaches();
    const { connection } = await AppConnection.attach(() => socket, 't');
    socket.onFrame = () => {};
    let closes = 0;
    connection.onClose(() => {
      closes += 1;
    });
    const pending = connection.request('app.complete', { prompt: 'x' });
    socket.push(null);
    socket.destroy();
    await expect(pending).rejects.toBeInstanceOf(AppDisconnectedError);
    expect(closes).toBe(1);
    await expect(connection.request('app.storage.get', { key: 'k' })).rejects.toBeInstanceOf(
      AppDisconnectedError,
    );
  });
});
