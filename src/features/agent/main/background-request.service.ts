/**
 * Background Request Service
 *
 * One-shot prompt→completion calls for background operations (task-note
 * status classification, workspace slug generation, small metadata extraction)
 * that are NOT rendered in the UI and MUST NOT create a durable agent session.
 *
 * The daemon owns the lifecycle via `agent.completeOnce` (PROTOCOL §5.32):
 * it spawns the auggie CLI, cleans the reply, and reaps the process on any
 * failure path (timeout / cancel / drop). No client-side agent
 * create→send→read→delete orchestration and nothing to garbage-collect on
 * the error path — the previous ACPProvider spawn is retired.
 */

import { Logger } from '$shared/logger';
import { BACKGROUND_REQUEST_TIMEOUT_MS } from '$shared/config/background-model';
import { getBackendClient } from '$features/backend/main/backend.ipc';
import { JsonRpcError } from '$features/backend/main/json-rpc-errors';

const logger = new Logger('BackgroundRequestService');

/**
 * Upper bound the daemon accepts on `timeoutMs` (§5.32); a longer value is
 * clamped rather than rejected, matching the daemon's own cap.
 */
const DAEMON_TIMEOUT_CAP_MS = 120_000;

export interface BackgroundRequestOptions {
  /** The prompt to send to the model. */
  prompt: string;
  /**
   * Reserved for future workspace-scoped background requests; currently
   * ignored. The daemon takes `workspaceId` (not a raw path) when scoping the
   * CLI's cwd, so this field cannot be forwarded verbatim. Kept in the
   * interface for source-compatibility with the previous ACPProvider seam.
   */
  workingDirectory?: string;
  /**
   * Optional model — forwarded to the CLI as `--model`. Omitted when unset,
   * so the daemon/CLI default applies (PROTOCOL §5.32).
   */
  model?: string;
  /** Override the default timeout (ms). Daemon clamps at 120000. */
  timeoutMs?: number;
  /** System prompt (composed with `prompt` by the daemon). */
  systemPrompt?: string;
  /**
   * Reserved: the previous ACP path used this for tool restrictions.
   * `agent.completeOnce` skips MCP entirely (no tools available), so this is
   * a no-op here but kept for source-compatibility with existing callers.
   */
  agentType?: string;
}

export interface BackgroundRequestResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Fire a one-shot background completion against the daemon.
 * Backward-compatible with the previous ACPProvider-backed signature — the
 * caller-facing `{ success, content?, error? }` result is unchanged.
 */
export async function makeBackgroundRequest(
  options: BackgroundRequestOptions,
): Promise<BackgroundRequestResult> {
  const prompt = options.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { success: false, error: 'prompt is required' };
  }

  const requestedTimeout = options.timeoutMs ?? BACKGROUND_REQUEST_TIMEOUT_MS;
  const timeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(requestedTimeout, DAEMON_TIMEOUT_CAP_MS)
      : BACKGROUND_REQUEST_TIMEOUT_MS;
  const params: Record<string, unknown> = { prompt, timeoutMs };
  if (options.model) params.model = options.model;
  if (options.systemPrompt) params.systemPrompt = options.systemPrompt;

  logger.info('Making background request', {
    model: options.model || '(provider default)',
    timeoutMs,
    promptLength: prompt.length,
    hasSystemPrompt: !!options.systemPrompt,
  });

  try {
    const result = (await getBackendClient().request(
      'agent.completeOnce',
      params,
    )) as { text?: unknown } | undefined;
    const text = typeof result?.text === 'string' ? result.text.trim() : '';
    return { success: true, content: text };
  } catch (error) {
    const message =
      error instanceof JsonRpcError || error instanceof Error
        ? error.message
        : String(error);
    logger.error('Background request failed', error as Error);
    return { success: false, error: message };
  }
}
