/**
 * Background Agent Executor
 *
 * A reactive utility for executing background agents and tracking their state.
 * Provides real-time status updates, message streaming, and result extraction.
 */

import { agentService } from './agent.service';
import {
  unifiedStateStore,
  type AgentStateChangeType,
} from '$features/agent/services/unified-state-store';
import { gitStore } from '$features/git/git.store.svelte';
import { workspaceStore } from '$features/workspace/workspace.store.svelte';
import { invoke } from '$lib/electron-bridge';
import { GIT_CHANNELS, FILE_CHANNELS } from '$shared/ipc/channels';
import { createLogger } from '$lib/utils/client-logger';
import {
  type BackgroundAgentType,
  getValidatedModelForType,
} from '$lib/store/slices/background-agent-settings/background-agent-settings-slice';
import type { Workspace } from '$shared/types';
import type { AgentMessage } from '$shared/types/agent.types';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, extractAllContent } from '$shared/types';
import { untrack } from 'svelte';
import { toast } from 'svelte-sonner';
import { getReduxStore, dispatch } from '$lib/store/redux-dispatch-bridge';
import { loadModels } from '$lib/store/slices/model/model-slice';
import { getGroupedModels } from '$lib/store/slices/model/model-utils';
import { selectActiveProviderId } from '$lib/store/slices/provider-settings/provider-settings-selectors';
import { getModelLabel, generateFallbackChain } from '$lib/utils/model-fallback';
import { shouldSkipFileForAI } from '$shared/binary-file-extensions';
import { addDeferredResult } from './deferred-results-cache';
import { track } from '$lib/services/analytics';
import {
  selectAvailableModels,
  selectIsLoadingModels,
  selectModelsLoaded,
} from '$lib/store/slices/model/model-selectors';

const logger = createLogger('BackgroundAgentExecutor');

// ============================================================================
// File filtering for commit message generation
// ============================================================================

/** Maximum diff size per file in characters before skipping */
const MAX_DIFF_SIZE_PER_FILE = 50_000; // 50KB per file

/** Maximum total diff size in characters */
const MAX_TOTAL_DIFF_SIZE = 200_000; // 200KB total

/**
 * Git commit information used in PR context preparation
 */
interface GitCommit {
  sha: string;
  message: string;
  author?: string;
  date?: string;
}

export type ExecutorStatus =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export interface BackgroundAgentConfig {
  type: 'commit' | 'pr' | 'review' | string;
  name?: string;
  promptPath?: string;
  resultTag?: string; // Tag to extract result from, e.g., "COMMIT_MESSAGE"
  resultPattern?: RegExp; // Alternative: regex pattern to extract result
  timeout?: number; // Max time to wait for result (ms)
}

export interface ResultContext {
  /** Whether this result was restored from a previous session (not freshly generated) */
  isRestored: boolean;
  /** The workspace ID this result was generated for (may differ from current active workspace) */
  workspaceId?: string;
  /** The execution context captured when the execution started (e.g., targetBranch for PR type) */
  executionContext?: AgentExecutorContext;
}

export interface ExecutorOptions extends BackgroundAgentConfig {
  onResult?: (result: string, context?: ResultContext) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: ExecutorStatus) => void;
  onMessage?: (message: AgentMessage) => void;
}

/**
 * Context data for different agent types
 */
export interface AgentExecutorContext {
  // For commit type
  files?: string[];
  changes?: string;

  // For PR type
  targetBranch?: string;
  baseBranch?: string;
  commits?: Array<{
    sha: string;
    message: string;
    author?: string;
    date?: string;
  }>;
  // Specify which commits to include in PR description
  includeStagedFiles?: boolean;
  includeCommitHashes?: string[]; // If provided, only include these commits

  // For review type
  reviewFiles?: Array<{
    path: string;
    content?: string;
    diff?: string;
  }>;

  // Generic context
  [key: string]: unknown;
}

/**
 * Reactive background agent executor
 *
 * @example
 * ```typescript
 * const executor = new BackgroundAgentExecutor({
 *   type: 'commit',
 *   resultTag: 'COMMIT_MESSAGE',
 *   onResult: (result) => {
 *     commitMessage = result;
 *   }
 * });
 *
 * // Execute the agent
 * await executor.execute(workspace);
 *
 * // Access reactive state
 * $inspect(executor.status); // "running", "success", etc.
 * $inspect(executor.messages); // Array of messages
 * $inspect(executor.result); // Extracted result
 * ```
 */
export class BackgroundAgentExecutor {
  // Reactive state using Svelte 5 runes
  status = $state<ExecutorStatus>('idle');
  messages = $state<AgentMessage[]>([]);
  result = $state<string | null>(null);
  error = $state<Error | null>(null);
  progress = $state<number>(0); // 0-100
  agentId = $state<string | null>(null);

  // Non-reactive state
  private config: ExecutorOptions;
  private unsubscribe: (() => void) | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;
  private workspaceId: string | null = null; // Track workspace for cleanup
  private executionContext: AgentExecutorContext | undefined = undefined; // Track execution context (e.g., targetBranch)

  /** The workspace ID this executor is currently running for (or last ran for). */
  get currentWorkspaceId(): string | null {
    return this.workspaceId;
  }

  // Derived state
  get isRunning() {
    return this.status === 'initializing' || this.status === 'running';
  }

  get isComplete() {
    return this.status === 'success' || this.status === 'error' || this.status === 'cancelled';
  }

  get latestMessage() {
    return this.messages[this.messages.length - 1];
  }

  constructor(config: ExecutorOptions) {
    this.config = config;
  }

  /**
   * Get current executor state for persistence
   */
  getState(): {
    agentId: string | null;
    status: ExecutorStatus;
    result: string | null;
    error: string | null;
  } {
    return {
      agentId: this.agentId,
      status: this.status,
      result: this.result,
      error: this.error?.message || null,
    };
  }

  /**
   * Reconnect to an existing agent by ID
   * Used to restore executor state after navigation/reload
   */
  async reconnect(
    workspaceId: string,
    agentId: string,
    savedState?: { status: ExecutorStatus; result: string | null },
  ): Promise<string | null> {
    if (this.isRunning) {
      // This is expected when reconnect is called multiple times (e.g., on re-render)
      logger.debug('Executor is already running, skipping reconnect', { agentId });
      return null;
    }

    // Skip if we already have the same result (prevents infinite loops)
    if (this.result && savedState?.result && this.result === savedState.result) {
      logger.debug('Skipping reconnect - already have the same result', { agentId });
      return this.result;
    }

    logger.debug('Reconnecting to existing agent', { agentId, savedState });

    // If we have a completed result, just restore it
    if (savedState?.result && (savedState.status === 'success' || savedState.status === 'error')) {
      // Only update if we don't already have this result
      const hadResult = this.result === savedState.result;
      this.agentId = agentId;
      this.workspaceId = workspaceId;
      this.result = savedState.result;
      this.status = savedState.status;
      this.progress = 100;

      // Notify result callback only if this is a new result (mark as restored)
      if (!hadResult && savedState.result && this.config.onResult) {
        this.config.onResult(savedState.result, { isRestored: true, workspaceId });
      }

      return this.result;
    }

    // Check if agent exists and is still running
    const workspace = unifiedStateStore.getWorkspace(workspaceId as WorkspaceId);
    if (!workspace) {
      // Workspace may not be loaded yet during initialization
      logger.debug('Workspace not found for reconnect (may still be loading)', { workspaceId });
      return null;
    }

    const agentState = workspace.agents.get(agentId);
    if (!agentState) {
      // Agent may have been cleaned up or not loaded yet
      logger.debug('Agent not found for reconnect (may have been cleaned up)', { agentId });
      return null;
    }

    // Restore state and subscribe to updates
    this.workspaceId = workspaceId;
    this.agentId = agentId;
    this.messages = [...agentState.messages];

    // Check if agent is still processing
    if (agentState.streaming.active || agentState.session.isProcessing) {
      this.status = 'running';
      this.progress = 50;
      this.subscribeToAgent(agentId, workspaceId);

      // Wait for completion
      return await this.waitForCompletion();
    } else {
      // Agent already finished, extract result
      this.extractResult();
      this.status = this.result ? 'success' : 'idle';
      this.progress = this.result ? 100 : 0;

      // Notify result callback if we extracted a result (mark as restored since we're reconnecting)
      if (this.result && this.config.onResult) {
        this.config.onResult(this.result, {
          isRestored: true,
          workspaceId: this.workspaceId ?? undefined,
          executionContext: this.executionContext,
        });
      }

      return this.result;
    }
  }

  /**
   * Ensure models are loaded before executing.
   * Waits up to 5 seconds for models to load.
   */
  private async ensureModelsLoaded(): Promise<void> {
    // If models are already loaded, return immediately
    const getCurrentProviderModelState = () => {
      const state = getReduxStore().getState();
      const activeProviderId = selectActiveProviderId.select(state);
      const availableModels = selectAvailableModels.select(state);
      const modelsLoaded = selectModelsLoaded.select(state, activeProviderId);
      const isLoadingModels = selectIsLoadingModels.select(state, activeProviderId);

      return {
        activeProviderId,
        availableModels,
        isLoadingModels,
        modelsLoaded,
      };
    };

    let currentProviderModelState = getCurrentProviderModelState();
    if (
      currentProviderModelState.modelsLoaded &&
      currentProviderModelState.availableModels.length > 0
    ) {
      logger.debug('Models already loaded', {
        count: currentProviderModelState.availableModels.length,
      });
      return;
    }

    logger.info('Models not loaded yet, waiting...');

    // Trigger model loading if not already in progress
    if (!currentProviderModelState.isLoadingModels) {
      logger.debug('Triggering model load');
      dispatch(loadModels());
    }

    // Wait for models to load (max 5 seconds)
    const startTime = Date.now();
    const timeout = 5000;

    currentProviderModelState = getCurrentProviderModelState();
    while (
      !currentProviderModelState.modelsLoaded ||
      currentProviderModelState.availableModels.length === 0
    ) {
      if (Date.now() - startTime > timeout) {
        logger.warn('Timeout waiting for models to load, proceeding with hardcoded fallback');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      currentProviderModelState = getCurrentProviderModelState();
    }

    if (
      currentProviderModelState.modelsLoaded &&
      currentProviderModelState.availableModels.length > 0
    ) {
      logger.info('Models loaded successfully', {
        count: currentProviderModelState.availableModels.length,
      });
    } else {
      logger.warn('Models not loaded after timeout, will use hardcoded fallback');
    }
  }

  /**
   * Execute the background agent
   */
  async execute(workspace: Workspace, context?: AgentExecutorContext): Promise<string | null> {
    if (this.isRunning) {
      // This is expected when execute is called while already running
      logger.debug('Executor is already running, skipping execute', { workspaceId: workspace.id });
      return null;
    }

    // Clean up previous agent before creating a new one
    await this.cleanupPreviousAgent();

    this.reset();
    this.workspaceId = workspace.id; // Store for cleanup
    this.executionContext = context; // Store execution context for use in onResult callback
    this.setStatus('initializing');

    try {
      // Map trigger types to valid agent type IDs
      const agentTypeMap: Record<string, import('$shared/types/agent.types').AgentTypeId> = {
        commit: 'commit-message',
        pr: 'pr-description',
        review: 'code-review',
        walkthrough: 'code-walkthrough',
        'script-detect': 'chat',
      };

      const agentType = agentTypeMap[this.config.type];
      if (!agentType) {
        throw new Error(`Unknown background agent type: ${this.config.type}`);
      }

      // Ensure models are loaded before validation
      await this.ensureModelsLoaded();

      // Create agent with agentType
      // Backend will build system prompt via InstructionService
      // Use background agent settings for model selection with fallback validation
      const backgroundAgentType = this.config.type as BackgroundAgentType;

      // Get available models from all enabled providers and validate the requested model
      const state = getReduxStore().getState();
      const activeProviderId = selectActiveProviderId.select(state);
      const providerAvailableModels = selectAvailableModels.select(state);
      const groupedModels = getGroupedModels(activeProviderId, providerAvailableModels);
      const flattenedModels = groupedModels.flatMap((group) => group.models);
      const availableModels =
        flattenedModels.length > 0 ? flattenedModels : providerAvailableModels;
      const bgState = getReduxStore().getState().backgroundAgentSettings;
      const modelResult = getValidatedModelForType(
        backgroundAgentType,
        bgState.defaultModel,
        bgState.typeOverrides,
        availableModels,
      );

      // Generate fallback chain from available models for backend to use
      // This allows backend to automatically retry with different models if one fails
      const fallbackChain = generateFallbackChain(availableModels);
      logger.info('[ModelFallback] Generated fallback chain for backend', {
        availableModelsCount: availableModels.length,
        availableModels: availableModels.map((m) => m.value),
        chainLength: fallbackChain.length,
        chain: fallbackChain,
      });

      // Handle case where no models are available
      if (modelResult.model === null) {
        const errorMessage = modelResult.fallbackReason || 'No models available';
        logger.error('Cannot create background agent: no models available', {
          requestedModel: modelResult.requestedModel,
          reason: errorMessage,
        });
        toast.error('Cannot start agent', {
          description: errorMessage,
          duration: 5000,
        });
        throw new Error(errorMessage);
      }

      // Show toast if we had to use a fallback model
      if (modelResult.usedFallback) {
        const fallbackLabel = getModelLabel(modelResult.model, availableModels);
        const requestedLabel = getModelLabel(modelResult.requestedModel, availableModels);

        logger.warn('Using fallback model for background agent', {
          requestedModel: modelResult.requestedModel,
          fallbackModel: modelResult.model,
          reason: modelResult.fallbackReason,
        });

        toast.warning('Model not available', {
          description: `${requestedLabel} is not available. Using ${fallbackLabel} instead.`,
          duration: 5000,
        });
      }

      const agent = await agentService.createAgent(workspace, {
        name: this.config.name || this.getDefaultName(),
        model: modelResult.model, // Use validated model (with fallback if needed) - guaranteed non-null here
        agentType, // Backend loads instructions + user rules via 3-tier fallback
        metadata: {
          isBackground: true,
          triggerType: this.config.type,
          resultTag: this.config.resultTag,
          modelFallbackChain: fallbackChain, // Pass fallback chain to backend
        },
        isBackground: true,
      });

      if (!agent) {
        throw new Error('Failed to create agent');
      }

      this.agentId = agent.id;

      // Subscribe to agent updates
      this.subscribeToAgent(agent.id, workspace.id);

      // Set timeout if configured
      if (this.config.timeout) {
        this.timeoutHandle = setTimeout(() => {
          this.handleTimeout();
        }, this.config.timeout);
      }

      this.setStatus('running');
      this.progress = 10;

      // Prepare and send context message
      const contextMessage = await this.prepareContext(workspace, this.config.type, context);
      await agentService.sendMessage(agent.id, contextMessage, workspace);

      this.progress = 20;

      // Wait for completion
      return await this.waitForCompletion();
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  /**
   * Cancel the current execution
   */
  cancel(): void {
    if (!this.isRunning) return;

    logger.info('Cancelling background agent execution');

    if (this.agentId) {
      // Stop generation is not available in the refactored service
      // We'll just mark it as cancelled
    }

    this.setStatus('cancelled');
    this.cleanup();
  }

  /**
   * Reset the executor state
   * Note: Does NOT delete the agent - call cleanupPreviousAgent() first if needed
   */
  reset(): void {
    this.status = 'idle';
    this.messages = [];
    this.result = null;
    this.error = null;
    this.progress = 0;
    this.agentId = null;
    this.workspaceId = null;
    this.executionContext = undefined;
    this.cleanup();
  }

  /**
   * Subscribe to agent updates using event-driven approach
   * instead of polling to reduce CPU usage
   */
  private subscribeToAgent(agentId: string, workspaceId: string): void {
    let wasStreaming = false;
    let lastMessageCount = 0;
    let noNewMessageTimer: NodeJS.Timeout | null = null;
    let lastNotifiedMessageId: string | null = null;

    // Handler for processing agent state updates
    const processAgentUpdate = () => {
      const workspace = unifiedStateStore.getWorkspace(workspaceId as WorkspaceId);
      if (!workspace) {
        logger.warn('Workspace not found in unified store', { workspaceId, agentId });
        return;
      }

      const agentState = workspace.agents.get(agentId);
      if (!agentState) {
        logger.warn('Agent not found in workspace', { workspaceId, agentId });
        return;
      }

      const session = agentState.session;

      // Wrap all state updates in untrack to prevent reactive loops
      untrack(() => {
        // Update messages
        this.messages = [...agentState.messages];

        // Update progress based on status
        if (agentState.streaming.active) {
          this.progress = Math.min(80, this.progress + 5);
          wasStreaming = true;

          // Reset the no-new-message timer when streaming
          if (noNewMessageTimer) {
            clearTimeout(noNewMessageTimer);
            noNewMessageTimer = null;
          }
        }

        // Check if we have new messages
        if (this.messages.length > lastMessageCount) {
          lastMessageCount = this.messages.length;

          // Set a timer to detect when no new messages arrive (streaming might be stuck)
          if (noNewMessageTimer) {
            clearTimeout(noNewMessageTimer);
          }

          noNewMessageTimer = setTimeout(() => {
            if (!this.isComplete && this.messages.length > 0) {
              // Re-check current agent state before assuming completion
              // This prevents premature completion during model fallback
              const currentWorkspace = unifiedStateStore.getWorkspace(workspaceId as WorkspaceId);
              const currentAgentState = currentWorkspace?.agents.get(agentId);
              const isStillActive =
                currentAgentState?.streaming.active ||
                currentAgentState?.session.isProcessing ||
                currentAgentState?.session.isStreaming;

              if (isStillActive) {
                logger.info(
                  'No new messages for 3 seconds, but agent is still active (likely model fallback)',
                  {
                    agentId,
                    streamingActive: currentAgentState?.streaming.active,
                    isProcessing: currentAgentState?.session.isProcessing,
                    isStreaming: currentAgentState?.session.isStreaming,
                  },
                );
                // Don't complete - agent is still working (e.g., model fallback in progress)
                return;
              }

              logger.info('No new messages for 3 seconds, assuming completion');
              this.handleCompletion();
            }
          }, 3000); // 3 seconds timeout
        }

        // Check for completion - improved detection
        const completionReasons = {
          idleWithMessages: session.status === AgentStatus.Idle && this.messages.length > 0,
          statusCompleted: session.status === AgentStatus.Completed,
          streamingStopped:
            wasStreaming &&
            !agentState.streaming.active &&
            !session.isProcessing &&
            this.messages.length > 0,
        };
        const isComplete = Object.values(completionReasons).some(Boolean);

        // Log for debugging
        if (this.messages.length > 0 && !this.isComplete) {
          logger.debug('[BackgroundAgentExecutor] Completion check', {
            agentId: this.agentId,
            sessionStatus: session.status,
            messagesCount: this.messages.length,
            isProcessing: session.isProcessing,
            streamingActive: agentState.streaming.active,
            wasStreaming,
            completionReasons,
            isComplete,
            alreadyComplete: this.isComplete,
          });
        }

        if (isComplete && !this.isComplete) {
          logger.info('[BackgroundAgentExecutor] Detected completion', {
            agentId: this.agentId,
            completionReasons,
          });
          // Clear the timer if we're completing normally
          if (noNewMessageTimer) {
            clearTimeout(noNewMessageTimer);
            noNewMessageTimer = null;
          }
          this.handleCompletion();
        } else if (session.status === AgentStatus.Error) {
          // Clear the timer on error
          if (noNewMessageTimer) {
            clearTimeout(noNewMessageTimer);
            noNewMessageTimer = null;
          }
          this.handleError(new Error('Agent encountered an error'));
        }

        // Extract result from latest message if available
        this.extractResult();

        // Notify message callback (only for new messages)
        const latestMessage = this.messages[this.messages.length - 1];
        if (latestMessage && this.config.onMessage && latestMessage.id !== lastNotifiedMessageId) {
          lastNotifiedMessageId = latestMessage.id;
          this.config.onMessage(latestMessage);
        }
      });
    };

    // Subscribe to agent state changes (event-driven, not polling)
    const unsubscribeAgentState = unifiedStateStore.onAgentStateChange(
      (changedWorkspaceId, changedAgentId, _changeType: AgentStateChangeType) => {
        // Only process updates for this specific agent
        if (changedWorkspaceId === workspaceId && changedAgentId === agentId) {
          processAgentUpdate();
        }
      },
    );

    // Also subscribe to streaming changes for faster updates during streaming
    const unsubscribeStreaming = unifiedStateStore.onStreamingChange(
      (changedAgentId, _isStreaming) => {
        if (changedAgentId === agentId) {
          processAgentUpdate();
        }
      },
    );

    // Do an initial check to get current state
    processAgentUpdate();

    // Store the cleanup function
    this.unsubscribe = () => {
      unsubscribeAgentState();
      unsubscribeStreaming();
      if (noNewMessageTimer) {
        clearTimeout(noNewMessageTimer);
      }
    };
  }

  /**
   * Clean model fallback status messages from content.
   * These are injected by the model fallback mechanism and should not be
   * included in extracted results (like commit messages).
   *
   * Patterns cleaned:
   * - "> ⚠️ Model `X` is not available. Trying `Y`..."
   * - "> ❌ **All models unavailable**" block
   * - Other model status blockquotes
   */
  private cleanModelFallbackMessages(content: string): string {
    if (!content) return content;

    let cleaned = content;

    // Remove model fallback status messages (blockquote format)
    // Pattern: "> ⚠️ Model `X` is not available. Trying `Y`...\n\n"
    cleaned = cleaned.replace(/>\s*⚠️\s*Model\s*`[^`]*`\s*is not available\..*?\n\n?/gi, '');

    // Remove "All models unavailable" error block
    // Pattern: "> ❌ **All models unavailable**\n>\n> ..."
    cleaned = cleaned.replace(/>\s*❌\s*\*\*All models unavailable\*\*[\s\S]*?(?=\n\n|$)/gi, '');

    // Remove any remaining model-related blockquotes
    // Pattern: "> ⚠️ Model ... is not available.\n\n"
    cleaned = cleaned.replace(/>\s*⚠️[^\n]*Model[^\n]*not available[^\n]*\n\n?/gi, '');

    // Clean up any excessive newlines left behind
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
  }

  /**
   * Extract result from messages
   * @param forceExtract - If true, use fallback extraction even if tag not found (used on completion)
   */
  private extractResult(forceExtract = false): void {
    if (this.result) {
      logger.debug('[BackgroundAgentExecutor] extractResult: already extracted, skipping');
      return; // Already extracted
    }

    const assistantMessages = this.messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length === 0) return;

    // Search ALL assistant messages for the result tag/pattern, not just the last one.
    // ACP agents that do multiple tool call rounds may emit the result tag in an earlier
    // message, with subsequent messages containing only tool calls and no text.
    // Search in reverse order so we find the latest match first.
    let content: string | null = null;
    let extractedResult: string | null = null;

    if (this.config.resultTag || this.config.resultPattern) {
      const tagRegex = this.config.resultTag
        ? new RegExp(
            `<<<${this.config.resultTag}>>>([\\s\\S]*?)<<<\\/${this.config.resultTag}>>>`,
            'i',
          )
        : null;

      for (let i = assistantMessages.length - 1; i >= 0; i--) {
        const msgContent = extractAllContent(assistantMessages[i]);
        if (!msgContent || typeof msgContent !== 'string') continue;

        const cleaned = this.cleanModelFallbackMessages(msgContent);

        // Try tag extraction
        if (tagRegex && !extractedResult) {
          const match = cleaned.match(tagRegex);
          if (match) {
            extractedResult = match[1].trim();
            content = cleaned;
            break;
          }
        }

        // Try pattern extraction
        if (!extractedResult && this.config.resultPattern) {
          const match = cleaned.match(this.config.resultPattern);
          if (match) {
            extractedResult = match[1] || match[0];
            content = cleaned;
            break;
          }
        }
      }
    }

    // If no tag/pattern extraction succeeded, fall back to last message content
    if (!content) {
      const lastMessage = assistantMessages[assistantMessages.length - 1];
      const lastContent = extractAllContent(lastMessage);
      if (!lastContent || typeof lastContent !== 'string') return;

      const originalContent = lastContent;
      content = this.cleanModelFallbackMessages(lastContent);

      if (content !== originalContent) {
        logger.info('[BackgroundAgentExecutor] Cleaned model fallback messages from content', {
          originalLength: originalContent.length,
          cleanedLength: content.length,
          removedChars: originalContent.length - content.length,
        });
      }
    }

    // Fallback: use entire content ONLY if no extraction method was specified.
    // When a resultTag or resultPattern is specified but not found, we should NOT
    // fall back to the entire content as it likely contains conversational text
    // like "I'll help you..." that should not be used as the result.
    if (!extractedResult && !this.config.resultTag && !this.config.resultPattern) {
      extractedResult = content.trim();
    }

    // If a tag was specified but not found, log a warning and set an error
    // This prevents conversational AI responses from being used as commit messages, etc.
    if (!extractedResult && this.config.resultTag && forceExtract) {
      logger.warn(
        `Expected <${this.config.resultTag}> tag not found in response. ` +
          'The model did not follow the expected output format.',
        {
          agentId: this.agentId,
          contentLength: content.length,
          contentPreview: content.substring(0, 200),
        },
      );
      // Set error so handleCompletion knows extraction failed
      this.error = new Error(
        `Expected <${this.config.resultTag}> tag not found in response. ` +
          'Please try again or use a different model.',
      );
    }

    if (extractedResult) {
      untrack(() => {
        this.result = extractedResult;
        this.progress = 90;

        // Check if the current workspace matches the workspace this executor was started for
        const currentWorkspaceId = workspaceStore.current?.id;
        const workspaceMatches = currentWorkspaceId === this.workspaceId;

        logger.info('[BackgroundAgentExecutor] Result extracted, checking workspace match', {
          resultLength: extractedResult.length,
          hasCallback: !!this.config.onResult,
          agentId: this.agentId,
          originalWorkspaceId: this.workspaceId,
          currentWorkspaceId,
          workspaceMatches,
        });

        // Always call onResult when a result is extracted, regardless of workspace match.
        // This ensures callbacks like auto-PR creation fire immediately.
        if (this.config.onResult) {
          this.config.onResult(extractedResult, {
            isRestored: false,
            workspaceId: this.workspaceId ?? undefined,
            executionContext: this.executionContext,
          });
        }

        // When workspace doesn't match, ALSO defer the result for UI restoration on navigate-back
        if (!workspaceMatches && this.workspaceId) {
          logger.info('[BackgroundAgentExecutor] Workspace mismatch, also deferring result for UI restoration', {
            originalWorkspaceId: this.workspaceId,
            currentWorkspaceId,
            type: this.config.type,
          });

          addDeferredResult(
            this.workspaceId,
            extractedResult,
            this.config.type as BackgroundAgentType,
          );
        }
      });
    }
  }

  /**
   * Wait for completion
   */
  private async waitForCompletion(): Promise<string | null> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.isComplete) {
          clearInterval(checkInterval);
          resolve(this.result);
        }
      }, 100);
    });
  }

  /**
   * Handle completion
   */
  private handleCompletion(): void {
    if (this.isComplete) return;

    untrack(() => {
      logger.info('[BackgroundAgentExecutor] handleCompletion called', {
        agentId: this.agentId,
        messagesCount: this.messages.length,
        hasResult: !!this.result,
      });

      // Force extraction on completion - use fallback if tag not found
      this.extractResult(true);
      this.progress = 100;

      logger.info('[BackgroundAgentExecutor] After extractResult', {
        hasResult: !!this.result,
        resultLength: this.result?.length || 0,
      });

      this.setStatus(this.result ? 'success' : 'error');

      if (!this.result && !this.error) {
        // Only set generic error if a more specific error wasn't already set
        this.error = new Error('No result extracted from agent response');
        logger.warn('[BackgroundAgentExecutor] No result extracted');
      }

      this.cleanup();
    });
  }

  /**
   * Handle timeout
   */
  private handleTimeout(): void {
    logger.warn('Background agent execution timed out');
    this.error = new Error('Execution timed out');
    this.setStatus('error');

    // Notify error callback so UI can show feedback
    if (this.config.onError) {
      this.config.onError(this.error);
    }

    this.cancel();
  }

  /**
   * Handle error
   */
  private handleError(error: unknown): void {
    untrack(() => {
      logger.error('Background agent execution failed', error);
      this.error = error instanceof Error ? error : new Error(String(error));
      this.setStatus('error');

      // Show user-friendly error toast
      const errorMessage = this.error.message;
      let toastMessage = 'Failed to generate';
      let toastDescription = errorMessage;
      let showSettingsAction = true;

      // Check for context errors (no staged files, git issues, etc.) - no settings action needed
      if (
        errorMessage.includes('No files are staged') ||
        errorMessage.includes('Unable to get git status')
      ) {
        showSettingsAction = false;
        // Use the error message directly - it's already user-friendly
      }
      // Check for model-related errors (404, not found, etc.)
      else if (
        errorMessage.includes('404') ||
        errorMessage.includes('Not Found') ||
        errorMessage.includes('HTTP error: 404') ||
        errorMessage.includes('model not available') ||
        errorMessage.includes('model not found')
      ) {
        toastMessage = 'Model not available';
        toastDescription =
          'The selected model is not available for your account. ' +
          'Please check your background agent settings and select a different model.';
      } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        toastMessage = 'Request timed out';
        toastDescription = 'The request took too long. Please try again.';
        showSettingsAction = false;
      } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
        toastMessage = 'Network error';
        toastDescription = 'Please check your internet connection and try again.';
        showSettingsAction = false;
      } else if (errorMessage.includes('Internal error')) {
        toastMessage = 'Service error';
        toastDescription =
          'An internal error occurred. This might be a model availability issue. Please try again or change your model settings.';
      }

      // Don't show toast for "all models exhausted" - the error is already shown in chat
      const isModelsExhaustedError =
        errorMessage.includes('No available models') ||
        errorMessage.includes('all models exhausted') ||
        errorMessage.includes('All models unavailable');

      if (isModelsExhaustedError) {
        // Skip toast - user already sees the error in the chat
        logger.info('Skipping toast for all models exhausted error - shown in chat');
      } else if (showSettingsAction) {
        toast.error(toastMessage, {
          description: toastDescription,
          duration: 10000, // Longer duration for error messages
          action: {
            label: 'Settings',
            onClick: () => {
              // TODO: Open settings panel to background agent settings
              logger.info('User clicked settings from error toast');
            },
          },
        });
      } else {
        toast.error(toastMessage, {
          description: toastDescription,
          duration: 5000,
        });
      }

      if (this.config.onError) {
        this.config.onError(this.error);
      }

      // Track agent errored event for background agents
      track('Agent Errored', {
        agent_id: this.agentId || '',
        agent_name: `Background Agent (${this.config.type})`,
        error_type: 'background_agent_error',
      });

      this.cleanup();
    });
  }

  /**
   * Set status and notify callback
   */
  private setStatus(status: ExecutorStatus): void {
    untrack(() => {
      this.status = status;

      if (this.config.onStatusChange) {
        this.config.onStatusChange(status);
      }
    });
  }

  /**
   * Cleanup resources (subscriptions and timers only)
   */
  private cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  /**
   * Clean up the previous agent to prevent memory leaks.
   * Background agents are ephemeral and should be deleted when replaced.
   */
  private async cleanupPreviousAgent(): Promise<void> {
    const previousAgentId = this.agentId;
    const previousWorkspaceId = this.workspaceId;

    if (previousAgentId && previousWorkspaceId) {
      logger.info('Cleaning up previous background agent', {
        agentId: previousAgentId,
        workspaceId: previousWorkspaceId,
        type: this.config.type,
      });

      try {
        // Delete the previous agent to free memory
        await agentService.deleteSession(previousAgentId, previousWorkspaceId);
        logger.debug('Previous background agent deleted', { agentId: previousAgentId });
      } catch (error) {
        // Log but don't fail - the new agent should still be created
        logger.warn('Failed to delete previous background agent', {
          agentId: previousAgentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get default name for the agent
   */
  private getDefaultName(): string {
    switch (this.config.type) {
      case 'commit':
        return 'Commit Message Generator';
      case 'pr':
        return 'PR Description Generator';
      case 'review':
        return 'Code Review Assistant';
      case 'walkthrough':
        return 'Code Walkthrough Generator';
      default:
        return `${this.config.type} Assistant`;
    }
  }

  /**
   * Prepare context message based on type
   *
   * Note: Errors are intentionally not caught here - they should propagate up to
   * the execute() method which will call handleError() to properly notify the user.
   */
  private async prepareContext(
    workspace: Workspace,
    type: string,
    context?: AgentExecutorContext,
  ): Promise<string> {
    switch (type) {
      case 'commit':
        return await this.prepareCommitContext(workspace, context);
      case 'pr':
        return await this.preparePRContext(workspace, context);
      case 'review':
        return await this.prepareReviewContext(workspace, context);
      case 'walkthrough':
        return await this.prepareWalkthroughContext(workspace, context);
      default:
        return typeof context?.message === 'string'
          ? context.message
          : 'Please analyze the current context and provide assistance.';
    }
  }

  /**
   * Prepare commit context
   */
  private async prepareCommitContext(
    workspace: Workspace,
    _context?: AgentExecutorContext,
  ): Promise<string> {
    // Load the git status first
    await gitStore.loadStatus(workspace.id, true); // Force refresh to avoid race condition with recently staged files
    const status = gitStore.status;

    if (!status) {
      throw new Error("Unable to get git status. Please ensure you're in a git repository.");
    }

    // Filter for staged files
    const stagedFiles = status.files.filter((file) => file.staged);

    if (stagedFiles.length === 0) {
      throw new Error('No files are staged for commit. Please stage some files first.');
    }

    // Separate files into those we'll get diffs for and those we'll skip
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const filesToDiff: typeof stagedFiles = [];

    for (const file of stagedFiles) {
      const skipCheck = shouldSkipFileForAI(file.path);
      if (skipCheck.skip) {
        skippedFiles.push({ path: file.path, reason: skipCheck.reason || 'skipped' });
      } else {
        filesToDiff.push(file);
      }
    }

    logger.info('Filtered staged files for commit message', {
      total: stagedFiles.length,
      toDiff: filesToDiff.length,
      skipped: skippedFiles.length,
      skippedFiles: skippedFiles.map((f) => f.path),
    });

    // Get recent commit messages for context (similar to VSCode extension)
    let recentCommits: string[] = [];
    try {
      const historyResult = (await invoke(GIT_CHANNELS.HISTORY, {
        workspaceId: workspace.id,
        limit: 5,
      })) as any;
      if (historyResult?.success && historyResult?.data) {
        // Extract just the commit messages
        recentCommits = (historyResult.data as any[])
          .map((commit: any) => commit.message || commit.subject)
          .filter(Boolean);
      }
    } catch (error) {
      logger.warn('Failed to get recent commits:', error);
      // Not critical, continue without recent commits
    }

    // Get diffs for individual files (allows us to filter and truncate per-file)
    let combinedDiff = '';
    const largeDiffFiles: Array<{ path: string; size: number }> = [];
    let totalDiffSize = 0;

    try {
      for (const file of filesToDiff) {
        // Stop if we've already accumulated too much diff content
        if (totalDiffSize >= MAX_TOTAL_DIFF_SIZE) {
          skippedFiles.push({ path: file.path, reason: 'total diff size limit reached' });
          continue;
        }

        const diffResult = (await invoke(GIT_CHANNELS.DIFF, {
          workspaceId: workspace.id,
          paths: [file.path],
          staged: true,
        })) as any;

        let fileDiff = '';
        if (diffResult?.success && diffResult?.data) {
          if (typeof diffResult.data === 'string') {
            fileDiff = diffResult.data;
          } else if (Array.isArray(diffResult.data)) {
            fileDiff = this.formatDiffChunks(diffResult.data);
          } else if ((diffResult.data as any).chunks) {
            fileDiff = `diff --git a/${file.path} b/${file.path}\n${this.formatDiffChunks(diffResult.data as any)}`;
          }
        }

        // Check if this individual file's diff is too large
        if (fileDiff.length > MAX_DIFF_SIZE_PER_FILE) {
          largeDiffFiles.push({ path: file.path, size: fileDiff.length });
          // Include a truncated version with a note
          const truncated = fileDiff.substring(0, MAX_DIFF_SIZE_PER_FILE);
          const lastNewline = truncated.lastIndexOf('\n');
          combinedDiff +=
            truncated.substring(0, lastNewline > 0 ? lastNewline : MAX_DIFF_SIZE_PER_FILE) +
            `\n... [truncated - file diff too large (${Math.round(fileDiff.length / 1024)}KB)]\n\n`;
          totalDiffSize += MAX_DIFF_SIZE_PER_FILE;
        } else if (fileDiff) {
          combinedDiff += fileDiff + '\n';
          totalDiffSize += fileDiff.length;
        }
      }
    } catch (error) {
      logger.error('Failed to get staged diff:', error);
      return 'Failed to get diff for staged changes. Please try again.';
    }

    // Build a more concise prompt similar to VSCode extension
    let message = `Generate a commit message for the following STAGED changes only.
Note: Only staged files will be committed. Any unstaged changes will NOT be included in this commit.
`;

    // Include the initial workspace prompt for context on what the user was trying to accomplish
    if (workspace.initialPrompt) {
      message += `
## Original Task
The user created this workspace with the following request:
"${workspace.initialPrompt}"

Use this context to understand the intent behind the changes and write a more meaningful commit message.

`;
    }

    message += `Please follow the conventional commit format:
<type>(<scope>): <subject>

<body>

Where type is one of: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert

Guidelines:
- Be concise but descriptive
- Use present tense ("add" not "added")
- Don't end the subject with a period
- Include a body for complex changes
- Focus on WHY the change was made, not just what changed

Wrap your final commit message in <<<${this.config.resultTag || 'COMMIT_MESSAGE'}>>> and <<</${this.config.resultTag || 'COMMIT_MESSAGE'}>>> tags.

Files changed (${stagedFiles.length}):
`;

    // Add file list with better status descriptions
    stagedFiles.forEach((file) => {
      const statusMap: Record<string, string> = {
        added: 'new file',
        deleted: 'deleted',
        renamed: 'renamed',
        modified: 'modified',
        untracked: 'new file',
      };
      const status = statusMap[file.status] || file.status;
      const isSkipped = skippedFiles.some((s) => s.path === file.path);
      const skipNote = isSkipped ? ' [diff skipped]' : '';
      message += `- ${file.path} (${status})${skipNote}\n`;
    });

    // Note about skipped files
    if (skippedFiles.length > 0) {
      message += `\n## Note: ${skippedFiles.length} file(s) had their diffs skipped:\n`;
      skippedFiles.forEach((f) => {
        message += `- ${f.path} (${f.reason})\n`;
      });
      message += `These files are still part of the commit, but their content was not analyzed.\n`;
    }

    // Note about truncated files
    if (largeDiffFiles.length > 0) {
      message += `\n## Note: ${largeDiffFiles.length} file(s) had their diffs truncated due to size:\n`;
      largeDiffFiles.forEach((f) => {
        message += `- ${f.path} (${Math.round(f.size / 1024)}KB)\n`;
      });
    }

    // Add recent commits for context if available
    if (recentCommits.length > 0) {
      message += '\n## Recent commit messages for context:\n';
      recentCommits.slice(0, 3).forEach((commit) => {
        message += `- ${commit}\n`;
      });
    }

    // Add the diff
    if (combinedDiff) {
      message += '\n## Diff:\n```diff\n';
      message += combinedDiff;
      message += '\n```\n';
    } else if (skippedFiles.length === stagedFiles.length) {
      // All files were skipped
      message +=
        '\n## Diff:\n[All staged files are binary/media/large files - no diff available]\n';
      message +=
        'Please write a commit message based on the file names and your understanding of the changes.\n';
    } else {
      logger.warn('No diff content available for commit message generation');
      message += '\n## Diff:\n[No diff available - please check git status]\n';
    }

    logger.info('Prepared commit context', {
      stagedFilesCount: stagedFiles.length,
      diffedFilesCount: filesToDiff.length,
      skippedFilesCount: skippedFiles.length,
      largeDiffFilesCount: largeDiffFiles.length,
      diffLength: combinedDiff.length,
      messageLength: message.length,
    });

    return message;
  }

  /**
   * Helper to format DiffChunk objects into diff string
   */
  private formatDiffChunks(data: unknown): string {
    if (!data) return '';

    /**
     * Get the diff prefix for a line based on its type.
     * Handles both capitalized ('Addition', 'Deletion') and lowercase ('add', 'remove') formats.
     */
    const getLinePrefix = (lineType: string | undefined): string => {
      if (!lineType) return ' ';
      const normalizedType = lineType.toLowerCase();
      if (normalizedType === 'addition' || normalizedType === 'add') return '+';
      if (normalizedType === 'deletion' || normalizedType === 'remove') return '-';
      return ' ';
    };

    // Handle array of DiffChunk objects (from getDiff)
    if (Array.isArray(data)) {
      let result = '';
      for (const fileChunk of data) {
        if (fileChunk.file) {
          result += `diff --git a/${fileChunk.file} b/${fileChunk.file}\n`;
        }
        if (fileChunk.chunks) {
          for (const hunk of fileChunk.chunks) {
            // Add hunk header
            if (hunk.oldStart !== undefined && hunk.newStart !== undefined) {
              result += `@@ -${hunk.oldStart},${hunk.oldLines || 0} +${hunk.newStart},${hunk.newLines || 0} @@\n`;
            }
            // Add lines
            if (hunk.lines) {
              for (const line of hunk.lines) {
                const prefix = getLinePrefix(line.type);
                result += `${prefix}${line.content || ''}\n`;
              }
            }
          }
        }
      }
      return result;
    }

    // Handle single DiffChunk object (legacy format)
    const singleChunk = data as {
      chunks?: Array<{ lines?: Array<{ type?: string; content?: string }> }>;
    };
    if (singleChunk.chunks) {
      let result = '';
      for (const chunk of singleChunk.chunks) {
        if (chunk.lines) {
          for (const line of chunk.lines) {
            const prefix = getLinePrefix(line.type);
            result += `${prefix}${line.content || ''}\n`;
          }
        }
      }
      return result;
    }

    return '';
  }

  /**
   * Prepare PR context
   */
  private async preparePRContext(
    workspace: Workspace,
    context?: AgentExecutorContext,
  ): Promise<string> {
    // Use provided commits or fetch from git
    let commits: GitCommit[] = [];
    if (context?.commits && context.commits.length > 0) {
      commits = context.commits;
    } else if (context?.includeCommitHashes && context.includeCommitHashes.length > 0) {
      // Fetch all commits and filter to the specified ones
      const allCommits = await invoke<GitCommit[]>(GIT_CHANNELS.LOG, {
        workspaceId: workspace.id,
        limit: 50,
      });
      if (allCommits && Array.isArray(allCommits)) {
        const hashSet = new Set(context.includeCommitHashes);
        commits = allCommits.filter((c) => hashSet.has(c.sha));
      }
    } else {
      // Default: fetch recent commits
      const fetched = await invoke<GitCommit[]>(GIT_CHANNELS.LOG, {
        workspaceId: workspace.id,
        limit: 20,
      });
      if (fetched && Array.isArray(fetched)) {
        commits = fetched;
      }
    }

    // Load the git status
    await gitStore.loadStatus(workspace.id, true); // Force refresh to avoid race condition with recently staged files
    const status = gitStore.status;

    // Determine if we should include staged files info
    const includeStagedFiles = context?.includeStagedFiles ?? true;
    const stagedFiles = includeStagedFiles ? status?.files.filter((f) => f.staged) || [] : [];

    let message = `Generate a pull request description for the following changes.

Please provide a comprehensive PR description with sections for Summary, Changes, Testing, and Checklist.

Wrap your final PR description in <<<${this.config.resultTag || 'PR_DESCRIPTION'}>>> and <<</${this.config.resultTag || 'PR_DESCRIPTION'}>>> tags.

`;

    // Include the initial workspace prompt for context on what the user was trying to accomplish
    if (workspace.initialPrompt) {
      message += `## Original Task
The user created this workspace with the following request:
"${workspace.initialPrompt}"

Use this context to write a PR description that explains how these changes fulfill the original request.

`;
    }

    // Add staged files section if including them
    if (stagedFiles.length > 0) {
      message += '## Staged Files (will be committed):\n';
      stagedFiles.forEach((file) => {
        message += `- ${file.path} (${file.status})\n`;
      });
      message += '\n';
    }

    if (commits.length > 0) {
      message += `## Commits (${commits.length}):\n`;
      commits.forEach((commit) => {
        message += `- ${commit.message} (${commit.sha.slice(0, 7)})\n`;
      });
    }

    message += '\n## Branch Information:\n';
    message += `- Current branch: ${status?.branch || 'unknown'}\n`;
    message += `- Base branch: ${context?.baseBranch || context?.targetBranch || 'main'}\n`;

    return message;
  }

  /**
   * Prepare review context
   */
  private async prepareReviewContext(
    workspace: Workspace,
    context?: AgentExecutorContext,
  ): Promise<string> {
    // Check for reviewFiles first (has more detail), then fall back to files
    const filesToReview = context?.reviewFiles || context?.files;

    if (filesToReview && Array.isArray(filesToReview) && filesToReview.length > 0) {
      let message = `Please review the following code changes.

Provide feedback on:
- Potential bugs
- Security issues
- Performance concerns
- Code quality
- Best practices

Wrap your final review in <<<${this.config.resultTag || 'CODE_REVIEW'}>>> and <<</${this.config.resultTag || 'CODE_REVIEW'}>>> tags.

`;

      // Use worktreePath (actual code) or repositoryPath, NOT path (which is metadata directory)
      const codeBasePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;

      for (const fileEntry of filesToReview) {
        // Handle both string[] (files) and object[] (reviewFiles) formats
        const filePath = typeof fileEntry === 'string' ? fileEntry : fileEntry.path;
        const fileContent = typeof fileEntry === 'object' ? fileEntry.content : undefined;
        const fileDiff = typeof fileEntry === 'object' ? fileEntry.diff : undefined;

        try {
          // Use provided content/diff if available, otherwise read from disk
          let content = fileContent;
          if (!content && !fileDiff && codeBasePath) {
            const fileResult = (await invoke(FILE_CHANNELS.READ, {
              path: `${codeBasePath}/${filePath}`,
            })) as { success: boolean; data?: { content: string }; error?: { message: string } };

            if (fileResult.success && fileResult.data?.content) {
              content = fileResult.data.content;
            } else {
              logger.warn(`Failed to read file ${filePath}:`, fileResult.error?.message);
              content = undefined;
            }
          }

          message += `## ${filePath}\n`;
          if (fileDiff) {
            message += `### Diff:\n\`\`\`diff\n${fileDiff}\n\`\`\`\n\n`;
          }
          if (content) {
            message += `### Content:\n\`\`\`\n${content}\n\`\`\`\n\n`;
          }
        } catch (error) {
          logger.error(`Failed to read file ${filePath}:`, error);
          message += `## ${filePath}\n[Unable to read file]\n\n`;
        }
      }

      return message;
    }

    // Default to reviewing staged changes
    return this.prepareCommitContext(workspace);
  }

  /**
   * Prepare walkthrough context - narrated explanation of staged changes
   */
  private async prepareWalkthroughContext(
    workspace: Workspace,
    _context?: AgentExecutorContext,
  ): Promise<string> {
    // Load the git status first
    await gitStore.loadStatus(workspace.id, true); // Force refresh to avoid race condition with recently staged files
    const status = gitStore.status;

    if (!status) {
      throw new Error("Unable to get git status. Please ensure you're in a git repository.");
    }

    // Filter for staged files
    const stagedFiles = status.files.filter((file) => file.staged);

    if (stagedFiles.length === 0) {
      throw new Error('No files are staged. Please stage some files to generate a walkthrough.');
    }

    // Separate files into those we'll get diffs for and those we'll skip
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const filesToDiff: typeof stagedFiles = [];

    for (const file of stagedFiles) {
      const skipCheck = shouldSkipFileForAI(file.path);
      if (skipCheck.skip) {
        skippedFiles.push({ path: file.path, reason: skipCheck.reason || 'skipped' });
      } else {
        filesToDiff.push(file);
      }
    }

    // Get diffs for individual files with size limits
    let combinedDiff = '';
    let totalDiffSize = 0;

    try {
      for (const file of filesToDiff) {
        if (totalDiffSize >= MAX_TOTAL_DIFF_SIZE) {
          skippedFiles.push({ path: file.path, reason: 'total diff size limit reached' });
          continue;
        }

        const diffResult = (await invoke(GIT_CHANNELS.DIFF, {
          workspaceId: workspace.id,
          paths: [file.path],
          staged: true,
        })) as { success: boolean; data?: unknown };

        let fileDiff = '';
        if (diffResult?.success && diffResult?.data) {
          if (typeof diffResult.data === 'string') {
            fileDiff = `diff --git a/${file.path} b/${file.path}\n${diffResult.data}`;
          } else if (Array.isArray(diffResult.data)) {
            fileDiff = `diff --git a/${file.path} b/${file.path}\n${this.formatDiffChunks(diffResult.data)}`;
          }
        }

        if (fileDiff.length > MAX_DIFF_SIZE_PER_FILE) {
          const truncated = fileDiff.substring(0, MAX_DIFF_SIZE_PER_FILE);
          const lastNewline = truncated.lastIndexOf('\n');
          combinedDiff +=
            truncated.substring(0, lastNewline > 0 ? lastNewline : MAX_DIFF_SIZE_PER_FILE) +
            `\n... [truncated]\n\n`;
          totalDiffSize += MAX_DIFF_SIZE_PER_FILE;
        } else if (fileDiff) {
          combinedDiff += fileDiff + '\n';
          totalDiffSize += fileDiff.length;
        }
      }
    } catch (error) {
      logger.error('Failed to get staged diff:', error);
      return 'Failed to get diff for staged changes. Please try again.';
    }

    // Build the walkthrough prompt - emphasize JSON output
    let message = `Output ONLY a JSON object (no markdown, no explanation) with this structure:
{"title":"Brief title","overview":"One sentence","annotations":[{"file":"path","line":10,"message":"Note"}]}

Analyze these staged changes and create 3-5 annotations highlighting the key changes.

`;

    // Include the initial workspace prompt for context
    if (workspace.initialPrompt) {
      message += `Context: "${workspace.initialPrompt}"\n\n`;
    }

    message += `Staged files: ${stagedFiles.map((f) => f.path).join(', ')}\n\n`;

    if (skippedFiles.length > 0) {
      message += `Note: ${skippedFiles.length} file(s) skipped (binary/media/large): ${skippedFiles.map((f) => f.path).join(', ')}\n\n`;
    }

    message += `Diff:\n\`\`\`diff\n${combinedDiff}\n\`\`\`\n\nRespond with ONLY the JSON object.`;

    return message;
  }
}

// Re-export deferred results functions for backward compatibility
export {
  getDeferredResults,
  clearDeferredResults,
  hasDeferredResults,
} from './deferred-results-cache';

/**
 * Create a background agent executor with preset configuration
 */
export function createCommitMessageExecutor(options?: Partial<ExecutorOptions>) {
  return new BackgroundAgentExecutor({
    type: 'commit',
    resultTag: 'COMMIT_MESSAGE',
    timeout: 120000, // 2 minutes
    ...options,
  });
}

export function createPRDescriptionExecutor(options?: Partial<ExecutorOptions>) {
  return new BackgroundAgentExecutor({
    type: 'pr',
    resultTag: 'PR_DESCRIPTION',
    timeout: 180000, // 3 minutes
    ...options,
  });
}

export function createCodeReviewExecutor(options?: Partial<ExecutorOptions>) {
  return new BackgroundAgentExecutor({
    type: 'review',
    resultTag: 'CODE_REVIEW',
    timeout: 120000, // 2 minutes
    ...options,
  });
}

export function createWalkthroughExecutor(options?: Partial<ExecutorOptions>) {
  return new BackgroundAgentExecutor({
    type: 'walkthrough',
    resultTag: 'CODE_WALKTHROUGH',
    timeout: 120000, // 2 minutes
    ...options,
  });
}
