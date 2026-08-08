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
 * Last successfully resolved active-streams snapshot (from either the daemon
 * `agent.listActive` probe or the legacy fallback). Served back on a transient
 * `agent.listActive` failure so a slow/overloaded daemon degrades to a stale
 * read instead of triggering the legacy fan-out — see `isMethodNotFoundError`.
 */
let lastKnownActiveStreams: ActiveStream[] = [];

/**
 * The legacy `workspace.list` → `agent.list` fan-out is only a safe substitute
 * for `agent.listActive` when the daemon genuinely predates the method
 * (JSON-RPC -32601 / `METHOD_NOT_FOUND`). Any other failure (timeout,
 * connection drop, internal error) means the daemon is already struggling, and
 * fanning out into O(workspaces) extra RPCs would amplify that load —
 * precisely the load ⇒ timeout ⇒ fan-out ⇒ more load loop this guards against
 * (monorepo#1395).
 */
function isMethodNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    if ((error as { code?: unknown }).code === 'METHOD_NOT_FOUND') return true;
    if ((error as { rpcCode?: unknown }).rpcCode === -32601) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /method not found/i.test(message);
}

async function getLegacyActiveStreams(
  client: ReturnType<typeof getBackendClient>,
): Promise<ActiveStream[]> {
  const workspaceListResult = (await client.request('workspace.list')) as
    { workspaces?: Array<Record<string, unknown>> } | undefined;
  const workspaces = Array.isArray(workspaceListResult?.workspaces)
    ? workspaceListResult.workspaces
    : [];

  const perWorkspace = await Promise.all(
    workspaces.map(async (ws) => {
      const workspaceId = String(ws.id ?? ws.workspaceId ?? '');
      if (!workspaceId) return [];
      try {
        const agentListResult = (await client.request('agent.list', { workspaceId })) as
          | {
              agents?: Array<{
                id?: string;
                isStreaming?: boolean;
                isResponding?: boolean;
                updatedAt?: string;
              }>;
            }
          | undefined;
        const agents = Array.isArray(agentListResult?.agents) ? agentListResult.agents : [];
        return agents
          .filter((agent) => agent.isStreaming === true || agent.isResponding === true)
          .map((agent) => {
            const agentId = String(agent.id ?? '');
            const parsed = agent.updatedAt ? Date.parse(agent.updatedAt) : NaN;
            const startTime = Number.isFinite(parsed) ? parsed : 0;
            return { agentId, sessionId: agentId, workspaceId, startTime };
          })
          .filter((entry) => entry.agentId.length > 0);
      } catch (error) {
        logger.warn('agent.list failed during active-streams probe; skipping workspace', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    }),
  );

  return perWorkspace.flat();
}

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

  // Cross-workspace active-streams probe used by the renderer tracker. New
  // daemons answer this in one request; the legacy fan-out remains as a
  // compatibility fallback while older sidecars may still be installed.
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
        if (!isMethodNotFoundError(error)) {
          // Transient failure (timeout, connection drop, internal error) — the
          // daemon is already struggling, so serve the last known snapshot
          // instead of fanning out into the legacy workspace.list + agent.list
          // per-workspace probe, which would only add more load.
          logger.warn('agent.listActive failed transiently; returning last known active streams', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { success: true, data: lastKnownActiveStreams };
        }
        logger.warn('agent.listActive unavailable; falling back to legacy active-streams probe', {
          error: error instanceof Error ? error.message : String(error),
        });
        activeStreams = await getLegacyActiveStreams(client);
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
