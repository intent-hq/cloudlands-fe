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

import { call, put, takeEvery, delay, race, take, select, fork, type SagaGenerator } from 'typed-redux-saga';
import { eventChannel, END, type EventChannel } from 'redux-saga';
import type { StoreState } from '$lib/store/types';

import { agentService } from '$features/agent/agent-ipc-bridge';
import { createLogger } from '$lib/utils/client-logger';
import {
  getValidatedModelForType,
  type BackgroundAgentType,
} from '$lib/store/slices/background-agent-settings/background-agent-settings-slice';
import { loadModels } from '$lib/store/slices/model/model-slice';
import { getGroupedModels } from '$lib/store/slices/model/model-utils';
import { selectActiveProviderId } from '$lib/store/slices/provider-settings/provider-settings-selectors';
import { getModelLabel, generateFallbackChain } from '$lib/utils/model-fallback';
import { addDeferredResult } from '$features/agent/deferred-results-cache';
import { track } from '$lib/services/analytics';
import {
  selectAvailableModels,
  selectIsLoadingModels,
  selectModelsLoaded,
} from '$lib/store/slices/model/model-selectors';
import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
import { selectAgentById } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import { AgentStatus } from '$shared/types';
import type { AgentMessage } from '$shared/types/agent.types';
import { removeLocalStorageItem, setLocalStorageJSON, getLocalStorageJSON } from '$lib/store/utils/safe-local-storage-saga';
import { debounceWithKeySaga } from '$lib/store/utils/debounce-saga';
import { workspaceMounted } from '$lib/store/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '$lib/store/slices/workspace/workspace-slice';

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
import { EXECUTOR_CONFIGS, emptyExecutorState } from '../background-agent-executor-types';
import { selectExecutorState } from '../background-agent-executor-selectors';
import { prepareContext } from '../utils/context-preparation';
import { extractResultFromMessages } from '../utils/result-extraction';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';

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

function createAgentStateChannel(
  agentId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  workspaceId: string,
): EventChannel<{ messages: AgentMessage[]; isComplete: boolean; isError: boolean; isStreaming: boolean }> {
  return eventChannel((emitter) => {
    let wasStreaming = false;
    let noNewMessageTimer: ReturnType<typeof setTimeout> | null = null;
    let lastMessageCount = 0;

    const processUpdate = () => {
      const state = getReduxStore().getState();
      const session = selectAgentById.select(state, agentId);
      if (!session) return;

      const messages = [...(session.messages ?? [])];
      const isStreaming = !!session.isStreaming;

      if (isStreaming) {
        wasStreaming = true;
        if (noNewMessageTimer) { clearTimeout(noNewMessageTimer); noNewMessageTimer = null; }
      }

      if (messages.length > lastMessageCount) {
        lastMessageCount = messages.length;
        if (noNewMessageTimer) clearTimeout(noNewMessageTimer);
        noNewMessageTimer = setTimeout(() => {
          const currentState = getReduxStore().getState();
          const currentSession = selectAgentById.select(currentState, agentId);
          const isStillActive = currentSession?.isStreaming || currentSession?.isProcessing;
          if (!isStillActive) {
            emitter({ messages, isComplete: true, isError: false, isStreaming: false });
            emitter(END);
          }
        }, 3000);
      }

      const completionReasons = {
        idleWithMessages: session.status === AgentStatus.Idle && messages.length > 0,
        statusCompleted: session.status === AgentStatus.Completed,
        streamingStopped: wasStreaming && !isStreaming && !session.isProcessing && messages.length > 0,
      };
      const isComplete = Object.values(completionReasons).some(Boolean);

      if (isComplete) {
        if (noNewMessageTimer) { clearTimeout(noNewMessageTimer); noNewMessageTimer = null; }
        emitter({ messages, isComplete: true, isError: false, isStreaming: false });
        emitter(END);
      } else if (session.status === AgentStatus.Error) {
        if (noNewMessageTimer) { clearTimeout(noNewMessageTimer); noNewMessageTimer = null; }
        emitter({ messages, isComplete: false, isError: true, isStreaming: false });
        emitter(END);
      } else {
        emitter({ messages, isComplete: false, isError: false, isStreaming });
      }
    };

    // Subscribe to Redux store changes for agent state updates
    const store = getReduxStore();
    let previousSession = selectAgentById.select(store.getState(), agentId);

    const unsubscribe = store.subscribe(() => {
      const currentSession = selectAgentById.select(store.getState(), agentId);
      if (currentSession !== previousSession) {
        previousSession = currentSession;
        processUpdate();
      }
    });

    // Initial check
    processUpdate();

    return () => {
      unsubscribe();
      if (noNewMessageTimer) clearTimeout(noNewMessageTimer);
    };
  });
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
        yield* call([agentService, agentService.deleteSession], prevState.agentId, prevState.workspaceId);
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
    const bgState = (getReduxStore().getState() as StoreState).backgroundAgentSettings;
    // Map executor types to background agent setting types (e.g., 'commit-merge' → 'commit')
    const settingsTypeMap: Record<string, string> = { 'commit-merge': 'commit' };
    const settingsType = (settingsTypeMap[executorType] || executorType) as BackgroundAgentType;
    const modelResult = getValidatedModelForType(
      settingsType,
      bgState.defaultModel,
      bgState.typeOverrides,
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

    // Create agent
    const agent = yield* call([agentService, agentService.createAgent], workspace, {
      name: config.name,
      model: modelResult.model,
      agentType: agentType as any,
      metadata: {
        isBackground: true,
        triggerType: executorType,
        resultTag: config.resultTag,
        modelFallbackChain: fallbackChain,
      },
      isBackground: true,
    });

    if (!agent) throw new Error('Failed to create agent');

    yield* put(setExecutorState(workspaceId, executorType, {
      status: 'running',
      agentId: agent.id,
      progress: 10,
    }));

    // Prepare and send context message
    const contextMessage = yield* call(prepareContext, workspace, executorType, config.resultTag, context);
    yield* call([agentService, agentService.sendMessage], agent.id, contextMessage, workspace);

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
  const channel = createAgentStateChannel(agentId, workspaceId);

  try {
    const { completed } = yield* race({
      completed: call(function* (): SagaGenerator<boolean> {
        while (true) {
          const event = yield* take(channel);
          if (!event) return false;

          const { messages, isComplete, isError } = event as any;

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

            // Handle cross-workspace deferred results
            if (finalResult) {
              const currentWorkspaceId = yield* selectActiveWorkspaceId.effect();
              if (currentWorkspaceId !== workspaceId) {
                addDeferredResult(workspaceId, finalResult, executorType as BackgroundAgentType);
              }
            }
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
  const agentSession = yield* selectAgentById.effect(agentId);
  if (!agentSession) return;

  if (agentSession.isStreaming || agentSession.isProcessing) {
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
    const messages = [...(agentSession.messages ?? [])];
    const config = EXECUTOR_CONFIGS[executorType as BackgroundExecutorType];
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

function selectBgExecutorWorkspaceState(state: StoreState, workspaceId: string) {
  return state.bgExecutor?.byWorkspaceId[workspaceId] ?? null;
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
  const workspaceState = yield* select(selectBgExecutorWorkspaceState, workspaceId);

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

