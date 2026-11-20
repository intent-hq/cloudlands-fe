type SettingsClient = {
  settings: {
    list(): Promise<{ path: string; value: unknown }[]>;
    update(changes: { path: string; value: boolean }[]): Promise<unknown>;
  };
};

/**
 * Remote access brings the Tailcat tunnel with it: turn an off tunnel on,
 * leaving the bind (loopback is always served) untouched. Fail-soft: returns
 * the failure text, or null when it is on, unsupported, or now turned on.
 */
export async function turnTunnelOnByDefault(client: SettingsClient): Promise<string | null> {
  try {
    const settings = await client.settings.list();
    if (settings.find((entry) => entry.path === 'server.tunnel.enabled')?.value !== false)
      return null;
    await client.settings.update([{ path: 'server.tunnel.enabled', value: true }]);
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}
