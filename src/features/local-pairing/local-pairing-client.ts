/**
 * Host-side local pairing requests (protocol §5.58). Every call targets this
 * desktop's own daemon (`localMachine`), which the main process reaches over
 * the UDS / named-pipe bridge. The administration methods are local-only:
 * over TCP/WSS they fail with `-32001`.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import {
  parseLocalPairingCode,
  parseLocalPairingCredentials,
  type LocalPairingCode,
  type LocalPairingCredential,
} from './local-pairing-types';

const LOCAL = { localMachine: true } as const;

/** `system.capabilities.localCodePairing === 1` on this desktop's daemon. */
export async function readLocalPairingCapability(): Promise<boolean> {
  const result = await backendRequest<{ localCodePairing?: unknown }>(
    'system.capabilities',
    {},
    LOCAL,
  );
  return result?.localCodePairing === 1;
}

export async function createLocalCode(): Promise<{ code: string; localCode: LocalPairingCode }> {
  const result = await backendRequest<{ code?: unknown; localCode?: unknown }>(
    'pairing.createLocalCode',
    {},
    LOCAL,
  );
  const localCode = parseLocalPairingCode(result?.localCode);
  if (typeof result?.code !== 'string' || !result.code || !localCode)
    throw new Error('Invalid pairing.createLocalCode response'); // i18n-ignore (developer diagnostic)
  return { code: result.code, localCode };
}

export async function cancelLocalCode(codeId: string): Promise<boolean> {
  const result = await backendRequest<{ cancelled?: unknown }>(
    'pairing.cancelLocalCode',
    { codeId },
    LOCAL,
  );
  return result?.cancelled === true;
}

export async function listLocalCredentials(): Promise<LocalPairingCredential[]> {
  const result = await backendRequest<unknown>('pairing.listLocalCredentials', {}, LOCAL);
  const credentials = parseLocalPairingCredentials(result);
  if (!credentials) throw new Error('Invalid pairing.listLocalCredentials response'); // i18n-ignore (developer diagnostic)
  return credentials;
}

export async function revokeLocalCredential(credentialId: string): Promise<boolean> {
  const result = await backendRequest<{ revoked?: unknown }>(
    'pairing.revokeLocalCredential',
    { credentialId },
    LOCAL,
  );
  return result?.revoked === true;
}

/**
 * Turn on a listener that only this computer can reach: the WSS API on, bound
 * to loopback, and the tunnel off so nothing outside the computer is opened.
 */
export async function enableLoopbackListener(): Promise<void> {
  const settings = await backendRequest<{ settings?: Array<{ path: string; value: unknown }> }>(
    'settings.list',
    undefined,
    LOCAL,
  );
  const entries = Array.isArray(settings?.settings) ? settings.settings : [];
  const has = (path: string) => entries.some((entry) => entry.path === path);
  const value = (path: string) => entries.find((entry) => entry.path === path)?.value;
  const changes: Array<{ path: string; value: unknown }> = [];
  if (has('server.bindAddress')) changes.push({ path: 'server.bindAddress', value: '127.0.0.1' });
  if (value('server.tunnel.enabled') === true)
    changes.push({ path: 'server.tunnel.enabled', value: false });
  changes.push({ path: 'server.wsApi.enabled', value: true });
  await backendRequest('settings.update', { changes }, LOCAL);
}
