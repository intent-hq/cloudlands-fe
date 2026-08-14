// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskStatus } from '$shared/types';
import TaskStatusProgress from '../TaskStatusProgress.svelte';

afterEach(cleanup);

const mixedStatuses: TaskStatus[] = [
  'complete',
  'in_progress',
  'review_required',
  'discussion_needed',
  'blocked',
  'waiting',
  'not_started',
  'cancelled',
];

describe('TaskStatusProgress', () => {
  it('renders completed, striped unfinished, and neutral not-started segments only', () => {
    const { container } = render(TaskStatusProgress, {
      props: { statuses: mixedStatuses, progress: 1 / 7, ariaLabel: 'Task progress' },
    });
    const segments = container.querySelectorAll<HTMLElement>('[data-task-progress-style]');

    expect(Array.from(segments, (segment) => segment.dataset.taskProgressStyle)).toEqual([
      'completed',
      'striped',
      'not-started',
    ]);
    expect(Array.from(segments, (segment) => segment.style.flexGrow)).toEqual(['1', '5', '1']);
    expect(segments[0].className).toContain('bg-foreground');
    expect(segments[1].style.maskImage).toBe('var(--status-in-progress-hatch-mask)');
    expect(segments[2].className).toContain('bg-background');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe(
      '1 complete, 1 in progress, 1 review required, 1 discussion needed, 1 blocked, 1 waiting, 1 not started',
    );
  });

  it('keeps loading and initialized empty geometry stable', () => {
    const loading = render(TaskStatusProgress, {
      props: { statuses: [], loading: true, ariaLabel: 'Task progress', size: 'compact' },
    });
    expect(
      loading.container.querySelector('[data-flame-progress-placeholder]')?.className,
    ).toContain('h-3');
    expect(screen.queryByRole('progressbar')).toBeNull();
    loading.unmount();

    const empty = render(TaskStatusProgress, {
      props: { statuses: [], progress: 0, ariaLabel: 'Task progress', size: 'compact' },
    });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Task progress');
    expect(empty.container.querySelectorAll('[data-task-progress-style]')).toHaveLength(0);
  });
});
