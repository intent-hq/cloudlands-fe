import { BackendError } from '$lib/client/live/backend-transport-types';
import { electronAPI } from '$lib/client/live/electron-ipc-transport';
import type { WorkspaceDomainReadTransport } from './workspace-domain-client';

/** Actual preload channels; the canonical domain client owns their envelopes. */
export function createElectronWorkspaceDomainReadTransport(): WorkspaceDomainReadTransport {
  return {
    // Bridge presence only, not daemon connectivity or handler readiness.
    available: () => typeof electronAPI()?.invoke === 'function',
    async invoke(channel, data) {
      const api = electronAPI();
      if (typeof api?.invoke !== 'function') {
        throw new BackendError({
          code: 'UNAVAILABLE',
          // i18n-ignore (internal transport diagnostic shared with the real backend bridge)
          message: 'Backend bridge unavailable',
        });
      }
      return api.invoke(channel, data);
    },
  };
}
