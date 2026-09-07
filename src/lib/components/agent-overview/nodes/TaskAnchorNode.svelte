<script lang="ts">
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import type { TaskNode } from '../types';
  import { activityMotion, activityNodeTransition } from '../activity-motion';

  interface Props {
    node: TaskNode;
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
</script>

<button
  use:activityMotion
  in:activityNodeTransition={{ delay: enterDelay, playbackSpeed }}
  out:activityNodeTransition={{ exit: true, playbackSpeed }}
  type="button"
  class="task-anchor relative flex h-12 w-44 touch-none items-start text-left text-foreground transition-opacity focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ring"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-task-state={node.state}
  data-last-activity-at={lastActivityAt}
  data-focus-state={focusState}
  data-zoom-band={zoomBand}
  {tabindex}
  {...events}
>
  <span class="task-label inline-flex max-w-full items-start gap-1.5 rounded-md px-1.5 py-0.5">
    <span class="mt-px shrink-0" inert>
      {#key node.state}
        <TaskStatusIcon status={node.state} size={16} />
      {/key}
    </span>
    <span class="task-title min-w-0 line-clamp-2 type-title leading-[1.2]">{node.title}</span>
  </span>
</button>

<style>
  .task-anchor {
    --agent-overview-font-serif: 'Source Serif 4 Variable', Georgia, serif;

    font-family: var(--agent-overview-font-serif);
    transition:
      opacity 120ms ease,
      filter 120ms ease;
  }
  .task-anchor[data-focus-state='dimmed'] {
    filter: opacity(0.28);
  }
  .task-label {
    background: color-mix(in srgb, var(--color-background) 94%, transparent);
    transition: opacity 120ms ease;
  }
  .task-anchor[data-zoom-band='far'] .task-label {
    opacity: 0;
  }
  .task-anchor[data-motion-enabled='false'] {
    animation: none;
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .task-anchor {
      animation: none;
      transition: none;
    }
  }
</style>
