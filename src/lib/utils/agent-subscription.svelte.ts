/**
 * Agent Subscription Utilities
 *
 * Provides reactive utilities for subscribing to agent updates.
 * Abstracts away the complexity of manual store subscriptions.
 */

import { agentService, type AgentSession } from '$features/agent/agent.service';
import { sessionStore, subscribeToAgent } from '$features/agent/browser';
import { workspaceStore } from '$features/workspace/workspace.store.svelte';
import { get } from 'svelte/store';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace } from '$shared/types';

const logger = createLogger('AgentSubscription');

type WorkspaceIdSource = string | null | undefined | (() => string | null | undefined);

function resolveWorkspaceId(source?: WorkspaceIdSource): string | undefined {
  if (!source) return undefined;
  const value = typeof source === 'function' ? source() : source;
  if (!value) return undefined;
  return String(value);
}

// NOTE: The session store may emit updates that don't materially change the
// subscribed agent (for example: updates to unrelated store fields or repeated
// broadcasts of the same session snapshot). In Svelte 5, assigning to a $state
// variable is itself a trigger, so we guard updates by comparing a lightweight
// fingerprint of the fields that actually matter for UI rendering.

function agentSessionFingerprint(agent: AgentSession | null): string {
  if (!agent) return 'null';

  const lastMessage = agent.messages?.[agent.messages.length - 1];
  const lastText = lastMessage?.contentBlocks?.[0]?.text ?? '';

  // Include metadata fields that affect UI rendering
  const metadata = (agent as any).metadata || (agent as any).agentMetadata;

  return JSON.stringify({
    id: String((agent as any).id ?? ''),
    name: String((agent as any).name ?? ''),
    backendSessionId: String((agent as any).backendSessionId ?? ''),
    workspaceId: String((agent as any).workspaceId ?? ''),
    status: String((agent as any).status ?? ''),
    isProcessing: Boolean((agent as any).isProcessing),
    isStreaming: Boolean((agent as any).isStreaming),
    isResponding: Boolean((agent as any).isResponding),
    updatedAt: String((agent as any).updatedAt ?? ''),
    lastActivity: String((agent as any).lastActivity ?? ''),
    lastMessageId: String((lastMessage as any)?.id ?? ''),
    lastMessageText: lastText,
    // Content block count so fingerprint changes when new tool_use blocks appear
    lastMsgBlockCount: lastMessage?.contentBlocks?.length ?? 0,
    // Message-level streaming flags (delegated agents may only have these)
    lastMsgIsStreaming: Boolean(lastMessage?.isStreaming),
    lastMsgStreamingComplete: Boolean(lastMessage?.streamingComplete),
    // Include metadata fields that affect AgentCard rendering
    specialist: String(metadata?.specialist ?? ''),
    createdByAgentId: String(metadata?.createdByAgentId ?? ''),
  });
}

function agentsFingerprint(agents: AgentSession[]): string {
  return JSON.stringify(
    agents.map((a) => {
      const lastMessage = a.messages?.[a.messages.length - 1];
      const lastText = lastMessage?.contentBlocks?.[0]?.text ?? '';
      // Only include a snippet of the text to avoid huge fingerprints during streaming
      const textSnippet = lastText.slice(0, 200);

      // Include metadata fields that affect UI rendering
      const metadata = (a as any).metadata || (a as any).agentMetadata;

      return {
        id: String((a as any).id ?? ''),
        name: String((a as any).name ?? ''),
        backendSessionId: String((a as any).backendSessionId ?? ''),
        workspaceId: String((a as any).workspaceId ?? ''),
        status: String((a as any).status ?? ''),
        isProcessing: Boolean((a as any).isProcessing),
        isStreaming: Boolean((a as any).isStreaming),
        isResponding: Boolean((a as any).isResponding),
        updatedAt: String((a as any).updatedAt ?? ''),
        lastActivity: String((a as any).lastActivity ?? ''),
        messageCount: (a.messages?.length ?? 0) as number,
        lastMessageId: String((lastMessage as any)?.id ?? ''),
        lastMessageText: textSnippet,
        // Content block count so fingerprint changes when new tool_use blocks appear
        lastMsgBlockCount: lastMessage?.contentBlocks?.length ?? 0,
        // Message-level streaming flags (delegated agents may only have these)
        lastMsgIsStreaming: Boolean(lastMessage?.isStreaming),
        lastMsgStreamingComplete: Boolean(lastMessage?.streamingComplete),
        // Include metadata fields that affect AgentCard rendering
        specialist: String(metadata?.specialist ?? ''),
        createdByAgentId: String(metadata?.createdByAgentId ?? ''),
      };
    }),
  );
}

/**
 * Subscribe to a specific agent session with automatic cleanup.
 * Returns an object with a `current` getter that provides reactive access to the agent.
 *
 * This uses manual subscription instead of $derived because Svelte's fine-grained
 * reactivity doesn't work well with Map mutations. Manual subscriptions always
 * fire on store.update() calls, regardless of object reference changes.
 *
 * IMPORTANT: The function returns an object with a `current` getter, not the agent directly.
 * This is necessary because returning $state directly from a function doesn't maintain
 * reactivity across function boundaries in Svelte 5.
 *
 * @param agentId - The ID of the agent to subscribe to
 * @returns An object with a `current` getter that returns the reactive agent session
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useAgentSubscription } from "$lib/utils/agent-subscription.svelte";
 *
 *   let { agentId } = $props();
 *   const agentSubscription = useAgentSubscription(agentId);
 *   const agent = $derived(agentSubscription.current);
 *
 *   // agent is now reactive and updates during streaming
 *   const messageCount = $derived(agent?.messages?.length || 0);
 * </script>
 * ```
 */
export function useAgentSubscription(agentId: string, workspace?: Workspace | null) {
  // CRITICAL: Use $state to create reactive state
  // This maintains the object structure while still allowing top-level reactivity
  let agent = $state<AgentSession | null>(null);
  let lastAgentFingerprint: string | null = null;
  let restoreAttempted = $state(false);

  // Resolve workspace ID for scoped subscription
  // This ensures the subscription only looks in the correct workspace,
  // preventing cross-workspace state bleed (F2 fix).
  const resolvedWsId = workspace?.id ? String(workspace.id) : undefined;

  // Use $effect for subscription management with automatic cleanup
  $effect(() => {
    // Subscribe to agent updates using the efficient per-agent subscription
    // This only triggers when THIS agent's data changes, not when ANY agent changes
    // (Much more efficient during streaming when multiple agents may be active)
    // Pass workspaceId to scope the lookup to the correct workspace
    const unsubscribe = subscribeToAgent(
      agentId,
      (updatedAgent) => {
        if (updatedAgent) {
          // Only update when something about the session actually changed (including streaming text)
          const nextFingerprint = agentSessionFingerprint(updatedAgent);
          if (lastAgentFingerprint !== nextFingerprint) {
            lastAgentFingerprint = nextFingerprint;
            agent = updatedAgent;
          }
        } else if (agent !== null) {
          // Agent was removed
          lastAgentFingerprint = null;
          agent = null;
        }
      },
      resolvedWsId,
    );

    // Note: subscribeToAgent calls the callback immediately with current value,
    // so we don't need to do a separate initial load here

    // If agent is still null after initial callback, try to restore from disk
    if (agent === null && !restoreAttempted) {
      restoreAttempted = true;
      // Use provided workspace or fall back to workspaceStore.current
      const resolvedWorkspace = workspace ?? workspaceStore.current;

      if (resolvedWorkspace) {
        agentService
          .restoreSessionWithoutBackend(agentId, resolvedWorkspace)
          .catch((error: unknown) => {
            logger.error('Failed to restore agent', { agentId, error });
          });
      }
    }

    // Return cleanup function - $effect will call this when the effect is destroyed
    return () => {
      unsubscribe();
    };
  });

  // CRITICAL: Return a getter to maintain reactivity across function boundaries
  // Returning $state directly doesn't work - the component gets the initial value
  // but doesn't see updates. A getter ensures the component always reads the current value.
  return {
    get current() {
      return agent;
    },
  };
}

// Track which workspaces are currently loading agents to avoid concurrent loads
const agentsLoadingForWorkspace = new Set<string>();

/**
 * Mark a workspace as currently loading agents from disk.
 * This prevents AgentSubscription's disk sync from running a redundant parallel load.
 * Call `releaseAgentLoadLock` when done.
 */
export function acquireAgentLoadLock(workspaceId: string): void {
  agentsLoadingForWorkspace.add(workspaceId);
}

/**
 * Release the agent loading lock for a workspace.
 */
export function releaseAgentLoadLock(workspaceId: string): void {
  agentsLoadingForWorkspace.delete(workspaceId);
}

/**
 * Subscribe to all agent sessions with automatic cleanup.
 * Returns a reactive object with `current` and `all` getters that update whenever any agent changes.
 *
 * The subscription stores ALL agents from the session store internally. Filtering by workspaceId
 * is done in two places:
 * 1. The hook's `current` getter pre-filters by the captured workspaceId (for simple use cases)
 * 2. Components can use `all` and filter with `$derived` for reactive filtering (recommended for
 *    components that may remain mounted while workspace changes, like TabbedSidebar)
 *
 * @param workspaceId - Optional workspace ID or getter. Used to trigger loading agents from disk
 *   for this workspace and to pre-filter in the `current` getter. Pass a getter (e.g.
 *   `() => workspaceId`) when the workspace can change while the component stays mounted.
 * @returns An object with:
 *   - `current`: Getter returning agents filtered by the captured workspaceId
 *   - `all`: Getter returning all agents (for reactive filtering with $derived)
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useAllAgentsSubscription } from "$lib/utils/agent-subscription.svelte";
 *
 *   let { workspaceId } = $props();
 *
 *   // Pass workspaceId to trigger loading from disk
 *   const agentSubscription = useAllAgentsSubscription(() => workspaceId);
 *
 *   // RECOMMENDED: Use .all with $derived for reactive filtering when workspace can change
 *   const workspaceAgents = $derived.by(() => {
 *     const all = agentSubscription.all;
 *     if (!workspaceId) return all;
 *     return all.filter(s => s.workspaceId === workspaceId);
 *   });
 * </script>
 * ```
 */
export function useAllAgentsSubscription(workspaceId?: WorkspaceIdSource) {
  // Store ALL agents from the session store - filtering happens at the component level
  let allAgents = $state<AgentSession[]>([]);
  let lastAgentsFingerprint = '';
  // Track loading state reactively
  let isLoading = $state(false);

  // Use $effect for subscription management with automatic cleanup
  $effect(() => {
    // Subscribe to all agent updates (no filtering here)
    const unsubscribe = sessionStore.getStore().subscribe((state) => {
      const nextAgents = state.sessions || [];
      const nextFingerprint = agentsFingerprint(nextAgents);
      if (nextFingerprint !== lastAgentsFingerprint) {
        lastAgentsFingerprint = nextFingerprint;
        allAgents = nextAgents;
      }
    });

    // Initial load
    const store = sessionStore.getStore();
    const state = get(store);
    const nextAgents = state.sessions || [];
    lastAgentsFingerprint = agentsFingerprint(nextAgents);
    allAgents = nextAgents;

    // Return cleanup function - $effect will call this when the effect is destroyed
    return () => {
      unsubscribe();
    };
  });

  // Sync agents from disk with the in-memory store.
  // This ensures delegated agents (created by backend) are visible in the UI.
  // The load trigger uses the global agentsLoadingForWorkspace set to prevent
  // duplicate loads.
  $effect(() => {
    const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
    // Early exit if no workspace ID provided
    if (!resolvedWorkspaceId) return;

    // Look up the workspace by its resolved ID rather than using
    // workspaceStore.current. workspaceStore.current points to whichever
    // workspace the user is actively viewing, which may differ from the
    // workspace this subscription was created for (e.g. when multiple
    // workspace tabs are open). Using findById ensures we pass the correct
    // workspace object to restoreSessionWithoutBackend below.
    // Reading workspaceStore.items keeps this as a reactive dependency so
    // the effect re-runs when the items list changes (e.g. after load).
    const _items = workspaceStore.items; // reactive dependency
    const workspace = workspaceStore.findById(resolvedWorkspaceId as any);
    if (!workspace) {
      logger.debug('Workspace not ready, will retry when available', { resolvedWorkspaceId });
      return;
    }

    // Prevent concurrent loads for the same workspace
    if (agentsLoadingForWorkspace.has(resolvedWorkspaceId)) {
      return;
    }

    // Track loaded workspaces to only do initial sync once per page session
    // But allow re-sync if there are no agents (handles initial empty state)
    const workspaceAgents = allAgents.filter((s) => {
      const agentWsId = s.workspaceId ? String(s.workspaceId) : '';
      return agentWsId === resolvedWorkspaceId;
    });

    // Only trigger initial load on mount or when store is empty for this workspace
    // The real-time updates come from agent:created events
    if (workspaceAgents.length > 0) {
      // Already have agents, trust real-time updates
      return;
    }

    logger.debug('Triggering agent load from disk for workspace:', resolvedWorkspaceId);
    agentsLoadingForWorkspace.add(resolvedWorkspaceId);
    isLoading = true;

    // Dynamically import and load agents from disk
    (async () => {
      const workspaceIdKey = resolvedWorkspaceId;
      try {
        const { getStoredAgentsFromDisk } = await import('$lib/utils/agent-loader');

        logger.info('[AgentSubscription] Loading agents from disk...', { workspaceIdKey });
        const diskAgents = await getStoredAgentsFromDisk(workspaceIdKey);
        logger.info('[AgentSubscription] Found agents on disk:', {
          count: diskAgents.length,
          agentIds: diskAgents.map((a) => a.id),
          agentNames: diskAgents.map((a) => a.name),
        });

        // Restore each agent session
        let restoredCount = 0;
        let skippedCount = 0;
        for (const diskAgent of diskAgents) {
          // Check if agent is already in the store
          const existingSession = agentService.getSession(diskAgent.id);
          if (!existingSession) {
            logger.debug('Restoring agent session:', diskAgent.id);
            // Restore the agent session without backend registration
            // This is a lightweight restore just to show the agent in the UI
            const restored = await agentService.restoreSessionWithoutBackend(
              diskAgent.id,
              workspace,
            );
            if (restored) {
              restoredCount++;
            } else {
              logger.warn('[AgentSubscription] Failed to restore agent:', diskAgent.id);
            }
          } else {
            skippedCount++;
          }
        }
        logger.info('[AgentSubscription] Agent load complete', {
          restoredCount,
          skippedCount,
          totalOnDisk: diskAgents.length,
        });
      } catch (error) {
        logger.error('Failed to load agents from disk', { error });
      } finally {
        // Clear the loading flag after loading is done (success or failure)
        agentsLoadingForWorkspace.delete(workspaceIdKey);
        isLoading = false;
      }
    })();
  });

  // CRITICAL: Return a getter to maintain reactivity across function boundaries
  // Returning $state directly doesn't work - the component gets the initial value
  // but doesn't see updates. A getter ensures the component always reads the current value.
  //
  // The filtering by workspaceId is done here in the getter, which means
  // every time a component reads .current, it gets the filtered result.
  return {
    get current() {
      const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
      if (!resolvedWorkspaceId) return allAgents;
      return allAgents.filter((s) => {
        const agentWsId = s.workspaceId ? String(s.workspaceId) : '';
        return agentWsId === resolvedWorkspaceId;
      });
    },
    // Also expose all agents for components that want to do their own filtering
    get all() {
      return allAgents;
    },
    // Expose loading state for showing skeleton loaders
    get loading() {
      return isLoading;
    },
  };
}
