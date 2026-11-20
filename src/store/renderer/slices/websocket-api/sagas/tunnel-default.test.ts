import { describe, expect, it, vi } from 'vitest';
import { turnTunnelOnByDefault } from './tunnel-default';

function client(rows: { path: string; value: unknown }[], update = vi.fn().mockResolvedValue([])) {
  return { settings: { list: vi.fn().mockResolvedValue(rows), update } };
}

const tunnelOff = { path: 'server.tunnel.enabled', value: false };

describe('turnTunnelOnByDefault', () => {
  it('turns the tunnel on over a loopback-only bind and never writes the bind', async () => {
    for (const bind of [undefined, '127.0.0.1', ['127.0.0.1'], ['::1'], []]) {
      const rows =
        bind === undefined ? [tunnelOff] : [{ path: 'server.bindAddress', value: bind }, tunnelOff];
      const c = client(rows);
      await expect(turnTunnelOnByDefault(c)).resolves.toEqual({ changed: true });
      expect(c.settings.update.mock.calls).toEqual([
        [[{ path: 'server.tunnel.enabled', value: true }]],
      ]);
    }
  });

  it("keeps a user's earlier choice of other networks, tunnel included", async () => {
    for (const bind of ['192.168.1.5', ['127.0.0.1', '100.101.102.103'], ['0.0.0.0'], ['::']]) {
      const c = client([{ path: 'server.bindAddress', value: bind }, tunnelOff]);
      await expect(turnTunnelOnByDefault(c)).resolves.toEqual({ changed: false });
      expect(c.settings.update).not.toHaveBeenCalled();
    }
  });

  it('writes nothing when the tunnel is on or unsupported', async () => {
    for (const rows of [[{ path: 'server.tunnel.enabled', value: true }], []]) {
      const c = client(rows);
      await expect(turnTunnelOnByDefault(c)).resolves.toEqual({ changed: false });
      expect(c.settings.update).not.toHaveBeenCalled();
    }
  });

  it('reports a failure instead of throwing', async () => {
    const c = client([tunnelOff], vi.fn().mockRejectedValue(new Error('tailcat missing')));
    await expect(turnTunnelOnByDefault(c)).resolves.toEqual({
      changed: false,
      error: 'tailcat missing',
    });
  });
});
