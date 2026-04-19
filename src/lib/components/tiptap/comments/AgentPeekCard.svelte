<script lang="ts">
  /**
   * AgentPeekCard
   *
   * A specialized card for displaying session comments with agent information.
   * Shows a preview of the agent conversation instead of a regular comment.
   */

  import { selectAgentLineStats } from '$lib/store/slices/line-changes/line-changes-selectors';
  import { getAgentPeekData, truncateToLines } from '$lib/utils/agent-peek-utils';
  import { useAgentSubscription } from '$lib/utils/agent-subscription.svelte';
  import { selectActiveWorkspace } from '$lib/store/slices/workspace/workspace-selectors';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import LineChangeStats from '$lib/components/shared/LineChangeStats.svelte';
  import AgentPreviewToolLabel from '$lib/components/chat/AgentPreviewToolLabel.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faArrowRight,
    faSpinner,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';

  type DisplayMode = 'full' | 'compact' | 'icon';

  interface Props {
    agentId: string;
    isCollapsed?: boolean;
    commentCreatedAt?: string; // ISO timestamp of when comment was created
    displayMode?: DisplayMode; // Display mode for responsive behavior
    onShow?: () => void; // Callback when clicking to expand (for icon/compact modes)
  }

  let {
    agentId,
    isCollapsed = false,
    commentCreatedAt,
    displayMode = 'full',
    onShow,
  }: Props = $props();

  const activeWorkspace = selectActiveWorkspace();

  // Use subscription utility for reliable reactivity with Maps
  // Pass the active workspace so the subscription is scoped to the current workspace
  // and doesn't accidentally pick up agent data from a different workspace (F9 fix).
  const agentSubscription = useAgentSubscription(agentId, $activeWorkspace);
  const agent = $derived(agentSubscription.current);
  const agentData = $derived(getAgentPeekData(agent));

  // Get line change stats
  const lineStats$ = selectAgentLineStats(agentId);
  const lineStats = $derived($lineStats$);

  // Truncate last response to 6 lines
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const truncatedResponse = $derived(
    agentData?.lastResponse ? truncateToLines(agentData.lastResponse, 6) : '',
  );

  const truncatedOneLine = $derived(
    agentData?.lastResponse ? truncateToLines(agentData.lastResponse, 1) : '',
  );

  // Determine if comment is recent (within 30 seconds)
  const RECENT_THRESHOLD_MS = 30000; // 30 seconds

  // Current time for reactivity (only update if needed)
  let currentTime = $state(Date.now());

  // Use $derived.by for computed values that don't need to be called as functions
  const isRecentComment = $derived.by(() => {
    if (!commentCreatedAt) return false;
    const createdAt = new Date(commentCreatedAt).getTime();
    // Use currentTime to make this reactive
    return currentTime - createdAt < RECENT_THRESHOLD_MS;
  });

  // Use $effect for time polling instead of onMount
  $effect(() => {
    // Only update time if agent is missing and comment is potentially recent
    if (!agent && commentCreatedAt) {
      const createdAt = new Date(commentCreatedAt).getTime();
      const age = Date.now() - createdAt;

      // Only set up interval if comment is still within the threshold
      if (age < RECENT_THRESHOLD_MS) {
        const interval = setInterval(() => {
          currentTime = Date.now();

          // Stop updating once we've passed the threshold
          const newAge = currentTime - createdAt;
          if (newAge >= RECENT_THRESHOLD_MS) {
            clearInterval(interval);
          }
        }, 1000);

        // Return cleanup function
        return () => clearInterval(interval);
      }
    }
  });
</script>

{#if displayMode === 'icon'}
  <!-- Icon mode - just show avatar -->
  {#if agentData}
    <button
      class="icon-button session-comment"
      onclick={() => onShow?.()}
      aria-label="Agent session: {agentData.name}"
    >
      <div class="icon-wrapper">
        <AuggieAvatar
          size={24}
          colorSeed={agentData.id}
          faceSeed={agentData.id}
          class={cn(agentData.isResponding && 'animate-pulse')}
        />
      </div>
    </button>
  {:else if isRecentComment}
    <!-- Waiting state in icon mode -->
    <button
      class="icon-button session-comment"
      onclick={() => onShow?.()}
      aria-label="Agent launching..."
    >
      <div class="icon-wrapper">
        <Fa icon={faSpinner} class="animate-spin" size="sm" />
      </div>
    </button>
  {:else}
    <!-- Error state in icon mode -->
    <button
      class="icon-button session-comment error"
      onclick={() => onShow?.()}
      aria-label="Agent not found"
    >
      <div class="icon-wrapper">
        <Fa icon={faExclamationTriangle} size="sm" />
      </div>
    </button>
  {/if}
{:else}
  <!-- Full mode (used for both compact and full display modes) -->
  <div
    class="flex flex-col bg-background rounded w-full min-w-[180px] transition-all duration-200"
    class:max-w-[380px]={!isCollapsed}
    class:cursor-pointer={isCollapsed}
    class:border={!isCollapsed}
    class:border-border={!isCollapsed}
    class:max-w-[180px]={displayMode === 'compact'}
  >
    {#if agentData}
      <!-- Header - Always visible (collapsed and expanded) -->
      <div class="flex items-center gap-2 px-3 py-2">
        <AuggieAvatar
          size={isCollapsed ? 18 : 20}
          colorSeed={agentData.id}
          faceSeed={agentData.id}
          class={cn(agentData.isResponding && 'animate-pulse')}
        />
        <div class="flex-1 min-w-0">
          {#if isCollapsed}
            <div class="font-medium truncate-end text-subtle text-xs italic">
              {#if truncatedOneLine}
                <span>{truncatedOneLine}</span>
              {:else if agentData.lastToolUse}
                <AgentPreviewToolLabel
                  toolUse={agentData.lastToolUse}
                  animate={agentData.isResponding}
                />
              {/if}
            </div>
          {:else}
            <div class="font-medium text-sm truncate">
              {agentData.name}<span class="text-xs text-subtle"
                >{agentData.isActive ? 'Active' : 'Idle'}</span
              >
            </div>
          {/if}
        </div>
        <!-- Navigate to agent button -->
        <Button
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          onclick={(e) => {
            e.stopPropagation();
            const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
            const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
            const openInAdjacentPanel = e.metaKey || e.ctrlKey;
            window.dispatchEvent(
              new CustomEvent('workspace:open-agent', {
                detail: { agentId: agentData.id, sourcePanelId, openInAdjacentPanel },
              }),
            );
          }}
        >
          <Fa icon={faArrowRight} class="h-3 w-3" />
        </Button>
      </div>

      <!-- Content - Only visible when expanded -->
      {#if !isCollapsed}
        <div class="px-3 pb-2">
          <!-- Line change stats -->
          {#if lineStats && (lineStats.additions > 0 || lineStats.deletions > 0)}
            <div class="flex items-center gap-1 mb-2">
              <LineChangeStats
                additions={lineStats.additions}
                deletions={lineStats.deletions}
                size="xs"
                showZero={false}
              />
              <span class="text-ui text-subtle">lines</span>
            </div>
          {/if}

          <!-- Last response -->
          {#if agentData?.lastResponse}
            <div class="text-xs whitespace-pre-wrap mb-2 line-clamp-3">
              {agentData?.lastResponse}
            </div>
          {:else if agentData?.lastToolUse}
            <div class="text-xs mb-2 line-clamp-3">
              <AgentPreviewToolLabel
                toolUse={agentData.lastToolUse}
                animate={agentData.isResponding}
              />
            </div>
          {/if}

          <!-- File changes -->
          {#if agentData.fileChanges && agentData.fileChanges.length > 0}
            <div class="text-xs text-subtle">
              {agentData.fileChanges.length} file{agentData.fileChanges.length === 1 ? '' : 's'} changed
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      <!-- Waiting for agent to register or error state -->
      <div class="px-3 py-2">
        {#if isRecentComment}
          <!-- Waiting for agent to register (comment is recent) -->
          <div class="flex items-center gap-2">
            <Fa icon={faSpinner} class="h-4 w-4 animate-spin text-ghost" />
            <div class="flex-1">
              <div class="text-sm font-medium">Waiting for Agent to Launch</div>
              <div class="text-xs text-subtle mt-0.5">
                Agent will appear here once ready...
              </div>
            </div>
          </div>
        {:else}
          <!-- Agent not found error (comment is old) -->
          <div class="flex items-start gap-2">
            <Fa icon={faExclamationTriangle} class="h-4 w-4 mt-0.5 text-destructive-foreground" />
            <div class="flex-1">
              <div class="text-sm font-medium text-destructive-foreground">
                {#if displayMode === 'full'}
                  Assigned{/if} Agent Not Found
              </div>
              <div
                class="text-xs text-subtle mt-0.5"
                class:hidden={displayMode !== 'full'}
              >
                The agent working on this area may have been deleted or failed to launch.
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .truncate-end {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    /* Beginning of string */
    direction: rtl;
    text-align: left;
  }

  /* Icon mode styles */
  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid;
    background: var(--background);
    cursor: pointer;
    transition: all 0.2s;
  }

  .icon-button.session-comment {
    border-color: rgb(125, 211, 252); /* sky-300 */
    background: rgb(224, 242, 254); /* sky-100 */
  }

  .icon-button.session-comment.error {
    border-color: var(--destructive);
    background: var(--destructive-foreground);
  }

  .icon-button:hover {
    transform: scale(1.1);
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
