/**
 * Background executor service — the post-saga consumer for the
 * background-agent-executor triggers (`bgExecutor/execute`,
 * `bgExecutor/cancel`) that lost their handler when
 * `background-agent-executor-saga.ts` was removed with the saga runtime.
 * Restores the Generate quick actions (commit message, PR description,
 * code review, walkthrough) WITHOUT re-adding a saga and WITHOUT changing
 * any dispatch site.
 *
 * Unlike the deleted saga (create agent → send → monitor → extract →
 * delete), this rides the daemon's stateless one-shot completion
 * `agent.completeOnce` (PROTOCOL §5.32): one wire call carrying the
 * instruction template as `systemPrompt`, the prepared context as `prompt`,
 * and the workspace id so the provider runs in the worktree. No agent
 * session is created and there is nothing to clean up on the error path;
 * `executor.agentId` therefore stays null ("view thought process"
 * affordances stay hidden).
 *
 * The §5.32 provider gate returns `{ available: false, reason }` instead of
 * text when no one-shot route exists for the effective default provider
 * (intentd#991 reason strings). That surfaces as a user-visible error state
 * plus toast — never a silent no-op.
 *
 * Cancellation: `agent.completeOnce` has no abort RPC — the daemon reaps the
 * provider when its own `timeoutMs` elapses. FE-side cancel therefore bumps
 * a per-(workspace, executor) generation so the in-flight response is
 * discarded on arrival, and marks the executor `cancelled` (the reference
 * saga's semantics).
 *
 * Dependency-light per src/store/renderer/AGENTS.md: top-level imports are
 * limited to the configured store, slice actions/types, store-free utils,
 * and the logger. Selector modules (which evaluate `store.createSelector`
 * at import) and the toast lib are dynamically imported inside handlers.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import {
  cancelExecution,
  executeBackgroundAgent,
  setExecutorState,
} from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';
import { EXECUTOR_CONFIGS } from '$store/renderer/slices/background-agent-executor/background-agent-executor-types';
import type { BackgroundAgentType } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import { prepareContext } from '$store/renderer/slices/background-agent-executor/utils/context-preparation';
import { extractResultFromText } from '$store/renderer/slices/background-agent-executor/utils/result-extraction';
import commitMessageInstruction from './instructions/background/commit-message';
import prDescriptionInstruction from './instructions/background/pr-description';
import codeReviewInstruction from './instructions/background/code-review';
import codeWalkthroughInstruction from './instructions/background/code-walkthrough';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('BackgroundExecutorService');

/** §5.32 daemon cap on `timeoutMs`; longer executor timeouts are clamped. */
const DAEMON_TIMEOUT_CAP_MS = 120_000;
/** Transport margin so the daemon's structured timeout error wins. */
const TRANSPORT_TIMEOUT_MARGIN_MS = 10_000;

/** System prompt per executor `agentType` (browser-safe templates). */
const INSTRUCTIONS_BY_AGENT_TYPE: Record<string, string> = {
  'commit-message': commitMessageInstruction,
  'pr-description': prDescriptionInstruction,
  'code-review': codeReviewInstruction,
  'code-walkthrough': codeWalkthroughInstruction,
};

/** §5.32 result envelope: text, or the provider-neutral unavailable gate. */
type CompleteOnceResult = { text?: unknown } | { available: false; reason?: unknown };

function isUnavailable(result: CompleteOnceResult): result is { available: false; reason?: unknown } {
  return 'available' in result && result.available === false;
}

/**
 * Per-(workspace, executor) run generation. Execute bumps it and captures
 * the value; cancel (or a newer execute) bumps it again so the stale run's
 * response is discarded instead of dispatched.
 */
const runGenerations = new Map<string, number>();

function generationKey(workspaceId: string, executorType: string): string {
  return `${workspaceId}:${executorType}`;
}

function bumpGeneration(workspaceId: string, executorType: string): number {
  const key = generationKey(workspaceId, executorType);
  const next = (runGenerations.get(key) ?? 0) + 1;
  runGenerations.set(key, next);
  return next;
}

function isCurrentGeneration(
  workspaceId: string,
  executorType: string,
  generation: number,
): boolean {
  return runGenerations.get(generationKey(workspaceId, executorType)) === generation;
}

/** Lazily pull the toast lib so this middleware-reachable module stays light. */
let toastPromise: Promise<(typeof import('svelte-sonner'))['toast']> | null = null;
function getToast() {
  if (!toastPromise) toastPromise = import('svelte-sonner').then((module) => module.toast);
  return toastPromise;
}

async function showErrorToast(message: string, description: string): Promise<void> {
  try {
    const toast = await getToast();
    toast.error(message, { description, duration: 5000 });
  } catch (error) {
    logger.warn('Failed to show background-executor toast', { error });
  }
}

/**
 * Lazily load the selector modules (they evaluate `store.createSelector` at
 * import, which must not run during middleware-chain construction).
 */
async function loadSelectorDeps() {
  const [wsSel, bgSel] = await Promise.all([
    import('$store/renderer/slices/workspace/workspace-selectors'),
    import('$store/renderer/slices/background-agent-settings/background-agent-settings-selectors'),
  ]);
  return {
    selectWorkspaceById: wsSel.selectWorkspaceById,
    selectModelForType: bgSel.selectModelForType,
  };
}

/**
 * Executor types map onto the background-agent settings types where one
 * exists ('commit-merge' shares the commit model); unmapped types (e.g.
 * 'walkthrough') fall through to the settings default model.
 */
const SETTINGS_TYPE_MAP: Record<string, BackgroundAgentType> = { 'commit-merge': 'commit' };

function updateExecutor(
  workspaceId: string,
  executorType: string,
  updates: Parameters<typeof setExecutorState>[2],
): void {
  appStore.dispatch(setExecutorState(workspaceId, executorType, updates));
}

async function handleExecute(
  workspaceId: string,
  executorType: string,
  context?: Parameters<typeof executeBackgroundAgent>[2],
): Promise<void> {
  const config = EXECUTOR_CONFIGS[executorType];
  if (!config) {
    logger.error(`Unknown executor type: ${executorType}`);
    return;
  }

  const generation = bumpGeneration(workspaceId, executorType);

  updateExecutor(workspaceId, executorType, {
    status: 'initializing',
    result: null,
    error: null,
    progress: 0,
    agentId: null,
    workspaceId,
    executionContext: context ?? null,
  });

  try {
    const { selectWorkspaceById, selectModelForType } = await loadSelectorDeps();

    const workspace = selectWorkspaceById.select(appStore.state, workspaceId);
    if (!workspace) {
      // i18n-ignore (internal diagnostic, surfaced via localized toast title)
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    // Effective model for this executor type ('' → omit, provider default).
    const settingsType = SETTINGS_TYPE_MAP[executorType] ?? (executorType as BackgroundAgentType);
    const model = selectModelForType.select(appStore.state, settingsType);

    const systemPrompt = INSTRUCTIONS_BY_AGENT_TYPE[config.agentType];
    const prompt = await prepareContext(workspace, executorType, config.resultTag, context);
    if (!isCurrentGeneration(workspaceId, executorType, generation)) return;

    updateExecutor(workspaceId, executorType, { status: 'running', progress: 20 });

    const timeoutMs = Math.min(config.timeout, DAEMON_TIMEOUT_CAP_MS);
    const params: Record<string, unknown> = { prompt, workspaceId, timeoutMs };
    if (systemPrompt) params.systemPrompt = systemPrompt;
    if (model) params.model = model;

    const response = await backendRequest<CompleteOnceResult>('agent.completeOnce', params, {
      timeoutMs: timeoutMs + TRANSPORT_TIMEOUT_MARGIN_MS,
    });
    if (!isCurrentGeneration(workspaceId, executorType, generation)) return;

    if (isUnavailable(response)) {
      const reason =
        typeof response.reason === 'string' && response.reason.length > 0
          ? response.reason
          : m.bgExecutor_service_unavailable_error();
      updateExecutor(workspaceId, executorType, { status: 'error', error: reason, progress: 0 });
      void showErrorToast(m.bgExecutor_service_generateFailed_error(), reason);
      return;
    }

    const text = typeof response.text === 'string' ? response.text : '';
    // Walkthrough prompts request raw JSON (no tags) — extract untagged.
    const resultTag = executorType === 'walkthrough' ? undefined : config.resultTag;
    const { result, error: extractError } = extractResultFromText(text, resultTag);

    updateExecutor(workspaceId, executorType, {
      status: result ? 'success' : 'error',
      result,
      error: extractError ?? (result ? null : m.bgExecutor_service_noResult_error()),
      progress: 100,
    });
  } catch (error) {
    if (!isCurrentGeneration(workspaceId, executorType, generation)) return;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Background execution failed', { workspaceId, executorType, error });
    updateExecutor(workspaceId, executorType, { status: 'error', error: message, progress: 0 });
    void showErrorToast(m.bgExecutor_service_generateFailed_error(), message);
  }
}

function handleCancel(workspaceId: string, executorType: string): void {
  bumpGeneration(workspaceId, executorType);
  updateExecutor(workspaceId, executorType, { status: 'cancelled' });
}

/**
 * Middleware wiring `bgExecutor/execute` and `bgExecutor/cancel` to the
 * §5.32 one-shot completion pipeline. Observes actions after the reducer
 * runs (execute/cancel are pure triggers with no reducer case).
 */
export function createBackgroundExecutorMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === executeBackgroundAgent.type) {
      const [workspaceId, executorType, context] = (
        action as ReturnType<typeof executeBackgroundAgent>
      ).payload;
      void handleExecute(workspaceId, executorType, context);
    } else if (action && action.type === cancelExecution.type) {
      const [workspaceId, executorType] = (action as ReturnType<typeof cancelExecution>).payload;
      handleCancel(workspaceId, executorType);
    }
    return result;
  };
}
