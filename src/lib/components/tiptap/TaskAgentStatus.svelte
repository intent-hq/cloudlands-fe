<script lang="ts">
  import {
    selectAgentIsResponding,
    selectAgentSessionStreamingContent,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import {
    selectActiveWorkspaceId,
    selectWorkspaceById,
  } from '$store/renderer/slices/workspace/workspace-selectors';

  import { restoreAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { createLogger } from '$lib/utils/client-logger';
  import { AgentStatus, type ContentBlock, type ToolUseBlock } from '$shared/types';
  import { onMount, onDestroy } from 'svelte';
  import { getLastMeaningfulLine } from '$lib/utils/text-utils';
  import { AuggieTextParser } from '$lib/utils/auggie-text-parser';
  import { taskAgentPollingManager } from './task-agent-polling-manager';
  import AugieAvatarWithState from '../ui/auggie-avatar/AugieAvatarWithState.svelte';
  import AgentPreviewToolLabel from '$lib/components/chat/AgentPreviewToolLabel.svelte';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  const logger = createLogger('TaskAgentStatus');

  // Polling configuration constants
  // Polling is now handled by the shared taskAgentPollingManager (500ms interval)
  const DISK_LOAD_ATTEMPT_POLL_COUNT = 8; // 4 seconds (8 * 500ms) - increased to give backend time to persist
  const LOG_INTERVAL_POLL_COUNT = 10; // Log every 5 seconds (10 * 500ms)
  const MAX_POLL_TIMEOUT_MS = 10000; // 10 seconds (reduced from 30s)
  const STOP_POLLING_AFTER_DISK_LOAD_POLLS = 14; // 7 seconds after disk load attempt (was 10 = 5s)

  // Module-level cache to track agents that failed to load FROM DISK
  // This only caches agents that don't exist on disk - NOT agents that are still loading
  // Entries expire after TTL and will be retried on next component mount
  const failedAgentDiskCache = new Map<string, number>(); // agentId -> timestamp of failure
  const DISK_CACHE_TTL_MS = 30000; // 30 seconds - cache failures briefly then retry

  let {
    agentId,
    onViewAgent,
    compact = false,
  }: {
    agentId: string;
    onViewAgent?: () => void;
    compact?: boolean;
  } = $props();

  const activeWorkspaceId$ = selectActiveWorkspaceId();
  const serviceAgent$ = selectAgentSession(agentId);
  const agentIsResponding$ = selectAgentIsResponding(agentId);

  // Force reactivity with a version counter that updates when we detect changes
  let version = $state(0);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let prevAgentRef: import('$shared/types').AgentSession | undefined;
  let prevAgentResponding = false;
  let pollCount = 0;
  let isPollingActive = false; // Track if we're registered with the polling manager

  // Check if this agent recently failed to load from disk (with TTL)
  // Don't skip trying if cache is expired - always allow retries after TTL
  // Use IIFE to compute initial cache validity - the agentId is read at mount time
  // and is expected to be stable for the component's lifetime (one component per agent)
  const initialCacheValid = (() => {
    // Capture agentId value at mount time - this is intentional since
    // the component is mounted per-agent and doesn't support agentId changes
    const currentAgentId = agentId;
    const cachedFailure = failedAgentDiskCache.get(currentAgentId);
    return !!(cachedFailure && Date.now() - cachedFailure < DISK_CACHE_TTL_MS);
  })();
  let triedLoading = initialCacheValid;
  let loadFailed = $state(initialCacheValid);
  let agentFound = $state(false);

  // Track final state when agent completes - keeps UI showing after completion
  let finalStatus = $state<'complete' | 'error' | null>(null);
  let isStreamActive = $state(false);

  // Streaming text is derived from Redux-owned agent-session messages.
  const streamingContent$ = selectAgentSessionStreamingContent(agentId);

  async function tryLoadAgent() {
    if (triedLoading) return;
    triedLoading = true;

    try {
      const reduxState = appStore.state;
      const wsId = selectActiveWorkspaceId.select(reduxState);
      const currentWorkspace = wsId ? selectWorkspaceById.select(reduxState, wsId) : undefined;
      if (currentWorkspace) {
        logger.debug('[TaskAgentStatus] Attempting to load agent from disk', {
          agentId,
          workspaceId: currentWorkspace.id,
        });
        const restoreAction = restoreAgentSessionRequested(currentWorkspace.id, agentId);
        appStore.dispatch(restoreAction);
        const loadedSession = await restoreAction.promise;
        if (loadedSession) {
          agentFound = true;
          // Clear from failed cache if it was there
          failedAgentDiskCache.delete(agentId);
          version++;
        } else {
          // Agent not found on disk - just mark as failed for UI purposes
          // Don't remove associations here - only explicit agent deletion should do that
          // The agent might still be loading or might not have been persisted yet
          logger.debug('[TaskAgentStatus] Agent not found on disk', { agentId });
          loadFailed = true;
          failedAgentDiskCache.set(agentId, Date.now());
          // NOTE: We deliberately do NOT dispatch task-agent association cleanup here
          // Associations should only be cleaned up when an agent is explicitly deleted
          // (handled by the agent deletion flow, not the loading flow)
        }
      } else {
        // No workspace available - can't load, but don't remove associations
        loadFailed = true;
        failedAgentDiskCache.set(agentId, Date.now());
      }
    } catch (e) {
      logger.debug('[TaskAgentStatus] Failed to load agent from disk', { agentId, error: e });
      loadFailed = true;
      failedAgentDiskCache.set(agentId, Date.now());
    }
  }

  onMount(() => {
    logger.debug('[TaskAgentStatus] Mounted', { agentId });

    // Poll callback - called by the shared polling manager
    // This is more efficient than each component having its own interval
    function pollCallback() {
      pollCount++;
      const pollState = appStore.state;
      const pollWsId = selectActiveWorkspaceId.select(pollState);
      const session = selectAgentSession.select(pollState, agentId);
      const reduxAgent = pollWsId ? selectAgentSession.select(pollState, agentId) : undefined;

      if (session || reduxAgent) {
        let needsUpdate = false;

        if (!agentFound) {
          logger.debug('[TaskAgentStatus] Agent found', {
            agentId,
            hasSession: !!session,
            hasStoreAgent: !!reduxAgent,
            pollCount,
          });
          agentFound = true;
          needsUpdate = true;
        }

        // Check responding state from Redux while polling for initial discovery.
        const currentResponding = selectAgentIsResponding.select(pollState, agentId);

        if (currentResponding && !isStreamActive) {
          // Store says the agent is responding; the readable selector effect below
          // owns stopping when Redux transitions out of responding.
          isStreamActive = true;
          needsUpdate = true;
        }

        // Check if agent completed (only set once)
        const status = reduxAgent?.status || session?.status;
        if (status === AgentStatus.Completed && !finalStatus) {
          finalStatus = 'complete';
          needsUpdate = true;
        } else if (status === AgentStatus.Error && !finalStatus) {
          finalStatus = 'error';
          needsUpdate = true;
        }

        if (needsUpdate) {
          version++;
        }

        // Stop polling once agent is found and stable (not streaming and has final status)
        if (agentFound && !isStreamActive && finalStatus && isPollingActive) {
          taskAgentPollingManager.unregister(agentId);
          isPollingActive = false;
        }
      } else if (pollCount === DISK_LOAD_ATTEMPT_POLL_COUNT) {
        // After ~2 seconds, try loading from disk
        tryLoadAgent();
      } else if (pollCount >= STOP_POLLING_AFTER_DISK_LOAD_POLLS && triedLoading && !agentFound) {
        // Stop polling if we've tried disk load and still haven't found the agent
        logger.debug('[TaskAgentStatus] Stopping poll - agent not found after disk load attempt', {
          agentId,
          pollCount,
        });
        if (isPollingActive) {
          taskAgentPollingManager.unregister(agentId);
          isPollingActive = false;
        }
        loadFailed = true;
      } else if (pollCount % LOG_INTERVAL_POLL_COUNT === 0) {
        // Log periodically for debugging (reduced frequency)
        logger.debug('[TaskAgentStatus] Still polling...', {
          agentId,
          pollCount,
        });
      }
    }

    // Register with the shared polling manager instead of creating our own interval
    // This consolidates all TaskAgentStatus polling into a single interval
    // Polling is now mainly for discovery - once agent is found, Redux updates take over
    taskAgentPollingManager.register(agentId, pollCallback);
    isPollingActive = true;

    // Stop polling after max timeout
    timeoutId = setTimeout(() => {
      if (!agentFound && isPollingActive) {
        logger.warn('[TaskAgentStatus] Polling timeout reached, agent not found', {
          agentId,
          pollCount,
        });
        taskAgentPollingManager.unregister(agentId);
        isPollingActive = false;
        loadFailed = true;
      }
    }, MAX_POLL_TIMEOUT_MS);
  });

  // React to Redux agent state through the readable selector initialized above.
  $effect(() => {
    const activeWorkspaceId = $activeWorkspaceId$;
    const currentAgent = $serviceAgent$;
    const currentResponding = $agentIsResponding$;
    if (
      !activeWorkspaceId ||
      !currentAgent ||
      (currentAgent === prevAgentRef && currentResponding === prevAgentResponding)
    )
      return;

    let needsUpdate = false;

    // Mark as found if this is the first time
    if (!agentFound) {
      logger.debug('[TaskAgentStatus] Agent found via Redux', { agentId });
      agentFound = true;
      needsUpdate = true;
    }

    // Handle responding state changes through the canonical selector
    if (currentResponding && !isStreamActive) {
      isStreamActive = true;
      needsUpdate = true;
    } else if (!currentResponding && isStreamActive) {
      isStreamActive = false;
      needsUpdate = true;
    }

    // Handle status changes
    if (currentAgent.status === AgentStatus.Completed && !finalStatus) {
      finalStatus = 'complete';
      needsUpdate = true;
    } else if (currentAgent.status === AgentStatus.Error && !finalStatus) {
      finalStatus = 'error';
      needsUpdate = true;
    }

    if (needsUpdate) {
      version++;
    }

    // Stop polling once agent is found and stable (not streaming and has final status)
    if (agentFound && !isStreamActive && finalStatus && isPollingActive) {
      taskAgentPollingManager.unregister(agentId);
      isPollingActive = false;
    }

    prevAgentRef = currentAgent;
    prevAgentResponding = currentResponding;
  });

  onDestroy(() => {
    // Unregister from the shared polling manager
    if (isPollingActive) {
      taskAgentPollingManager.unregister(agentId);
      isPollingActive = false;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  // Reactive Redux subscription — replaces the previous non-reactive
  // service lookup so the component re-renders when the agent session
  // changes in the store.
  const storeAgent = $derived((void version, $activeWorkspaceId$ ? $serviceAgent$ : undefined));
  const serviceAgent = $derived((void version, $serviceAgent$));

  // Use either source - store takes precedence for live state
  const agent = $derived(storeAgent || serviceAgent);

  // Optimistic UI: Show immediately when we have an agent ID
  // This handles the case where the task node has a delegatedAgentId but the agent
  // is still being created in the background. We show a "creating" state until
  // the agent appears in the store, or we explicitly detect failure.
  // Only hide if loading explicitly failed (agent doesn't exist and we tried loading)
  const shouldShow = $derived(!loadFailed);

  // Get digest from either live Redux streaming content or agent session.
  // Live streaming content takes precedence when present.
  const agentDigest = $derived.by(() => {
    // First check currently streaming Redux content.
    const streamingDigest = AuggieTextParser.extractDigest($streamingContent$).digest;
    if (streamingDigest) {
      return streamingDigest;
    }
    // Fall back to session-stored digest
    const sessionDigest = storeAgent?.digest || serviceAgent?.digest;
    if (sessionDigest) {
      return sessionDigest;
    }

    // Check the last message's text content for an embedded <agent_digest> tag
    // This handles the case where the agent sent a digest in the last turn
    const messages = storeAgent?.messages || serviceAgent?.messages;
    if (messages && messages.length > 0) {
      // Look for the last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant') continue;

        // Extract text from contentBlocks
        if (msg.contentBlocks && msg.contentBlocks.length > 0) {
          const textContent = msg.contentBlocks
            .filter((block: ContentBlock) => block.type === 'text')
            .map((block: ContentBlock) => ('text' in block ? block.text : '') || '')
            .join(' ')
            .trim();

          if (textContent) {
            // Try to extract digest from the text content
            const { digest } = AuggieTextParser.extractDigest(textContent);
            if (digest) {
              return digest;
            }
          }
        }
        break; // Only check the last assistant message
      }
    }

    return null;
  });

  // Debug logging - only log once when agent is first found to avoid log spam
  let hasLoggedAgentFound = false;
  $effect(() => {
    if (agent && !hasLoggedAgentFound) {
      hasLoggedAgentFound = true;
      logger.debug('[TaskAgentStatus] Agent state available', {
        agentId,
        hasStoreAgent: !!storeAgent,
        hasServiceAgent: !!serviceAgent,
        agentStatus: storeAgent?.status || serviceAgent?.status,
      });
    }
  });

  // Process queue hint from Redux state
  const processQueueHint = $derived(storeAgent?.processQueueHint);

  // Determine agent status - defined before latestContent since it depends on this value
  type AgentDisplayStatus = 'streaming' | 'active' | 'complete' | 'error' | 'idle' | 'unknown';
  const agentStatus: AgentDisplayStatus = $derived.by(() => {
    // Use finalStatus if we have one (agent completed/errored)
    if (finalStatus === 'complete') return 'complete';
    if (finalStatus === 'error') return 'error';

    // Use Redux-derived streaming state for real-time updates.
    if (isStreamActive) return 'streaming';

    if (!storeAgent && !serviceAgent) return 'unknown';

    // Fallback to canonical current-state selector
    if ($agentIsResponding$) return 'active';

    const status = storeAgent?.status || serviceAgent?.status;
    if (status === AgentStatus.Completed) return 'complete';
    if (status === AgentStatus.Error) return 'error';

    return 'idle';
  });

  // Get the latest message or streaming content
  const latestContent = $derived.by(() => {
    // First check Redux-owned streaming content for real-time updates.
    const streamingContent = AuggieTextParser.stripDigestTagsForDisplay($streamingContent$);
    if (isStreamActive && streamingContent) {
      const lastLine = getLastMeaningfulLine(streamingContent);
      return {
        text: lastLine || m.tiptap_taskAgentStatus_working_label(),
        isStreaming: true,
      };
    }

    if (!storeAgent && !serviceAgent) return null;

    // Otherwise show the last message
    const messages = storeAgent?.messages || serviceAgent?.messages;
    if (messages && messages.length > 0) {
      // Get the last message (could be user or assistant)
      const lastMsg = messages[messages.length - 1];

      // If last message is from user, show that
      if (lastMsg.role === 'user') {
        if (lastMsg.contentBlocks && lastMsg.contentBlocks.length > 0) {
          const textBlocks = lastMsg.contentBlocks
            .filter((block: ContentBlock) => block.type === 'text')
            .map((block: ContentBlock) => ('text' in block ? block.text : '') || '')
            .join(' ')
            .trim();
          if (textBlocks) {
            const lastLine = getLastMeaningfulLine(textBlocks);
            return {
              text: lastLine,
              isStreaming: false,
            };
          }
        }
        // Fallback for user messages with legacy content field
        const legacyContent = (lastMsg as { content?: string }).content;
        if (typeof legacyContent === 'string' && legacyContent) {
          return {
            text: getLastMeaningfulLine(legacyContent),
            isStreaming: false,
          };
        }
      }

      // Find the last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'user') continue;

        // Extract text from contentBlocks - check both text and content fields
        if (msg.contentBlocks && msg.contentBlocks.length > 0) {
          // First check for text blocks
          const textBlocks = msg.contentBlocks
            .filter((block: ContentBlock) => block.type === 'text')
            .map((block: ContentBlock) => ('text' in block ? block.text : '') || '')
            .join(' ')
            .trim();

          if (textBlocks) {
            // Get the last meaningful line - CSS will handle truncation
            const lastLine = getLastMeaningfulLine(textBlocks);
            return {
              text: lastLine,
              isStreaming: false,
            };
          }

          // If no text blocks, surface the latest tool_use block so the template
          // can render the same icon+label UI used in ToolCall.svelte.
          const toolBlocks = msg.contentBlocks.filter(
            (block: ContentBlock): block is ToolUseBlock => block.type === 'tool_use',
          );
          if (toolBlocks.length > 0) {
            const lastToolBlock = toolBlocks[toolBlocks.length - 1];
            return {
              toolBlock: lastToolBlock,
              isStreaming: agentStatus === 'streaming' || agentStatus === 'active',
            };
          }
        }
      }
    }

    return null;
  });

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    logger.debug('Task agent status clicked', { agentId });

    // Call the callback if provided, otherwise navigate directly
    if (onViewAgent) {
      onViewAgent();
    } else {
      // Navigate directly to the agent
      const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e.metaKey || e.ctrlKey;
      const wsId = selectActiveWorkspaceId.select(appStore.state);
      if (wsId) {
        appStore.dispatch(
          openAgentTabRequested(wsId, {
            agentId,
            sourcePanelId,
            openInAdjacentPanel,
          }),
        );
      }
    }
  };
</script>

{#if shouldShow}
  <button
    onclick={handleClick}
    onmousedown={(e) => e.preventDefault()}
    class="task-agent-status"
    class:compact
    class:streaming={agentStatus === 'streaming'}
    class:active={agentStatus === 'active'}
    class:complete={agentStatus === 'complete'}
    class:error={agentStatus === 'error'}
    class:loading={!agent}
    type="button"
    contenteditable="false"
  >
    <div class="status-content">
      {#if processQueueHint?.waiting}
        <!-- Process queue hint takes priority -->
        <span class="status-text"
          >{m.tiptap_taskAgentStatus_waitingSlot_label({
            used: formatInteger(processQueueHint.used),
            cap: formatInteger(processQueueHint.cap),
          })}</span
        >
      {:else if agentDigest}
        <!-- Show digest prominently when available -->
        <span class="line-clamp-3 break-all text-subtle">{agentDigest}</span>
      {:else if !agent && !agentFound}
        <span class="status-text loading-text">{m.tiptap_taskAgentStatus_spinningUp_label()}</span>
      {:else if !agent}
        <span class="status-text loading-text">{m.tiptap_taskAgentStatus_loadingAgent_label()}</span>
      {:else if latestContent?.toolBlock}
        <span class="status-text">
          <AgentPreviewToolLabel
            toolUse={latestContent.toolBlock}
            animate={latestContent.isStreaming}
          />
        </span>
      {:else if latestContent?.text}
        <span class="status-text">{latestContent.text}</span>
      {:else if agentStatus === 'streaming' || agentStatus === 'active'}
        <span class="status-text">{m.tiptap_taskAgentStatus_working_label()}</span>
      {:else if agentStatus === 'complete'}
        <span class="status-text">{m.tiptap_taskAgentStatus_completed_label()}</span>
      {:else if agentStatus === 'error'}
        <span class="status-text">{m.tiptap_taskAgentStatus_error_label()}</span>
      {:else}
        <span class="status-text">{m.tiptap_taskAgentStatus_assigned_label()}</span>
      {/if}
    </div>

    <div class="status-icon">
      <AugieAvatarWithState {agentId} size={19} />
    </div>
  </button>
{/if}

<style>
  .task-agent-status {
    display: flex;
    align-items: start;
    gap: 0.5rem;
    width: calc(100% - 1.5rem);
    padding: 0.33rem 0.5rem;
    margin-left: 1.5rem;
    margin-top: -0.3rem;
    margin-bottom: 0.3rem;
    background-color: var(--color-sidebar);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    cursor: pointer;
    color: var(--color-muted-foreground);
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;
    text-align: left;
    outline: none;
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  }

  /* Compact mode - used when inside a linked task card */
  .task-agent-status.compact {
    width: 100%;
    margin: 0;
    padding: 0.25rem 0;
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    gap: 0.5rem;
    font-size: 0.9rem;
    line-height: 1.5em;
  }

  .task-agent-status.compact:hover {
    background-color: transparent;
  }

  .task-agent-status:hover:not(.compact) {
    background-color: var(--color-accent);
  }

  .task-agent-status:active {
    background-color: var(--color-accent);
  }

  .task-agent-status.loading {
    opacity: 0.7;
  }

  .loading-text {
    font-style: italic;
  }

  .status-icon {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    margin-top: 0.3rem;
    margin-right: 0.66rem;
  }

  .status-content {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .status-text {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
