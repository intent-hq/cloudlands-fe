/**
 * Live connected-clients domain (REV-2, PROTOCOL §5.17).
 *
 * `list` reads the daemon's live logical-client registry (`client.list`).
 * `ownClientId` observes the current transport's acknowledged hello identity.
 * It never sends another handshake or caches identity across connections.
 */
import type { AppClient, ClientsClient } from '../app-client';
import { isLiveClient, type LiveClient } from '$shared/types/browser-clients';
import { backendRequest, observeBackendNodeCapabilities } from './backend-transport';

let identityEpoch = 0;

export class LiveClientsClient implements ClientsClient {
  async list(workspaceId?: string): Promise<LiveClient[]> {
    const result = await backendRequest<{ clients?: unknown }>(
      'client.list',
      ...(workspaceId ? [{ workspaceId }] : []),
    );
    if (!Array.isArray(result?.clients) || !result.clients.every(isLiveClient)) {
      throw new Error('Invalid client.list response shape');
    }
    return result.clients;
  }

  async ownClientId(): Promise<string> {
    const epoch = identityEpoch;
    const result = await observeBackendNodeCapabilities();
    if (epoch !== identityEpoch) throw new Error('Browser client identity changed');
    const clientId = (result as { clientId?: unknown } | null)?.clientId;
    if (typeof clientId !== 'string' || clientId.length === 0)
      throw new Error('Invalid confirmed identity: clientId missing');
    return clientId;
  }
}

/** Reject pending observations belonging to the previous browser connection. */
export function invalidateOwnClientId(): void {
  identityEpoch++;
}

// Tied to AppClient["clients"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['clients'] | undefined = undefined as
  LiveClientsClient | undefined;
void _interfaceCheck;

export const __resetOwnClientIdForTesting = invalidateOwnClientId;
