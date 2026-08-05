<!--
  TaskStatusIcon - Compact SVG-based task status indicator

  Displays an animated circular icon that represents task status:
  - not_started: Empty outline circle (gray)
  - waiting: Empty outline circle with clock (gray)
  - discussion_needed: Circle with question mark (amber)
  - blocked: Circle with exclamation mark (red)
  - in_progress: Half-filled circle animating (blue)
  - review_required: Circle with eye icon (blue)
  - complete: Filled circle with checkmark (green)
  - cancelled: Filled circle with exclamation (red)
-->
<script lang="ts">
  import type { TaskStatus } from '$shared/types';
  import {
  draw,
  scale,
} from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';

  type NormalizedTaskStatus = TaskStatus | 'unknown';

  const taskStatuses = new Set<TaskStatus>([
    'not_started',
    'waiting',
    'discussion_needed',
    'blocked',
    'in_progress',
    'review_required',
    'complete',
    'cancelled',
  ]);

  let {
    status,
    size = 16,
    onclick,
  }: {
    status: unknown;
    size?: number;
    onclick?: (e: MouseEvent) => void;
  } = $props();

  // Generate unique ID for clip paths
  const uniqueId = Math.random().toString(36).substring(2, 9);

  // Normalize legacy status values
  let normalizedStatus = $derived.by((): NormalizedTaskStatus => {
    if (status === 'todo') return 'not_started';
    if (status === 'in-progress') return 'in_progress';
    if (status === 'done') return 'complete';

    if (typeof status === 'string' && taskStatuses.has(status as TaskStatus)) {
      return status as TaskStatus;
    }

    return 'unknown';
  });

  const statusColors = {
    not_started: { stroke: '#99999966', fill: 'transparent', innerCircleRPercentage: 0 },
    waiting: { stroke: '#99999966', fill: 'transparent', innerCircleRPercentage: 0 },
    discussion_needed: { stroke: '#f59e0b', fill: '#f59e0b', innerCircleRPercentage: 100 },
    blocked: { stroke: '#ef4444', fill: '#ef4444', innerCircleRPercentage: 100 },
    in_progress: { stroke: '#00BCFF', fill: '#00BCFF', innerCircleRPercentage: 55 },
    review_required: { stroke: '#3b82f6', fill: '#3b82f6', innerCircleRPercentage: 100 },
    complete: { stroke: '#22c55e', fill: '#00BD7D', innerCircleRPercentage: 100 },
    cancelled: { stroke: '#99999966', fill: '#99999966', innerCircleRPercentage: 0 },
    unknown: { stroke: '#99999966', fill: 'transparent', innerCircleRPercentage: 0 },
  };

  let colors = $derived(statusColors[normalizedStatus] || statusColors.not_started);
  const statusLabels: Record<NormalizedTaskStatus, () => string> = {
    not_started: m.tiptap_taskStatus_notStarted_label,
    waiting: m.tiptap_taskStatus_waiting_label,
    discussion_needed: m.tiptap_taskStatus_discussionNeeded_label,
    blocked: m.tiptap_taskStatus_blocked_label,
    in_progress: m.tiptap_taskStatus_inProgress_label,
    review_required: m.tiptap_taskStatus_reviewRequired_label,
    complete: m.tiptap_taskStatus_complete_label,
    cancelled: m.tiptap_taskStatus_cancelled_label,
    unknown: m.tiptap_taskStatus_unknown_label,
  };
  let statusLabel = $derived((statusLabels[normalizedStatus] ?? m.tiptap_taskStatus_unknown_label)());
</script>

<button
  type="button"
  class="task-status-icon inline-flex items-center justify-center shrink-0 cursor-pointer bg-transparent border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary rounded-full"
  style="width: {size}px; height: {size}px;"
  {onclick}
  title={m.tiptap_taskStatus_status_tooltip({ status: statusLabel })}
>
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <!-- Clip path for half-fill effect -->
    <defs>
      <clipPath id="half-clip-{uniqueId}">
        <rect x="48%" y="0" width="100%" height="100%" />
      </clipPath>
    </defs>
    <circle
      cx="50%"
      cy="50%"
      r="{colors.innerCircleRPercentage * 0.5}%"
      fill={colors.fill}
      clip-path={normalizedStatus === 'in_progress' ? `url(#half-clip-${uniqueId})` : 'none'}
      class="transition-all duration-300 origin-center"
    />

    <circle
      cx="50%"
      cy="50%"
      r="45%"
      stroke={colors.stroke}
      stroke-width="2.5"
      fill="none"
      class="transition-all duration-300"
    />

    {#if normalizedStatus === 'not_started' || normalizedStatus === 'waiting'}
      <!-- Empty circle outline -->
    {:else if normalizedStatus === 'in_progress'}
      <!-- Half-filled circle with animation -->
      <circle cx="12" cy="12" r="10" stroke={colors.stroke} stroke-width="2" fill="none" />
    {:else if normalizedStatus === 'complete'}
      <!-- Filled circle with checkmark -->
      <path
        d="M7 12.5L10.5 16L17 9"
        stroke="white"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        transition:draw={{ duration: 300 }}
      />
    {:else if normalizedStatus === 'cancelled'}
      <!-- Circle with diagonal line (no symbol) -->
      <path
        d="M5 19L19 5"
        stroke={colors.stroke}
        stroke-width="2.5"
        stroke-linecap="round"
        transition:draw={{ duration: 300 }}
      />
    {:else if normalizedStatus === 'discussion_needed'}
      <!-- Filled circle with question mark -->
      <path
        d="M13.1372 17.7135C13.1372 18.1682 12.9566 18.6042 12.6351 18.9257C12.3136 19.2472 11.8776 19.4278 11.4229 19.4278C10.9683 19.4278 10.5322 19.2472 10.2107 18.9257C9.88925 18.6042 9.70864 18.1682 9.70864 17.7135C9.70864 17.2589 9.88925 16.8228 10.2107 16.5014C10.5322 16.1799 10.9683 15.9993 11.4229 15.9993C11.8776 15.9993 12.3136 16.1799 12.6351 16.5014C12.9566 16.8228 13.1372 17.2589 13.1372 17.7135ZM10.2109 7.07297C10.3957 6.88872 10.6201 6.7491 10.8671 6.66473C11.114 6.58037 11.377 6.55349 11.6359 6.58615C11.8948 6.61881 12.1428 6.71015 12.361 6.8532C12.5793 6.99625 12.762 7.18724 12.8953 7.4116C13.0285 7.63597 13.1088 7.8878 13.1299 8.14789C13.1511 8.40799 13.1126 8.66948 13.0174 8.91244C12.9222 9.1554 12.7728 9.37342 12.5805 9.54988C12.3883 9.72634 12.1583 9.85659 11.9081 9.93068C11.1212 10.1604 10.1372 10.901 10.1372 12.1421V12.5707C10.1372 12.9117 10.2727 13.2387 10.5138 13.4798C10.7549 13.7209 11.0819 13.8564 11.4229 13.8564C11.7639 13.8564 12.0909 13.7209 12.3321 13.4798C12.5732 13.2387 12.7086 12.9117 12.7086 12.5707V12.3735C13.3281 12.1785 13.8952 11.8451 14.3669 11.3988C14.8387 10.9524 15.2029 10.4046 15.4319 9.79683C15.6609 9.18906 15.7487 8.53719 15.6888 7.89048C15.6289 7.24377 15.4228 6.61913 15.0861 6.06376C14.7494 5.50838 14.2908 5.03681 13.7451 4.68466C13.1994 4.33251 12.5808 4.10899 11.936 4.03101C11.2912 3.95302 10.6371 4.0226 10.0232 4.23449C9.40925 4.44638 8.8515 4.79503 8.39207 5.25411C8.26933 5.37277 8.17145 5.51469 8.10414 5.67158C8.03683 5.82848 8.00145 5.9972 8.00004 6.16792C7.99864 6.33864 8.03125 6.50792 8.09597 6.6659C8.16069 6.82388 8.25623 6.96739 8.37701 7.08805C8.49778 7.20871 8.64138 7.30411 8.79942 7.36868C8.95746 7.43326 9.12677 7.46571 9.29749 7.46414C9.4682 7.46258 9.6369 7.42703 9.79373 7.35958C9.95056 7.29212 10.0924 7.19411 10.2109 7.07125V7.07297Z"
        fill="white"
        class="origin-center"
        transition:scale={{ duration: 300 }}
      />
      <!-- <circle cx="12" cy="15.5" r="1.5" fill="white" transition:draw={{ duration: 300 }} /> -->
    {:else if normalizedStatus === 'blocked'}
      <!-- Filled circle with exclamation mark -->
      <path
        d="M12 5.5V13.5"
        stroke="white"
        stroke-width="3"
        stroke-linecap="round"
        transition:draw={{ duration: 300 }}
      />
      <circle
        cx="12"
        cy="17.5"
        r="1.6"
        fill="white"
        class="origin-center"
        transition:scale={{ duration: 300 }}
      />
    {:else if normalizedStatus === 'review_required'}
      <!-- Filled circle with eye icon -->
      <path
        d="M11.6668 13.649C12.1044 13.649 12.5241 13.4751 12.8336 13.1656C13.1431 12.8562 13.3169 12.4365 13.3169 11.9988C13.3169 11.5611 13.1431 11.1414 12.8336 10.832C12.5241 10.5225 12.1044 10.3486 11.6668 10.3486C11.2291 10.3486 10.8094 10.5225 10.4999 10.832C10.1905 11.1414 10.0166 11.5611 10.0166 11.9988C10.0166 12.4365 10.1905 12.8562 10.4999 13.1656C10.8094 13.4751 11.2291 13.649 11.6668 13.649Z"
        fill="white"
        class="origin-center"
        transition:scale={{ duration: 300 }}
      />
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M4.38506 12.3064C4.31566 12.1046 4.31566 11.8855 4.38506 11.6837C4.90912 10.1693 5.89241 8.85596 7.198 7.92665C8.50359 6.99734 10.0665 6.4983 11.669 6.49902C13.2716 6.49975 14.834 7.00021 16.1388 7.9307C17.4435 8.8612 18.4256 10.1754 18.9483 11.6903C19.0177 11.8921 19.0177 12.1112 18.9483 12.313C18.4245 13.8278 17.4412 15.1416 16.1355 16.0712C14.8298 17.0008 13.2666 17.5 11.6638 17.4993C10.0609 17.4986 8.49824 16.9979 7.19336 16.0671C5.88848 15.1363 4.90641 13.8217 4.38396 12.3064H4.38506ZM14.9681 11.9984C14.9681 12.8737 14.6204 13.7131 14.0015 14.3321C13.3825 14.951 12.5431 15.2987 11.6678 15.2987C10.7925 15.2987 9.95304 14.951 9.33411 14.3321C8.71517 13.7131 8.36746 12.8737 8.36746 11.9984C8.36746 11.1231 8.71517 10.2836 9.33411 9.66468C9.95304 9.04575 10.7925 8.69803 11.6678 8.69803C12.5431 8.69803 13.3825 9.04575 14.0015 9.66468C14.6204 10.2836 14.9681 11.1231 14.9681 11.9984Z"
        fill="white"
        class="origin-center"
        transition:scale={{ duration: 300 }}
      />

      <!-- <ellipse
        cx="12"
        cy="12"
        rx="5"
        ry="3"
        stroke="white"
        stroke-width="1.5"
        fill="none"
        transition:draw={{ duration: 300 }}
      /> -->
      <!-- <circle cx="12" cy="12" r="1.5" fill="white" transition:draw={{ duration: 300 }} /> -->
    {/if}
  </svg>
</button>
