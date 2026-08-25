/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProgressItem } from '../workspace-task-fallback';
import TaskProgressControl from '../TaskProgressControl.svelte';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

const tasks: TaskProgressItem[] = [
  { id: 'pending', title: 'Inspect the panel', status: 'pending' },
  { id: 'running', title: 'Move the task progress', status: 'running' },
  { id: 'waiting', title: 'Wait for review', status: 'waiting' },
  { id: 'done-1', title: 'Map the native plan', status: 'completed' },
  { id: 'done-2', title: 'Add the fallback', status: 'completed' },
];

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: vi.fn(() => []),
  });
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TaskProgressControl', () => {
  it('shows compact progress and reveals one flat task list from keyboard focus', async () => {
    render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');
    expect(trigger.textContent?.trim()).toBe('');
    expect(trigger.getAttribute('aria-label')).toBe('Task progress: 2 of 5 completed');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();

    trigger.focus();
    const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
    expect(document.activeElement).toBe(trigger);
    expect(dialog).toBeTruthy();
    expect(dialog.className).toContain('type-body');
    expect(dialog.className).toContain('w-72');
    expect(dialog.className).toContain('rounded-md');
    expect(dialog.className).toContain('border-border');
    expect(dialog.className).toContain('bg-popover');
    expect(dialog.className).toContain('shadow-(--elevation-overlay)');
    expect(dialog.className).not.toContain('w-80');
    expect(dialog.className).not.toContain('rounded-(--radius-medium)');
    expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual([
      'pending',
      'running',
      'waiting',
      'done-1',
      'done-2',
    ]);
    expect(screen.getByLabelText('In Progress: Move the task progress')).toBeTruthy();
    expect(screen.getByText('Move the task progress').className).toContain('shimmer-text');
    expect(screen.getByLabelText('Complete: Map the native plan')).toBeTruthy();
    expect(
      screen.getAllByTestId('task-progress-row').every((row) => row.className.includes('h-7')),
    ).toBe(true);
    expect(
      screen.getAllByTestId('task-progress-row').every((row) => !row.className.includes('h-8')),
    ).toBe(true);
    expect(screen.getByText('Inspect the panel').className).toContain('text-popover-foreground');
    expect(screen.getByText('Inspect the panel').className).not.toContain('text-muted-foreground');
    expect(screen.getByText('Map the native plan').className).toContain('text-muted-foreground');
    expect(screen.getByText('Map the native plan').className).toContain('line-through');
    expect(screen.getByText('Map the native plan').className).toContain(
      'decoration-muted-foreground/30',
    );
    expect(screen.getByText('Map the native plan').closest('li')?.className).toContain(
      'opacity-70',
    );
    expect(screen.queryByTestId('task-progress-completed-toggle')).toBeNull();
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('layers one completed disk behind deeply overlapping active-task crescents', () => {
    const statusTasks: TaskProgressItem[] = [
      ...tasks,
      { id: 'discussion', title: 'Discuss the approach', status: 'discussion_needed' },
      { id: 'blocked', title: 'Resolve the blocker', status: 'blocked' },
      { id: 'review', title: 'Review the result', status: 'review_required' },
    ];
    render(TaskProgressControl, { props: { tasks: statusTasks } });

    const icons = screen.getAllByTestId('task-progress-status-icon');
    const stackItems = screen.getAllByTestId('task-progress-stack-item');
    expect(icons.map((icon) => icon.dataset.taskStatus)).toEqual([
      'completed',
      'pending',
      'waiting',
      'discussion_needed',
      'blocked',
      'review_required',
      'running',
    ]);
    expect(
      icons.map((icon) => icon.querySelector<HTMLElement>('[data-icon]')?.dataset.icon),
    ).toEqual([
      'check',
      'circle',
      'clock',
      'circle-question',
      'triangle-exclamation',
      'eye',
      'spinner',
    ]);
    expect(
      icons.every(
        (icon) =>
          icon.className.includes('size-3.5') &&
          icon.className.includes('items-center') &&
          icon.className.includes('justify-center') &&
          icon.className.includes('leading-none') &&
          icon.className.includes('rounded-full') &&
          !icon.className.includes('size-4') &&
          !icon.className.includes('border') &&
          !icon.className.includes('shadow'),
      ),
    ).toBe(true);
    expect(stackItems.slice(1).every((item) => item.className.includes('-ml-1.75'))).toBe(true);
    expect(stackItems.slice(1).every((item) => !item.className.includes('-ml-2'))).toBe(true);
    expect(stackItems.map((item) => item.style.zIndex)).toEqual(['', '1', '2', '3', '4', '5', '6']);
    expect(icons[0].className).toContain('bg-primary text-primary-foreground');
    expect(icons[0].dataset.completedCount).toBe('2');
    expect(icons[1].className).toContain('bg-muted');
    expect(icons[2].className).toContain('bg-muted');
    expect(icons.slice(3).every((icon) => icon.className.includes('primary'))).toBe(true);
    expect(icons.at(-1)?.className).toContain('bg-primary/20 text-primary');
    expect(icons.every((icon) => !/(green|blue|amber|red|violet)-/.test(icon.className))).toBe(
      true,
    );
    expect(icons.at(-1)?.innerHTML).toContain('motion-reduce:animate-none');
    const trigger = screen.getByTestId('task-progress-trigger');
    expect(trigger.className).toContain('h-7');
    expect(trigger.className).toContain('w-fit');
    expect(trigger.className).toContain('gap-0');
    expect(trigger.className).toContain('p-0');
    expect(trigger.className).toContain('m-0');
    expect(trigger.className).not.toMatch(/(?:min-w-|p[lrxy]-|m[lrxy]-)/);
  });

  it('reuses the compact status indicators in every flat row', async () => {
    const statusTasks: TaskProgressItem[] = [
      ...tasks,
      { id: 'discussion', title: 'Discuss the approach', status: 'discussion_needed' },
      { id: 'blocked', title: 'Resolve the blocker', status: 'blocked' },
      { id: 'review', title: 'Review the result', status: 'review_required' },
    ];
    render(TaskProgressControl, { props: { tasks: statusTasks } });
    screen.getByTestId('task-progress-trigger').focus();
    await screen.findByRole('dialog', { name: 'Agent tasks' });

    const stackByStatus = new Map(
      screen
        .getAllByTestId('task-progress-status-icon')
        .map((icon) => [icon.dataset.taskStatus, icon]),
    );
    const rowIcons = screen.getAllByTestId('task-progress-row-status-icon');
    expect(rowIcons).toHaveLength(statusTasks.length);
    expect(rowIcons.every((icon) => icon.className.includes('size-3.5'))).toBe(true);
    expect(rowIcons.every((icon) => !icon.className.includes('size-4'))).toBe(true);
    for (const rowIcon of rowIcons) {
      const stackIcon = stackByStatus.get(rowIcon.dataset.taskStatus);
      expect(stackIcon).toBeTruthy();
      expect(rowIcon.className).toBe(stackIcon?.className);
      expect(rowIcon.innerHTML).toBe(stackIcon?.innerHTML);
    }
  });

  it('shows exactly one solid completed disk when all tasks are complete', () => {
    render(TaskProgressControl, {
      props: { tasks: tasks.map((task) => ({ ...task, status: 'completed' as const })) },
    });

    const icons = screen.getAllByTestId('task-progress-status-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0].dataset.taskStatus).toBe('completed');
    expect(icons[0].dataset.completedCount).toBe('5');
    expect(icons[0].className).toContain('bg-primary text-primary-foreground');
    expect(icons[0].className).not.toContain('border');
    expect(icons[0].className).not.toContain('shadow');
  });

  it('opens the task list directly on hover without a separate tooltip', async () => {
    render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');

    await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });

    expect(await screen.findByRole('dialog', { name: 'Agent tasks' })).toBeTruthy();
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('keeps the flat list and trigger focus through live task movement', async () => {
    const view = render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');
    trigger.focus();
    await screen.findByRole('dialog', { name: 'Agent tasks' });

    await view.rerender({
      tasks: tasks.map((task) =>
        task.id === 'running' ? { ...task, status: 'completed' as const } : task,
      ),
    });

    await waitFor(() =>
      expect(trigger.getAttribute('aria-label')).toBe('Task progress: 3 of 5 completed'),
    );
    expect(document.activeElement).toBe(trigger);
    expect(
      screen
        .getAllByTestId('task-progress-status-icon')
        .filter((icon) => icon.dataset.taskStatus === 'completed'),
    ).toHaveLength(1);
    expect(screen.getByText('Move the task progress')).toBeTruthy();
    expect(screen.queryByTestId('task-progress-completed-toggle')).toBeNull();
    expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual([
      'pending',
      'waiting',
      'running',
      'done-1',
      'done-2',
    ]);
  });

  it('stays hidden for an empty task set', () => {
    render(TaskProgressControl, { props: { tasks: [] } });
    expect(screen.queryByTestId('task-progress-trigger')).toBeNull();
  });
});
