<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowUpRightFromSquare, faFile } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { m } from '$shared/paraglide/messages.js';
  import type { FileNode, NoteNode } from '../types';
  import {
    activityMotion,
    activityNodeTransition,
    resourceBrightness,
    resourceCooldownRemaining,
    writePulse,
  } from '../activity-motion';

  interface Props {
    node: FileNode | NoteNode;
    focusState?: 'focused' | 'neighbour' | 'dimmed' | 'none';
    zoomBand?: 'full' | 'mid' | 'far';
    tabindex?: number;
    access: 'read' | 'write';
    additions?: number;
    deletions?: number;
    isActive?: boolean;
    lastActivityAt?: string;
    nudgeX?: number;
    nudgeY?: number;
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
    access,
    additions = 0,
    deletions = 0,
    isActive = false,
    lastActivityAt,
    nudgeX = 0,
    nudgeY = 0,
    enterDelay = 0,
    playbackSpeed = 1,
    ...events
  }: Props = $props();

  const label = $derived(node.type === 'file' ? node.fileName : node.title);
  const tooltip = $derived(node.type === 'file' && node.isExternal ? node.path : undefined);
  const ariaLabel = $derived(
    node.type === 'file' && node.isExternal
      ? m.agentOverview_resourceNode_external_ariaLabel({ name: node.fileName, path: node.path })
      : undefined,
  );
  const brightness = $derived(resourceBrightness(node.lastActionTimestamp));
  const cooldownRemaining = $derived(resourceCooldownRemaining(node.lastActionTimestamp));
</script>

<button
  use:activityMotion
  use:writePulse={{
    additions,
    deletions,
    enabled: access === 'write',
    nudgeX,
    nudgeY,
    timestamp: lastActivityAt,
  }}
  in:activityNodeTransition={{ delay: enterDelay, playbackSpeed }}
  out:activityNodeTransition={{ exit: true, playbackSpeed }}
  type="button"
  class="resource-node flex h-[88px] w-[72px] touch-none flex-col items-center gap-1.5 text-center text-muted-foreground transition-opacity hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ring"
  data-graph-node
  data-node-id={node.id}
  data-external={node.type === 'file' && node.isExternal}
  data-active={isActive}
  data-access={access}
  data-last-activity-at={lastActivityAt}
  data-focus-state={focusState}
  data-zoom-band={zoomBand}
  {tabindex}
  title={tooltip}
  aria-label={ariaLabel}
  style:--resource-brightness={brightness}
  style:--resource-cooldown={`${cooldownRemaining}ms`}
  {...events}
>
  <span
    class="resource-card relative flex h-[58px] w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background text-subtle"
    class:border-dashed={node.type === 'file' && node.isExternal}
    aria-hidden="true"
  >
    <Fa icon={node.type === 'file' ? faFile : faNote} size="xs" />
    {#if node.type === 'file' && node.isExternal}
      <span class="absolute right-1 top-1"><Fa icon={faArrowUpRightFromSquare} size="xs" /></span>
    {/if}
  </span>
  <span class="resource-label line-clamp-2 w-full text-[11px] leading-[1.15]">{label}</span>
</button>

<style>
  .resource-node {
    opacity: var(--resource-brightness);
    animation: resource-cooldown var(--resource-cooldown) linear forwards;
    transition:
      opacity 600ms linear,
      border-color 180ms ease,
      color 120ms ease,
      filter 120ms ease;
  }
  .resource-node[data-focus-state='dimmed'] {
    filter: opacity(0.28);
  }
  .resource-card,
  .resource-label {
    transition:
      opacity 120ms ease,
      scale 120ms ease;
  }
  .resource-node[data-zoom-band='mid'] .resource-label,
  .resource-node[data-zoom-band='far'] .resource-label,
  .resource-node[data-zoom-band='mid'] .resource-card > :global(*),
  .resource-node[data-zoom-band='far'] .resource-card > :global(*) {
    opacity: 0;
  }
  .resource-node[data-zoom-band='mid'] .resource-card,
  .resource-node[data-zoom-band='far'] .resource-card {
    border-radius: 9999px;
    scale: 0.22;
  }
  .resource-node[data-active='true'] .resource-card,
  .resource-node:hover .resource-card {
    border-color: var(--color-muted-foreground);
  }
  .resource-node[data-active='true'] {
    color: var(--color-foreground);
    font-weight: 500;
  }
  .resource-node[data-motion-enabled='false'] {
    animation-play-state: paused;
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .resource-node {
      animation: none;
      transition: none;
    }
  }
  @keyframes resource-cooldown {
    from {
      opacity: var(--resource-brightness);
    }
    to {
      opacity: 0.35;
    }
  }
</style>
