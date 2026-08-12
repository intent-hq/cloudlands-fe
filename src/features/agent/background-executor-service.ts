/**
 * Background executor saga for the background-agent-executor triggers
 * (`bgExecutor/execute`, `bgExecutor/cancel`). Restores the Generate quick
 * actions (commit message, PR description, code review, walkthrough) as an
 * app-owned saga without changing any dispatch site.
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
 * The quick-action model is NOT resolved here: the call carries the `type`
 * hint and no `model`, so the daemon applies
 * `quickActions.typeOverrides[type]` → `quickActions.defaultModel` →
 * provider default (intentd#1012, monorepo#1743) as the single source of
 * truth.
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
 * Selector access uses selector `.effect()` inside the saga, and all state
 * updates are dispatched through saga effects. The toast lib remains lazy.
 */
import { all, call, cancelled, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { takeLatestInContext } from '$store/renderer/utils/context-saga-effects';
import {
  cancelExecution,
  executeBackgroundAgent,
  setExecutorState,
} from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';
import { EXECUTOR_CONFIGS } from '$store/renderer/slices/background-agent-executor/background-agent-executor-types';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { prepareContext } from '$store/renderer/slices/background-agent-executor/utils/context-preparation';
import {
  extractCommitResultFromText,
  extractPrResultFromText,
  extractResultFromText,
} from '$store/renderer/slices/background-agent-executor/utils/result-extraction';
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

function isUnavailable(
  result: CompleteOnceResult,
): result is { available: false; reason?: unknown } {
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
 * Wire `type` hint per executor type (§5.32). The daemon keys
 * `quickActions.typeOverrides` on it and falls back to
 * `quickActions.defaultModel` then the provider default (intentd#1012), so
 * an executor without an override key (e.g. 'walkthrough') simply misses the
 * map and resolves to the default. 'commit-merge' shares the commit model.
 */
const QUICK_ACTION_TYPE_MAP: Record<string, string> = { 'commit-merge': 'commit' };

function* handleExecute(
  workspaceId: string,
  executorType: string,
  context?: Parameters<typeof executeBackgroundAgent>[2],
): SagaGenerator<void> {
  const config = EXECUTOR_CONFIGS[executorType];
  if (!config) {
    logger.error(`Unknown executor type: ${executorType}`);
    return;
  }

  const generation = bumpGeneration(workspaceId, executorType);

  yield* put(
    setExecutorState(workspaceId, executorType, {
      status: 'initializing',
      result: null,
      error: null,
      progress: 0,
      agentId: null,
      workspaceId,
      executionContext: context ?? null,
    }),
  );

  try {
    const workspace = yield* selectWorkspaceById.effect(workspaceId);
    if (!workspace) {
      // i18n-ignore (internal diagnostic, surfaced via localized toast title)
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    // Quick-action `type` hint; the daemon resolves the model from it.
    const quickActionType = QUICK_ACTION_TYPE_MAP[executorType] ?? executorType;

    const systemPrompt = INSTRUCTIONS_BY_AGENT_TYPE[config.agentType];
    const prompt = yield* call(prepareContext, workspace, executorType, config.resultTag, context);
    if (!isCurrentGeneration(workspaceId, executorType, generation)) return;

    yield* put(setExecutorState(workspaceId, executorType, { status: 'running', progress: 20 }));

    const timeoutMs = Math.min(config.timeout, DAEMON_TIMEOUT_CAP_MS);
    const params: Record<string, unknown> = {
      prompt,
      workspaceId,
      timeoutMs,
      type: quickActionType,
    };
    if (systemPrompt) params.systemPrompt = systemPrompt;

    const response: CompleteOnceResult = yield* call(
      backendRequest<CompleteOnceResult>,
      'agent.completeOnce',
      params,
      { timeoutMs: timeoutMs + TRANSPORT_TIMEOUT_MARGIN_MS },
    );
    if (!isCurrentGeneration(workspaceId, executorType, generation)) return;

    if (isUnavailable(response)) {
      const reason =
        typeof response.reason === 'string' && response.reason.length > 0
          ? response.reason
          : m.bgExecutor_service_unavailable_error();
      yield* put(
        setExecutorState(workspaceId, executorType, {
          status: 'error',
          error: reason,
          progress: 0,
        }),
      );
      yield* fork(showErrorToast, m.bgExecutor_service_generateFailed_error(), reason);
      return;
    }

    const text = typeof response.text === 'string' ? response.text : '';
    const { result, error: extractError } = extractExecutorResult(
      executorType,
      config.resultTag,
      text,
    );

    yield* put(
      setExecutorState(workspaceId, executorType, {
        status: result ? 'success' : 'error',
        result,
        error: extractError ?? (result ? null : m.bgExecutor_service_noResult_error()),
        progress: 100,
      }),
    );
  } catch (error) {
    if (!isCurrentGeneration(workspaceId, executorType, generation)) return;
    const message = executionErrorMessage(error);
    logger.error('Background execution failed', { workspaceId, executorType, error });
    yield* put(
      setExecutorState(workspaceId, executorType, { status: 'error', error: message, progress: 0 }),
    );
    yield* fork(showErrorToast, m.bgExecutor_service_generateFailed_error(), message);
  } finally {
    if ((yield* cancelled()) && isCurrentGeneration(workspaceId, executorType, generation)) {
      bumpGeneration(workspaceId, executorType);
      yield* put(setExecutorState(workspaceId, executorType, { status: 'cancelled' }));
    }
  }
}

/**
 * Extract the executor result from the completion text. Commit and PR
 * executors use JSON contracts ({"subject", "body"?} / {"title", "body"})
 * formatted back into the legacy downstream shapes (`subject\n\nbody`,
 * `# {title}\n\n{body}`) so consumers are unchanged. Review keeps its
 * <<<CODE_REVIEW>>> tag contract, and walkthrough prompts request raw JSON
 * (no tags, no `resultTag` config) — extract untagged.
 */
function extractExecutorResult(
  executorType: string,
  resultTag: string | undefined,
  text: string,
): { result: string | null; error: string | null } {
  if (executorType === 'commit' || executorType === 'commit-merge') {
    return extractCommitResultFromText(text);
  }
  if (executorType === 'pr') return extractPrResultFromText(text);
  return extractResultFromText(text, resultTag);
}

/**
 * Human-readable message for a failed execution. The daemon maps internal
 * failures to JSON-RPC -32603 with the generic message "Internal error" and
 * the actionable cause (e.g. "<providerId>: …", "…timed out after <n>ms";
 * PROTOCOL §5.32 Errors) in `error.data`, which the transports normalize onto
 * `BackendError.data.detail` (json-rpc-errors.ts / browser-websocket-
 * transport.ts). Prefer that detail so the error state and toast never show a
 * bare "Internal error"; fall back to `message` when no detail is carried.
 */
function executionErrorMessage(error: unknown): string {
  if (error instanceof BackendError && error.rpcCode === -32603) {
    const data = error.data;
    if (typeof data === 'string' && data.length > 0) return data;
    if (data && typeof data === 'object') {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.length > 0) return detail;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function* executeBackgroundAgentWorker(
  action: ReturnType<typeof executeBackgroundAgent>,
): SagaGenerator<void> {
  const [workspaceId, executorType, context] = action.payload;
  yield* call(handleExecute, workspaceId, executorType, context);
}

function* cancelExecutionWorker(action: ReturnType<typeof cancelExecution>): SagaGenerator<void> {
  const [workspaceId, executorType] = action.payload;
  bumpGeneration(workspaceId, executorType);
  yield* put(setExecutorState(workspaceId, executorType, { status: 'cancelled' }));
}

/** Owns background executor work under the app saga lifecycle. */
export function* backgroundExecutorSaga(): SagaGenerator<void> {
  yield* all([
    takeLatestInContext(
      executeBackgroundAgent,
      (action) => generationKey(action.payload[0], action.payload[1]),
      executeBackgroundAgentWorker,
    ),
    takeEvery(cancelExecution, cancelExecutionWorker),
  ]);
}
