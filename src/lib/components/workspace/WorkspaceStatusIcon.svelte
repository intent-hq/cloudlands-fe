<!--
  WorkspaceStatusIcon - Compact SVG-based workspace status indicator

  Displays a circular icon that represents workspace status:
  - not_started: Empty outline circle (gray)
  - in_progress: Half-filled circle (blue)
  - complete: Filled circle with checkmark (green)
  - pr_open: Filled circle with PR icon (purple)
  - pr_merged: Filled circle with merge icon (purple, darker)
-->
<script lang="ts">
  import {
  draw,
  scale,
} from 'svelte/transition';
  import type { WorkspaceDisplayStatus } from '$lib/components/workspace/utils/workspace-status-grouping';

  let {
    status,
    size = 14,
  }: {
    status: WorkspaceDisplayStatus;
    size?: number;
  } = $props();

  // Generate unique ID for clip paths
  const uniqueId = Math.random().toString(36).substring(2, 9);

  const statusColors: Record<
    WorkspaceDisplayStatus,
    { stroke: string; fill: string; innerCircleRPercentage: number }
  > = {
    not_started: { stroke: '#99999966', fill: 'transparent', innerCircleRPercentage: 0 },
    in_progress: { stroke: '#00BCFF', fill: '#00BCFF', innerCircleRPercentage: 55 },
    complete: { stroke: '#22c55e', fill: '#00BD7D', innerCircleRPercentage: 100 },
    pr_ready: { stroke: '#22c55e', fill: '#22c55e', innerCircleRPercentage: 100 },
    pr_open: { stroke: 'transparent', fill: 'transparent', innerCircleRPercentage: 100 },
    pr_merged: { stroke: 'transparent', fill: 'transparent', innerCircleRPercentage: 100 },
  };

  const statusLabels: Record<WorkspaceDisplayStatus, string> = {
    not_started: 'Not started',
    in_progress: 'In progress',
    complete: 'Complete',
    pr_ready: 'PR Mergeable',
    pr_open: 'PR open',
    pr_merged: 'PR merged',
  };

  let colors = $derived(statusColors[status] || statusColors.not_started);
</script>

<div
  class="workspace-status-icon inline-flex items-center justify-center shrink-0"
  style="width: {size}px; height: {size}px;"
  title={statusLabels[status]}
>
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" class="overflow-visible">
    <!-- Clip path for half-fill effect -->
    <defs>
      <clipPath id="ws-half-clip-{uniqueId}">
        <rect x="48%" y="0" width="100%" height="100%" />
      </clipPath>
    </defs>
    <circle
      cx="50%"
      cy="50%"
      r="{colors.innerCircleRPercentage * 0.5}%"
      fill={colors.fill}
      clip-path={status === 'in_progress' ? `url(#ws-half-clip-${uniqueId})` : 'none'}
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

    {#if status === 'not_started'}
      <!-- Empty circle outline -->
    {:else if status === 'in_progress'}
      <!-- Half-filled circle -->
      <circle cx="12" cy="12" r="10" stroke={colors.stroke} stroke-width="2" fill="none" />
    {:else if status === 'complete'}
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
    {:else if status === 'pr_open'}
      <!-- PR open icon (pull request symbol) -->
      <g transition:scale={{ duration: 300 }}>
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" class="text-ghost" fill="currentColor" transform="scale(1.5) translate(0, 0)"></path>
      </g>
    {:else if status === 'pr_merged'}
      <!-- PR merged icon (merge symbol) -->
      <g transition:scale={{ duration: 300 }}>
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" class="text-ghost" fill="currentColor" transform="scale(1.5) translate(0, 0)"></path>
      </g>
    {/if}
  </svg>
</div>
