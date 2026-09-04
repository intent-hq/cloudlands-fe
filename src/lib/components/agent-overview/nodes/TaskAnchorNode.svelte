<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import type { TaskStatus } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import type { TaskNode } from '../types';
  import { activityMotion, activityNodeTransition } from '../activity-motion';

  interface Props {
    node: TaskNode;
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
    isActive = false,
    lastActivityAt,
    enterDelay = 0,
    playbackSpeed = 1,
    ...events
  }: Props = $props();
  let previousState: TaskStatus | null = null;
  let settling = $state(false);

  $effect(() => {
    const state = node.state;
    settling = previousState !== null && state === 'complete' && previousState !== 'complete';
    previousState = state;
  });

  const labels: Record<TaskStatus, () => string> = {
    not_started: m.workspace_taskStatus_notStarted_label,
    waiting: m.workspace_taskStatus_waiting_label,
    discussion_needed: m.workspace_taskStatus_discussionNeeded_label,
    blocked: m.workspace_taskStatus_blocked_label,
    in_progress: m.workspace_taskStatus_inProgress_label,
    review_required: m.workspace_taskStatus_reviewRequired_label,
    complete: m.workspace_taskStatus_complete_label,
    cancelled: m.workspace_taskStatus_cancelled_label,
  };
</script>

<button
  use:activityMotion
  in:activityNodeTransition={{ delay: enterDelay, playbackSpeed }}
  out:activityNodeTransition={{ exit: true, playbackSpeed }}
  type="button"
  class="task-anchor relative flex h-[84px] w-[168px] touch-none flex-col justify-center gap-1 overflow-hidden rounded-xl border bg-card/95 px-3.5 py-3 text-left shadow-xs backdrop-blur-sm transition-opacity hover:border-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 {isActive
    ? 'border-primary'
    : 'border-border'}"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-task-state={node.state}
  class:task-settling={settling}
  data-last-activity-at={lastActivityAt}
  {...events}
>
  <span
    class="flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
  >
    <span>{m.workspace_noteCodeChanges_task_label()}</span>
    <span aria-hidden="true">·</span>
    <span>{labels[node.state]()}</span>
    {#if node.state === 'complete'}
      <span class="ml-auto text-foreground" aria-hidden="true">
        <Fa icon={faCheck} size="xs" />
      </span>
    {/if}
  </span>
  <span class="line-clamp-2 text-sm font-medium leading-tight text-foreground">{node.title}</span>
  {#if node.state === 'in_progress' || node.state === 'complete'}
    <span
      class="task-progress absolute inset-x-0 bottom-0 h-px origin-left {node.state === 'complete'
        ? 'bg-foreground'
        : 'bg-primary'}"
      aria-hidden="true"
    ></span>
  {/if}
</button>

<style>
  .task-anchor {
    transition:
      opacity 180ms ease,
      border-color 180ms ease,
      box-shadow 180ms ease;
  }
  .task-anchor[data-motion-enabled='false'] {
    animation: none;
    transition: none;
  }
  .task-progress {
    transform: scaleX(0.64);
    transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .task-anchor[data-task-state='complete'] .task-progress {
    transform: scaleX(1);
  }
  .task-settling::after {
    position: absolute;
    inset: -1px;
    border: 1px solid var(--color-primary);
    border-radius: inherit;
    content: '';
    pointer-events: none;
    animation: task-settle 520ms ease-out 260ms 1 both;
  }
  @keyframes task-settle {
    from {
      opacity: 0.7;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(1.13);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .task-anchor {
      animation: none;
      transition: none;
    }
    .task-progress {
      transition: opacity 140ms ease;
      transform: scaleX(1);
    }
    .task-settling::after {
      animation: none;
    }
  }
</style>
