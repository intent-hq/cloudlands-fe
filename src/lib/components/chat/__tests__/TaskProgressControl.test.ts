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
  it('shows compact progress and reveals one-row active tasks from keyboard focus', async () => {
    render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');
    expect(trigger.textContent?.trim()).toBe('2/5');
    expect(trigger.getAttribute('aria-label')).toBe('Task progress: 2 of 5 completed');

    trigger.focus();
    const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
    expect(document.activeElement).toBe(trigger);
    expect(dialog).toBeTruthy();
    expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual([
      'pending',
      'running',
      'waiting',
    ]);
    expect(screen.getByLabelText('In Progress: Move the task progress')).toBeTruthy();
    expect(screen.getByText('Move the task progress').className).toContain('shimmer-text');
    expect(screen.queryByText('Map the native plan')).toBeNull();
  });

  it('starts completed tasks collapsed and keeps accordion focus through live movement', async () => {
    const view = render(TaskProgressControl, { props: { tasks } });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    const toggle = await screen.findByRole('button', { name: '2 tasks completed' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle);
    expect(screen.getByText('Map the native plan')).toBeTruthy();
    toggle.focus();

    await view.rerender({
      tasks: tasks.map((task) =>
        task.id === 'running' ? { ...task, status: 'completed' as const } : task,
      ),
    });

    await waitFor(() => expect(toggle.textContent).toContain('3 tasks completed'));
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByTestId('task-progress-trigger').textContent?.trim()).toBe('3/5');
    expect(screen.getByText('Move the task progress')).toBeTruthy();
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
