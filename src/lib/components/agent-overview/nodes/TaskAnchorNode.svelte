<script lang="ts">
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { TaskNode } from '../types';
  import { activityMotion, activityNodeTransition } from '../activity-motion';

  interface Props {
    node: TaskNode;
    focusState?: 'focused' | 'neighbour' | 'dimmed' | 'none';
    zoomBand?: 'full' | 'mid' | 'far';
    tabindex?: number;
    isActive?: boolean;
    lastActivityAt?: string;
    agentCount?: number;
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
    agentCount = 0,
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
  class="task-anchor relative flex h-12 w-44 touch-none flex-col items-start text-left text-foreground transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-task-state={node.state}
  data-last-activity-at={lastActivityAt}
  data-focus-state={focusState}
  data-zoom-band={zoomBand}
  aria-label={node.title}
  {tabindex}
  title={zoomBand === 'far' /* i18n-ignore (semantic zoom code token) */ ? node.title : undefined}
  {...events}
>
  {#if zoomBand === 'far' && focusState !== 'focused'}
    <span class="task-status-dot" aria-hidden="true"></span>
  {:else}
    <span class="task-label inline-flex max-w-full items-start gap-1.5 px-1.5 py-0.5">
      <span class="mt-px shrink-0" inert>
        {#key node.state}
          <TaskStatusIcon status={node.state} size={16} />
        {/key}
      </span>
      <span class="task-title min-w-0 line-clamp-2 leading-[1.2]">{node.title}</span>
    </span>
    {#if focusState === 'focused'}
      <span class="node-meta">
        {node.state.replaceAll('_', ' ')} ·
        {agentCount === 1
          ? m.chat_toolDetails_agentCount_one({ count: agentCount })
          : m.chat_toolDetails_agentCount_many({ count: agentCount })}
      </span>
    {/if}
  {/if}
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
  .task-anchor[data-focus-state='focused'] {
    outline: 2px solid var(--color-foreground);
    outline-offset: 4px;
  }
  .task-label {
    opacity: clamp(0.58, calc((var(--zoom) - 0.3) * 3.34), 1);
    transition: opacity 120ms linear;
  }
  .task-title {
    font-size: clamp(17px, calc(17px / var(--zoom)), 40px);
    paint-order: stroke fill;
    -webkit-text-stroke: calc(2px / var(--zoom)) var(--color-background);
  }
  .task-anchor[data-focus-state='focused'] .task-label {
    opacity: 1;
  }
  .node-meta {
    max-width: 100%;
    padding-inline: 0.375rem;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.1;
    white-space: nowrap;
  }
  .task-status-dot {
    width: calc(4px / var(--zoom));
    height: calc(4px / var(--zoom));
    margin: auto;
    border-radius: 9999px;
    background: var(--color-muted-foreground);
  }
  .task-anchor[data-task-state='discussion_needed'] .task-status-dot {
    background: var(--color-warning);
  }
  .task-anchor[data-task-state='blocked'] .task-status-dot {
    background: var(--color-destructive);
  }
  .task-anchor[data-task-state='in_progress'] .task-status-dot {
    background: var(--color-info);
  }
  .task-anchor[data-task-state='review_required'] .task-status-dot {
    background: var(--color-muted-foreground);
  }
  .task-anchor[data-task-state='complete'] .task-status-dot {
    background: var(--color-success);
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
