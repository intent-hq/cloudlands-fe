/**
 * Cortex IPC Handlers
 *
 * IPC handlers for Cortex ACP adapter integration.
 * Models are maintained as a static list since the Cortex CLI
 * does not expose a model listing endpoint.
 */

import { ipcMain } from 'electron';
import { CORTEX_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { resolveCortexCommand } from './cortex-resolver';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';

const logger = new Logger('CortexIPC');

const DEFAULT_MODELS = [
  {
    value: 'claude-opus-4-5',
    label: 'Claude Opus 4.5',
    description: 'High-capability model for complex reasoning',
  },
  {
    value: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    description: 'Fast, balanced model for general tasks',
  },
];

export function setupCortexIPC() {
  // Check if cortex-acp is available
  ipcMain.handle(CORTEX_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      // Gate behind feature code
      if (!featureCodesService.isFeatureEnabled('cortex')) {
        logger.debug('Cortex disabled (feature code not activated)');
        return { success: true, available: false };
      }

      logger.debug('Checking cortex-acp availability');
      const resolved = await resolveCortexCommand();
      const isAvailable = !!resolved;
      logger.info('Cortex availability check', {
        isAvailable,
        command: resolved?.command,
      });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Cortex not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Cortex (static list)
  ipcMain.handle(CORTEX_CHANNELS.GET_MODELS, async () => {
    try {
      const resolved = await resolveCortexCommand();
      if (!resolved) {
        return { success: true, data: [], warning: 'Cortex not available' };
      }

      logger.info('Returning Cortex model list', { count: DEFAULT_MODELS.length });
      return { success: true, data: DEFAULT_MODELS };
    } catch (error) {
      logger.warn('Could not get models for Cortex', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });
}

