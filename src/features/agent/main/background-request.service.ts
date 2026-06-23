/**
 * Background Request Service
 *
 * Simple service for making one-off requests to a cheap model.
 * These requests are NOT shown in the UI and are used for background operations like:
 * - Checking if a task note should be marked as complete
 * - Quick validations
 * - Metadata extraction
 *
 * Each request creates a fresh ACP provider to avoid shared state/history issues.
 * This is intentionally simple - no pooling, no shared state.
 */

import { Logger } from '$shared/logger';
import {
  BACKGROUND_MODEL_ID,
  BACKGROUND_REQUEST_TIMEOUT_MS,
} from '$shared/config/background-model';
import { parseCompoundModelId } from '$shared/config/provider-config';

const logger = new Logger('BackgroundRequestService');

export interface BackgroundRequestOptions {
  /** The prompt to send to the model */
  prompt: string;
  /** Working directory for the request (usually workspace path) */
  workingDirectory?: string;
  /** Override the default model */
  model?: string;
  /** Override the default timeout */
  timeoutMs?: number;
  /** System prompt (optional) */
  systemPrompt?: string;
  /** Agent type for tool restrictions (e.g., 'commit-message', 'code-review') */
  agentType?: string;
}

export interface BackgroundRequestResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Make a simple background request to a cheap model.
 * Creates a fresh provider for each request - no shared state.
 */
export async function makeBackgroundRequest(
  options: BackgroundRequestOptions,
): Promise<BackgroundRequestResult> {
  const model = options.model || BACKGROUND_MODEL_ID;
  const timeoutMs = options.timeoutMs || BACKGROUND_REQUEST_TIMEOUT_MS;
  const { providerId } = parseCompoundModelId(model);

  logger.info('Making background request', {
    model,
    providerId,
    promptLength: options.prompt.length,
  });

  let provider: any = null;

  try {
    // Create a fresh provider for this request
    const { ProviderRegistry } = await import('./provider-registry');
    const registry = ProviderRegistry.createDefault();

    // Build base config. Agent type is set both as metadata.agentType (standard)
    // and as a direct top-level property (fallback) — belt-and-suspenders to ensure
    // tool restrictions are applied even if metadata doesn't survive the pipeline.
    const backgroundId = `background-${options.agentType || 'generic'}-${Date.now()}`;
    const config: any = {
      id: backgroundId,
      provider: providerId,
      model,
      workspaceId: 'background-request',
      workspacePath: options.workingDirectory || process.cwd(),
      systemPrompt: options.systemPrompt || 'Be concise.',
      acpMode: 'ask' as const,
      simpleRequest: true,
      metadata: options.agentType ? { agentType: options.agentType } : undefined,
      agentType: options.agentType,
    };

    logger.info('Background request config created', {
      hasAgentType: !!options.agentType,
      agentType: options.agentType,
      hasMetadata: !!config.metadata,
      metadataKeys: config.metadata ? Object.keys(config.metadata) : [],
      workspacePath: config.workspacePath,
    });

    provider = await registry.create(providerId, config, true);

    // Build message using contentBlocks format (required by ACP provider)
    const messages = [
      {
        role: 'user' as const,
        contentBlocks: [{ type: 'text' as const, text: options.prompt }],
      },
    ];

    // Make request with timeout
    const result = await Promise.race([
      new Promise<BackgroundRequestResult>((resolve) => {
        const contentParts: string[] = [];
        let hasError = false;
        let resolved = false;

        const safeResolve = (result: BackgroundRequestResult) => {
          if (!resolved) {
            resolved = true;
            resolve(result);
          }
        };

        provider
          .streamMessage(messages, {
            onChunk: (chunk: string) => {
              if (!hasError) {
                contentParts.push(chunk);
              }
            },
            onComplete: (message?: { content?: string }) => {
              // Only succeed if we didn't hit an error
              if (!hasError) {
                // Use chunk-accumulated content first; fall back to content from the
                // completion message (which comes from the messageAccumulator via
                // handleStreamCompletion). This handles non-streaming agents that
                // return content only in the prompt response.
                const finalContent =
                  contentParts.join('').trim() ||
                  (message?.content ? String(message.content).trim() : '');
                safeResolve({ success: true, content: finalContent });
              }
            },
            onError: (err: Error) => {
              hasError = true;
              safeResolve({ success: false, error: err.message });
            },
          })
          .catch((err: Error) => safeResolve({ success: false, error: err.message }));
      }),
      new Promise<BackgroundRequestResult>((resolve) => {
        setTimeout(() => resolve({ success: false, error: 'Timeout' }), timeoutMs);
      }),
    ]);

    return result;
  } catch (error) {
    logger.error('Background request failed', error as Error);
    return { success: false, error: (error as Error).message };
  } finally {
    // Always cleanup the provider
    if (provider?.cleanup) {
      try {
        provider.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
