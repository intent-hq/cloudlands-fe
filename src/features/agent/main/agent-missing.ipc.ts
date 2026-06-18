/**
 * Missing Agent IPC Handlers
 *
 * Handles agent operations that were missing handlers
 */

import { BrowserWindow, ipcMain } from 'electron';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { z } from 'zod';
import { Logger } from '$shared/logger';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { AugmentCLI } from '../../auggie/main/augment-cli';
import {
  getInputWithEnhancePrompt,
  extractEnhancedPrompt,
} from '$lib/utils/prompt-enhancement';
import {
  agentCircuitBreaker,
  type CircuitStatus,
} from '$shared/services/agent-circuit-breaker';
import { getWindowIdsForWorkspace } from '../../system/main/system.ipc';

const logger = new Logger('AgentMissing-IPC');
const augmentCLI = new AugmentCLI();

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

const AgentEnhancePromptSchema = z.object({
  prompt: z.string(),
  workspaceId: z.string().optional(),
  modelId: z.string().optional(),
});

const AgentGenerateLayoutSchema = z.object({
  prompt: z.string(),
  workspaceId: z.string().optional(),
  modelId: z.string().optional(),
});

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
    'agent:enhance-prompt',
    'agent:generate-layout',
  ];

  // Ignore channels that have not been registered yet.
  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // Get active streams - used by frontend to re-register IPC handlers after page refresh/HMR
  // Now includes accumulated content so frontend can restore without losing chunks
  ipcMain.handle('agent:get-active-streams', async () => {
    try {
      // Import AgentBackendHandler dynamically to avoid circular dependencies
      const { AgentBackendHandler } = await import('./agent-backend-handler.service');
      const handler = AgentBackendHandler.getInstance();
      const activeStreams = handler.getActiveStreams();

      logger.debug('agent:get-active-streams called', {
        count: activeStreams.length,
        agentIds: activeStreams.map((s) => s.agentId),
        withAccumulatedContent: activeStreams.filter((s) => s.accumulatedContent).length,
      });

      return {
        success: true,
        data: activeStreams,
      };
    } catch (error) {
      logger.error('Failed to get active streams', error as Error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to get active streams',
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
            error: error instanceof Error ? error.message : 'Failed to reset circuit breaker',
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
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'universal-agent:enhancePrompt',
    ),
  );

  // Agent enhance prompt (used by PanelLayoutHeader, SimpleRichInput, and agent stream lifecycle)
  ipcMain.handle(
    'agent:enhance-prompt',
    createSafeValidatedHandler(
      AgentEnhancePromptSchema,
      async (_event, { prompt, workspaceId, modelId }) => {
        try {
          logger.info('Enhancing prompt with AI', {
            promptLength: prompt.length,
            workspaceId,
            modelId,
          });

          // Wrap the prompt with the enhancement template
          const enhancementPrompt = getInputWithEnhancePrompt(prompt);

          // Use auggie CLI to enhance the prompt
          // Use a 30 second timeout for prompt enhancement (simple request)
          // Skip MCP servers for faster response - prompt enhancement doesn't need tools
          // Model is passed from the renderer (from selectModelForType('fast') Redux selector)
          const response = await augmentCLI.streamChat(
            enhancementPrompt,
            {
              model: modelId || MODEL_DEFAULTS.BACKGROUND_REQUEST_MODEL,
              workspaceId,
              agentId: 'enhance-prompt',
              systemPrompt:
                'You are a helpful assistant. Respond directly and concisely. Do not use any tools.',
              skipMcp: true, // Skip MCP server initialization for faster response
            },
            () => {}, // No streaming chunks needed for this use case
            undefined, // No abort signal
            30000, // 30 second timeout
          );

          // Extract the enhanced prompt from the response
          const enhancedPrompt = extractEnhancedPrompt(response.content);

          if (enhancedPrompt) {
            logger.info('Prompt enhanced', { responseLength: enhancedPrompt.length });
            return {
              success: true,
              enhanced: enhancedPrompt,
              original: prompt,
            };
          } else {
            logger.warn('Failed to parse enhanced prompt from response', {
              responseLength: response.content.length,
            });
            return {
              success: false,
              error: 'Failed to parse enhanced prompt from response',
            };
          }
        } catch (error) {
          logger.error('Failed to enhance prompt', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'agent:enhance-prompt',
    ),
  );

  // Agent generate layout (used by PanelLayoutControls for AI layout suggestions)
  ipcMain.handle(
    'agent:generate-layout',
    createSafeValidatedHandler(
      AgentGenerateLayoutSchema,
      async (_event, { prompt, workspaceId, modelId }) => {
        try {
          logger.info('Generating layout with AI', {
            promptLength: prompt.length,
            workspaceId,
            modelId,
          });

          // Call AI directly without enhancement wrapper
          // Use a 30 second timeout for layout generation (simple request)
          // Skip MCP servers for faster response - layout generation doesn't need tools
          const response = await augmentCLI.streamChat(
            prompt,
            {
              model: modelId || MODEL_DEFAULTS.BACKGROUND_REQUEST_MODEL,
              workspaceId,
              agentId: 'generate-layout',
              systemPrompt:
                'You are a layout configuration assistant. Follow the instructions exactly and respond only with the requested JSON format.',
              skipMcp: true, // Skip MCP server initialization for faster response
            },
            () => {}, // No streaming chunks needed for this use case
            undefined, // No abort signal
            30000, // 30 second timeout
          );

          logger.info('Layout generation response received', {
            responseLength: response.content.length,
          });

          return {
            success: true,
            enhanced: response.content,
            original: prompt,
          };
        } catch (error) {
          logger.error('Failed to generate layout', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'agent:generate-layout',
    ),
  );

  // Note: Agent context handlers are registered in agent-context.ipc.ts

  logger.info('Missing agent IPC handlers registered');
}
