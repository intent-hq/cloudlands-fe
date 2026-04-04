/**
 * useBackgroundAgent Hook
 *
 * A Svelte 5 composable for easily using background agents in components.
 * Provides reactive state and simple API for executing background agents.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useBackgroundAgent } from '$lib/hooks/use-background-agent.svelte';
 *
 *   const commitAgent = useBackgroundAgent('commit', {
 *     resultTag: 'COMMIT_MESSAGE',
 *     onResult: (message) => {
 *       commitMessage = message;
 *     }
 *   });
 * </script>
 *
 * <button onclick={() => commitAgent.execute(workspace)}>
 *   {#if commitAgent.isRunning}
 *     Generating... ({commitAgent.progress}%)
 *   {:else}
 *     Generate Commit Message
 *   {/if}
 * </button>
 *
 * {#if commitAgent.result}
 *   <div>{commitAgent.result}</div>
 * {/if}
 * ```
 */

import {
  executeBackgroundAgent,
  cancelExecution,
  resetExecutor,
} from '$lib/store/slices/background-agent-executor/background-agent-executor-slice';
import type { AgentExecutorContext } from '$lib/store/slices/background-agent-executor/background-agent-executor-types';
import type { ExecutorStatus } from '$lib/store/slices/background-agent-executor/background-agent-executor-types';
import { getDispatch } from '$lib/store/utils/utils';
import type { Workspace } from '$shared/types';

export interface UseBackgroundAgentOptions {
  autoExecute?: boolean; // Execute immediately when workspace is available
  workspace?: Workspace; // Workspace to use for auto-execution
  onResult?: (result: string) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: ExecutorStatus) => void;
  resultTag?: string;
  timeout?: number;
}

export interface UseBackgroundAgentReturn {
  // Methods only — reactive state must be read via selectors in the consuming component
  execute: (workspace: Workspace, context?: AgentExecutorContext) => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Create a reactive background agent hook backed by Redux
 */
export function useBackgroundAgent(
  type: string,
  options: UseBackgroundAgentOptions = {},
): UseBackgroundAgentReturn {
  const { autoExecute, workspace: initialWorkspace } = options;
  const dispatch = getDispatch();

  // We need a workspaceId to scope the selector. Use provided workspace or empty.
  const wsId = initialWorkspace?.id ?? '';

  // Auto-execute if requested
  if (autoExecute && initialWorkspace) {
    dispatch(executeBackgroundAgent(initialWorkspace.id, type));
  }

  return {
    execute: (workspace: Workspace, context?: AgentExecutorContext) => {
      dispatch(executeBackgroundAgent(workspace.id, type, context));
    },
    cancel: () => {
      if (wsId) dispatch(cancelExecution(wsId, type));
    },
    reset: () => {
      if (wsId) dispatch(resetExecutor(wsId, type));
    },
  };
}

/**
 * Preset hooks for common use cases
 */
export function useCommitMessage(options?: UseBackgroundAgentOptions) {
  return useBackgroundAgent('commit', {
    resultTag: 'COMMIT_MESSAGE',
    timeout: 30000,
    ...options,
  });
}

export function usePRDescription(options?: UseBackgroundAgentOptions) {
  return useBackgroundAgent('pr', {
    resultTag: 'PR_DESCRIPTION',
    timeout: 45000,
    ...options,
  });
}

export function useCodeReview(options?: UseBackgroundAgentOptions) {
  return useBackgroundAgent('review', {
    resultTag: 'CODE_REVIEW',
    timeout: 60000,
    ...options,
  });
}

export function useCodeWalkthrough(options?: UseBackgroundAgentOptions) {
  return useBackgroundAgent('walkthrough', {
    resultTag: 'CODE_WALKTHROUGH',
    timeout: 120000, // 2 minutes for walkthrough generation
    ...options,
  });
}
