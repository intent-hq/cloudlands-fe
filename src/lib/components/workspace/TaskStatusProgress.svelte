<script lang="ts">
  import type { TaskStatus } from '$shared/types';
  import {
    buildTaskProgressSegments,
    formatTaskStatusValueText,
    normalizeTaskStatusBars,
    TASK_PROGRESS_SEGMENT_CLASSES,
    type TaskProgressFallback,
  } from './utils/task-status-display';

  interface Props {
    statuses?: readonly TaskStatus[];
    progress?: number;
    loading?: boolean;
    animationKey?: string;
    ariaLabel: string;
    size?: 'default' | 'compact';
    fallback?: TaskProgressFallback;
    class?: string;
  }

  let {
    statuses = [],
    progress,
    loading = progress === undefined,
    animationKey,
    ariaLabel,
    size = 'default',
    fallback,
    class: className = '',
  }: Props = $props();

  const statusBars = $derived(normalizeTaskStatusBars(statuses, fallback));
  const segments = $derived(buildTaskProgressSegments(statusBars));
  const progressPercent = $derived(
    Number.isFinite(progress) ? Math.min(100, Math.max(0, (progress ?? 0) * 100)) : 0,
  );
  const progressValueText = $derived(formatTaskStatusValueText(statusBars, ariaLabel));
  const heightClass = $derived(size === 'compact' ? 'h-3' : 'h-5');
</script>

{#key animationKey}
  {#if loading}
    <div
      class="{heightClass} w-full {className}"
      data-task-status-progress
      data-task-status-size={size}
      data-flame-progress-placeholder
      aria-hidden="true"
    ></div>
  {:else}
    <div
      class="flame-progress-enter flex {heightClass} w-full overflow-hidden rounded-xs bg-background {className}"
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(progressPercent)}
      aria-valuetext={progressValueText}
      data-task-status-progress
      data-task-status-size={size}
      data-flame-animation-key={animationKey}
    >
      {#each segments as segment (segment.visualState)}
        <div
          class="flame-status-segment h-full min-w-0 {TASK_PROGRESS_SEGMENT_CLASSES[
            segment.visualState
          ]}"
          data-flame-status-bar={segment.visualState}
          data-task-progress-style={segment.visualState}
          aria-hidden="true"
          style:flex-basis="0%"
          style:flex-grow={segment.count}
          style:mask-image={segment.visualState === 'striped'
            ? 'var(--status-in-progress-hatch-mask)'
            : undefined}
        ></div>
      {/each}
    </div>
  {/if}
{/key}

<style>
  .flame-progress-enter {
    animation: flame-progress-enter var(--motion-slow) var(--ease-emphasized-out) both;
  }

  .flame-status-segment {
    transition: flex-grow var(--motion-slow) var(--ease-emphasized-out);
    animation: flame-status-enter var(--motion-standard) var(--ease-standard) both;
  }

  @keyframes flame-progress-enter {
    from {
      clip-path: inset(0 100% 0 0 round var(--radius-small));
    }
    to {
      clip-path: inset(0 0 0 0 round var(--radius-small));
    }
  }

  @keyframes flame-status-enter {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .flame-progress-enter,
    .flame-status-segment {
      animation: none;
      transition: none;
    }
  }
</style>
