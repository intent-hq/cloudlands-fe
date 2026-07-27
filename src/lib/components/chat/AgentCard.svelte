<script lang="ts">
  /**
   * AgentCard Component
   *
   * A compact card that shows an agent's avatar, name, status, and message preview.
   * Uses subscription for real-time updates and displays line changes stats.
   * Reads Redux-owned streaming state for real-time response updates.
   */
  import { tick } from 'svelte';
  import { writable } from 'svelte/store';
  import { toast } from 'svelte-sonner';
  import LineChangeStats from '$lib/components/shared/LineChangeStats.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import {
  selectAgentSession,
  selectAgentIsResponding,
  selectAgentSessionStreamingContent,
  selectAgentIsWaiting,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
  import {
  deleteAgentWithUndoRequested,
  ensureAgentSessionLoaded,
  renameAgentSessionRequested,
  stopAgentSessionRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
  import { getLastMeaningfulLine } from '$lib/utils/text-utils';
  import AgentPreviewToolLabel from './AgentPreviewToolLabel.svelte';
  import { selectAgentLineStats } from '$store/renderer/slices/changes/changes-selectors';
  import AugieAvatarWithState from '../ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { getAvatarState } from '../ui/auggie-avatar/avatar-state';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingCount } from '$store/renderer/slices/permission/permission-selectors';
  import { slide } from 'svelte/transition';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
  getPanelLayoutManager,
  hasPanelLayoutManager,
} from '$features/layout/panel-layout-adapter';
  import type { Workspace } from '$shared/types';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';

  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import {
  faArrowUpRightFromSquare,
  faFolderOpen,
  faPen,
  faStop,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import { store as appStore } from '$store/renderer/store';
  import { invoke } from '$lib/electron-bridge';
  import { selectIsDaemonLocal } from '$store/renderer/slices/daemon-health/daemon-health-selectors';

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
    /** Hide the message preview / second line */
    hidePreview?: boolean;
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
    hidePreview = false,
    workspace = null,
  }: Props = $props();

  // svelte-ignore state_referenced_locally -- selectors are initialized with the current agent; the effect below mirrors prop changes.
  const agentIdStore = writable(agentId);
  $effect(() => {
    agentIdStore.set(agentId);
  });

  const agentPermCount = selectPendingCount(agentIdStore);

  $effect(() => {
    const wsId = workspace?.id;
    if (wsId) {
      appStore.dispatch(ensureAgentSessionLoaded(String(wsId), agentId));
    }
  });

  // Inline editing state
  let isEditing = $state(false);
  let editingValue = $state('');
  let editInputRef: HTMLInputElement | null = $state(null);

  // Context menu state
  let contextMenu: { x: number; y: number } | null = $state(null);

  // Platform file-manager label (locality-gated reveal ⇒ daemon host is this
  // machine, so the client platform matches; PanelTabBar idiom).
  const isWindows = typeof navigator !== 'undefined' && navigator.platform?.startsWith('Win');
  const isMac =
    typeof navigator !== 'undefined' &&
    // @ts-expect-error - userAgentData is not in all browsers
    (navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  const fileManagerName = isWindows ? 'Explorer' : isMac ? 'Finder' : 'File Manager';

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
      const wsId = $agent$?.workspaceId
        ? String($agent$.workspaceId)
        : workspace?.id
          ? String(workspace.id)
          : undefined;
      if (wsId) {
        const trimmed = editingValue.trim();
        // Capture previous values before the optimistic dispatch so a failed
        // rename can revert back to exactly what the user saw.
        const previousName = displayName;
        const previousNameExplicitlySet = $agent$?.nameExplicitlySet ?? false;
        appStore.dispatch(
          updateAgentSessionFields(agentId, {
            name: trimmed,
            nameExplicitlySet: true,
          } as any),
        );
        const action = renameAgentSessionRequested(wsId, agentId, trimmed);
        appStore.dispatch(action);
        action.promise.catch(() => {
          // Revert the optimistic dispatch so Redux matches disk, then notify.
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: previousName,
              nameExplicitlySet: previousNameExplicitlySet,
            } as any),
          );
          toast.error('Failed to rename agent');
        });
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
          {
            const wsId = $agent$?.workspaceId
              ? String($agent$.workspaceId)
              : workspace?.id
                ? String(workspace.id)
                : undefined;
            if (wsId) {
              appStore.dispatch(openAgentTabRequested(wsId, { agentId }));
            }
          }
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

    // Reveal the agent's CoW sandbox directory — daemon-host desktop action,
    // only offered when the agent has a sandbox and the daemon runs on this
    // machine (PROTOCOL §5.14 locality; same gate as other reveal affordances).
    const sandboxPath = agentSandboxPath;
    if (sandboxPath && selectIsDaemonLocal.select(appStore.state)) {
      items.push({
        id: 'reveal-sandbox',
        label: `Reveal in ${fileManagerName}`,
        icon: faFolderOpen,
        onClick: async () => {
          closeContextMenu();
          try {
            await invoke('shell:showItemInFolder', { path: sandboxPath });
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : `Failed to reveal in ${fileManagerName}`,
            );
          }
        },
      });
    }

    // Add stop option if agent is running
    if (avatarState === 'running' || avatarState === 'responding') {
      items.push({
        id: 'stop',
        label: 'Stop',
        icon: faStop,
        onClick: async () => {
          const wsId = $agent$?.workspaceId
            ? String($agent$.workspaceId)
            : workspace?.id
              ? String(workspace.id)
              : undefined;
          if (wsId) {
            const action = stopAgentSessionRequested(wsId, agentId);
            appStore.dispatch(action);
            await action.promise;
          }
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
        const sessionWorkspaceId = $agent$?.workspaceId
          ? String($agent$.workspaceId)
          : workspace?.id
            ? String(workspace.id)
            : undefined;
        if (sessionWorkspaceId && hasPanelLayoutManager(sessionWorkspaceId)) {
          const layoutManager = getPanelLayoutManager(sessionWorkspaceId);
          layoutManager.closeTabsByType('agent', 'agentId', agentId);
        }
        closeContextMenu();

        if (sessionWorkspaceId) {
          const action = deleteAgentWithUndoRequested(
            sessionWorkspaceId,
            agentId,
            agentName || undefined,
          );
          appStore.dispatch(action);
          await action.promise;
        }
      },
    });

    return items;
  }

  // Reactive agent session from Redux; ensureAgentSessionLoaded dispatch
  // above handles the disk restore.
  const agent$ = selectAgentSession(agentIdStore);
  const agentIsResponding$ = selectAgentIsResponding(agentIdStore);
  const agentIsWaiting$ = selectAgentIsWaiting(agentIdStore);
  const agentData = $derived(getAgentPeekData($agent$));

  // Get parent agent ID from metadata (for delegation info)
  const parentAgentId = $derived(agentData?.parentAgentId);

  // Mirror the parent agent ID into a writable so the Redux selector
  // re-evaluates reactively: the "Delegated by" label appears as soon as
  // the parent session lands in state (e.g. on workspace restore) without
  // requiring a re-render of this component.
  const parentAgentIdStore = writable<string>('');
  $effect(() => {
    parentAgentIdStore.set(parentAgentId ?? '');
  });
  const parentAgent$ = selectAgentSession(parentAgentIdStore);
  const delegatedByName = $derived(parentAgentId ? $parentAgent$?.name : undefined);

  // Get line changes for this agent
  const lineChanges$ = selectAgentLineStats(agentIdStore);

  // Streaming state is derived from Redux-owned stream lifecycle/message state.
  const streamingContent$ = selectAgentSessionStreamingContent(agentIdStore);
  const streamingBuffer = $derived($streamingContent$);
  const isStreamActive = $derived($agentIsResponding$ && !$agentIsWaiting$);

  // Extract display data
  const displayName = $derived(agentData?.name || agentName || 'Agent');
  const lastUserMsg = $derived(
    // filter out [Currently viewing: ...] prefixes and @context[...] mentions (raw base64/pipe format)
    agentData?.lastUserMessage
      ?.replace(/^\[.*?\]\s*/g, '')
      ?.replace(/@context\[[^\]]*\]/g, '')
      ?.trim() || '',
  );
  // Use centralized getAvatarState for consistent state calculation
  const avatarState = $derived(
    getAvatarState(
      {
        isStreaming: isStreamActive || ($agentIsResponding$ && !$agentIsWaiting$),
        status: $agentIsWaiting$ ? 'waiting' : agentData?.status,
      },
      {
        hasPermissionRequest: $agentPermCount > 0,
      },
    ),
  );

  // Get specialist ID from agent metadata (for avatar overlay)
  const specialist = $derived.by(() => {
    const specialistId = $agent$?.metadata?.specialist || $agent$?.agentMetadata?.specialist;
    return specialistId || null;
  });

  // Sandbox directory for sandboxed agents (daemon-provided metadata).
  const agentSandboxPath = $derived.by(() => {
    const path = $agent$?.metadata?.sandboxPath || $agent$?.agentMetadata?.sandboxPath;
    return typeof path === 'string' && path.length > 0 ? path : null;
  });

  // Show streaming content if actively streaming, otherwise show last response.
  // When actively streaming, prefer the live text buffer so we reflect
  // character-by-character progress. Tool previews (lastToolUse) only kick in
  // when there's no meaningful text to show.
  const lastResponse = $derived.by(() => {
    if (isStreamActive && streamingBuffer) {
      const line = getLastMeaningfulLine(streamingBuffer);
      if (line) return line;
    }
    return agentData?.lastResponse ? getLastMeaningfulLine(agentData.lastResponse) : '';
  });

  // Tool-use block to preview when the latest thing the agent did was a tool
  // call (see agent-peek-utils). Only used when there's no text to display.
  const lastToolUse = $derived(agentData?.lastToolUse);

  const updatedAt = $derived($agent$?.updatedAt);

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
      const sourcePanelId = findSourcePanelId(event.target);
      const openInAdjacentPanel = event.metaKey || event.ctrlKey;
      const wsId = $agent$?.workspaceId
        ? String($agent$.workspaceId)
        : workspace?.id
          ? String(workspace.id)
          : undefined;
      if (!wsId) return;
      appStore.dispatch(
        openAgentTabRequested(wsId, {
          agentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }
</script>

{#snippet agentCardContent()}
  <div
    style="padding-left: {depth * 10}px; container-type: inline-size;"
    class="relative agent-card-container"
    data-agent-id={agentId}
    data-testid="agent-list-item"
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
                class="text-sm truncate bg-transparent border-none outline-none! ring-0! focus:ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! min-w-0 flex-1 text-foreground"
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <h3
                class="min-w-0 shrink whitespace-nowrap text-sm truncate text-foreground/90 group-hover:text-foreground"
                ondblclick={handleNameDoubleClick}
              >
                {displayName}
              </h3>
            {/if}
            <!-- {#if specialist}
            <span
              class="specialist-icon shrink-0 text-subtle dark:text-background ml-1.5 mr-0.5"
            >
              <SpecialistToolIcon {specialist} size={12} muted />
            </span>
            <span class="specialist-text text-ui text-subtle shrink-0">
              {specialistDisplayName}
            </span>
          {/if} -->
            {#if delegatedByName}
              <span
                class="delegated-by-text ml-1 min-w-0 shrink truncate whitespace-nowrap text-ui text-subtle"
              >
                · Delegated by {delegatedByName}
              </span>
            {/if}
            {#if isBackground}
              <div class="ml-auto px-1 py-0.5 text-ui font-bold bg-muted text-subtle rounded mr-1">
                BG
              </div>
            {/if}
          </div>

          <div class="flex items-center gap-2 shrink-0">
            {#if $lineChanges$ && ($lineChanges$.additions > 0 || $lineChanges$.deletions > 0)}
              <LineChangeStats
                additions={$lineChanges$.additions}
                deletions={$lineChanges$.deletions}
                size="xs"
              />
            {/if}
            {#if updatedAt}
              <RelativeTime date={updatedAt} compact class="text-ui text-subtle" />
            {/if}
          </div>
        </div>

        <!-- Message preview - show completion report if available, otherwise last response -->
        {#if !hidePreview}
          {#if effectiveCompletionReport}
            <div class="mt-0.5">
              <p class="text-sm text-subtle truncate">
                {effectiveCompletionReport}
              </p>
            </div>
          {:else if lastUserMsg || lastResponse || lastToolUse}
            <div class="space-y-0.5">
              {#if lastResponse}
                <p
                  class="text-sm text-subtle truncate"
                  data-testid="agent-card-preview"
                  transition:slide={{ axis: 'y', duration: 150 }}
                >
                  {lastResponse}
                </p>
              {:else if lastToolUse}
                <div
                  class="text-sm text-subtle truncate"
                  data-testid="agent-card-preview"
                  transition:slide={{ axis: 'y', duration: 150 }}
                >
                  <AgentPreviewToolLabel toolUse={lastToolUse} animate={isRunning} />
                </div>
              {:else if lastUserMsg}
                <p class="text-sm text-subtle truncate" data-testid="agent-card-preview">
                  {lastUserMsg}
                </p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </button>
  </div>
{/snippet}

{@render agentCardContent()}

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
