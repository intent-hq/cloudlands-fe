import type { ConnectionTunnelResult } from '$shared/types/connections';

type Request = (method: string, params?: unknown) => Promise<unknown>;
const TUNNEL_ENABLED = 'server.tunnel.enabled';

function settingEntries(result: unknown, field: 'settings' | 'applied'): unknown[] {
  const entries =
    result && typeof result === 'object'
      ? (result as { settings?: unknown; applied?: unknown })[field]
      : null;
  if (!Array.isArray(entries)) {
    throw new Error('Invalid Tailcat settings response'); // i18n-ignore (wire contract failure)
  }
  return entries;
}

function tunnelEntry(entries: unknown[]): { path: string; value?: unknown } | undefined {
  return entries.find(
    (entry): entry is { path: string; value?: unknown } =>
      !!entry && typeof entry === 'object' && 'path' in entry && entry.path === TUNNEL_ENABLED,
  );
}

export async function getConnectionTunnel(request: Request): Promise<ConnectionTunnelResult> {
  const entry = tunnelEntry(settingEntries(await request('settings.list'), 'settings'));
  if (!entry) return { supported: false, enabled: false };
  if (typeof entry.value !== 'boolean') {
    throw new Error('Invalid Tailcat enabled setting'); // i18n-ignore (wire contract failure)
  }
  return { supported: true, enabled: entry.value };
}

export async function setConnectionTunnel(
  request: Request,
  enabled: boolean,
): Promise<ConnectionTunnelResult> {
  const current = await getConnectionTunnel(request);
  if (!current.supported) return current;
  const result = await request('settings.update', {
    changes: [{ path: TUNNEL_ENABLED, value: enabled }],
  });
  const applied = tunnelEntry(settingEntries(result, 'applied'));
  // Unchanged values are omitted from applied; verify those with a fresh read.
  const verified = applied
    ? { supported: true, enabled: applied.value }
    : await getConnectionTunnel(request);
  if (!verified.supported || verified.enabled !== enabled) {
    throw new Error('The server did not apply the Tailcat setting'); // i18n-ignore (wire contract failure)
  }
  return { supported: true, enabled };
}
