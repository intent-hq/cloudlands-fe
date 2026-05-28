/**
 * Background Agent Executor Redux module
 *
 * Manages background agent execution state and lifecycle for:
 * - Commit message generation
 * - PR description generation
 * - Code review
 * - Code walkthrough
 */

// Slice
export {
  backgroundAgentExecutorReducer,
  initialState as backgroundAgentExecutorInitialState,
  // Saga trigger actions
  executeBackgroundAgent,
  cancelExecution,
  reconnectAgent,
  // Reducer actions
  setExecutorState,
  resetExecutor,
  clearWorkspaceExecutors,
  hydrateBgExecutorState,
  requestPersistBgExecutor,
  persistBgExecutor,
  BG_EXECUTOR_STORAGE_KEY_PREFIX,
  BG_EXECUTOR_SAVE_DEBOUNCE_MS,
} from './background-agent-executor-slice';

// Types
export type {
  ExecutorStatus,
  BackgroundExecutorType,
  AgentExecutorContext,
  ExecutorInstanceState,
  BackgroundAgentConfig,
  ResultContext,
  BackgroundAgentExecutorState,
} from './background-agent-executor-types';

export {
  emptyExecutorState,
  EXECUTOR_CONFIGS,
} from './background-agent-executor-types';

// Selectors
export {
  selectExecutorState,
  selectExecutorStatus,
  selectExecutorResult,
  selectExecutorError,
  selectExecutorProgress,
  selectExecutorAgentId,
  selectExecutorIsRunning,
  selectExecutorIsComplete,
} from './background-agent-executor-selectors';

// Saga
export { backgroundAgentExecutorSaga } from './sagas/background-agent-executor-saga';

// Utils
export { prepareContext, formatDiffChunks } from './utils/context-preparation';
export { extractResultFromMessages, cleanModelFallbackMessages } from './utils/result-extraction';

