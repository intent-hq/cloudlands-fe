import { Fragment } from 'react';
import type { TaskStatus } from '$shared/types';
import {
  buildTaskProgressSegments,
  formatTaskStatusValueText,
  normalizeTaskStatusBars,
  TASK_PROGRESS_SEGMENT_CLASSES,
  type TaskProgressFallback,
} from '$lib/components/workspace/utils/task-status-display';
import { cn } from '@/lib/utils';
import './task-status-progress.css';

export interface TaskStatusProgressProps {
  statuses?: readonly TaskStatus[];
  progress?: number;
  loading?: boolean;
  animationKey?: string;
  motion?: boolean;
  ariaLabel: string;
  size?: 'default' | 'compact';
  fallback?: TaskProgressFallback;
  className?: string;
}

export function TaskStatusProgress({
  statuses = [],
  progress,
  loading = progress === undefined,
  animationKey,
  motion = true,
  ariaLabel,
  size = 'default',
  fallback,
  className = '',
}: TaskStatusProgressProps) {
  const statusBars = normalizeTaskStatusBars(statuses, fallback);
  const segments = buildTaskProgressSegments(statusBars);
  const progressPercent = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, (progress ?? 0) * 100))
    : 0;
  const progressValueText = formatTaskStatusValueText(statusBars, ariaLabel);
  const heightClass = size === 'compact' ? 'h-3' : 'h-5';

  return (
    <Fragment key={motion ? animationKey : undefined}>
      {loading ? (
        <div
          key="loading"
          className={cn(heightClass, 'w-full', className)}
          data-task-status-progress=""
          data-task-status-size={size}
          data-task-status-motion={motion ? 'animated' : 'static'}
          data-flame-progress-placeholder=""
          aria-hidden="true"
        />
      ) : (
        <div
          key="progress"
          className={cn(
            motion && 'flame-progress-enter',
            'flex w-full overflow-hidden rounded-xs bg-background',
            heightClass,
            className,
          )}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source segmented bar; native progress cannot render its three status treatments.
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
          aria-valuetext={progressValueText}
          data-task-status-progress=""
          data-task-status-size={size}
          data-task-status-motion={motion ? 'animated' : 'static'}
          data-flame-animation-key={motion ? animationKey : undefined}
        >
          {segments.map((segment) => (
            <div
              key={segment.visualState}
              className={cn(
                motion && 'flame-status-segment',
                'h-full min-w-0',
                TASK_PROGRESS_SEGMENT_CLASSES[segment.visualState],
              )}
              data-flame-status-bar={segment.visualState}
              data-task-progress-style={segment.visualState}
              aria-hidden="true"
              style={{
                flexBasis: '0%',
                flexGrow: segment.count,
                maskImage:
                  segment.visualState === 'striped'
                    ? 'var(--status-in-progress-hatch-mask)'
                    : undefined,
              }}
            />
          ))}
        </div>
      )}
    </Fragment>
  );
}
