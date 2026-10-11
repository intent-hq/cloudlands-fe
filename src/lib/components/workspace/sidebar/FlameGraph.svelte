<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { Note, TaskStatus } from '$shared/types';
  import { isSpecNote } from '$shared/constants/notes';
  import { buildTaskTree, flattenTasks } from './flame-graph-model';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { TASK_STATUS_INDICATOR_CLASSES, TASK_STATUS_LABELS } from '../utils/task-status-display';
  import TaskStatusProgress from '../TaskStatusProgress.svelte';
  interface Props {
    notes: Note[];
    onTaskClick?: (noteId: string) => void;
    /** Canonical BE-owned completion ratio, from 0 to 1. Undefined while loading. */
    progress?: number;
    loading?: boolean;
    /** Remounts the visual bar so workspace switches replay the entrance animation. */
    animationKey?: string;
  }

  let {
    notes = [],
    onTaskClick,
    progress,
    loading = progress === undefined,
    animationKey,
  }: Props = $props();

  const taskTree = $derived(buildTaskTree(notes));
  const taskList = $derived(flattenTasks(taskTree));
  const specNoteId = $derived(
    notes.find((note) => isSpecNote(note.id as string))?.id as string | undefined,
  );
  const taskCount = $derived(taskList.length);
  const completedCount = $derived(
    taskList.filter((task) => task.note.metadata?.task?.status === 'complete').length,
  );
  const taskStatuses = $derived(
    taskList.map((task) => task.note.metadata?.task?.status ?? ('not_started' as TaskStatus)),
  );
</script>

{#snippet taskListTooltip()}
  <div
    class="flex h-auto min-h-0 max-h-72 w-72 flex-col overflow-x-hidden overflow-y-auto px-2 py-1"
  >
    <Button
      variant="ghost"
      type="button"
      class="type-caption mb-0.5 h-auto w-full cursor-pointer px-1 py-0.5 text-left font-normal text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 disabled:cursor-default"
      onclick={() => specNoteId && onTaskClick?.(specNoteId)}
      disabled={!specNoteId || !onTaskClick}
      aria-label={m.workspace_flameGraph_openSpecProgress_ariaLabel({
        completed: formatInteger(completedCount),
        total: formatInteger(taskCount),
      })}
    >
      {m.workspace_flameGraph_tasksComplete_label({
        completed: formatInteger(completedCount),
        total: formatInteger(taskCount),
      })}
    </Button>
    {#each taskList as task (task.note.id)}
      {@const status = task.note.metadata?.task?.status ?? 'not_started'}
      <Button
        variant="ghost"
        type="button"
        class="flex h-auto w-full min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
        onclick={() => onTaskClick?.(task.note.id as string)}
        aria-label={m.workspace_flameGraph_openTask_ariaLabel({
          title: task.note.title,
          status: TASK_STATUS_LABELS[status],
        })}
      >
        <span
          class="size-2 shrink-0 rounded-full {TASK_STATUS_INDICATOR_CLASSES[status]}"
          aria-hidden="true"
        ></span>
        <span class="type-caption min-w-0 flex-1 truncate text-foreground">{task.note.title}</span>
        <span class="type-caption shrink-0 font-normal! text-subtle"
          >{TASK_STATUS_LABELS[status]}</span
        >
      </Button>
    {/each}
  </div>
{/snippet}

{#key animationKey}
  {#if loading}
    <TaskStatusProgress
      statuses={[]}
      {progress}
      loading
      {animationKey}
      ariaLabel={m.workspace_flameGraph_taskProgress_ariaLabel()}
    />
  {:else}
    <Tooltip
      content={taskListTooltip}
      side="bottom"
      align="start"
      sideOffset={6}
      delayDuration={300}
      disableHoverableContent={false}
      contentClass="h-auto! min-h-0! max-w-80 border-foreground/20! bg-secondary! p-0! text-secondary-foreground! shadow-(--elevation-overlay)! ring-1 ring-foreground/10 whitespace-normal"
      class="w-full {specNoteId && onTaskClick ? 'cursor-pointer' : ''}"
      onclick={() => specNoteId && onTaskClick?.(specNoteId)}
      showArrow
    >
      <TaskStatusProgress
        statuses={taskStatuses}
        {progress}
        loading={false}
        {animationKey}
        ariaLabel={m.workspace_flameGraph_taskProgress_ariaLabel()}
      />
    </Tooltip>
  {/if}
{/key}
