/**
 * Missing Agent IPC Handlers
 *
 * Handles agent operations that were missing handlers.
 * Prompt enhancement and AI layout generation live on the intentd daemon
 * (`agent.enhancePrompt`, PROTOCOL §5.31) and are reached through the live
 * backend transport — the former local AugmentCLI spawn path was retired.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { z } from 'zod';
import { Logger } from '$shared/logger';
import { agentCircuitBreaker, type CircuitStatus } from '$shared/services/agent-circuit-breaker';
import { getWindowIdsForWorkspace } from '../../system/main/system.ipc';
import { ANY_HOST } from '../../system/main/window-workspace-tracking';
import { m } from '../../../shared/paraglide/messages.js';

const logger = new Logger('AgentMissing-IPC');

const AgentCircuitBreakerResetSchema = z.object({
  workspaceId: z.string(),
});

/** Ensures the circuit-breaker status broadcaster is wired up exactly once. */
let circuitBreakerBroadcastUnsubscribe: (() => void) | null = null;

/**
 * Broadcast a circuit-breaker status change to the renderer windows that are
 * viewing the affected workspace, so the UI can surface (or clear) a notice.
 */
function broadcastCircuitBreakerStatus(workspaceId: string, status: CircuitStatus): void {
  // ANY_HOST: the circuit breaker is keyed by workspace id alone and carries
  // no host, so every host's windows holding this id are notified.
  const targetWindowIds = getWindowIdsForWorkspace(workspaceId, ANY_HOST);
  const targetSet = targetWindowIds.length > 0 ? new Set(targetWindowIds) : null;

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (targetSet && !targetSet.has(win.id)) continue;
    try {
      win.webContents.send('agent:circuit-breaker:status', { workspaceId, status });
    } catch (error) {
      logger.warn('Failed to send circuit-breaker status to window', {
        windowId: win.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Subscribe (once) to circuit-breaker state changes and forward them to the
 * renderer. Registering more than once (e.g. on HMR) would duplicate events,
 * so the previous subscription is torn down first.
 */
function registerCircuitBreakerBroadcaster(): void {
  if (circuitBreakerBroadcastUnsubscribe) {
    circuitBreakerBroadcastUnsubscribe();
    circuitBreakerBroadcastUnsubscribe = null;
  }
  circuitBreakerBroadcastUnsubscribe = agentCircuitBreaker.onAnyStatusChange(
    broadcastCircuitBreakerStatus,
  );
}

const UniversalAgentEnhancePromptSchema = z.object({
  prompt: z.string(),
  context: z
    .object({
      workspaceId: z.string().optional(),
      agentId: z.string().optional(),
      files: z.array(z.string()).optional(),
    })
    .optional(),
});

// Note: Agent context schemas are defined in agent-context.ipc.ts

/**
 * Register missing agent IPC handlers
 */
export function registerMissingAgentHandlers(): void {
  // Remove only the handlers registered by this module before re-registering.
  const handlers = ['agent:circuit-breaker:reset', 'universal-agent:enhancePrompt'];

  // Ignore channels that have not been registered yet.
  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // Manually reset a tripped circuit breaker for a workspace so the user can
  // recover without restarting the app. The resulting status change is
  // broadcast to the renderer via the onAnyStatusChange subscription below.
  ipcMain.handle(
    'agent:circuit-breaker:reset',
    createSafeValidatedHandler(
      AgentCircuitBreakerResetSchema,
      async (_event, { workspaceId }) => {
        try {
          logger.info('Manual circuit breaker reset requested', { workspaceId });
          agentCircuitBreaker.reset(workspaceId);
          return {
            success: true,
            status: agentCircuitBreaker.getStatus(workspaceId),
          };
        } catch (error) {
          logger.error('Failed to reset circuit breaker', error as Error);
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : m.agent_ipc_circuitBreakerResetFailed_error(),
          };
        }
      },
      'agent:circuit-breaker:reset',
    ),
  );

  // Forward circuit-breaker state changes to the renderer.
  registerCircuitBreakerBroadcaster();

  // Universal agent enhance prompt
  ipcMain.handle(
    'universal-agent:enhancePrompt',
    createSafeValidatedHandler(
      UniversalAgentEnhancePromptSchema,
      async (_event, { prompt, context }) => {
        try {
          logger.info('Enhancing prompt', { promptLength: prompt.length });

          // Mock enhancement
          const enhanced = `${prompt}\n\n[Context: Workspace ${context?.workspaceId || 'default'}]`;

          return {
            success: true,
            enhancedPrompt: enhanced,
          };
        } catch (error) {
          logger.error('Failed to enhance prompt', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : m.agent_ipc_unknown_error(),
          };
        }
      },
      'universal-agent:enhancePrompt',
    ),
  );

  // Note: prompt enhancement / AI layout generation moved to the daemon
  // (agent.enhancePrompt, PROTOCOL §5.31) — no local handlers remain.

  // Note: Agent context handlers are registered in agent-context.ipc.ts

  logger.info('Missing agent IPC handlers registered');
}
