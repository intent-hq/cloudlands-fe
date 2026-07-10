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
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';
import type { ExecutionResult } from './browser-action-executor';

const logger = new Logger('BrowserExecReverse');

export const BROWSER_EXEC_METHOD = 'browser.exec';

/**
 * Signature of `executeBrowserActions` from `./browser.ipc`. Kept in-file to
 * avoid a static import of the browser IPC entry (and its Electron-touching
 * transitive deps) at module-load time — the wiring point loads it lazily
 * when the daemon actually issues the reverse intent (see below).
 */
export type ExecuteBrowserActionsFn = (
  actions: unknown[],
  tabId?: string,
  agentId?: string,
  workspaceId?: string,
) => Promise<ExecutionResult>;

interface BrowserExecParams {
  actions: unknown[];
  tabId?: string;
  agentId?: string;
  workspaceId?: string;
}

/** `saveAsset` seam so tests can stub the daemon round-trip. */
export type SaveAssetFn = (params: {
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
) => {
  const { executeBrowserActions } = await import('./browser.ipc');
  return executeBrowserActions(actions, tabId, agentId, workspaceId);
};

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
    const params = parseParams(rawParams);
    logger.info('Serving browser.exec reverse intent', {
      actionCount: params.actions.length,
      hasTabId: !!params.tabId,
      hasAgentId: !!params.agentId,
      hasWorkspaceId: !!params.workspaceId,
    });

    const result = await executor(
      params.actions,
      params.tabId,
      params.agentId,
      params.workspaceId,
    );

    if (params.workspaceId && saveAsset && result.success) {
      await rewriteScreenshotAssets(result, params.workspaceId, saveAsset);
    }

    return result;
  });
}

function parseParams(raw: unknown): BrowserExecParams {
  if (!raw || typeof raw !== 'object') {
    throw new Error('browser.exec: params must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const actions = obj.actions;
  if (!Array.isArray(actions)) {
    throw new Error('browser.exec: actions must be an array');
  }
  if (actions.length === 0) {
    throw new Error('browser.exec: actions must not be empty');
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

/**
 * Replace inline `{ base64, width, height }` screenshot payloads with
 * `{ assetUrl, width, height }` so the wire response stays small. Mirrors
 * `browser-tools.ts` for parity with the pre-port MCP path.
 */
async function rewriteScreenshotAssets(
  result: ExecutionResult,
  workspaceId: string,
  saveAsset: SaveAssetFn,
): Promise<void> {
  for (const actionResult of result.results) {
    if (actionResult.action !== 'screenshot' || !actionResult.success) continue;
    const data = actionResult.result as
      | { base64?: string; width?: number; height?: number }
      | undefined;
    if (!data?.base64) continue;
    try {
      const saved = await saveAsset({
        workspaceId,
        data: data.base64,
        mimeType: 'image/jpeg',
        originalName: `screenshot-${Date.now()}.jpg`,
      });
      actionResult.result = {
        assetUrl: saved?.url,
        width: data.width,
        height: data.height,
      };
    } catch (err) {
      logger.warn('Failed to save screenshot as asset, keeping base64 in result', {
        error: (err as Error).message,
      });
    }
  }
}
