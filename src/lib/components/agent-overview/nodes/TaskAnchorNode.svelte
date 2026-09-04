<script lang="ts">
  import type { TaskStatus } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import type { TaskNode } from '../types';
  import { TASK_STATUS_RING_CLASSES } from '../constants';

  interface Props {
    node: TaskNode;
    assignedAgentCount: number;
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

  let { node, assignedAgentCount, isActive = false, lastActivityAt, ...events }: Props = $props();

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

  const agentCountLabel = $derived(
    assignedAgentCount === 1
      ? m.chat_toolDetails_agentCount_one({ count: assignedAgentCount })
      : m.chat_toolDetails_agentCount_many({ count: assignedAgentCount }),
  );
</script>

<button
  type="button"
  class="task-anchor flex size-32 touch-none flex-col items-center justify-center gap-1 rounded-full border-[3px] bg-card/95 px-4 text-center shadow-sm backdrop-blur-sm transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 {isActive
    ? 'ring-2 ring-primary/30'
    : ''} {TASK_STATUS_RING_CLASSES[node.state]}"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-last-activity-at={lastActivityAt}
  {...events}
>
  <span class="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{node.title}</span>
  <span class="text-xs font-medium">{labels[node.state]()}</span>
  <span class="text-xs text-subtle">{agentCountLabel}</span>
</button>
