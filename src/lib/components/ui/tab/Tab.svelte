<script lang="ts">
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';
  import UnsavedIndicator from '../indicators/UnsavedIndicator.svelte';
  import AgentBadge from '../indicators/AgentBadge.svelte';
  import AugieAvatarWithState, {
    type AvatarState,
  } from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';

  interface RunningAgent {
    agentId: string;
    state: AvatarState;
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
  }

  interface Props {
    id?: string;
    active?: boolean;
    hasLeftCurve?: boolean;
    hasRightCurve?: boolean;
    isPinned?: boolean;
    hasUnsavedChanges?: boolean;
    agentCount?: number;
    /** Agents that are running or have unread messages - shown with avatar state */
    runningAgents?: RunningAgent[];
    class?: string;
    onclick?: (e: MouseEvent) => void;
    onclose?: (e: MouseEvent) => void;
    onauxclick?: (e: MouseEvent) => void;
    oncontextmenu?: (e: MouseEvent) => void;
    ondragstart?: (e: DragEvent) => void;
    ondragover?: (e: DragEvent) => void;
    ondragleave?: (e: DragEvent) => void;
    ondrop?: (e: DragEvent) => void;
    ondragend?: (e: DragEvent) => void;
    children?: Snippet;
    closeButton?: Snippet;
  }

  let {
    id,
    active = false,
    isPinned = false,
    hasUnsavedChanges = false,
    agentCount = 0,
    runningAgents = [],
    hasLeftCurve = true,
    hasRightCurve = true,
    class: className,
    onclick,
    onclose,
    onauxclick,
    oncontextmenu,
    ondragstart,
    ondragover,
    ondragleave,
    ondrop,
    ondragend,
    children,
    closeButton,
  }: Props = $props();

  let isHovered = $state(false);
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  draggable={true}
  role="tab"
  tabindex={active ? 0 : -1}
  data-tab-id={id}
  aria-selected={active}
  aria-label={`Space tab: ${id}`}
  class={cn(
    'tab-button group/tab-button relative h-9 px-1 text-sm font-medium cursor-pointer',
    active ? 'bg-sidebar text-foreground rounded-t-lg' : '',
    className,
  )}
  {onclick}
  {oncontextmenu}
  {ondragstart}
  {ondragover}
  {ondragleave}
  {ondrop}
  {ondragend}
  onauxclick={(e) => {
    // Middle mouse button (scroll wheel click) to close tab
    if (e.button === 1 && onclose) {
      e.preventDefault();
      e.stopPropagation();
      onclose(e);
    }
    onauxclick?.(e);
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onclick?.(e as unknown as MouseEvent);
    }
  }}
  onmouseenter={() => (isHovered = true)}
  onmouseleave={() => (isHovered = false)}
>
  <div
    class={cn(
      'px-3 h-8 pt-0.5 rounded-lg flex items-center gap-1.5 focus/tab-button:outline-none focus-visible/tab-button:ring-2 focus-visible/tab-button:ring-primary focus-visible/tab-button:ring-offset-2 transition-all duration-200',
      active
        ? ''
        : isPinned
          ? 'text-foreground bg-sidebar/30 hover:bg-sidebar/50'
          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar/50',
    )}
  >
    {#if active}
      {#if hasLeftCurve}
        <!-- Left curved corner -->
        <svg
          class="absolute left-0 bottom-0 w-3 transform -translate-x-full text-sidebar"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          <path d="M 1 0 L 1 1 L 0 1 Q 1 1 1 0 Z" fill="currentColor" />
        </svg>
      {/if}

      {#if hasRightCurve}
        <!-- Right curved corner -->
        <svg
          class="absolute right-0 bottom-0 w-3 transform translate-x-full text-sidebar"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          <path d="M 0 0 L 0 1 L 1 1 Q 0 1 0 0 Z" fill="currentColor" />
        </svg>
      {/if}
    {/if}

    <!-- Tab content -->
    <div class="flex items-center gap-1.5 min-w-0">
      {@render children?.()}
    </div>

    {#if runningAgents.length > 0 || agentCount > 0 || hasUnsavedChanges || closeButton || onclose}
      <!-- Indicators container -->
      <div class="flex items-center gap-1 ml-auto">
        <!-- Running/unread agents with avatars -->
        {#if runningAgents.length > 0}
          <div class="flex items-center -space-x-1">
            {#each runningAgents.slice(0, 2) as { agentId, state, specialist } (agentId)}
              <AugieAvatarWithState {agentId} size={14} {state} {specialist} class="" />
            {/each}
            {#if runningAgents.length > 2}
              <div
                class="flex items-center justify-center w-3.5 h-3.5 text-ui font-medium text-subtle"
              >
                +{runningAgents.length - 2}
              </div>
            {/if}
          </div>
        {:else if agentCount > 0}
          <!-- Fallback to agent count badge if no running agents -->
          <AgentBadge count={agentCount} />
        {/if}

        <!-- Unsaved changes indicator -->
        {#if hasUnsavedChanges}
          <UnsavedIndicator visible={true} />
        {/if}

        <!-- Close button -->
        {#if closeButton || onclose}
          <div
            class={cn(
              'transition-opacity duration-200 close-button-container',
              active || isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
          >
            {#if closeButton}
              {@render closeButton()}
            {:else}
              <button
                type="button"
                class="close-button flex items-center justify-center w-5 h-5 rounded hover:bg-foreground/10 active:bg-foreground/20 transition-all duration-150 shrink-0 -mr-2 opacity-50"
                onclick={(e) => {
                  e.stopPropagation();
                  onclose?.(e);
                }}
                aria-label={m.ui_tab_close_ariaLabel()}
                title={m.ui_tab_close_tooltip()}
              >
                <Fa icon={faXmark} size="xs" />
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .tab-button {
    -webkit-app-region: no-drag;
    /* Smooth transitions for all state changes */
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Smooth background color transitions */
  .tab-button:hover:not(:disabled) {
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Close button container smooth fade */
  .close-button-container {
    transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Close button hover effects */
  .close-button {
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .close-button:hover {
    transform: scale(1.1);
    will-change: transform;
  }

  .close-button:active {
    transform: scale(0.95);
  }

  /* Focus styles for keyboard navigation */
  .tab-button:focus-visible {
    outline: 2px solid hsl(var(--primary));
    outline-offset: -2px;
  }

  /* Respect prefers-reduced-motion */
  @media (prefers-reduced-motion: reduce) {
    .tab-button {
      transition: none;
    }

    .tab-button:hover:not(:disabled) {
      transition: none;
    }

    .close-button-container {
      transition: none;
    }

    .close-button {
      transition: none;
    }

    .close-button:hover {
      transform: none;
    }

    .close-button:active {
      transform: none;
    }

    .close-button svg {
      transition: none;
    }

    .close-button:hover svg {
      transform: none;
    }
  }
</style>
