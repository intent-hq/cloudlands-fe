import { describe, expect, it, vi } from 'vitest';
import { turnTunnelOnByDefault } from './tunnel-default';

function client(rows: { path: string; value: unknown }[], update = vi.fn().mockResolvedValue([])) {
  return { settings: { list: vi.fn().mockResolvedValue(rows), update } };
}

describe('turnTunnelOnByDefault', () => {
  it('turns an off tunnel on and leaves the bind alone', async () => {
    const c = client([
      { path: 'server.bindAddress', value: '127.0.0.1' },
      { path: 'server.tunnel.enabled', value: false },
    ]);
    await expect(turnTunnelOnByDefault(c)).resolves.toBeNull();
    expect(c.settings.update.mock.calls).toEqual([
      [[{ path: 'server.tunnel.enabled', value: true }]],
    ]);
  });

  it('writes nothing when the tunnel is on or unsupported', async () => {
    for (const rows of [[{ path: 'server.tunnel.enabled', value: true }], []]) {
      const c = client(rows);
      await expect(turnTunnelOnByDefault(c)).resolves.toBeNull();
      expect(c.settings.update).not.toHaveBeenCalled();
    }
  });

  it('reports a failure instead of throwing', async () => {
    const c = client(
      [{ path: 'server.tunnel.enabled', value: false }],
      vi.fn().mockRejectedValue(new Error('tailcat missing')),
    );
    await expect(turnTunnelOnByDefault(c)).resolves.toBe('tailcat missing');
  });
});
