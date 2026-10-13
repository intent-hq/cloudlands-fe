import { EventEmitter, once } from 'node:events';
import { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { raceDuplexSockets, WebSocketDuplex } from './backend-connection';
import { createTunneledSocket } from './tailcat-tunnel';
import { observePhysicalSocketClose } from './physical-socket-close';

class ControlledWebSocket extends EventEmitter {
  readyState = 1;
  terminate = vi.fn();
  send = vi.fn();
}
function webSocket() {
  const wire = new ControlledWebSocket();
  const stream = new WebSocketDuplex(wire as unknown as WebSocket);
  stream.on('error', () => {});
  return { wire, stream };
}
async function destroyFacade(stream: Duplex) {
  const closed = once(stream, 'close');
  stream.destroy();
  await closed;
}
describe('actual close evidence through native transport wrappers', () => {
  it('does not treat WebSocket duplex destruction as underlying close', async () => {
    const { wire, stream } = webSocket(),
      closed = vi.fn();
    observePhysicalSocketClose(stream, closed);
    await destroyFacade(stream);
    expect(wire.terminate).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    wire.emit('close');
    expect(closed).toHaveBeenCalledOnce();
    wire.emit('close');
    expect(closed).toHaveBeenCalledOnce();
    const late = vi.fn();
    observePhysicalSocketClose(stream, late);
    expect(late).toHaveBeenCalledOnce();
  });
  it('forwards only the race winner physical close through destroyed facades', async () => {
    const winner = webSocket(),
      loser = webSocket();
    const facade = raceDuplexSockets([
      { host: 'winner', create: () => winner.stream },
      { host: 'loser', create: () => loser.stream },
    ]);
    facade.on('error', () => {});
    const closed = vi.fn();
    observePhysicalSocketClose(facade, closed);
    winner.wire.emit('open');
    loser.wire.emit('close');
    expect(closed).not.toHaveBeenCalled();
    await destroyFacade(facade);
    expect(winner.wire.terminate).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    winner.wire.emit('close');
    expect(closed).toHaveBeenCalledOnce();
  });
  it('forwards the tunnel inner physical close without credit on tunnel destruction', async () => {
    const inner = webSocket();
    const createInner = vi.fn(() => inner.stream);
    const spawn = vi.fn(() => {
      throw new Error('This test must not spawn a tunnel process');
    });
    const tunnel = createTunneledSocket({
      tcAddress: 'unused-test-address',
      remotePort: 5181,
      binaryPath: '/unused-test-binary',
      spawn,
      createInner,
    });
    tunnel.on('error', () => {});
    try {
      await vi.waitFor(() => expect(createInner).toHaveBeenCalledOnce());
      inner.wire.emit('open');
      const closed = vi.fn();
      observePhysicalSocketClose(tunnel, closed);
      await destroyFacade(tunnel);
      expect(closed).not.toHaveBeenCalled();
      inner.wire.emit('close');
      expect(closed).toHaveBeenCalledOnce();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      tunnel.destroy();
    }
  });
  it('does not infer physical proof from an unrecognized duplex close', async () => {
    const stream = new Duplex({
      read() {},
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const closed = vi.fn();
    observePhysicalSocketClose(stream, closed);
    await destroyFacade(stream);
    expect(closed).not.toHaveBeenCalled();
  });
});
