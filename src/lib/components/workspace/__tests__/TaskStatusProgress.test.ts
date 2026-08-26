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

  it('keeps static progress free of animation classes and time-keyed remounts', async () => {
    const view = render(TaskStatusProgress, {
      props: {
        statuses: mixedStatuses,
        progress: 1 / 7,
        animationKey: 'workspace-one',
        motion: false,
        ariaLabel: 'Task progress',
      },
    });
    const progressbar = screen.getByRole('progressbar');
    const segments = view.container.querySelectorAll('[data-task-progress-style]');

    expect(progressbar.getAttribute('data-task-status-motion')).toBe('static');
    expect(progressbar.getAttribute('data-flame-animation-key')).toBeNull();
    expect(progressbar.className).not.toContain('flame-progress-enter');
    expect(
      [...segments].every((segment) => !segment.classList.contains('flame-status-segment')),
    ).toBe(true);

    await view.rerender({
      statuses: mixedStatuses,
      progress: 2 / 7,
      animationKey: 'workspace-two',
      motion: false,
      ariaLabel: 'Task progress',
    });
    expect(screen.getByRole('progressbar')).toBe(progressbar);

    view.unmount();
    const loading = render(TaskStatusProgress, {
      props: {
        statuses: [],
        loading: true,
        motion: false,
        ariaLabel: 'Task progress',
      },
    });
    const placeholder = loading.container.querySelector('[data-flame-progress-placeholder]');
    expect(placeholder?.getAttribute('data-task-status-motion')).toBe('static');
    expect(placeholder?.className).not.toContain('flame-progress-enter');
    expect(placeholder?.className).not.toContain('flame-status-segment');
  });
});
