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

  let { node, isActive = false, lastActivityAt, ...events }: Props = $props();

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
  transition:activityNodeTransition
  type="button"
  class="task-anchor relative flex h-[84px] w-[168px] touch-none flex-col justify-center gap-1 overflow-hidden rounded-xl border bg-card/95 px-3.5 py-3 text-left shadow-xs backdrop-blur-sm transition-opacity hover:border-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 {isActive
    ? 'border-primary'
    : 'border-border'}"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-task-state={node.state}
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
      class="absolute inset-x-0 bottom-0 h-px {node.state === 'complete'
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
  @media (prefers-reduced-motion: reduce) {
    .task-anchor {
      animation: none;
      transition: none;
    }
  }
</style>
