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
  BackgroundAgentExecutor,
  type ExecutorOptions,
  type ExecutorStatus,
} from '$features/agent/background-agent-executor.svelte';
import type { Workspace } from '$shared/types';

export interface UseBackgroundAgentOptions extends Omit<ExecutorOptions, 'type'> {
  autoExecute?: boolean; // Execute immediately when workspace is available
  workspace?: Workspace; // Workspace to use for auto-execution
}

export interface UseBackgroundAgentReturn {
  // Reactive state
  status: ExecutorStatus;
  isRunning: boolean;
  isComplete: boolean;
  progress: number;
  result: string | null;
  error: Error | null;
  messages: any[];

  // Methods
  execute: (workspace: Workspace, context?: any) => Promise<string | null>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Create a reactive background agent hook
 */
export function useBackgroundAgent(
  type: string,
  options: UseBackgroundAgentOptions = {},
): UseBackgroundAgentReturn {
  const { autoExecute, workspace, ...executorOptions } = options;

  // Create the executor
  const executor = new BackgroundAgentExecutor({
    type,
    ...executorOptions,
  });

  // Auto-execute if requested
  if (autoExecute && workspace) {
    executor.execute(workspace);
  }

  // Return reactive interface
  return {
    // Reactive state (these will be reactive due to $state in executor)
    get status() {
      return executor.status;
    },
    get isRunning() {
      return executor.isRunning;
    },
    get isComplete() {
      return executor.isComplete;
    },
    get progress() {
      return executor.progress;
    },
    get result() {
      return executor.result;
    },
    get error() {
      return executor.error;
    },
    get messages() {
      return executor.messages;
    },

    // Methods
    execute: (workspace: Workspace, context?: any) => executor.execute(workspace, context),
    cancel: () => executor.cancel(),
    reset: () => executor.reset(),
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
