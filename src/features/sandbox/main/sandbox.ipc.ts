/**
 * Sandbox IPC handlers
 *
 * Development-only handlers for sandbox pages
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import {
  getInstructionById,
  getInstructionWithCommon,
  common,
} from '../../agent/main/instructions';
import { getBaseInstruction } from '../../agent/main/instructions/base-system-prompt';

const logger = new Logger('SandboxIPC');

export function setupSandboxIPC(): void {
  logger.info('Setting up sandbox IPC handlers');

  // Get agent rules for a specific agent type
  ipcMain.handle(
    'sandbox:get-agent-rules',
    async (_event, { agentType }: { agentType: string }) => {
      try {
        logger.debug('Getting agent rules', { agentType });

        // Get the base system prompt (includes CDP debug tools when enabled)
        const base = getBaseInstruction();

        // Get common instructions
        const commonInstructions = common;

        // Get specialization rules
        const specialization = getInstructionById(agentType, true);

        // Get combined (common + specialization)
        const combined = getInstructionWithCommon(agentType);

        // Estimate tokens (rough: ~4 chars per token)
        const totalTokens = Math.ceil((base.length + combined.length) / 4);

        return {
          success: true,
          data: {
            baseSystemPrompt: base,
            common: commonInstructions,
            specialization,
            combined,
            totalTokens,
          },
        };
      } catch (error) {
        logger.error('Failed to get agent rules', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  logger.info('Sandbox IPC handlers setup complete');
}
