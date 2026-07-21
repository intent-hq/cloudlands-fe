/**
 * Codex IPC Handlers
 *
 * IPC handlers for Codex ACP adapter integration. Model listing is a thin
 * call to the daemon's per-provider catalog (`models.list { providerId }`,
 * PROTOCOL §6.7) — the daemon owns the probe, caching, and static fallback.
 */

import { ipcMain } from 'electron';
import { CODEX_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { resolveCodexModelListCommands } from './codex-resolver';
import {
  getManagedCodexAcpStatus,
  type ManagedCodexAcpStatus,
} from './codex-acp-manager';

const logger = new Logger('CodexIPC');

type CodexManagedInstallState =
  | 'not_installed'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'unsupported';
type CodexManagedInstallStatusPayload = {
  managedInstallState: CodexManagedInstallState;
  version?: string;
  downloadProgress?: number;
  error?: string;
  usingFallback?: boolean;
};

function toManagedInstallStatusPayload(
  status: ManagedCodexAcpStatus,
): CodexManagedInstallStatusPayload {
  const stateMap: Record<ManagedCodexAcpStatus['state'], CodexManagedInstallState> = {
    not_installed: 'not_installed',
    installing: 'installing',
    ready: 'installed',
    error: 'failed',
    unsupported: 'unsupported',
  };
  return {
    managedInstallState: stateMap[status.state],
    version: status.version,
    error: status.error,
  };
}

export function setupCodexIPC() {
  ipcMain.handle(CODEX_CHANNELS.MANAGED_INSTALL_STATUS, async () => ({
    success: true,
    data: toManagedInstallStatusPayload(getManagedCodexAcpStatus()),
  }));

  // Check if a Codex model-listing path is available
  ipcMain.handle(CODEX_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking Codex availability');
      const candidates = await resolveCodexModelListCommands();
      const isAvailable = candidates.length > 0;
      logger.info('Codex availability check', {
        isAvailable,
        sources: candidates.map((candidate) => candidate.source),
        command: candidates[0]?.command,
        usesNpx: candidates[0]?.usesNpx,
      });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Codex not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Codex — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CODEX_CHANNELS.GET_MODELS,
    async (_event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('codex', params),
  );
}
