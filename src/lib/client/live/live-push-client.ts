import type { AppClient, PushClient, PushStatus } from '../app-client';
import { backendRequest } from './backend-transport';
import { BackendError } from './backend-transport-types';

function isPushStatus(value: unknown): value is PushStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.enabled === 'boolean' &&
    typeof status.relayUrl === 'string' &&
    (status.daemonId === null || typeof status.daemonId === 'string') &&
    typeof status.linked === 'boolean' &&
    (status.linkedDevices === null || typeof status.linkedDevices === 'number') &&
    typeof status.publishing === 'boolean'
  );
}

export class LivePushClient implements PushClient {
  async status(): Promise<PushStatus | null> {
    let result: unknown;
    try {
      result = await backendRequest<unknown>('push.status');
    } catch (error) {
      if (
        error instanceof BackendError &&
        (error.rpcCode === -32601 || error.code === 'METHOD_NOT_FOUND')
      ) {
        return null;
      }
      throw error;
    }
    if (!isPushStatus(result)) throw new Error('Invalid push.status response shape');
    const { enabled, relayUrl, daemonId, linked, linkedDevices, publishing } = result;
    return { enabled, relayUrl, daemonId, linked, linkedDevices, publishing };
  }
}

const _interfaceCheck: AppClient['push'] | undefined = undefined as LivePushClient | undefined;
void _interfaceCheck;
