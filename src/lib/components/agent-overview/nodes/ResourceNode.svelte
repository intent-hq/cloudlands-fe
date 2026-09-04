<script lang="ts">
  import Fa from 'svelte-fa';
  import { faFile } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { formatInteger } from '$lib/i18n/format';
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
  class="resource-node flex h-8 w-[180px] touch-none items-center gap-2 rounded-full border border-border bg-card/95 px-3 text-left shadow-xs backdrop-blur-sm transition-opacity hover:border-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-access={access}
  data-last-activity-at={lastActivityAt}
  style:--resource-brightness={brightness}
  style:--resource-cooldown={`${cooldownRemaining}ms`}
  {...events}
>
  <span class="shrink-0 text-subtle"
    ><Fa icon={node.type === 'file' ? faFile : faNote} size="xs" /></span
  >
  <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{label}</span>
  {#if access === 'write'}
    <span
      class="write-count shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
      style:--target-additions={additions}
      style:--target-deletions={deletions}
      data-write-count
    >
      +{formatInteger(additions)} −{formatInteger(deletions)}
    </span>
  {/if}
</button>

<style>
  @property --display-additions {
    syntax: '<integer>';
    inherits: false;
    initial-value: 0;
  }
  @property --display-deletions {
    syntax: '<integer>';
    inherits: false;
    initial-value: 0;
  }
  .resource-node {
    opacity: var(--resource-brightness);
    animation: resource-cooldown var(--resource-cooldown) linear forwards;
    transition:
      opacity 600ms linear,
      border-color 180ms ease;
  }
  .write-count {
    --display-additions: var(--target-additions);
    --display-deletions: var(--target-deletions);
    color: transparent;
    counter-reset: additions var(--display-additions) deletions var(--display-deletions);
    position: relative;
  }
  .write-count::after {
    position: absolute;
    inset: 0;
    color: var(--color-muted-foreground);
    content: '+' counter(additions) ' −' counter(deletions);
    white-space: nowrap;
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
