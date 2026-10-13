import { Fragment } from 'react';
import type { Note, TaskStatus } from '$shared/types';
import { isSpecNote } from '$shared/constants/notes';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import { buildTaskTree, flattenTasks } from '$lib/components/workspace/sidebar/flame-graph-model';
import {
  TASK_STATUS_INDICATOR_CLASSES,
  TASK_STATUS_LABELS,
} from '$lib/components/workspace/utils/task-status-display';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TaskStatusProgress } from '../task-status-progress';

export interface FlameGraphProps {
  notes: Note[];
  onTaskClick?: (noteId: string) => void;
  /** Canonical BE-owned completion ratio, from 0 to 1. Undefined while loading. */
  progress?: number;
  loading?: boolean;
  /** Remounts the visual bar so workspace switches replay the entrance animation. */
  animationKey?: string;
}

export function FlameGraph({
  notes = [],
  onTaskClick,
  progress,
  loading = progress === undefined,
  animationKey,
}: FlameGraphProps) {
  const taskList = flattenTasks(buildTaskTree(notes));
  const specNoteId = notes.find((note) => isSpecNote(note.id as string))?.id as string | undefined;
  const taskCount = taskList.length;
  const completedCount = taskList.filter(
    (task) => task.note.metadata?.task?.status === 'complete',
  ).length;
  const taskStatuses = taskList.map(
    (task) => task.note.metadata?.task?.status ?? ('not_started' as TaskStatus),
  );

  const taskListTooltip = (
    <div className="flex h-auto min-h-0 max-h-72 w-72 flex-col overflow-x-hidden overflow-y-auto px-2 py-1">
      <Button
        variant="ghost"
        type="button"
        className="type-caption mb-0.5 h-auto w-full cursor-pointer px-1 py-0.5 text-left font-normal text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 disabled:cursor-default"
        onClick={() => specNoteId && onTaskClick?.(specNoteId)}
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
      {taskList.map((task) => {
        const status = task.note.metadata?.task?.status ?? 'not_started';
        return (
          <Button
            key={task.note.id}
            variant="ghost"
            type="button"
            className="flex h-auto w-full min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
            onClick={() => onTaskClick?.(task.note.id as string)}
            aria-label={m.workspace_flameGraph_openTask_ariaLabel({
              title: task.note.title,
              status: TASK_STATUS_LABELS[status],
            })}
          >
            <span
              className={cn('size-2 shrink-0 rounded-full', TASK_STATUS_INDICATOR_CLASSES[status])}
              aria-hidden="true"
            />
            <span className="type-caption min-w-0 flex-1 truncate text-foreground">
              {task.note.title}
            </span>
            <span className="type-caption shrink-0 font-normal! text-subtle">
              {TASK_STATUS_LABELS[status]}
            </span>
          </Button>
        );
      })}
    </div>
  );

  return (
    <Fragment key={animationKey}>
      {loading ? (
        <TaskStatusProgress
          statuses={[]}
          progress={progress}
          loading
          animationKey={animationKey}
          ariaLabel={m.workspace_flameGraph_taskProgress_ariaLabel()}
        />
      ) : (
        <Tooltip
          content={taskListTooltip}
          side="bottom"
          align="start"
          sideOffset={6}
          delayDuration={300}
          disableHoverableContent={false}
          contentClass="h-auto! min-h-0! max-w-80 border-foreground/20! bg-secondary! p-0! text-secondary-foreground! shadow-(--elevation-overlay)! ring-1 ring-foreground/10 whitespace-normal"
          className={cn('w-full', specNoteId && onTaskClick && 'cursor-pointer')}
          onClick={() => specNoteId && onTaskClick?.(specNoteId)}
          showArrow
          trigger={
            <Button
              variant="ghost"
              wrapContent={false}
              className="h-5 w-full p-0"
              aria-label={
                specNoteId && onTaskClick
                  ? m.workspace_flameGraph_openSpecProgress_ariaLabel({
                      completed: formatInteger(completedCount),
                      total: formatInteger(taskCount),
                    })
                  : m.workspace_flameGraph_taskProgress_ariaLabel()
              }
            >
              <TaskStatusProgress
                statuses={taskStatuses}
                progress={progress}
                loading={false}
                animationKey={animationKey}
                ariaLabel={m.workspace_flameGraph_taskProgress_ariaLabel()}
              />
            </Button>
          }
        />
      )}
    </Fragment>
  );
}
