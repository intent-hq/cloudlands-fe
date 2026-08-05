<script lang="ts">
  /**
   * AgentPeekCard
   *
   * A specialized card for displaying session comments with agent information.
   * Shows a preview of the agent conversation instead of a regular comment.
   */

  import { selectAgentLineStats } from '$store/renderer/slices/changes/changes-selectors';
  import { requestAgentLineStats } from '$store/renderer/slices/changes/changes-slice';
  import {
  getAgentPeekData,
  truncateToLines,
} from '$lib/utils/agent-peek-utils';

  import { selectAgentIsResponding } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
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
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { writable } from 'svelte/store';

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
  // svelte-ignore state_referenced_locally -- selectors are initialized with the current agent; the effect below mirrors prop changes.
  const agentIdStore = writable(agentId);
  $effect(() => {
    agentIdStore.set(agentId);
  });

  // Reactive agent session from Redux. The ensure saga dispatch below
  // triggers the disk restore; running it in an effect ensures we
  // re-dispatch when the active workspace or agentId changes while the
  // component stays mounted.
  const agent$ = selectAgentSession(agentIdStore);
  const agentIsResponding$ = selectAgentIsResponding(agentIdStore);
  const agentData = $derived(getAgentPeekData($agent$));

  $effect(() => {
    const workspace = $activeWorkspace;
    if (!workspace?.id) return;
    appStore.dispatch(ensureAgentSessionLoaded(String(workspace.id), agentId));
  });

  // Get line change stats
  const lineStats$ = selectAgentLineStats(agentIdStore);

  $effect(() => {
    if (displayMode === 'icon' || isCollapsed) return;
    appStore.dispatch(requestAgentLineStats(agentId));
  });

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
    if (!$agent$ && commentCreatedAt) {
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
      aria-label={m.tiptap_agentPeek_session_ariaLabel({ name: agentData.name })}
    >
      <div class="icon-wrapper">
        <AuggieAvatar
          size={24}
          agentId={agentData.id}
          class={cn($agentIsResponding$ && 'animate-pulse')}
        />
      </div>
    </button>
  {:else if isRecentComment}
    <!-- Waiting state in icon mode -->
    <button
      class="icon-button session-comment"
      onclick={() => onShow?.()}
      aria-label={m.tiptap_agentPeek_launching_ariaLabel()}
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
      aria-label={m.tiptap_agentPeek_notFound_ariaLabel()}
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
          agentId={agentData.id}
          class={cn($agentIsResponding$ && 'animate-pulse')}
        />
        <div class="flex-1 min-w-0">
          {#if isCollapsed}
            <div class="font-medium truncate-end text-subtle text-xs italic">
              {#if truncatedOneLine}
                <span>{truncatedOneLine}</span>
              {:else if agentData.lastToolUse}
                <AgentPreviewToolLabel
                  toolUse={agentData.lastToolUse}
                  animate={$agentIsResponding$}
                />
              {/if}
            </div>
          {:else}
            <div class="font-medium text-sm truncate">
              {agentData.name}<span class="text-xs text-subtle"
                >{$agentIsResponding$ ? m.tiptap_agentPeek_active_label() : m.tiptap_agentPeek_idle_label()}</span
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
            const wsId = $activeWorkspace?.id;
            if (wsId) {
              appStore.dispatch(
                openAgentTabRequested(wsId, {
                  agentId: agentData.id,
                  sourcePanelId,
                  openInAdjacentPanel,
                }),
              );
            }
          }}
        >
          <Fa icon={faArrowRight} class="h-3 w-3" />
        </Button>
      </div>

      <!-- Content - Only visible when expanded -->
      {#if !isCollapsed}
        <div class="px-3 pb-2">
          <!-- Line change stats -->
          {#if $lineStats$ && ($lineStats$.additions > 0 || $lineStats$.deletions > 0)}
            <div class="flex items-center gap-1 mb-2">
              <LineChangeStats
                additions={$lineStats$.additions}
                deletions={$lineStats$.deletions}
                size="xs"
                showZero={false}
              />
              <span class="text-ui text-subtle">{m.tiptap_agentPeek_lines_label()}</span>
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
                animate={$agentIsResponding$}
              />
            </div>
          {/if}

          <!-- File changes -->
          {#if agentData.fileChanges && agentData.fileChanges.length > 0}
            <div class="text-xs text-subtle">
              {agentData.fileChanges.length === 1
                ? m.tiptap_agentPeek_filesChanged_one()
                : m.tiptap_agentPeek_filesChanged_many({
                    count: formatInteger(agentData.fileChanges.length),
                  })}
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
              <div class="text-sm font-medium">{m.tiptap_agentPeek_waitingLaunch_label()}</div>
              <div class="text-xs text-subtle mt-0.5">{m.tiptap_agentPeek_appearOnceReady_label()}</div>
            </div>
          </div>
        {:else}
          <!-- Agent not found error (comment is old) -->
          <div class="flex items-start gap-2">
            <Fa icon={faExclamationTriangle} class="h-4 w-4 mt-0.5 text-destructive-foreground" />
            <div class="flex-1">
              <div class="text-sm font-medium text-destructive-foreground">
                {displayMode === 'full'
                  ? m.tiptap_agentPeek_assignedNotFound_label()
                  : m.tiptap_agentPeek_notFound_label()}
              </div>
              <div class="text-xs text-subtle mt-0.5" class:hidden={displayMode !== 'full'}>
                {m.tiptap_agentPeek_mayBeDeleted_description()}
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
