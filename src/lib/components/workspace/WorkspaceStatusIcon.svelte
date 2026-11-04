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
    /** Shows the unread dot as a strong green "just finished" dot. */
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
    transition:
      background-color var(--spring-slow) var(--spring-slow-ease),
      box-shadow var(--spring-slow) var(--spring-slow-ease);
  }

  .workspace-status-dot-finished {
    background-color: hsl(var(--workspace-status-finished));
    box-shadow: 0 0 0 3px hsl(var(--workspace-status-finished) / 0.25);
    animation: workspace-status-dot-finish var(--spring-slow) var(--spring-slow-ease);
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
  }

  @media (forced-colors: active) {
    .workspace-status-dot {
      background-color: CanvasText;
      box-shadow: none;
    }
  }
</style>
