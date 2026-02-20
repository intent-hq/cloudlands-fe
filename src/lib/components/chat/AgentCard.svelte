<script lang="ts">
  /**
   * AgentCard Component
   *
   * A compact card that shows an agent's avatar, name, status, and message preview.
   * Uses subscription for real-time updates and displays line changes stats.
   * Listens to streaming events for real-time response updates.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import LineChangeStats from '$lib/components/shared/LineChangeStats.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { useAgentSubscription } from '$lib/utils/agent-subscription.svelte';
  import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
  import { getLastMeaningfulLine } from '$lib/utils/text-utils';
  import { lineChangesStore } from '$features/line-changes/line-changes.store.svelte';
  import { agentService } from '$features/agent/agent.service';
  import { AgentId } from '$shared/types/branded-ids';
  import AugieAvatarWithState from '../ui/auggie-avatar/AugieAvatarWithState.svelte';
  import SpecialistToolIcon from '../ui/auggie-avatar/SpecialistToolIcon.svelte';
  import { getAvatarState } from '../ui/auggie-avatar/avatar-state';
  import { permissionStore } from '$lib/stores/permission.store.svelte';
  import { slide } from 'svelte/transition';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { sessionStore } from '$features/agent/browser';
  import { getPanelLayoutManager, hasPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import type { Workspace } from '$shared/types';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import {
    faArrowUpRightFromSquare,
    faPen,
    faStop,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    agentId: string;
    /** Optional static agent name (used when agent data not yet loaded) */
    agentName?: string;
    /** Whether to show background agent indicator */
    isBackground?: boolean;
    /** Optional click handler override */
    onclick?: () => void;
    /** Completion report from the agent (passed from event data) */
    completionReport?: string;
    /** Last response summary from the agent (passed from event data, used as fallback) */
    lastResponseSummary?: string;
    /** Whether this card is selected/active */
    selected?: boolean;
    /** Hierarchy depth for indentation (0 = root) */
    depth?: number;
    /** Always show border (useful for overview/standalone cards) */
    showBorder?: boolean;
    /** Show colored border based on agent state (green for running, red for failed, etc.) */
    showStateBorder?: boolean;
    /** Optional workspace to load agent session from (for home page usage) */
    workspace?: Workspace | null;
  }

  let {
    agentId,
    agentName,
    isBackground = false,
    onclick,
    completionReport,
    lastResponseSummary,
    selected = false,
    depth = 0,
    showBorder = false,
    showStateBorder = false,
    workspace = null,
  }: Props = $props();

  // Inline editing state
  let isEditing = $state(false);
  let editingValue = $state('');
  let editInputRef: HTMLInputElement | null = $state(null);

  // Context menu state
  let contextMenu: { x: number; y: number } | null = $state(null);

  // Start editing the agent name
  async function startEditing() {
    editingValue = displayName;
    isEditing = true;
    await tick();
    editInputRef?.focus();
    editInputRef?.select();
  }

  // Save the edited name
  function saveEdit() {
    if (editingValue.trim() && editingValue.trim() !== displayName) {
      sessionStore.updateSession(agentId, { name: editingValue.trim() });
      // Persist the name change to disk
      const session = sessionStore.getSession(agentId);
      if (session?.workspaceId) {
        agentService.saveSession(agentId, session.workspaceId, true);
      }
    }
    cancelEdit();
  }

  // Cancel editing
  function cancelEdit() {
    isEditing = false;
    editingValue = '';
  }

  // Handle keyboard events during editing
  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation(); // Prevent bubbling to parent button which would trigger startEditing again
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }

  // Handle double-click on name
  function handleNameDoubleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startEditing();
  }

  // Handle keyboard events on the card button
  function handleCardKeydown(e: KeyboardEvent) {
    // Enter key starts editing the agent name
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      startEditing();
    }
  }

  // Context menu handlers
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function getContextMenuItems(): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: 'Open',
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          window.dispatchEvent(
            new CustomEvent('workspace:open-agent', {
              detail: { agentId },
            }),
          );
          closeContextMenu();
        },
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: faPen,
        onClick: () => {
          startEditing();
          closeContextMenu();
        },
      },
    ];

    // Add stop option if agent is running
    if (avatarState === 'running' || avatarState === 'responding') {
      items.push({
        id: 'stop',
        label: 'Stop',
        icon: faStop,
        onClick: async () => {
          await agentService.stopSession(agentId);
          closeContextMenu();
        },
      });
    }

    items.push({ type: 'separator' });
    items.push({
      id: 'delete',
      label: 'Delete',
      icon: faTrash,
      destructive: true,
      onClick: async () => {
        // Close related panel tabs before deleting
        const session = sessionStore.getSession(agentId);
        const sessionWorkspaceId = session?.workspaceId;
        if (sessionWorkspaceId && hasPanelLayoutManager(sessionWorkspaceId)) {
          const layoutManager = getPanelLayoutManager(sessionWorkspaceId);
          layoutManager.closeTabsMatching((tab) => tab.type === 'agent' && tab.agentId === agentId);
        }
        closeContextMenu();

        await agentService.deleteSessionWithUndo({
          agentId,
          workspaceId: sessionWorkspaceId,
          agentName: agentName || undefined,
        });
      },
    });

    return items;
  }

  // Subscribe to agent updates for real-time streaming
  // Pass workspace to allow loading from disk when on home page (workspaceStore.current is null)
  const agentSubscription = useAgentSubscription(agentId, workspace);
  const agent = $derived(agentSubscription.current);
  const agentData = $derived(getAgentPeekData(agent));

  // Get parent agent ID from metadata (for delegation info)
  const parentAgentId = $derived(agentData?.parentAgentId);

  // Get parent agent name directly from agentService (reactive via $derived)
  // Note: We use agentService.getSession() instead of useAgentSubscription because
  // useAgentSubscription captures the agentId at hook creation time, but parentAgentId
  // might not be available until the agent metadata loads.
  const delegatedByName = $derived.by(() => {
    if (!parentAgentId) return undefined;
    const parentSession = agentService.getSession(parentAgentId);
    return parentSession?.name;
  });

  // Get line changes for this agent
  const lineChanges = $derived(lineChangesStore.getAgentStats(AgentId(agentId)));

  // Streaming state - updated via events for real-time display
  let streamingBuffer: string = $state('');
  let isStreamActive: boolean = $state(false);
  let streamListenerCleanup: (() => void) | undefined;

  // Listen to streaming events for real-time updates
  onMount(() => {
    const streamEventName = `agent:stream:${agentId}`;
    const messageSentEventName = `agent:message-sent:${agentId}`;

    const streamListener = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { type, content } = customEvent.detail || {};

      if (type === 'start') {
        // Message processing has started
        isStreamActive = true;
      } else if (type === 'chunk' && content) {
        streamingBuffer += content;
        isStreamActive = true;
      } else if (type === 'end' || type === 'complete') {
        isStreamActive = false;
        streamingBuffer = '';
      } else if (type === 'error') {
        isStreamActive = false;
        streamingBuffer = '';
      }
    };

    // Listen for message sent event to show running state immediately
    const messageSentListener = () => {
      isStreamActive = true;
    };

    window.addEventListener(streamEventName, streamListener);
    window.addEventListener(messageSentEventName, messageSentListener);
    streamListenerCleanup = () => {
      window.removeEventListener(streamEventName, streamListener);
      window.removeEventListener(messageSentEventName, messageSentListener);
    };
  });

  onDestroy(() => {
    streamListenerCleanup?.();
  });

  // Extract display data
  const displayName = $derived(agentData?.name || agentName || 'Agent');
  const lastUserMsg = $derived(
    // filter out [Currently viewing: ...] prefixes
    agentData?.lastUserMessage?.replace(/^\[.*?\]\s*/g, '') || '',
  );
  // Use centralized getAvatarState for consistent state calculation
  const avatarState = $derived(
    getAvatarState(
      {
        isStreaming: isStreamActive || agentData?.isResponding,
        status: agentData?.status,
      },
      {
        hasPermissionRequest: permissionStore.getPendingCount(agentId) > 0,
      },
    ),
  );

  // Get specialist ID from agent metadata (for avatar overlay)
  const specialist = $derived.by(() => {
    const specialistId = agent?.metadata?.specialist || agent?.agentMetadata?.specialist;
    return specialistId || null;
  });

  // Map specialist ID to display name using unified lookup
  // Includes built-in and custom specialists
  const specialistDisplayName = $derived.by(() => {
    if (!specialist) return null;
    return specialistsStore.getSpecialistName(specialist);
  });

  // Show streaming content if actively streaming, otherwise show last response
  const lastResponse = $derived.by(() => {
    if (isStreamActive && streamingBuffer) {
      return getLastMeaningfulLine(streamingBuffer);
    }
    return agentData?.lastResponse ? getLastMeaningfulLine(agentData.lastResponse) : '';
  });

  const updatedAt = $derived(agent?.updatedAt);

  // Border color based on state - only show colored border if showStateBorder is true
  const isRunning = $derived(avatarState === 'running' || avatarState === 'responding');
  const glowClass = $derived.by(() => {
    if (!showStateBorder) return '';
    if (isRunning) return 'agent-glow-active';
    if (avatarState === 'failed') return 'shadow shadow-red-500 shadow-sm';
    if (avatarState === 'needs-permission') return 'shadow shadow-amber-500 shadow-sm';
    if (avatarState === 'waiting') return 'shadow shadow-amber-500 shadow-sm';
    return 'glow-transparent';
  });

  // Show completion report if available - priority order:
  // 1. Digest from <agent_digest> tag (most concise, agent-provided summary)
  // 2. Completion report from report_to_parent tool (prop from event data)
  // 3. Completion report from agent metadata
  // 4. lastResponseSummary (fallback from event data)
  const effectiveCompletionReport = $derived(
    agentData?.digest || completionReport || agentData?.completionReport || lastResponseSummary,
  );

  // Handle click - navigate to agent
  function handleClick(event: MouseEvent) {
    if (onclick) {
      onclick();
    } else {
      // Use workspace:open-agent event for panel layout support (no toggle behavior)
      const sourcePanelId = findSourcePanelId(event.target);
      const openInAdjacentPanel = event.metaKey || event.ctrlKey;
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId, sourcePanelId, openInAdjacentPanel },
        }),
      );
    }
  }
</script>

<div
  style="padding-left: {depth * 10}px; container-type: inline-size;"
  class="relative agent-card-container"
  data-agent-id={agentId}
>
  <button
    type="button"
    class="w-full text-left flex gap-2 px-1.75 pt-1.25 pb-1.5 transition-colors duration-150 cursor-pointer group border {selected ||
    showBorder
      ? `bg-background border-border ${glowClass} shadow-xs`
      : 'border-transparent'}"
    onclick={handleClick}
    onkeydown={handleCardKeydown}
    oncontextmenu={handleContextMenu}
  >
    <div class="relative shrink-0 mt-[-0.8px] -mb-1">
      <AugieAvatarWithState
        {agentId}
        size={20}
        state={avatarState}
        specialist={specialist as import('$lib/constants/specialists').BuiltinSpecialistId | null}
      />
    </div>

    <div class="agent-card-content flex-1 min-w-0 flex flex-col">
      <!-- Header row -->
      <div class="flex items-center gap-1.5 pr-1.5">
        <!-- Avatar with streaming indicator -->

        <div class="flex-1 min-w-0 font-medium flex items-center">
          {#if isEditing}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:this={editInputRef}
              type="text"
              bind:value={editingValue}
              onblur={saveEdit}
              onkeydown={handleEditKeydown}
              class="text-sm truncate bg-transparent border-none outline-none! ring-0! focus:ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! min-w-0 flex-1 text-foreground/90"
              onclick={(e) => e.stopPropagation()}
            />
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <h3
              class="shrink whitespace-nowrap text-sm truncate text-foreground/90 group-hover:text-foreground"
              ondblclick={handleNameDoubleClick}
            >
              {displayName}
            </h3>
          {/if}
          <!-- {#if specialist}
            <span
              class="specialist-icon shrink-0 text-muted-foreground/60 dark:text-background ml-1.5 mr-0.5"
            >
              <SpecialistToolIcon {specialist} size={12} muted />
            </span>
            <span class="specialist-text text-[10px] text-muted-foreground/60 shrink-0">
              {specialistDisplayName}
            </span>
          {/if} -->
          {#if delegatedByName}
            <span
              class="shrink-3 delegated-by-text truncate text-[10px] text-muted-foreground/50 whitespace-nowrap ml-1"
            >
              · Delegated by {delegatedByName}
            </span>
          {/if}
          {#if isBackground}
            <div
              class="ml-auto px-1 py-0.5 text-[8px] font-bold bg-muted text-muted-foreground rounded mr-1"
            >
              BG
            </div>
          {/if}
        </div>

        <div class="flex items-center gap-2 shrink-0">
          {#if lineChanges && (lineChanges.additions > 0 || lineChanges.deletions > 0)}
            <LineChangeStats
              additions={lineChanges.additions}
              deletions={lineChanges.deletions}
              size="xs"
            />
          {/if}
          {#if updatedAt}
            <RelativeTime date={updatedAt} compact class="text-[10px] text-muted-foreground/40" />
          {/if}
        </div>
      </div>

      <!-- Message preview - show completion report if available, otherwise last response -->
      {#if effectiveCompletionReport}
        <div class="mt-0.5">
          <p class="text-sm text-foreground/70 truncate">
            {effectiveCompletionReport}
          </p>
        </div>
      {:else if lastUserMsg || lastResponse}
        <div class="space-y-0.5">
          {#if lastResponse}
            <p
              class="text-sm text-muted-foreground/60 truncate"
              transition:slide={{ axis: 'y', duration: 150 }}
            >
              {lastResponse}
            </p>
          {:else if lastUserMsg}
            <p class="text-sm text-muted-foreground truncate">
              {lastUserMsg}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  </button>
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={getContextMenuItems()}
    onClickOutside={closeContextMenu}
  />
{/if}

<style>
  /* Hide text content when container is too narrow (< 80px) */
  @container (max-width: 80px) {
    .agent-card-content {
      display: none;
    }
  }

  /* Default: show text, hide icon */
  .specialist-text {
    display: inline;
  }

  /* When narrow (< 300px): show icon, hide text */
  @container (max-width: 300px) {
    .specialist-text {
      display: none;
    }
    .specialist-icon {
      display: inline-flex;
    }
    .delegated-by-text {
      display: none;
    }
  }

  /* Glowing gradient animation for active/running agents */
  :global(.agent-glow-active) {
    position: relative;
    box-shadow: 0 0 12px 2px rgba(16, 185, 129, 0.1);
    animation: agent-glow-pulse 2s ease-in-out infinite;
  }

  :global(.agent-glow-active)::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      135deg,
      rgba(16, 185, 129, 0.2) 0%,
      rgba(52, 211, 153, 0.1) 25%,
      rgba(16, 185, 129, 0.2) 50%,
      rgba(52, 211, 153, 0.1) 75%,
      rgba(16, 185, 129, 0.2) 100%
    );
    background-size: 200% 200%;
    animation: agent-gradient-shift 2s linear infinite;
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    z-index: 1;
  }

  @keyframes agent-glow-pulse {
    0%,
    100% {
      box-shadow: 0 0 9px 2px rgba(16, 185, 129, 0.1);
    }
    50% {
      box-shadow: 0 0 12px 4px rgba(16, 185, 129, 0.13);
    }
  }

  @keyframes agent-gradient-shift {
    0% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 200% 50%;
    }
  }

  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    :global(.agent-glow-active) {
      animation: none;
      box-shadow: 0 0 10px 3px rgba(16, 185, 129, 0.12);
    }
    :global(.agent-glow-active)::before {
      animation: none;
      background-position: 0% 50%;
    }
  }
</style>
