// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$shared/types';

vi.mock('$lib/components/ui/tooltip', async () => ({
  Tooltip: (await import('./mocks/MockTooltipRich.svelte')).default,
}));

import FlameGraph from '../FlameGraph.svelte';

afterEach(cleanup);

describe('FlameGraph task progress', () => {
  it('reserves the progress slot while tasks are not loaded', () => {
    const { container } = render(FlameGraph, { props: { notes: [], animationKey: 'loading' } });

    expect(container.querySelector('[data-flame-progress-placeholder]')).not.toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('opens the spec from the muted summary and a task from its transparent row', async () => {
    const onTaskClick = vi.fn();
    const notes = [
      {
        id: 'spec',
        title: 'Spec',
        content: '- [ ] [Build UI](intent://local/task/task-1)',
        isDefault: true,
      },
      {
        id: 'task-1',
        title: 'Build UI',
        parentId: 'spec',
        metadata: { task: { status: 'in_progress' } },
      },
    ] as Note[];

    render(FlameGraph, { props: { notes, progress: 0.5, onTaskClick } });

    const row = screen.getByRole('button', { name: 'Open Build UI, In Progress' });
    const summary = screen.getByRole('button', { name: 'Open spec, 0 of 1 tasks complete' });
    const status = screen.getByText('In Progress');
    const tooltipContent = screen.getByTestId('mock-tooltip-content');
    const tooltipTrigger = screen.getByTestId('mock-tooltip-trigger');
    expect(status.className).toContain('font-normal');
    expect(status.className).toContain('text-subtle');
    expect(summary.className).toContain('cursor-pointer');
    expect(summary.className).toContain('font-normal');
    expect(row.className).not.toContain('hover:bg-');
    expect(tooltipContent.dataset.contentClass).toContain('whitespace-normal');
    expect(tooltipTrigger.className).toContain('cursor-pointer');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');

    await fireEvent.click(tooltipTrigger);
    expect(onTaskClick).toHaveBeenCalledWith('spec');

    await fireEvent.click(summary);
    expect(onTaskClick).toHaveBeenCalledWith('spec');

    await fireEvent.click(row);
    expect(onTaskClick).toHaveBeenCalledWith('task-1');
  });

  it('renders proportional status bars and remounts their animation across workspaces', async () => {
    const notes = [
      {
        id: 'spec',
        title: 'Spec',
        content: [
          '- [x] [Done](intent://local/task/done)',
          '- [/] [Build](intent://local/task/build)',
          '- [/] [Test](intent://local/task/test)',
          '- [ ] [Plan](intent://local/task/plan)',
        ].join('\n'),
        isDefault: true,
      },
      {
        id: 'done',
        title: 'Done',
        parentId: 'spec',
        metadata: { task: { status: 'complete' } },
      },
      {
        id: 'build',
        title: 'Build',
        parentId: 'spec',
        metadata: { task: { status: 'in_progress' } },
      },
      {
        id: 'test',
        title: 'Test',
        parentId: 'spec',
        metadata: { task: { status: 'review_required' } },
      },
      {
        id: 'plan',
        title: 'Plan',
        parentId: 'spec',
        metadata: { task: { status: 'not_started' } },
      },
    ] as Note[];

    const { container, rerender } = render(FlameGraph, {
      props: { notes, progress: 0.25, animationKey: 'workspace-one' },
    });
    const bars = container.querySelectorAll<HTMLElement>('[data-flame-status-bar]');
    const progressbar = screen.getByRole('progressbar');

    expect(Array.from(bars, (bar) => bar.dataset.flameStatusBar)).toEqual([
      'complete',
      'in_progress',
      'review_required',
      'not_started',
    ]);
    expect(bars[1].style.flexGrow).toBe('1');
    expect(bars[1].style.maskImage).toBe('var(--status-in-progress-hatch-mask)');
    expect(bars[0].className).toContain('bg-foreground');
    expect(bars[0].className).toContain('dark:bg-accent');
    expect(bars[0].className).not.toContain('border');
    expect(bars[1].className).toContain('bg-foreground');
    expect(bars[1].className).toContain('dark:bg-muted-foreground/60');
    expect(bars[2].className).toContain('bg-primary/70');
    expect(bars[2].className).toContain('dark:bg-secondary');
    expect(bars[3].className).toContain('bg-background');
    expect(bars[3].className).toContain('dark:bg-muted/60');
    expect(bars[1].className).toContain('flame-status-segment');
    expect(progressbar.className).toContain('bg-background');
    expect(progressbar.className).toContain('flame-progress-enter');
    expect(progressbar.getAttribute('data-flame-animation-key')).toBe('workspace-one');
    expect(progressbar.getAttribute('aria-valuetext')).toBe(
      '1 complete, 1 in progress, 1 review required, 1 not started',
    );

    await rerender({ notes, progress: 0.25, animationKey: 'workspace-two' });

    const switchedProgressbar = screen.getByRole('progressbar');
    expect(switchedProgressbar).not.toBe(progressbar);
    expect(switchedProgressbar.getAttribute('data-flame-animation-key')).toBe('workspace-two');
  });
});
