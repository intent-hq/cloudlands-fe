<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import type { AgentNode } from '../types';
  import { activityMotion, activityNodeTransition } from '../activity-motion';

  interface Props {
    node: AgentNode;
    focusState?: 'focused' | 'neighbour' | 'dimmed' | 'none';
    zoomBand?: 'full' | 'mid' | 'far';
    tabindex?: number;
    isActive?: boolean;
    lastActivityAt?: string;
    enterDelay?: number;
    playbackSpeed?: number;
    onclick?: (event: MouseEvent) => void;
    ondblclick?: (event: MouseEvent) => void;
    onpointerdown?: (event: PointerEvent) => void;
    onpointermove?: (event: PointerEvent) => void;
    onpointerup?: (event: PointerEvent) => void;
    onpointercancel?: (event: PointerEvent) => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    onfocus?: () => void;
    onblur?: () => void;
  }

  let {
    node,
    focusState = 'none',
    zoomBand = 'full',
    tabindex = 0,
    isActive = false,
    lastActivityAt,
    enterDelay = 0,
    playbackSpeed = 1,
    ...events
  }: Props = $props();

  const avatarState = $derived(
    getAvatarState(
      {
        status: node.status,
        isResponding: node.status === 'responding',
        isWaitingForOtherAgents: node.status === 'waiting',
      },
      { isCompleted: node.status === 'completed', isFailed: node.status === 'failed' },
    ),
  );

  const specialistLabel = $derived(node.specialist?.replaceAll('-', ' '));
  const agentLabel = $derived(specialistLabel ? `${node.name} · ${specialistLabel}` : node.name);
</script>

<button
  use:activityMotion
  in:activityNodeTransition={{ delay: enterDelay, playbackSpeed }}
  out:activityNodeTransition={{ exit: true, playbackSpeed }}
  type="button"
  class="agent-orb flex h-22 w-28 touch-none flex-col items-center gap-1 text-center text-foreground transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-last-activity-at={lastActivityAt}
  data-agent-status={node.status}
  data-focus-state={focusState}
  data-zoom-band={zoomBand}
  {tabindex}
  title={agentLabel}
  aria-label={agentLabel}
  {...events}
>
  <span
    class="agent-avatar-wrapper"
    data-static-ring={isActive ? 'working' : node.status === 'waiting' ? 'waiting' : undefined}
    style:animation-delay={`${enterDelay}ms`}
  >
    <AgentAvatarWithState
      agentId={node.agentId}
      specialist={node.specialist}
      variant="prominent"
      state={avatarState}
    />
  </span>
  <span
    class="agent-name line-clamp-2 w-full break-words text-xs leading-tight"
    class:font-semibold={isActive}>{node.name}</span
  >
  {#if specialistLabel && zoomBand === 'full'}
    <span class="specialist-caption type-caption max-w-full truncate text-muted-foreground">
      {specialistLabel}
    </span>
  {/if}
  {#if focusState === 'focused'}
    <span class="node-meta">
      {#if specialistLabel}<span>{specialistLabel} ·</span>{' '}{/if}{node.status} ·
      <RelativeTime date={lastActivityAt ?? node.createdAt} compact />
    </span>
  {/if}
</button>

<style>
  .agent-orb {
    position: relative;
    transition:
      opacity 120ms ease,
      filter 120ms ease,
      scale 120ms ease;
  }
  .agent-orb[data-focus-state='dimmed'] {
    filter: opacity(0.28);
  }
  .agent-orb[data-focus-state='focused'] {
    outline: 2px solid var(--color-foreground);
    outline-offset: 4px;
  }
  .agent-name {
    font-size: clamp(13px, calc(13px / var(--zoom)), 31.5px);
    opacity: clamp(0.58, calc((var(--zoom) - 0.3) * 3.34), 1);
    transition: opacity 120ms linear;
  }
  .agent-orb[data-focus-state='focused'] .agent-name {
    opacity: 1;
  }
  .agent-orb[data-agent-status='waiting'] .agent-avatar-wrapper {
    animation: waiting-pulse 2.8s ease-in-out infinite;
  }
  .agent-orb[data-active='true'] .agent-avatar-wrapper {
    animation: working-breathe 2.4s ease-in-out infinite;
  }
  .agent-orb[data-focus-state='focused'] .agent-avatar-wrapper,
  .agent-orb[data-motion-enabled='false'] .agent-avatar-wrapper {
    animation: none;
  }
  .agent-orb[data-motion-enabled='false'] {
    transition: none;
  }
  .agent-orb[data-motion-enabled='false'] .agent-avatar-wrapper[data-static-ring='working'] {
    outline: 2px solid var(--color-foreground);
    outline-offset: 2px;
  }
  .agent-orb[data-motion-enabled='false'] .agent-avatar-wrapper[data-static-ring='waiting'] {
    outline: 1.5px dashed var(--color-foreground);
    outline-offset: 2px;
  }
  .node-meta {
    max-width: 100%;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.1;
    white-space: nowrap;
  }
  @keyframes waiting-pulse {
    50% {
      opacity: 0.72;
    }
  }
  @keyframes working-breathe {
    50% {
      transform: scale(1.04);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-orb .agent-avatar-wrapper {
      animation: none;
    }
    .agent-avatar-wrapper[data-static-ring='working'] {
      outline: 2px solid var(--color-foreground);
      outline-offset: 2px;
    }
    .agent-avatar-wrapper[data-static-ring='waiting'] {
      outline: 1.5px dashed var(--color-foreground);
      outline-offset: 2px;
    }
    .agent-orb {
      transition: none;
    }
  }
</style>
