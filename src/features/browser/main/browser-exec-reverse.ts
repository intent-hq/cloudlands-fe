/**
 * FE-served `browser.exec` reverse-intent handler (PROTOCOL §5.14, GAP-2b).
 *
 * The daemon proxies `browser.exec` back to the connected FE as a reverse
 * JSON-RPC request (`rev-<n>` id namespace). We route the payload directly to
 * the ported {@link executeBrowserActions} pipeline and return its
 * `{ success, results, error? }` envelope verbatim — the daemon's
 * `browser_ops::shape_result` reshapes it for the original caller (single
 * action → the lone action object, multiple → `{ results: [...] }`), so the FE
 * must NOT collapse the shape here.
 *
 * Screenshot results are large base64 blobs. Mirroring the previous MCP path
 * (`browser-tools.ts`), we rewrite them to `workspace-asset://` URLs via
 * `note.saveAsset` when a `workspaceId` is available so they survive ACP
 * truncation.
 */

import { Logger } from '../../../shared/logger';
import { ReverseRpcHandlerError, type JsonRpcClient } from '../../backend/main/json-rpc-client';
import type { ExecutionResult } from './browser-action-executor';

const logger = new Logger('BrowserExecReverse');

export const BROWSER_EXEC_METHOD = 'browser.exec';

/**
 * intentd's reverse-request deadlines (`crates/intent-transport/src/reverse.rs`):
 * a `browser.exec` batch containing a `screenshot` action gets 20 s, any
 * other reverse request 30 s. The FE must answer inside that window or the
 * daemon discards the reply and the agent sees a bare "reverse request timed
 * out" (intent-hq/intent#4835).
 */
const DEFAULT_REVERSE_TIMEOUT_MS = 30_000;
const SCREENSHOT_REVERSE_TIMEOUT_MS = 20_000;

/**
 * Time reserved between the FE's answer and the daemon's deadline for the
 * reply to cross the transport. The request deadline handed to the executor
 * and to asset persistence is the daemon deadline minus this margin.
 */
const REVERSE_TRANSPORT_MARGIN_MS = 2_000;

/**
 * How long after the request deadline the handler's own backstop fires. The
 * executor clamps every stage to that deadline and answers with a per-action
 * `deadline-exhausted` result naming the stage; the backstop must not race
 * those stage timers (same instant, unordered) and replace a structured
 * answer with an empty envelope, so it only wins when a stage overran its
 * clamp. Fits inside the transport margin.
 */
const EXECUTOR_BACKSTOP_GRACE_MS = 1_000;

/**
 * Signature of `executeBrowserActions` from `./browser.ipc`. Kept in-file to
 * avoid a static import of the browser IPC entry (and its Electron-touching
 * transitive deps) at module-load time — the wiring point loads it lazily
 * when the daemon actually issues the reverse intent (see below).
 * `deadline` is the absolute epoch-ms request deadline (see above).
 */
export type ExecuteBrowserActionsFn = (
  actions: unknown[],
  tabId?: string,
  agentId?: string,
  workspaceId?: string,
  backendContext?: BrowserExecutionBackendContext,
  deadline?: number,
) => Promise<ExecutionResult>;

/** Backend identity captured at the reverse-handler or renderer IPC boundary. */
export interface BrowserExecutionBackendContext {
  client: JsonRpcClient;
  backendId: string;
  savedRemote: boolean;
}

interface BrowserExecParams {
  actions: unknown[];
  tabId?: string;
  agentId?: string;
  workspaceId?: string;
}

/** `saveAsset` seam so tests can stub the daemon round-trip. */
type SaveAssetFn = (params: {
  workspaceId: string;
  data: string;
  mimeType: string;
  originalName: string;
}) => Promise<{ url?: string } | undefined>;

export interface RegisterBrowserExecOptions {
  /** Overridable executor for tests. */
  executor?: ExecuteBrowserActionsFn;
  /** Overridable asset-save call for tests. */
  saveAsset?: SaveAssetFn;
  /** True when this client belongs to a persisted remote connection. */
  savedRemote?: boolean;
  /** Stable backend pool id for scoped lifecycle subscriptions. */
  backendId?: string;
}

/**
 * Default executor — a lazy dynamic import so this module doesn't transitively
 * load Electron-touching browser code (embedded CDP + `system.ipc`) just to be
 * imported. The daemon-initiated reverse call is the only real trigger, and
 * that path runs in the Electron main process where the import is safe.
 */
const defaultExecutor: ExecuteBrowserActionsFn = async (
  actions,
  tabId,
  agentId,
  workspaceId,
  backendContext,
  deadline,
) => {
  const { executeBrowserActions } = await import('./browser.ipc');
  return executeBrowserActions(actions, tabId, agentId, workspaceId, backendContext, deadline);
};

/**
 * The absolute deadline (epoch ms) for one reverse request, derived from its
 * receipt: the daemon deadline that applies to this batch minus the transport
 * margin. Mirrors the daemon's selection — any `screenshot` action puts the
 * whole batch on the shorter screenshot deadline.
 */
function requestDeadline(receivedAt: number, actions: unknown[]): number {
  const includesScreenshot = actions.some(
    (action) =>
      !!action &&
      typeof action === 'object' &&
      (action as { action?: unknown }).action === 'screenshot',
  );
  const daemonTimeoutMs = includesScreenshot
    ? SCREENSHOT_REVERSE_TIMEOUT_MS
    : DEFAULT_REVERSE_TIMEOUT_MS;
  return receivedAt + daemonTimeoutMs - REVERSE_TRANSPORT_MARGIN_MS;
}

/**
 * Backstop for the executor itself: every capture stage is clamped to the
 * deadline, but should the batch still not settle shortly after it, answer
 * with a truthful failure envelope before the daemon gives up rather than
 * let the reply arrive after it. The abandoned batch's eventual result is
 * dropped. Fires {@link EXECUTOR_BACKSTOP_GRACE_MS} past the deadline so a
 * stage that answers at the deadline keeps its per-action error.
 */
async function executeWithinDeadline(
  run: Promise<ExecutionResult>,
  deadline: number,
): Promise<ExecutionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run,
      new Promise<ExecutionResult>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              success: false,
              results: [],
              // i18n-ignore (agent-facing operational timeout, not user-facing)
              error: `browser.exec: the actions did not settle within the request deadline (stage: action execution). Retry the request.`,
            }),
          Math.max(0, deadline + EXECUTOR_BACKSTOP_GRACE_MS - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register the `browser.exec` reverse-intent handler on the shared JSON-RPC
 * client. Returns a disposer that removes the registration.
 */
export function registerBrowserExecReverseHandler(
  client: JsonRpcClient,
  options: RegisterBrowserExecOptions = {},
): () => void {
  const executor = options.executor ?? defaultExecutor;
  const saveAsset = options.saveAsset;

  return client.registerMethod(BROWSER_EXEC_METHOD, async (rawParams) => {
    const receivedAt = Date.now();
    const params = parseParams(rawParams);
    const deadline = requestDeadline(receivedAt, params.actions);
    logger.info('Serving browser.exec reverse intent', {
      actionCount: params.actions.length,
      hasTabId: !!params.tabId,
      hasAgentId: !!params.agentId,
      hasWorkspaceId: !!params.workspaceId,
      budgetMs: deadline - receivedAt,
    });

    const result = await executeWithinDeadline(
      executor(
        params.actions,
        params.tabId,
        params.agentId,
        params.workspaceId,
        {
          client,
          backendId: options.backendId ?? 'local',
          savedRemote: options.savedRemote ?? false,
        },
        deadline,
      ),
      deadline,
    );

    if (params.workspaceId && saveAsset && result.success) {
      await rewriteScreenshotAssets(result, params.workspaceId, saveAsset, deadline);
    }

    return result;
  });
}

function parseParams(raw: unknown): BrowserExecParams {
  // Validation failures are deterministic bad-input errors, so surface them as
  // JSON-RPC `-32602 INVALID_PARAMS` (not the `-32603 INTERNAL_ERROR` fallback
  // that plain `Error`s would map to) so the daemon/caller can distinguish
  // malformed payloads from handler faults.
  if (!raw || typeof raw !== 'object') {
    throw new ReverseRpcHandlerError(-32602, 'browser.exec: params must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const actions = obj.actions;
  if (!Array.isArray(actions)) {
    throw new ReverseRpcHandlerError(-32602, 'browser.exec: actions must be an array');
  }
  if (actions.length === 0) {
    throw new ReverseRpcHandlerError(-32602, 'browser.exec: actions must not be empty');
  }
  return {
    actions,
    tabId: optionalString(obj.tabId),
    agentId: optionalString(obj.agentId),
    workspaceId: optionalString(obj.workspaceId),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Own cap on asset persistence; further clamped to the request deadline. */
const SCREENSHOT_ASSET_SAVE_TIMEOUT_MS = 5_000;

/**
 * Replace inline `{ base64, width, height }` screenshot payloads with
 * `{ assetUrl, width, height }` so the wire response stays small. Mirrors
 * `browser-tools.ts` for parity with the pre-port MCP path.
 *
 * Persistence is bounded by whatever is left of the request `deadline`
 * (at most its own cap): a capture that legitimately used most of the budget
 * still answers with the usable inline base64 inside the deadline instead of
 * overrunning into the daemon's transport timeout (#4835).
 */
async function rewriteScreenshotAssets(
  result: ExecutionResult,
  workspaceId: string,
  saveAsset: SaveAssetFn,
  deadline: number,
): Promise<void> {
  await Promise.all(
    result.results.map(async (actionResult) => {
      if (actionResult.action !== 'screenshot' || !actionResult.success) return;
      const data = actionResult.result as
        { base64?: string; width?: number; height?: number } | undefined;
      if (!data?.base64) return;
      const saveBudgetMs = Math.min(SCREENSHOT_ASSET_SAVE_TIMEOUT_MS, deadline - Date.now());
      if (saveBudgetMs <= 0) {
        logger.warn('No request budget left for asset persistence; keeping base64 in result', {
          workspaceId,
        });
        return;
      }
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const saved = await Promise.race([
          saveAsset({
            workspaceId,
            data: data.base64,
            mimeType: 'image/jpeg',
            originalName: `screenshot-${Date.now()}.jpg`,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    // i18n-ignore (agent-facing operational timeout, not user-facing)
                    `Asset persistence timed out after ${saveBudgetMs}ms`,
                  ),
                ),
              saveBudgetMs,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        // Only replace the base64 payload once we actually have a usable
        // `assetUrl` — `SaveAssetFn` may return `undefined` or a payload without
        // `url`, and dropping the base64 in that case would leave the caller
        // with neither the inline blob nor a fetchable URL.
        if (saved?.url) {
          actionResult.result = {
            assetUrl: saved.url,
            width: data.width,
            height: data.height,
          };
        } else {
          logger.warn('saveAsset returned no url; keeping base64 in screenshot result', {
            workspaceId,
          });
        }
      } catch (err) {
        logger.warn('Failed to save screenshot as asset, keeping base64 in result', {
          workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}
