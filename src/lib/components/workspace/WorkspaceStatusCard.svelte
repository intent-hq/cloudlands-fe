<script lang="ts">
  import type { WorkspacePhaseInfo, WorkspacePhaseStats, WorkspacePhase } from './workspace-phase';
  import WorkspacePhaseIndicator from './WorkspacePhaseIndicator.svelte';
  import TaskProgressBar from './TaskProgressBar.svelte';
  import { cn } from '$lib/utils';
  import Button from '../ui/button/button.svelte';

  interface ActionDef {
    label: string;
    action: string;
  }

  interface Props {
    phase: WorkspacePhaseInfo;
    stats: WorkspacePhaseStats;
    variant?: 'card' | 'header' | 'row';
    /** Whether the spec note has content */
    hasSpec?: boolean;
    /** Whether the coordinator/initial agent is actively running */
    isAgentRunning?: boolean;
    /** Short digest of what the agent is doing */
    agentDigest?: string;
    title?: string;
    repoName?: string;
    branch?: string;
    onClick?: () => void;
    onAction?: (action: string) => void;
    class?: string;
  }

  let {
    phase,
    stats,
    variant = 'card',
    hasSpec = false,
    isAgentRunning = false,
    agentDigest,
    title: _title,
    repoName: _repoName,
    branch: _branch,
    onClick,
    onAction,
    class: className,
  }: Props = $props();

  // Dynamic actions based on phase + context
  let actions = $derived.by((): { primary: ActionDef; secondary: ActionDef } => {
    if (phase.phase === 'planning') {
      if (isAgentRunning) {
        return {
          primary: { label: 'Show Coordinator', action: 'show-coordinator' },
          secondary: { label: 'Pause', action: 'pause' },
        };
      }
      if (hasSpec || stats.tasks.total > 0) {
        return {
          primary: { label: 'Approve & Start', action: 'approve' },
          secondary: { label: 'View Spec', action: 'view-spec' },
        };
      }
      return {
        primary: { label: 'Show Coordinator', action: 'show-coordinator' },
        secondary: { label: 'View Spec', action: 'view-spec' },
      };
    }
    if (phase.phase === 'building') {
      return {
        primary: { label: 'Show Coordinator', action: 'show-coordinator' },
        secondary: { label: 'Pause', action: 'pause' },
      };
    }
    if (phase.phase === 'reviewing') {
      return {
        primary: { label: 'Create PR', action: 'create-pr' },
        secondary: { label: 'Show changes', action: 'show-changes' },
      };
    }
    // shipped
    return {
      primary: { label: 'Archive', action: 'archive' },
      secondary: { label: 'Show changes', action: 'show-changes' },
    };
  });

  // Dynamic subtitle: show agent digest when running
  let subtitle = $derived(isAgentRunning && agentDigest ? agentDigest : phase.subtitle);

  // Task progress for building phase pie chart (0–1)
  let buildProgress = $derived(
    stats.tasks.total > 0 ? stats.tasks.completed / stats.tasks.total : 0,
  );

  let hasStats = $derived(
    stats.tasks.total > 0 ||
      stats.files.changed > 0 ||
      stats.commits.total > 0 ||
      stats.pr.hasOpen ||
      stats.pr.hasMerged,
  );

  let prLabel = $derived.by(() => {
    if (stats.pr.hasMerged) return `PR #${stats.pr.number ?? ''} merged`;
    if (stats.pr.hasOpen) return `PR ${stats.pr.number ? `#${stats.pr.number}` : ''} open`;
    return '';
  });

  const phasePillStyles: Record<WorkspacePhase, string> = {
    planning: 'bg-muted/20 text-subtle',
    building: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    reviewing: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
    shipped: 'bg-foreground/10 text-foreground',
  };
</script>

{#if variant === 'row'}
  <!-- Row: single-line compact -->
  <button
    type="button"
    class={cn(
      'flex items-center gap-2 w-full min-w-0 text-left text-sm py-1',
      onClick && 'cursor-pointer transition-colors rounded',
      !onClick && 'cursor-default',
      className,
    )}
    onclick={onClick}
    disabled={!onClick}
  >
    <WorkspacePhaseIndicator
      phase={phase.phase}
      progress={buildProgress}
      size={14}
      class="shrink-0"
    />
    <span class="font-medium truncate">{phase.label}</span>
    <span class="text-ghost shrink-0">·</span>
    <span class="text-subtle truncate text-xs">{subtitle}</span>
  </button>
{:else if variant === 'header'}
  <!-- Header: phase + stats inline, for sidebar top -->
  <div class={cn('flex flex-col gap-1.5 w-full min-w-0', className)}>
    {#if _title}
      <div class="text-sm font-semibold truncate">{_title}</div>
    {/if}
    {#if _repoName || _branch}
      <div class="flex items-center gap-1 text-xs text-subtle truncate">
        {#if _repoName}<span class="truncate">{_repoName}</span>{/if}
        {#if _repoName && _branch}<span class="text-ghost">·</span>{/if}
        {#if _branch}<span class="truncate">{_branch}</span>{/if}
      </div>
    {/if}
    <div class="flex items-center gap-2 text-xs">
      <WorkspacePhaseIndicator
        phase={phase.phase}
        progress={buildProgress}
        size={12}
        class="shrink-0"
      />
      <span class="text-subtle truncate">{subtitle}</span>
      <span
        class={cn(
          'inline-flex items-center px-1.5 py-px rounded-full text-ui font-medium shrink-0 ml-auto',
          phasePillStyles[phase.phase],
        )}>{phase.label}</span
      >
    </div>
  </div>
{:else}
  <!-- Card: clean, compact card for sidebar -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
  <div
    class={cn(
      'rounded-lg border border-border/50 bg-background text-left w-full',
      onClick && 'cursor-pointer hover:bg-background/80 transition-colors',
      className,
    )}
    onclick={onClick}
    role={onClick ? 'button' : undefined}
    tabindex={onClick ? 0 : undefined}
  >
    <!-- Phase + subtitle -->
    <div class="flex items-start gap-2.5 px-3 pt-3 pb-2">
      <WorkspacePhaseIndicator
        phase={phase.phase}
        progress={buildProgress}
        size={16}
        class="shrink-0 mt-0.5"
      />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium">{phase.label}</div>
        <div class="text-xs text-subtle mt-0.5 leading-snug line-clamp-2">
          {subtitle}
        </div>
      </div>
    </div>

    <!-- Stats -->
    {#if hasStats}
      <div class="flex flex-col gap-1 px-3 pb-2.5">
        {#if stats.tasks.total > 0}
          <div class="flex items-center gap-2">
            <TaskProgressBar stats={stats.tasks} barWidth="3px" barHeight="14px" class="flex-1" />
            <span class="text-ui text-subtle shrink-0 tabular-nums">
              {stats.tasks.completed}/{stats.tasks.total}
            </span>
          </div>
        {/if}
        {#if stats.files.changed > 0}
          <div class="flex items-center justify-between text-ui">
            <span class="text-subtle">{stats.files.changed} files</span>
            <span class="tabular-nums">
              <span class="text-green-500/70">+{stats.files.additions}</span>
              <span class="text-red-500/70 ml-1">-{stats.files.deletions}</span>
            </span>
          </div>
        {/if}
        {#if stats.commits.total > 0}
          <div class="flex items-center justify-between text-ui">
            <span class="text-subtle">{stats.commits.total} commits</span>
          </div>
        {/if}
        {#if prLabel}
          <div class="flex items-center text-ui">
            <span
              class={cn(
                'inline-flex items-center gap-1',
                stats.pr.hasMerged ? 'text-purple-500/70' : 'text-green-500/70',
              )}>{prLabel}</span
            >
          </div>
        {/if}
      </div>
    {/if}

    <!-- Actions -->
    {#if onAction}
      <div class="flex items-center gap-1.5 px-2 pb-2">
        <Button
          class="flex-1 h-7 text-xs"
          variant="outline"
          size="sm"
          onclick={(e) => {
            e.stopPropagation();
            onAction?.(actions.primary.action);
          }}>{actions.primary.label}</Button
        >
        <Button
          class="h-7 text-xs text-subtle"
          variant="ghost"
          size="sm"
          onclick={(e) => {
            e.stopPropagation();
            onAction?.(actions.secondary.action);
          }}>{actions.secondary.label}</Button
        >
      </div>
    {/if}
  </div>
{/if}
