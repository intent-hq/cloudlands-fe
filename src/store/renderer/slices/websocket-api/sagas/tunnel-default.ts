type SettingsClient = {
  settings: {
    list(): Promise<{ path: string; value: unknown }[]>;
    update(changes: { path: string; value: boolean }[]): Promise<unknown>;
  };
};

const isLoopback = (ip: unknown) =>
  typeof ip === 'string' && (ip === '::1' || ip.startsWith('127.'));

/**
 * Turning remote access on defaults to loopback plus the Tailcat tunnel: an
 * off tunnel is turned on while the bind is still loopback only (loopback is
 * always served, so the bind is never written). A bind the user widened to
 * other networks keeps their whole setup, tunnel included. Fail-soft: a
 * failure is returned, never thrown.
 */
export async function turnTunnelOnByDefault(
  client: SettingsClient,
): Promise<{ changed: boolean; error?: string }> {
  try {
    const settings = await client.settings.list();
    const value = (path: string) => settings.find((entry) => entry.path === path)?.value;
    const bind = value('server.bindAddress');
    const binds = Array.isArray(bind) ? bind : bind === undefined ? [] : [bind];
    if (value('server.tunnel.enabled') !== false || !binds.every(isLoopback))
      return { changed: false };
    await client.settings.update([{ path: 'server.tunnel.enabled', value: true }]);
    return { changed: true };
  } catch (cause) {
    return { changed: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
