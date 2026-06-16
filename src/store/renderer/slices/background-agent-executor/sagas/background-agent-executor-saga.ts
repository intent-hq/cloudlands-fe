/**
 * Background Agent Executor Saga
 *
 * Manages the full lifecycle of background agent executions:
 * - Agent creation and configuration
 * - Model validation and fallback
 * - Agent state subscription and monitoring
 * - Result extraction
 * - Toast notifications
 * - Cleanup
 */

import {
  call,
  put,
  takeEvery,
  delay,
  race,
  take,
  fork,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  type EventChannel,
} from 'redux-saga';
import {
  createChannelFromSelector,
  type SelectorChannelPayload,
} from 'ag-redux-toolkit/saga';

import { agentFactory } from '$features/agent/services/agent-factory';
import { sendMessage } from '$features/agent/agent-stream-lifecycle';
import { createLogger } from '$lib/utils/client-logger';
import {
  getValidatedModelForType,
  type BackgroundAgentType,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  selectBgDefaultModel,
  selectBgTypeOverrides,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
import { loadModels } from '$store/renderer/slices/model/model-slice';
import { getGroupedModels } from '$store/renderer/slices/model/model-utils';
import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import {
  getModelLabel,
  generateFallbackChain,
} from '$lib/utils/model-fallback';
import { track } from '$lib/services/analytics';
import { deleteAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  selectAvailableModels,
  selectIsLoadingModels,
  selectModelsLoaded,
} from '$store/renderer/slices/model/model-selectors';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';

import {
  selectAgentIsRunning,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  AgentStatus,
  type AgentSession,
} from '$shared/types';
import type { AgentMessage } from '$shared/types/agent.types';
import {
  removeLocalStorageItem,
  setLocalStorageJSON,
  getLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import { debounceWithKeySaga } from 'ag-redux-toolkit/utils/sagas/debounce-saga';
import { workspaceMounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceId } from '$shared/types/branded-ids';

import {
  executeBackgroundAgent,
  cancelExecution,
  reconnectAgent,
  setExecutorState,
  resetExecutor,
  hydrateBgExecutorState,
  requestPersistBgExecutor,
  persistBgExecutor,
  clearWorkspaceExecutors,
  BG_EXECUTOR_STORAGE_KEY_PREFIX,
  BG_EXECUTOR_SAVE_DEBOUNCE_MS,
} from '../background-agent-executor-slice';
import type {
  BackgroundExecutorType,
  AgentExecutorContext,
  ExecutorInstanceState,
  ExecutorStatus,
  BackgroundAgentExecutorWorkspaceState,
} from '../background-agent-executor-types';
import {
  EXECUTOR_CONFIGS,
  emptyExecutorState,
} from '../background-agent-executor-types';
import { selectExecutorState } from '../background-agent-executor-selectors';
import { prepareContext } from '../utils/context-preparation';
import { extractResultFromMessages } from '../utils/result-extraction';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';

const logger = createLogger('BgExecutorSaga');

// ============================================================================
// Toast helper (imported dynamically to avoid SSR issues)
// ============================================================================

function showErrorToast(message: string, description: string, duration = 5000): Promise<void> {
  return import('svelte-sonner').then(({ toast }) => {
    toast.error(message, { description, duration } as any);
  });
}

function showWarningToast(message: string, description: string, duration = 5000): Promise<void> {
  return import('svelte-sonner').then(({ toast }) => {
    toast.warning(message, { description, duration } as any);
  });
}

// ============================================================================
// Model loading helper
// ============================================================================

function* ensureModelsLoaded(): SagaGenerator<void> {
  const activeProviderId = yield* selectActiveProviderId.effect();
  let availableModels = yield* selectAvailableModels.effect();
  let modelsLoaded = yield* selectModelsLoaded.effect(activeProviderId);
  const isLoadingModels = yield* selectIsLoadingModels.effect(activeProviderId);

  if (modelsLoaded && availableModels.length > 0) {
    return;
  }

  if (!isLoadingModels) {
    yield* put(loadModels());
  }

  // Wait up to 5s for models
  const startTime = Date.now();
  while (!modelsLoaded || availableModels.length === 0) {
    if (Date.now() - startTime > 5000) {
      logger.warn('Timeout waiting for models to load');
      break;
    }
    yield* delay(100);
    availableModels = yield* selectAvailableModels.effect();
    modelsLoaded = yield* selectModelsLoaded.effect(activeProviderId);
  }
}

// ============================================================================
// Agent state change channel
// ============================================================================

function getMessagesWithIdleSummaryFallback(
  session: AgentSession,
  includeFallback: boolean,
  resultTag?: string,
): AgentMessage[] {
  const messages = [...(session.messages ?? [])];
  if (!includeFallback || messages.some((message) => message.role === 'assistant')) {
    return messages;
  }

  const fallbackText = typeof session.lastAgentResponse === 'string'
    ? session.lastAgentResponse.trim()
    : '';
  if (!fallbackText) return messages;
  if (
    !resultTag ||
    !fallbackText.includes(`<<<${resultTag}>>>`) ||
    !fallbackText.includes(`<<<\/${resultTag}>>>`)
  ) {
    return messages;
  }

  const timestamp = typeof session.updatedAt === 'string'
    ? session.updatedAt
    : typeof session.createdAt === 'string'
      ? session.createdAt
      : '1970-01-01T00:00:00.000Z';

  return [
    ...messages,
    {
      id: `${String(session.id)}-idle-summary`,
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: fallbackText }],
      timestamp,
      streamingComplete: true,
      isStreaming: false,
    } as AgentMessage,
  ];
}

type AgentStateEvent = {
  messages: AgentMessage[];
  isComplete: boolean;
  isError: boolean;
  isStreaming: boolean;
};

function getAgentStateEvent(
  session: AgentSession,
  isRunning: boolean,
  resultTag?: string,
): AgentStateEvent {
  const messages = getMessagesWithIdleSummaryFallback(session, !isRunning, resultTag);

  if (session.status === AgentStatus.Error) {
    return { messages, isComplete: false, isError: true, isStreaming: false };
  }

  if (!isRunning && messages.length > 0) {
    return { messages, isComplete: true, isError: false, isStreaming: false };
  }

  return { messages, isComplete: false, isError: false, isStreaming: isRunning };
}

export function* createAgentStateChannel(
  agentId: string,
  workspaceId: string,
): SagaGenerator<EventChannel<SelectorChannelPayload<AgentSession | undefined>>> {
  void workspaceId;
  return yield* createChannelFromSelector(selectAgentSession, agentId);
}

// ============================================================================
// Execute handler
// ============================================================================

function* handleExecute(action: ReturnType<typeof executeBackgroundAgent>): SagaGenerator<void> {
  const [workspaceId, executorType, context] = action.payload;
  const config = EXECUTOR_CONFIGS[executorType];
  if (!config) {
    logger.error(`Unknown executor type: ${executorType}`);
    return;
  }

  // Set initializing
  yield* put(setExecutorState(workspaceId, executorType, {
    status: 'initializing',
    result: null,
    error: null,
    progress: 0,
    agentId: null,
    workspaceId,
    executionContext: context ?? null,
  }));

  try {
    // Delete previous agent if exists
    const prevState = yield* selectExecutorState.effect(workspaceId, executorType);
    if (prevState?.agentId && prevState?.workspaceId) {
      try {
        const deleteAction = deleteAgentSessionRequested(prevState.workspaceId, prevState.agentId);
        yield* put(deleteAction);
        yield* call(() => deleteAction.promise);
      } catch (e) {
        logger.warn('Failed to delete previous agent', { error: e });
      }
    }

    // Get workspace
    const workspace = yield* selectWorkspaceById.effect(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    // Ensure models loaded
    yield* call(ensureModelsLoaded);

    // Get agent type from config
    const agentType = config.agentType;
    if (!agentType) throw new Error(`Unknown executor type: ${executorType}`);

    // Validate model
    const activeProviderId = yield* selectActiveProviderId.effect();
    const providerAvailableModels = yield* selectAvailableModels.effect();
    const groupedModels = getGroupedModels(activeProviderId, providerAvailableModels);
    const flattenedModels = groupedModels.flatMap((group: any) => group.models);
    const availableModels = flattenedModels.length > 0 ? flattenedModels : providerAvailableModels;
    const defaultModel = yield* selectBgDefaultModel.effect();
    const typeOverrides = yield* selectBgTypeOverrides.effect();
    // Map executor types to background agent setting types (e.g., 'commit-merge' → 'commit')
    const settingsTypeMap: Record<string, BackgroundAgentType> = { 'commit-merge': 'commit' };
    const settingsType = (settingsTypeMap[executorType] || executorType) as BackgroundAgentType;
    const modelResult = getValidatedModelForType(
      settingsType,
      defaultModel,
      typeOverrides,
      availableModels,
    );

    const fallbackChain = generateFallbackChain(availableModels);

    if (modelResult.model === null) {
      const errorMessage = modelResult.fallbackReason || 'No models available';
      yield* call(showErrorToast, 'Cannot start agent', errorMessage);
      throw new Error(errorMessage);
    }

    if (modelResult.usedFallback) {
      const fallbackLabel = getModelLabel(modelResult.model, availableModels);
      const requestedLabel = getModelLabel(modelResult.requestedModel, availableModels);
      yield* call(showWarningToast, 'Model not available',
        `${requestedLabel} is not available. Using ${fallbackLabel} instead.`);
    }

    // Create agent through the saga-owned factory path.
    const creationResult: Awaited<ReturnType<typeof agentFactory.createAgent>> = yield* call(
      [agentFactory, agentFactory.createAgent],
      workspace,
      {
        name: config.name,
        model: modelResult.model,
        workspaceId: WorkspaceId(workspaceId),
        agentType: agentType as any,
        source: 'background-agent',
        metadata: {
          isBackground: true,
          triggerType: executorType,
          resultTag: config.resultTag,
          modelFallbackChain: fallbackChain,
        },
        isBackground: true,
      },
    );

    const agent = creationResult.agent;

    if (!creationResult.success || !agent) {
      throw new Error(creationResult.error || 'Failed to create agent');
    }

    yield* put(setExecutorState(workspaceId, executorType, {
      status: 'running',
      agentId: agent.id,
      progress: 10,
    }));

    // Prepare and send context message
    const contextMessage = yield* call(prepareContext, workspace, executorType, config.resultTag, context);
    yield* call(sendMessage, agent.id, contextMessage, workspace);

    yield* put(setExecutorState(workspaceId, executorType, { progress: 20 }));

    // Monitor agent completion
    yield* call(monitorAgent, workspaceId, executorType, agent.id, config.resultTag, config.timeout);
  } catch (error: any) {
    logger.error('Background agent execution failed', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    yield* put(setExecutorState(workspaceId, executorType, {
      status: 'error',
      error: errorMessage,
      progress: 0,
    }));

    // Show error toast
    yield* call(handleErrorToast, errorMessage, executorType);

    track('Agent Errored', {
      agent_id: '',
      agent_name: `Background Agent (${executorType})`,
      error_type: 'background_agent_error',
    });
  }
}

// ============================================================================
// Monitor agent completion
// ============================================================================

function* monitorAgent(
  workspaceId: string,
  executorType: string,
  agentId: string,
  resultTag: string,
  timeout: number,
): SagaGenerator<void> {
  const channel = yield* createAgentStateChannel(agentId, workspaceId);

  try {
    const { completed } = yield* race({
      completed: call(function* (): SagaGenerator<boolean> {
        const initialSession = yield* selectAgentSession.effect(agentId);
        if (initialSession) {
          const initialHandled = yield* call(
            handleAgentStateEvent,
            workspaceId,
            executorType,
            agentId,
            resultTag,
            initialSession,
          );
          if (initialHandled) return true;
        }

        while (true) {
          const { payload: session } = yield* take(channel);
          if (!session) continue;
          const handled = yield* call(
            handleAgentStateEvent,
            workspaceId,
            executorType,
            agentId,
            resultTag,
            session,
          );
          if (handled) return true;
        }
      }),
      timedOut: delay(timeout),
    });

    if (!completed) {
      logger.warn('Background agent execution timed out');
      yield* put(setExecutorState(workspaceId, executorType, {
        status: 'error',
        error: 'Execution timed out',
      }));
      yield* call(showErrorToast, 'Request timed out',
        'The request took too long. Please try again.');
    }
  } finally {
    channel.close();
  }
}

function* handleAgentStateEvent(
  workspaceId: string,
  executorType: string,
  agentId: string,
  resultTag: string,
  session: AgentSession,
): SagaGenerator<boolean> {
  const isRunning = yield* selectAgentIsRunning.effect(agentId);
  const { messages, isComplete, isError } = getAgentStateEvent(session, isRunning, resultTag);

  // Try to extract result from current messages
  const { result } = extractResultFromMessages(messages, resultTag, undefined, false);
  if (result) {
    yield* put(setExecutorState(workspaceId, executorType, { progress: 90 }));
  }

  if (isComplete) {
    // Final extraction with forceExtract
    const { result: finalResult, error: extractError } =
      extractResultFromMessages(messages, resultTag, undefined, true);

    yield* put(setExecutorState(workspaceId, executorType, {
      status: finalResult ? 'success' : 'error',
      result: finalResult,
      error: extractError || (finalResult ? null : 'No result extracted from agent response'),
      progress: 100,
    }));

    return true;
  }

  if (isError) {
    yield* put(setExecutorState(workspaceId, executorType, {
      status: 'error',
      error: 'Agent encountered an error',
      progress: 0,
    }));
    return true;
  }

  // Update progress while running
  const execState = yield* selectExecutorState.effect(workspaceId, executorType);
  const currentProgress = execState?.progress ?? 20;
  if (currentProgress < 80) {
    yield* put(setExecutorState(workspaceId, executorType, {
      progress: Math.min(80, currentProgress + 5),
    }));
  }

  return false;
}

// ============================================================================
// Cancel handler
// ============================================================================

function* handleCancel(action: ReturnType<typeof cancelExecution>): SagaGenerator<void> {
  const [workspaceId, executorType] = action.payload;
  yield* put(setExecutorState(workspaceId, executorType, { status: 'cancelled' }));
}

// ============================================================================
// Reconnect handler
// ============================================================================

function* handleReconnect(action: ReturnType<typeof reconnectAgent>): SagaGenerator<void> {
  const [workspaceId, executorType, agentId, savedState] = action.payload;

  // If we have a completed result, just restore it
  if (savedState?.result && (savedState.status === 'success' || savedState.status === 'error')) {
    yield* put(setExecutorState(workspaceId, executorType, {
      agentId,
      workspaceId,
      result: savedState.result,
      status: savedState.status,
      progress: 100,
    }));
    return;
  }

  // Check if agent exists and is still running via Redux
  const agentSession = yield* selectAgentSession.effect(agentId);
  if (!agentSession) return;

  if (yield* selectAgentIsRunning.effect(agentId)) {
    yield* put(setExecutorState(workspaceId, executorType, {
      status: 'running',
      agentId,
      workspaceId,
      progress: 50,
    }));

    const config = EXECUTOR_CONFIGS[executorType as BackgroundExecutorType];
    if (config) {
      yield* call(monitorAgent, workspaceId, executorType, agentId, config.resultTag, config.timeout);
    }
  } else {
    // Agent already finished, extract result
    const config = EXECUTOR_CONFIGS[executorType as BackgroundExecutorType];
    const messages = getMessagesWithIdleSummaryFallback(
      agentSession,
      true,
      config?.resultTag,
    );
    const { result } = extractResultFromMessages(messages, config?.resultTag, undefined, true);

    yield* put(setExecutorState(workspaceId, executorType, {
      agentId,
      workspaceId,
      result,
      status: result ? 'success' : 'idle',
      progress: result ? 100 : 0,
    }));
  }
}

// ============================================================================
// Error toast helper
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function* handleErrorToast(errorMessage: string, executorType: string): SagaGenerator<void> {
  const toastMessage = 'Failed to generate';
  const toastDescription = errorMessage;

  const isModelsExhausted =
    errorMessage.includes('No available models') ||
    errorMessage.includes('all models exhausted') ||
    errorMessage.includes('All models unavailable');

  if (isModelsExhausted) return;

  if (errorMessage.includes('No files are staged') || errorMessage.includes('Unable to get git status')) {
    yield* call(showErrorToast, toastMessage, toastDescription);
  } else if (errorMessage.includes('404') || errorMessage.includes('Not Found') || errorMessage.includes('model not available')) {
    yield* call(showErrorToast, 'Model not available',
      'The selected model is not available. Please check your background agent settings.');
  } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    yield* call(showErrorToast, 'Request timed out',
      'The request took too long. Please try again.');
  } else {
    yield* call(showErrorToast, toastMessage, toastDescription);
  }
}

// ============================================================================
// Persistence helpers
// ============================================================================

function getBgExecutorStorageKey(workspaceId: string): string {
  return `${BG_EXECUTOR_STORAGE_KEY_PREFIX}${workspaceId}`;
}

function isEmptyExecutorInstanceState(executor: ExecutorInstanceState): boolean {
  return (
    executor.status === emptyExecutorState.status &&
    executor.result === emptyExecutorState.result &&
    executor.error === emptyExecutorState.error &&
    executor.progress === emptyExecutorState.progress &&
    executor.agentId === emptyExecutorState.agentId &&
    executor.workspaceId === emptyExecutorState.workspaceId &&
    executor.executionContext === emptyExecutorState.executionContext
  );
}

function* selectPersistableBgExecutorWorkspaceState(
  workspaceId: string,
): SagaGenerator<BackgroundAgentExecutorWorkspaceState | null> {
  const executors: Record<string, ExecutorInstanceState> = {};

  for (const executorType of Object.keys(EXECUTOR_CONFIGS)) {
    const executor = yield* selectExecutorState.effect(workspaceId, executorType);
    if (!isEmptyExecutorInstanceState(executor)) {
      executors[executorType] = executor;
    }
  }

  return Object.keys(executors).length > 0 ? { executors } : null;
}

/**
 * Sanitize persisted executor state — clear stale running/initializing statuses
 * that cannot be reconnected after a restart.
 */
function sanitizePersistedBgExecutorState(
  persisted: unknown,
): BackgroundAgentExecutorWorkspaceState | null {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    return null;
  }

  const record = persisted as Record<string, unknown>;
  const executors = record.executors;
  if (!executors || typeof executors !== 'object' || Array.isArray(executors)) {
    return null;
  }

  const sanitized: Record<string, ExecutorInstanceState> = {};

  for (const [key, value] of Object.entries(executors as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const exec = value as Record<string, unknown>;

    const status = exec.status as string;
    // Clear stale running/initializing — these can't be reconnected after restart
    if (status === 'running' || status === 'initializing') {
      sanitized[key] = {
        ...emptyExecutorState,
        // Preserve agentId so reconnect can pick it up
        agentId: typeof exec.agentId === 'string' ? exec.agentId : null,
        workspaceId: typeof exec.workspaceId === 'string' ? exec.workspaceId : null,
        status: 'idle',
      };
    } else {
      sanitized[key] = {
        status: (status ?? 'idle') as ExecutorStatus,
        result: typeof exec.result === 'string' ? exec.result : null,
        error: typeof exec.error === 'string' ? exec.error : null,
        progress: typeof exec.progress === 'number' ? exec.progress : 0,
        agentId: typeof exec.agentId === 'string' ? exec.agentId : null,
        workspaceId: typeof exec.workspaceId === 'string' ? exec.workspaceId : null,
        executionContext: (exec.executionContext as AgentExecutorContext) ?? null,
      };
    }
  }

  return { executors: sanitized };
}

function* persistBgExecutorWorkspaceState(
  workspaceId: string,
  workspaceState: BackgroundAgentExecutorWorkspaceState,
): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, getBgExecutorStorageKey(workspaceId), workspaceState);
}

export function* handlePersistBgExecutor(
  action: ReturnType<typeof persistBgExecutor>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const workspaceState = yield* call(selectPersistableBgExecutorWorkspaceState, workspaceId);

  if (!workspaceState) {
    yield* call(removeLocalStorageItem, getBgExecutorStorageKey(workspaceId));
    return;
  }

  yield* call(persistBgExecutorWorkspaceState, workspaceId, workspaceState);
}

export function* handleBgExecutorWorkspaceMounted(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const storageKey = getBgExecutorStorageKey(workspaceId);
  const persisted = yield* call(getLocalStorageJSON<unknown>, storageKey);

  if (persisted === undefined) {
    return;
  }

  const sanitized = sanitizePersistedBgExecutorState(persisted);
  if (!sanitized) {
    yield* call(removeLocalStorageItem, storageKey);
    return;
  }

  yield* put(hydrateBgExecutorState(workspaceId, sanitized));

  // If we sanitized (cleared stale running states), persist the cleaned version
  const originalSerialized = JSON.stringify(persisted);
  const sanitizedSerialized = JSON.stringify(sanitized);
  if (sanitizedSerialized !== originalSerialized) {
    yield* call(persistBgExecutorWorkspaceState, workspaceId, sanitized);
  }
}

export function* handleBgExecutorWorkspaceRemoved(
  action: ReturnType<typeof removeWorkspaceEntity>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* put(clearWorkspaceExecutors(workspaceId));
  yield* call(removeLocalStorageItem, getBgExecutorStorageKey(workspaceId));
}

export function* queueBgExecutorPersistence(
  action: { payload: [workspaceId: string, ...rest: unknown[]] },
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* put(requestPersistBgExecutor(persistBgExecutor(workspaceId)));
}

function getBgExecutorWorkspaceIdFromInnerAction(
  action: ReturnType<typeof persistBgExecutor>,
): string {
  return action.payload[0];
}

const BG_EXECUTOR_DEBOUNCED_PERSIST_ACTION_TYPES = [
  setExecutorState,
  resetExecutor,
  clearWorkspaceExecutors,
] as const;

// ============================================================================
// Root saga
// ============================================================================

export function* backgroundAgentExecutorSaga(): SagaGenerator<void> {
  yield* takeEvery(executeBackgroundAgent, handleExecute);
  yield* takeEvery(cancelExecution, handleCancel);
  yield* takeEvery(reconnectAgent, handleReconnect);

  // Persistence: hydrate on mount, persist on changes, cleanup on removal
  yield* takeEvery(workspaceMounted, handleBgExecutorWorkspaceMounted);
  yield* takeEvery(removeWorkspaceEntity, handleBgExecutorWorkspaceRemoved);

  for (const actionCreator of BG_EXECUTOR_DEBOUNCED_PERSIST_ACTION_TYPES) {
    yield* takeEvery(actionCreator, queueBgExecutorPersistence);
  }

  yield* takeEvery(persistBgExecutor, handlePersistBgExecutor);

  yield* fork(
    debounceWithKeySaga,
    requestPersistBgExecutor,
    BG_EXECUTOR_SAVE_DEBOUNCE_MS,
    getBgExecutorWorkspaceIdFromInnerAction,
  );
}

