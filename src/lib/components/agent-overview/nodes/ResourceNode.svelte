<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowUpRightFromSquare, faFile } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { m } from '$shared/paraglide/messages.js';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import type { FileNode, NoteNode } from '../types';
  import {
    activityMotion,
    activityNodeTransition,
    resourceCooldownRemaining,
    resourceLabelOpacity,
    resourceOpacity,
    writePulse,
  } from '../activity-motion';

  interface Props {
    node: FileNode | NoteNode;
    focusState?: 'focused' | 'neighbour' | 'dimmed' | 'none';
    isSelectionActive?: boolean;
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
    isSelectionActive = false,
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
  const opacity = $derived(resourceOpacity(node.lastActionTimestamp, focusState === 'dimmed'));
  const labelOpacity = $derived(resourceLabelOpacity(focusState === 'dimmed'));
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
  class="resource-node relative flex h-auto min-h-22 w-18 cursor-pointer touch-none flex-col items-center gap-1.5 rounded-md text-center text-muted-foreground transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
  data-graph-node
  data-node-id={node.id}
  data-external={node.type === 'file' && node.isExternal}
  data-active={isActive}
  data-access={access}
  data-last-activity-at={lastActivityAt}
  data-focus-state={focusState}
  data-selection-active={isSelectionActive}
  data-zoom-band={zoomBand}
  {tabindex}
  title={tooltip}
  aria-label={ariaLabel ?? label}
  {...events}
>
  {#if zoomBand === 'full' || isSelectionActive}
    <span
      class="resource-card relative flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background text-subtle"
      class:border-dashed={node.type === 'file' && node.isExternal}
      style:opacity
      style:animation-duration={`${cooldownRemaining}ms`}
      aria-hidden="true"
    >
      <Fa icon={node.type === 'file' ? faFile : faNote} size="xs" />
      {#if node.type === 'file' && node.isExternal}
        <span class="absolute right-1 top-1"><Fa icon={faArrowUpRightFromSquare} size="xs" /></span>
      {/if}
    </span>
    <span class="resource-label line-clamp-2" style:opacity={labelOpacity}>{label}</span>
  {:else}
    <span class="flex h-14 w-11 shrink-0 items-center justify-center" aria-hidden="true">
      <span class="resource-dot" style:opacity style:animation-duration={`${cooldownRemaining}ms`}
      ></span>
    </span>
  {/if}
  <span class="node-meta" style:opacity={labelOpacity} hidden={!isSelectionActive}>
    {#if node.type === 'file'}+{additions} −{deletions}{:else}{access}{/if} ·
    <RelativeTime date={lastActivityAt ?? node.lastActionTimestamp} compact />
  </span>
</button>

<style>
  .resource-node {
    transition:
      border-color 180ms ease,
      color 120ms ease,
      filter 120ms ease;
  }
  .resource-node[data-selection-active='true'] {
    outline: 1.5px solid var(--color-ring);
    outline-offset: 4px;
  }
  .resource-card,
  .resource-label,
  .resource-dot {
    transition:
      opacity 120ms ease,
      scale 120ms ease;
  }
  .resource-card,
  .resource-dot {
    animation: resource-cooldown linear forwards;
  }
  .resource-label {
    width: calc(112px / var(--zoom));
    max-width: calc(112px / var(--zoom));
    font-size: clamp(13px, calc(13px / var(--zoom)), 20.8px);
    line-height: 1.15;
    overflow-wrap: anywhere;
    text-overflow: ellipsis;
  }
  .node-meta {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 50%;
    visibility: hidden;
    max-width: 100%;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.1;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .resource-node[data-selection-active='true'] .node-meta {
    visibility: visible;
  }
  .resource-dot {
    width: calc(6px / var(--zoom));
    height: calc(6px / var(--zoom));
    border-radius: 9999px;
    background: var(--color-muted-foreground);
  }
  .resource-node[data-active='true'] .resource-card {
    border-color: var(--color-muted-foreground);
  }
  .resource-node[data-active='true'] {
    color: var(--color-foreground);
    font-weight: 500;
  }
  .resource-node[data-motion-enabled='false'] .resource-card,
  .resource-node[data-motion-enabled='false'] .resource-dot {
    animation-play-state: paused;
  }
  .resource-node[data-motion-enabled='false'] {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .resource-card,
    .resource-dot {
      animation: none;
    }
    .resource-node {
      transition: none;
    }
  }
  @keyframes resource-cooldown {
    to {
      opacity: 0.4;
    }
  }
</style>
