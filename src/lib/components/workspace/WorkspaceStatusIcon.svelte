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
    justFinished = false,
    class: className,
  }: {
    status: WorkspaceStatusPresentationState;
    size?: number;
    decorative?: boolean;
    /** Pulses the unread dot while the workspace has just finished. */
    justFinished?: boolean;
    class?: string;
  } = $props();

  const presentation = $derived(getWorkspaceStatusPresentation(status));
  const finished = $derived(justFinished && presentation.state === 'unread');
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
  data-workspace-status-just-finished={finished || undefined}
>
  {#if presentation.visual === 'dot'}
    {#if finished}
      <span
        class="workspace-status-dot workspace-status-dot-ping animate-ping motion-reduce:animate-none"
        aria-hidden="true"
      ></span>
    {/if}
    <span
      class={cn('workspace-status-dot', finished && 'workspace-status-dot-finished')}
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

  .workspace-status-icon {
    position: relative;
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
    transition: background-color var(--spring-slow) var(--spring-slow-ease);
  }

  .workspace-status-dot-finished {
    animation: workspace-status-dot-finish var(--spring-slow) var(--spring-slow-ease);
  }

  .workspace-status-dot-ping {
    position: absolute;
    inset: 0;
    margin: auto;
    opacity: 0.6;
  }

  @keyframes workspace-status-dot-finish {
    from {
      transform: scale(0.5);
    }
    to {
      transform: scale(1);
    }
  }

  @container style(--motion-reduced: 1) {
    .workspace-status-dot {
      transition: none;
      animation: none;
    }

    .workspace-status-dot-ping {
      display: none;
    }
  }

  @media (forced-colors: active) {
    .workspace-status-dot {
      background-color: CanvasText;
      box-shadow: none;
    }

    .workspace-status-dot-ping {
      display: none;
    }
  }
</style>
