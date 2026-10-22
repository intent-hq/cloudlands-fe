import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from './json-rpc-client';

class Socket extends EventEmitter {
  destroyed = false;
  frames: Array<{ id: number; method: string; params: unknown }> = [];
  write(line: string) {
    this.frames.push(JSON.parse(line));
    return true;
  }
  destroy() {
    this.destroyed = true;
  }
  reply(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
}
const clients: JsonRpcClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.dispose());
});
async function connect(capability: unknown) {
  const socket = new Socket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    helloParams: () => ({ clientId: 'original' }),
    heartbeatIntervalMs: 0,
  });
  clients.push(client);
  client.start();
  socket.emit('connect');
  await vi.waitFor(() => expect(socket.frames).toHaveLength(1));
  socket.reply(1, {
    clientId: 'original',
    server: { capabilities: { gitlabCheckout: capability } },
  });
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  return { socket, client };
}
const target = {
  provider: 'gitlab',
  host: 'git.example:8443',
  instanceBaseUrl: 'https://git.example:8443/Forge',
};
const methods = ['authStatus', 'connect', 'cancelAuth', 'revoke', 'getUser'];
describe('full GitLab instance operands on the actual JSON-RPC client', () => {
  it.each(methods)(
    'refuses unsupported %s without sending or downgrading the root',
    async (method) => {
      const { socket, client } = await connect(undefined);
      await expect(client.request('sourceControl.' + method, target)).rejects.toMatchObject({
        code: 'gitlab-instance-unsupported',
      });
      expect(socket.frames).toHaveLength(1);
    },
  );
  it.each([null, false, true, '1', 0, 2])(
    'requires exact integer capability 1, not %j',
    async (flag) => {
      const { socket, client } = await connect(flag);
      await expect(client.request('sourceControl.connect', target)).rejects.toMatchObject({
        code: 'gitlab-instance-unsupported',
      });
      expect(socket.frames).toHaveLength(1);
    },
  );
  it.each(methods)('sends supported %s with its complete original operands', async (method) => {
    const { socket, client } = await connect(1);
    const pending = client.request('sourceControl.' + method, target);
    expect(socket.frames[1]).toMatchObject({ method: 'sourceControl.' + method, params: target });
    socket.reply(2, { ok: true });
    await expect(pending).resolves.toEqual({ ok: true });
  });
  it('retains legacy bare-host calls on older daemons', async () => {
    const { socket, client } = await connect(undefined);
    const params = { provider: 'gitlab', host: target.host };
    const pending = client.request('sourceControl.authStatus', params);
    expect(socket.frames[1].params).toEqual(params);
    socket.reply(2, { isConfigured: false });
    await expect(pending).resolves.toEqual({ isConfigured: false });
  });
  it('does not publish a late setup response after the original hello retires', async () => {
    const { socket, client } = await connect(1);
    const pending = client.request('sourceControl.connect', target);
    const rejected = expect(pending).rejects.toThrow('GITLAB_INSTANCE_SETUP_RETIRED');
    const hello = client.request('client.hello');
    await vi.waitFor(() => expect(socket.frames).toHaveLength(3));
    socket.reply(2, { ok: true });
    await rejected;
    socket.reply(3, { clientId: 'replacement', server: { capabilities: { gitlabCheckout: 1 } } });
    await hello;
  });
});
