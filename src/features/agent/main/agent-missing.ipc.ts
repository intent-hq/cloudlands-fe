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
import { getBackendClient } from '../../backend/main/backend.ipc';
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
  const targetWindowIds = getWindowIdsForWorkspace(workspaceId);
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

interface ActiveStream {
  agentId: string;
  sessionId: string;
  workspaceId: string;
  startTime: number;
}

interface AgentListActiveResult {
  streams: ActiveStream[];
}

/**
 * Last successfully resolved active-streams snapshot from the daemon's
 * `agent.listActive` probe. Served back on ANY `agent.listActive` failure —
 * including a `-32601` METHOD_NOT_FOUND — so a slow/overloaded daemon degrades
 * to a stale read instead of issuing more RPCs. The former
 * `workspace.list` → `agent.list` per-workspace fan-out was removed: every
 * supported daemon serves `agent.listActive`, and fanning out O(workspaces)
 * `agent.list` calls on a failure only amplified load (monorepo#1395).
 */
let lastKnownActiveStreams: ActiveStream[] = [];

// Note: Agent context schemas are defined in agent-context.ipc.ts

/**
 * Register missing agent IPC handlers
 */
export function registerMissingAgentHandlers(): void {
  // Remove only the handlers registered by this module before re-registering.
  const handlers = [
    'agent:get-active-streams',
    'agent:circuit-breaker:reset',
    'universal-agent:enhancePrompt',
  ];

  // Ignore channels that have not been registered yet.
  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // Cross-workspace active-streams probe used by the renderer tracker — one
  // daemon-global `agent.listActive` request, never a per-workspace fan-out.
  ipcMain.handle('agent:get-active-streams', async () => {
    try {
      const client = getBackendClient();
      let activeStreams: ActiveStream[];
      try {
        const result = await client.request<AgentListActiveResult>('agent.listActive');
        activeStreams = result.streams.map(({ agentId, sessionId, workspaceId, startTime }) => ({
          agentId,
          sessionId,
          workspaceId,
          startTime,
        }));
      } catch (error) {
        // Any failure (timeout, connection drop, internal error, method not
        // found) — serve the last known snapshot rather than issuing more
        // RPCs against a daemon that is already struggling.
        logger.warn('agent.listActive failed; returning last known active streams', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: true, data: lastKnownActiveStreams };
      }

      logger.debug('agent:get-active-streams called', {
        count: activeStreams.length,
        agentIds: activeStreams.map((s) => s.agentId),
      });

      lastKnownActiveStreams = activeStreams;

      return {
        success: true,
        data: activeStreams,
      };
    } catch (error) {
      logger.error('Failed to get active streams', error as Error);
      return {
        success: false,
        error: (error as Error).message || m.agent_ipc_activeStreamsFailed_error(),
        data: [],
      };
    }
  });

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
