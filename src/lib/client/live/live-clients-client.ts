/**
 * Live connected-clients domain (REV-2, PROTOCOL §5.17).
 *
 * `list` reads the daemon's live logical-client registry (`client.list`).
 * `ownClientId` learns the identity THIS connection presents on `client.hello`
 * by issuing a hello probe: in Electron the main-process JsonRpcClient merges
 * the persisted stable clientId (plus `capabilities.browserExec` and the host
 * triple) into every forwarded hello, so the daemon echoes the id the sidebar
 * needs for `isHost = hostClientId === ownClientId`. The probe is single-flight
 * per process; a failed probe is not cached so the next caller retries.
 */
import type { AppClient, ClientsClient } from '../app-client';
import { isLiveClient, type LiveClient } from '$shared/types/browser-clients';
import { backendRequest } from './backend-transport';

let ownClientIdPromise: Promise<string> | null = null;

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

  ownClientId(): Promise<string> {
    if (!ownClientIdPromise) {
      ownClientIdPromise = backendRequest<{ clientId?: unknown }>('client.hello', {}).then(
        (result) => {
          const clientId = result?.clientId;
          if (typeof clientId !== 'string' || clientId.length === 0) {
            throw new Error('Invalid client.hello response shape: clientId missing');
          }
          return clientId;
        },
      );
      const probe = ownClientIdPromise;
      probe.catch(() => {
        if (ownClientIdPromise === probe) ownClientIdPromise = null;
      });
    }
    return ownClientIdPromise;
  }
}

/** Forget the previous connection's probe, including any pending flight. */
export function invalidateOwnClientId(): void {
  ownClientIdPromise = null;
}

// Tied to AppClient["clients"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['clients'] | undefined = undefined as
  LiveClientsClient | undefined;
void _interfaceCheck;

export const __resetOwnClientIdForTesting = invalidateOwnClientId;
