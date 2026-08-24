<script lang="ts">
  import Fa from 'svelte-fa';
  import { cn } from '$lib/utils';
  import {
    getWorkspaceStatusPresentation,
    type WorkspaceStatusPresentationState,
  } from './utils/workspace-status-presentation';

  let {
    status,
    size = 14,
    decorative = false,
    inProgressDot = 'ringed',
    class: className,
  }: {
    status: WorkspaceStatusPresentationState;
    size?: number;
    decorative?: boolean;
    inProgressDot?: 'ringed' | 'solid';
    class?: string;
  } = $props();

  const presentation = $derived(getWorkspaceStatusPresentation(status));
</script>

<span
  class={cn(
    'workspace-status-icon inline-flex shrink-0 items-center justify-center forced-colors:text-[CanvasText]',
    presentation.className,
    className,
  )}
  style="width: {size}px; height: {size}px;"
  role={decorative ? undefined : 'img'}
  aria-label={decorative ? undefined : presentation.accessibleName}
  aria-hidden={decorative ? 'true' : undefined}
  title={decorative ? undefined : presentation.tooltip}
  data-workspace-status={presentation.state}
  data-workspace-status-visual={presentation.visual}
  data-workspace-status-icon={presentation.icon?.iconName}
>
  {#if presentation.visual === 'dot'}
    <span
      class={cn(
        'workspace-status-dot',
        presentation.state === 'in_progress' &&
          inProgressDot === 'ringed' &&
          'workspace-status-dot-ring',
      )}
      data-workspace-status-dot
    ></span>
  {:else if presentation.icon}
    <Fa icon={presentation.icon} class="size-full!" />
  {/if}
</span>

<style>
  :global(.workspace-status-color-active) {
    color: hsl(var(--agent-avatar-surface-active));
  }

  :global(.workspace-status-color-unread) {
    color: hsl(var(--workspace-status-unread));
  }

  .workspace-status-dot {
    display: block;
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    outline: none;
    background-color: currentColor;
    box-shadow: none;
  }

  .workspace-status-dot-ring {
    box-shadow: inset 0 0 0 1px hsl(var(--background));
  }

  :global(.dark) .workspace-status-dot-ring {
    box-shadow: none;
  }

  @media (forced-colors: active) {
    .workspace-status-dot {
      background-color: CanvasText;
      box-shadow: none;
    }
  }
</style>
