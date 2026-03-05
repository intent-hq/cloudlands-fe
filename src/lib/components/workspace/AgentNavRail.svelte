<script lang="ts">
  import { Fa } from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import {
    type AvatarState,
    getAvatarState,
    isAgentStreamingFromStore,
  } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { permissionStore } from '$lib/stores/permission.store.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import { tick } from 'svelte';
  import type { FileOperation } from '$shared/types';
  import LineChangeStats from '$lib/components/shared/LineChangeStats.svelte';
  import FileChangesList from '$lib/components/shared/FileChangesList.svelte';
  import { lineChangesStore } from '$features/line-changes/line-changes.store.svelte';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';
  import { formatRelativeTime } from '$shared/utils-client';
  import { createLogger } from '$lib/utils/client-logger';
  import { parseStoredMessage } from '$lib/utils/parseStoredMessage';

  const logger = createLogger('AgentNavRail');

  interface AgentItem {
    id: string;
    name: string;
    isActive?: boolean;
    isResponding?: boolean;
    isBackground?: boolean;
    isLoading?: boolean;
    status?: string;
    createdAt?: string;
    metadata?: { isBackground?: boolean; createdByAgentId?: string; specialist?: string };
    lastUserMessage?: string;
    lastResponse?: string;
    fileChanges?: FileOperation[];
    messages?: any[];
    parentAgentId?: string; // ID of parent agent (from metadata.createdByAgentId or parentSessionId)
    parentSessionId?: string; // For forked sessions
    children?: AgentItem[]; // Child agents delegated from this agent
    depth?: number; // Nesting depth for indentation
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null; // Specialist type for tool icon overlay
  }

  let {
    agents = [],
    activeItemId = null,
    onCreate,
    onSelect,
    class: className = '',
    isLoading = false,
    drawerOpen = false,
    drawerType = null,
  }: {
    agents?: any[];
    activeItemId?: string | null;
    onCreate?: () => void;
    onSelect?: (agentId: string) => void;
    class?: string;
    isLoading?: boolean;
    drawerOpen?: boolean;
    drawerType?: string | null;
  } = $props();

  // Cache for extracted messages - keyed by agentId + messageCount
  // This avoids re-extracting messages on every reactive update
  const messageCache = new Map<string, { lastUserMessage: string; lastResponse: string }>();

  /**
   * Strip context prefixes from user message text (e.g., "[Currently viewing: Spec]")
   * Uses parseStoredMessage to extract just the user's actual message
   */
  function stripContextPrefixes(text: string): string {
    const parsed = parseStoredMessage(text);
    return parsed.userMessage;
  }

  /**
   * Extract text content from a message's content blocks
   * Handles both old format (content array) and new format (contentBlocks)
   * For user messages, strips context prefixes like "[Currently viewing: Spec]"
   */
  function extractTextFromMessage(msg: any): string {
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join(' ');
    } else if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
      text = msg.contentBlocks
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || block.content || '')
        .join(' ')
        .trim();
    }

    // For user messages, strip context prefixes
    const isUserMessage = msg.role === 'user' || msg.role === 'User';
    if (isUserMessage && text) {
      text = stripContextPrefixes(text);
    }

    return text;
  }

  /**
   * Extract last user message and last response from an agent's messages
   * Uses caching to avoid re-processing on every reactive update
   */
  function getExtractedMessages(agent: any): { lastUserMessage: string; lastResponse: string } {
    const messages = agent.messages;
    if (!messages || messages.length === 0) {
      return { lastUserMessage: '', lastResponse: '' };
    }

    // Create cache key based on agent ID and message count
    // This invalidates cache when new messages are added
    const cacheKey = `${agent.id}:${messages.length}`;
    const cached = messageCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let lastUserMessage = '';
    let lastResponse = '';

    // Find the last user message (iterate backwards for efficiency)
    for (let i = messages.length - 1; i >= 0 && !lastUserMessage; i--) {
      const msg = messages[i];
      if (msg.role === 'user' || msg.role === 'User') {
        lastUserMessage = extractTextFromMessage(msg);
      }
    }

    // Find the last assistant response
    for (let i = messages.length - 1; i >= 0 && !lastResponse; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' || msg.role === 'Assistant') {
        lastResponse = extractTextFromMessage(msg);
      }
    }

    const result = { lastUserMessage, lastResponse };
    messageCache.set(cacheKey, result);

    // Limit cache size to prevent memory leaks
    if (messageCache.size > 100) {
      const firstKey = messageCache.keys().next().value;
      if (firstKey) messageCache.delete(firstKey);
    }

    return result;
  }

  // Convert agents to agent items - preserve all original properties
  // Note: We capture activeItemId, drawerType, drawerOpen in the closure to ensure
  // the derived is recalculated when these props change
  const agentItems = $derived.by(() => {
    // Capture reactive props to ensure this derived updates when they change
    const currentActiveId = activeItemId;
    const currentDrawerType = drawerType;
    const currentDrawerOpen = drawerOpen;

    // Dedupe agents by ID to prevent duplicate key errors
    const seen = new Set<string>();
    const dedupedAgents = agents.filter((a) => {
      if (!a || !a.id || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    // Helper to check if an agent is running
    const isRunning = (agent: any): boolean => {
      // Check unified state store first
      const currentWorkspace = unifiedStateStore.getCurrentWorkspace();
      if (currentWorkspace) {
        const agentState = currentWorkspace.agents.get(agent.id as any);
        if (agentState?.streaming?.active) return true;
      }
      // Check agent properties
      return (
        agent.isAgentResponding ||
        agent.isProcessing ||
        agent.status === 'streaming' ||
        agent.status === 'processing'
      );
    };

    // Filter out background agents that are not open, not running, and not recently created
    const filteredAgents = dedupedAgents.filter((agent) => {
      const isBackground = agent.isBackground || agent.metadata?.isBackground;
      if (!isBackground) return true;

      // For background agents, only show if open, running, or recently created
      const isOpen =
        currentDrawerType === 'agent' &&
        String(agent.id) === String(currentActiveId) &&
        currentDrawerOpen;
      if (isOpen || isRunning(agent)) return true;

      // Show if recently created (within 5 seconds) — streaming state may not be set yet
      const createdAt = agent.createdAt ? new Date(agent.createdAt).getTime() : 0;
      if (createdAt > 0 && Date.now() - createdAt < 5000) return true;

      return false;
    });

    // Sort by createdAt - oldest first (top) to newest last (bottom)
    const sortedAgents = [...filteredAgents].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aTime - bTime;
    });

    // Create agent items with parent references
    const agentMap = new Map<string, AgentItem>();
    const items: AgentItem[] = sortedAgents.map((agent) => {
      // Calculate isActive using the captured reactive values
      const isAgentActive =
        currentDrawerType === 'agent' &&
        String(agent.id) === String(currentActiveId) &&
        currentDrawerOpen;

      // Use cached message extraction
      const { lastUserMessage, lastResponse } = getExtractedMessages(agent);

      // Determine parent agent ID (from delegation or fork)
      const parentAgentId = agent.metadata?.createdByAgentId || agent.parentSessionId || undefined;

      const item: AgentItem = {
        ...agent, // Keep all original properties
        id: agent.id,
        name: agent.name || 'New Chat',
        isActive: isAgentActive,
        isResponding: agent.isAgentResponding || agent.isProcessing || false,
        lastUserMessage: lastUserMessage || agent.lastUserMessage || '',
        lastResponse: lastResponse || agent.lastResponse || '',
        fileChanges: agent.fileChanges || [],
        messages: agent.messages || [],
        parentAgentId,
        children: [],
        depth: 0,
      };
      agentMap.set(agent.id, item);
      return item;
    });

    // Build hierarchy: assign children to parents and calculate depth
    const rootItems: AgentItem[] = [];
    for (const item of items) {
      if (item.parentAgentId && agentMap.has(item.parentAgentId)) {
        const parent = agentMap.get(item.parentAgentId)!;
        parent.children = parent.children || [];
        parent.children.push(item);
      } else {
        rootItems.push(item);
      }
    }

    // Calculate depth recursively and flatten to display order
    function flattenWithDepth(items: AgentItem[], depth: number): AgentItem[] {
      const result: AgentItem[] = [];
      for (const item of items) {
        item.depth = depth;
        result.push(item);
        if (item.children && item.children.length > 0) {
          // Sort children by createdAt
          const sortedChildren = [...item.children].sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return aTime - bTime;
          });
          result.push(...flattenWithDepth(sortedChildren, depth + 1));
        }
      }
      return result;
    }

    return flattenWithDepth(rootItems, 0);
  });

  let hoveredItemId: string | null = $state(null);
  let scrollContainer: HTMLElement | undefined = $state();

  // Track unread count to trigger reactivity when it changes
  let unreadCount = $state(0);
  $effect(() => {
    const unsubscribe = unreadTrackingService.subscribe((count) => {
      unreadCount = count;
    });
    return () => unsubscribe();
  });

  // Track streaming state changes for reactivity
  let streamingVersion = $state(0);
  $effect(() => {
    const unsubscribe = unifiedStateStore.onStreamingChange(() => {
      streamingVersion++;
    });
    return unsubscribe;
  });

  // Helper to check if an agent has unread messages
  function hasUnread(agentId: string): boolean {
    // Access unreadCount to ensure reactivity
    void unreadCount;
    return unreadTrackingService.hasUnread(agentId);
  }

  /**
   * Get the avatar state for an agent item
   * Uses centralized getAvatarState for consistent state calculation
   */
  function getAgentAvatarState(item: AgentItem): AvatarState {
    // Access version counters to trigger reactivity
    void unreadCount;
    void streamingVersion;

    // Get workspace ID for streaming check
    const currentWorkspace = unifiedStateStore.getCurrentWorkspace();
    const workspaceId = currentWorkspace?.workspace.id;

    return getAvatarState(
      {
        isStreaming: workspaceId ? isAgentStreamingFromStore(workspaceId, item.id) : false,
        isResponding: item.isResponding,
        status: item.status,
      },
      {
        hasUnread: hasUnread(item.id),
        isActive: item.isActive,
        hasPermissionRequest: permissionStore.getPendingCount(item.id) > 0,
      },
    );
  }

  async function handleItemClick(item: AgentItem) {
    // Always call onSelect - the parent component handles toggle logic
    if (onSelect && item?.id) {
      onSelect(item.id);
    } else if (!item?.id) {
      logger.error('Cannot select agent - missing item ID', { item });
    }
  }

  function handleItemHover(itemId: string | null) {
    hoveredItemId = itemId;
  }

  // Scroll active item into view when component mounts or active item changes
  $effect(() => {
    if (activeItemId && drawerType === 'agent' && scrollContainer) {
      const container = scrollContainer;

      tick().then(() => {
        const activeButton = container?.querySelector(
          `button[data-agent-id="${activeItemId}"]`,
        ) as HTMLElement;
        activeButton?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  });
</script>

<div class={cn('flex flex-col max-h-full', className)} aria-label="Agent navigation rail">
  <!-- Add Agent Button -->
  <div class="flex-none flex justify-center">
    <Button
      variant="ghost-light"
      size="icon-sm"
      onclick={onCreate}
      tooltip="New agent"
      tooltipShortcut="mod+n"
      tooltipSide="left"
      tooltipDelayDuration={0}
    >
      <Fa icon={faPlus} size="sm" />
    </Button>
  </div>

  <!-- Agent Items - Simple Scrollable Container -->
  <div class="flex-1 overflow-y-auto min-h-0 relative" bind:this={scrollContainer}>
    <!-- Top gradient fade (fixed position) -->
    <div
      class="pointer-events-none sticky top-0 left-0 right-0 h-3 -mb-2 bg-linear-to-b from-sidebar to-transparent z-10"
    ></div>

    <div class="flex flex-col items-center gap-1 w-full pt-2">
      {#if isLoading && agents.length === 0}
        <!-- Skeleton loaders for agents during initial loading -->
        {#each Array(2) as _, i}
          <div class="relative w-full -my-0.5 animate-pulse" style="animation-delay: {i * 100}ms">
            <div class="w-full h-9 flex items-center justify-center">
              <Skeleton class="w-[26px] h-[26px] rounded-full" />
            </div>
          </div>
        {/each}
      {:else if agentItems.length > 0}
        {#each agentItems as item (item.id)}
          {@const depth = item.depth || 0}
          {@const avatarSize = depth > 0 ? 20 : 26}
          <div
            class={cn('relative w-full group', depth > 0 ? '-my-1' : '-my-0.5')}
            style:anchor-name="--agent-{item.id}"
          >
            <button
              data-agent-id={item.id}
              class={cn(
                'relative w-full flex items-center transition-all cursor-pointer',
                item.isActive && 'bg-background',
                depth === 0 ? 'h-9 justify-center' : 'h-7 justify-start',
              )}
              style:padding-left={depth > 0 ? `${depth * 18}px` : undefined}
              onclick={() => handleItemClick(item)}
              onmouseenter={() => handleItemHover(item.id)}
              onmouseleave={() => handleItemHover(null)}
            >
              <!-- Auggie Avatar with State -->
              <div class="relative">
                {#if item.isLoading || item.status === 'initializing'}
                  <!-- Show loading spinner for initializing agents -->
                  <div
                    class="flex items-center justify-center"
                    style:width="{avatarSize}px"
                    style:height="{avatarSize}px"
                  >
                    <div
                      class={cn(
                        'border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin',
                        depth > 0 ? 'w-4 h-4' : 'w-5 h-5',
                      )}
                    ></div>
                  </div>
                {:else}
                  {@const specialistId = item.specialist || item.metadata?.specialist}
                  <AugieAvatarWithState
                    agentId={item.id}
                    size={avatarSize}
                    state={getAgentAvatarState(item)}
                    specialist={specialistId === 'spec-writer' ||
                    specialistId === 'implementor' ||
                    specialistId === 'verifier'
                      ? specialistId
                      : null}
                  />
                  {#if item.isBackground || item.metadata?.isBackground}
                    <div
                      class="absolute -top-1 -right-1 px-1 py-0.5 text-ui font-bold bg-muted text-subtle rounded"
                    >
                      BG
                    </div>
                  {/if}
                {/if}
              </div>
              <!-- Right line indicator for child agents -->
              {#if depth > 0}
                <div class="absolute right-0 top-0 bottom-0 w-px bg-muted-foreground/20"></div>
              {/if}
            </button>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Bottom gradient fade (fixed position) -->
    <div
      class="pointer-events-none sticky bottom-0 left-0 right-0 h-8 bg-linear-to-t from-sidebar to-transparent z-10"
    ></div>
  </div>
</div>

<!-- Hover Card - Outside scroll container, uses CSS Anchor Positioning. IMPORTANT: position-anchor must match for hover card and anchor element. -->
{#if hoveredItemId !== null}
  {@const hoveredItem = agentItems.find((i) => i.id === hoveredItemId)}
  {@const agentLineStats = hoveredItem
    ? lineChangesStore.getAgentStats(hoveredItem.id as import('$shared/types/branded-ids').AgentId)
    : undefined}
  {#if hoveredItem}
    {@const hoverSpecialistId = hoveredItem.specialist || hoveredItem.metadata?.specialist}
    <HoverCard anchor={'--agent-' + hoveredItemId}>
      <div class="space-y-2 w-full gap-3 pb-3">
        <div class="flex items-center gap-2 px-3 pt-3">
          <AuggieAvatar
            size={20}
            colorSeed={hoveredItem.id}
            faceSeed={hoveredItem.id}
            class={cn(hoveredItem.isResponding && 'animate-pulse')}
            specialist={hoverSpecialistId === 'spec-writer' ||
            hoverSpecialistId === 'implementor' ||
            hoverSpecialistId === 'verifier'
              ? hoverSpecialistId
              : null}
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <div class="font-medium text-sm truncate">{hoveredItem.name}</div>
              {#if hoveredItem.isBackground || hoveredItem.metadata?.isBackground}
                <span
                  class="px-1 py-0.5 text-ui font-bold bg-muted text-subtle rounded"
                >
                  BG
                </span>
              {/if}
            </div>
            <!-- Show line change stats if available -->
            {#if agentLineStats && (agentLineStats.additions > 0 || agentLineStats.deletions > 0)}
              <div class="flex items-center gap-1 mt-0.5">
                <LineChangeStats
                  additions={agentLineStats.additions}
                  deletions={agentLineStats.deletions}
                  size="xs"
                  showZero={false}
                />
                <span class="text-ui text-subtle">lines</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- Created at time -->
        <div class="px-3 text-xs text-subtle">
          {#if hoveredItem.createdAt}
            Created {formatRelativeTime(hoveredItem.createdAt)}
          {:else}
            Created at unknown time
          {/if}
        </div>

        {#if hoveredItem.lastUserMessage}
          <div class="px-3 whitespace-break-spaces wrap-break-word">
            <div class="text-xs text-subtle font-medium line-clamp-3">
              {hoveredItem.lastUserMessage}
            </div>
          </div>
        {:else if hoveredItem.messages && hoveredItem.messages.length > 0}
          <!-- Fallback: Show last message if lastUserMessage not extracted -->
          {@const lastMsg = hoveredItem.messages[hoveredItem.messages.length - 1]}
          {@const msgText = (() => {
            if (typeof lastMsg.content === 'string') return lastMsg.content;
            if (lastMsg.contentBlocks && Array.isArray(lastMsg.contentBlocks)) {
              const text = lastMsg.contentBlocks
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text || b.content || '')
                .join(' ')
                .trim();
              return text || '[No text content]';
            }
            return '[No content]';
          })()}
          <div class="px-3 whitespace-break-spaces wrap-break-word">
            <div class="text-xs text-subtle font-medium line-clamp-3">
              {lastMsg.role}: {msgText}
            </div>
          </div>
        {/if}

        {#if hoveredItem.lastResponse}
          <div class="px-3 whitespace-break-spaces wrap-break-word">
            <div class="text-xs line-clamp-3">
              {hoveredItem.lastResponse}
            </div>
          </div>
        {:else if !hoveredItem.lastUserMessage && hoveredItem.messages && hoveredItem.messages.length > 1}
          <!-- Fallback: Show second to last message if it's from assistant -->
          {@const secondLastMsg = hoveredItem.messages[hoveredItem.messages.length - 2]}
          {#if secondLastMsg.role === 'assistant' || secondLastMsg.role === 'Assistant'}
            {@const msgText = (() => {
              if (typeof secondLastMsg.content === 'string') return secondLastMsg.content;
              if (secondLastMsg.contentBlocks && Array.isArray(secondLastMsg.contentBlocks)) {
                const text = secondLastMsg.contentBlocks
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text || b.content || '')
                  .join(' ')
                  .trim();
                return text || '[No text content]';
              }
              return '[No content]';
            })()}
            <div class="px-3 whitespace-break-spaces wrap-break-word">
              <div class="text-xs line-clamp-3">
                {msgText}
              </div>
            </div>
          {/if}
        {/if}

        {#if hoveredItem.fileChanges && hoveredItem.fileChanges.length > 0}
          <div class="bg-muted/50 px-2 py-2">
            <FileChangesList
              fileChanges={hoveredItem.fileChanges}
              maxItems={7}
              showStats={true}
              compact
            />
          </div>
        {/if}

        {#if !hoveredItem.lastUserMessage && !hoveredItem.lastResponse && (!hoveredItem.fileChanges || hoveredItem.fileChanges.length === 0)}
          {#if hoveredItem.messages && hoveredItem.messages.length > 0}
            <div class="pb-3 px-2 text-xs text-subtle">
              {hoveredItem.messages.length}
              {hoveredItem.messages.length === 1 ? 'message' : 'messages'}
            </div>
          {:else}
            <div class="pb-3 px-2 text-xs text-subtle italic">No activity yet</div>
          {/if}
        {/if}
      </div>
    </HoverCard>
  {/if}
{/if}
