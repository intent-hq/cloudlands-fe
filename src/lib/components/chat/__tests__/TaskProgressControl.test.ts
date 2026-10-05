/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
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

const allStatusTasks: TaskProgressItem[] = [
  { id: 'pending', title: 'Inspect the panel', status: 'pending' },
  { id: 'running', title: 'Move the task progress', status: 'running' },
  { id: 'completed', title: 'Map the native plan', status: 'completed' },
  { id: 'waiting', title: 'Wait for review', status: 'waiting' },
  { id: 'discussion', title: 'Discuss the approach', status: 'discussion_needed' },
  { id: 'blocked', title: 'Resolve the blocker', status: 'blocked' },
  { id: 'review', title: 'Review the result', status: 'review_required' },
];

const checklistCases: Array<{
  name: string;
  items: TaskProgressItem[];
  completed: number;
}> = [
  { name: 'one task', items: [tasks[0]], completed: 0 },
  { name: 'many tasks', items: tasks, completed: 2 },
  { name: 'active tasks', items: tasks.slice(0, 3), completed: 0 },
  {
    name: 'completed tasks',
    items: tasks.map((task) => ({ ...task, status: 'completed' as const })),
    completed: tasks.length,
  },
  { name: 'overflow tasks', items: allStatusTasks, completed: 1 },
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
  document.documentElement.classList.remove('dark', 'light');
  vi.restoreAllMocks();
});

describe('TaskProgressControl', () => {
  const searchableTasks: TaskProgressItem[] = [
    ...allStatusTasks,
    { id: 'extra', title: 'Review keyboard navigation', status: 'pending' },
  ];

  // jsdom has no layout: bits-ui hides floating wrappers after measuring empty
  // client rects. State tests use mounted controls; CT verifies their visibility.
  const statusControl = () => screen.getByLabelText('Filter tasks by status');
  const selectedStatus = () => statusControl().textContent?.replace(/\s+/g, ' ').trim();
  async function selectStatus(name: RegExp) {
    const trigger = statusControl();
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('listbox', { hidden: true });
    const index = screen.getAllByRole('option', { hidden: true }).findIndex((option) => {
      const label = option.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return name.test(label);
    });
    expect(index).toBeGreaterThanOrEqual(0);
    await fireEvent.keyDown(trigger, { key: 'Home' });
    for (let i = 0; i < index; i++) await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox', { hidden: true })).toBeNull());
    expect(statusControl().getAttribute('aria-expanded')).toBe('false');
  }

  it.each(['status-stack', 'checklist'] as const)(
    'shows search and status filters at eight tasks, not seven, for %s',
    async (presentation) => {
      const view = render(TaskProgressControl, { props: { tasks: allStatusTasks, presentation } });
      await fireEvent.click(screen.getByTestId('task-progress-trigger'));
      await screen.findByRole('dialog');
      expect(screen.queryByRole('searchbox')).toBeNull();
      expect(screen.queryByRole('combobox', { name: 'Filter tasks by status' })).toBeNull();

      await view.rerender({ tasks: searchableTasks, presentation });
      expect(screen.getByRole('searchbox')).toBeTruthy();
      expect(selectedStatus()).toBe('All 8');
      expect(screen.getByTestId('task-progress-summary').textContent?.match(/\d+/g)).toEqual([
        '1',
        '8',
      ]);
      expect(screen.getByTestId('task-progress-trigger').textContent?.trim()).toBe('');
    },
  );

  it('combines trimmed case-insensitive title search with status filters and unfiltered counts', async () => {
    render(TaskProgressControl, { props: { tasks: searchableTasks, presentation: 'checklist' } });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    const search = await screen.findByRole('searchbox');
    await fireEvent.input(search, { target: { value: '  ReVieW  ' } });
    await waitFor(() =>
      expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual([
        'waiting',
        'review',
        'extra',
      ]),
    );
    await selectStatus(/not started 2/i);
    await waitFor(() =>
      expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual([
        'extra',
      ]),
    );
    expect(selectedStatus()).toMatch(/not started 2/i);
    expect(screen.getByTestId('task-progress-summary').textContent?.match(/\d+/g)).toEqual([
      '1',
      '8',
    ]);
    await selectStatus(/complete 1/i);
    await waitFor(() => expect(screen.queryAllByTestId('task-progress-row')).toHaveLength(0));
    expect(screen.getByTestId('task-progress-no-matches')).toBeTruthy();
    await fireEvent.click(screen.getByText('Reset filters'));
    expect((search as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(search);
    expect(selectedStatus()).toBe('All 8');
    await waitFor(() => expect(screen.getAllByTestId('task-progress-row')).toHaveLength(8));
  });

  it('clears only the search query and retains the selected status', async () => {
    render(TaskProgressControl, { props: { tasks: searchableTasks, presentation: 'checklist' } });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    const search = await screen.findByRole('searchbox');
    expect(screen.queryByLabelText('Clear search')).toBeNull();
    await selectStatus(/not started 2/i);
    await fireEvent.input(search, { target: { value: 'missing' } });
    await waitFor(() => expect(screen.queryAllByTestId('task-progress-row')).toHaveLength(0));
    await fireEvent.click(screen.getByLabelText('Clear search'));
    expect((search as HTMLInputElement).value).toBe('');
    expect(selectedStatus()).toMatch(/not started 2/i);
    expect(screen.queryByLabelText('Clear search')).toBeNull();
    await waitFor(() =>
      expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual([
        'pending',
        'extra',
      ]),
    );
  });

  it.each([
    ['Not started 2', ['pending', 'extra']],
    ['In progress 1', ['running']],
    ['Waiting 1', ['waiting']],
    ['Discussion needed 1', ['discussion']],
    ['Blocked 1', ['blocked']],
    ['Review required 1', ['review']],
    ['Complete 1', ['completed']],
  ])('filters the existing %s status without changing task order', async (label, ids) => {
    render(TaskProgressControl, { props: { tasks: searchableTasks } });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    await selectStatus(new RegExp(label as string, 'i'));
    await waitFor(() =>
      expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual(
        ids,
      ),
    );
  });

  it('keeps an active search and zero-count selected status through live shrink, and resets on close', async () => {
    const view = render(TaskProgressControl, { props: { tasks: searchableTasks } });
    const trigger = screen.getByTestId('task-progress-trigger');
    await fireEvent.click(trigger);
    const search = await screen.findByRole('searchbox');
    await fireEvent.input(search, { target: { value: 'review' } });
    await selectStatus(/waiting 1/i);
    search.focus();
    await view.rerender({ tasks: [searchableTasks[0], searchableTasks[2]] });
    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe('review');
    expect(selectedStatus()).toBe('Waiting 0');
    expect(screen.getByTestId('task-progress-summary').textContent?.match(/\d+/g)).toEqual([
      '1',
      '2',
    ]);
    await waitFor(() => expect(screen.queryAllByTestId('task-progress-row')).toHaveLength(0));
    await fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await fireEvent.click(trigger);
    await screen.findByRole('dialog', { hidden: true });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getAllByTestId('task-progress-row')).toHaveLength(2);
    await view.rerender({ tasks: searchableTasks });
    expect((screen.getByRole('searchbox', { hidden: true }) as HTMLInputElement).value).toBe('');
    expect(selectedStatus()).toBe('All 8');
  });

  it('retains focused controls after unfiltered shrink and closes when every task disappears', async () => {
    const view = render(TaskProgressControl, { props: { tasks: searchableTasks } });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    const search = await screen.findByRole('searchbox');
    search.focus();
    await view.rerender({ tasks: allStatusTasks });
    expect(screen.getByRole('searchbox')).toBe(search);
    expect(document.activeElement).toBe(search);
    await fireEvent.input(search, { target: { value: 'missing' } });
    await view.rerender({ tasks: [] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('task-progress-trigger')).toBeNull();
    await view.rerender({ tasks: searchableTasks });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    expect(((await screen.findByRole('searchbox')) as HTMLInputElement).value).toBe('');
    expect(screen.getAllByTestId('task-progress-row')).toHaveLength(8);
  });

  it('updates filtered membership and counts when task titles and statuses change live', async () => {
    const view = render(TaskProgressControl, { props: { tasks: searchableTasks } });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    await fireEvent.input(await screen.findByRole('searchbox'), { target: { value: 'review' } });
    await selectStatus(/not started 2/i);
    await view.rerender({
      tasks: searchableTasks.map((task) =>
        task.id === 'extra' ? { ...task, status: 'completed' } : task,
      ),
    });
    await waitFor(() => expect(screen.queryAllByTestId('task-progress-row')).toHaveLength(0));
    expect(selectedStatus()).toMatch(/not started 1/i);
    await view.rerender({
      tasks: searchableTasks.map((task) =>
        task.id === 'pending' ? { ...task, title: 'Review panel' } : task,
      ),
    });
    await waitFor(() =>
      expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual([
        'pending',
        'extra',
      ]),
    );
  });

  it.each([
    ['status-stack', 'ArrowDown'],
    ['status-stack', 'PageDown'],
    ['checklist', 'ArrowDown'],
    ['checklist', 'PageDown'],
  ] as const)(
    'retains early %s %s entry until the scroll region mounts',
    async (presentation, key) => {
      render(TaskProgressControl, { props: { tasks: allStatusTasks, presentation } });
      const trigger = screen.getByTestId('task-progress-trigger');
      trigger.focus();
      // Deliver input before Svelte flushes the opening portal, not after a test wait.
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await tick();
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByTestId('task-progress-scroll-region')),
      );
    },
  );

  it.each(['ArrowDown', 'PageDown'])(
    'retains early %s entry to the correct long-list control',
    async (key) => {
      render(TaskProgressControl, { props: { tasks: searchableTasks, presentation: 'checklist' } });
      const trigger = screen.getByTestId('task-progress-trigger');
      trigger.focus();
      for (const input of ['Enter', key]) {
        trigger.dispatchEvent(
          new KeyboardEvent('keydown', { key: input, bubbles: true, cancelable: true }),
        );
      }
      await tick();
      await waitFor(() =>
        expect(document.activeElement).toBe(
          key === 'ArrowDown'
            ? screen.getByRole('searchbox')
            : screen.getByTestId('task-progress-scroll-region'),
        ),
      );
    },
  );

  it.each(['ArrowDown', 'PageDown'])(
    'cancels pending %s entry on close without replaying it',
    async (key) => {
      render(TaskProgressControl, { props: { tasks } });
      const trigger = screen.getByTestId('task-progress-trigger');
      const outside = document.createElement('button');
      document.body.append(outside);
      trigger.focus();
      for (const input of ['Enter', key, 'Enter']) {
        trigger.dispatchEvent(
          new KeyboardEvent('keydown', { key: input, bubbles: true, cancelable: true }),
        );
      }
      outside.focus();
      await tick();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(outside);
      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      expect(document.activeElement).toBe(trigger);
      outside.remove();
    },
  );

  it('drops pending keyboard entry when the task control unmounts', async () => {
    const component = render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');
    trigger.focus();
    for (const key of ['Enter', 'ArrowDown']) {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    component.unmount();
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('shows compact progress and reveals one flat task list only after activation', async () => {
    render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');
    expect(trigger.textContent?.trim()).toBe('');
    expect(trigger.getAttribute('aria-label')).toBe('Task progress: 2 of 5 completed');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();

    const closest = vi.spyOn(trigger, 'closest');
    trigger.focus();
    expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();
    await fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
    expect(closest).toHaveBeenCalledWith('[data-panel-id]');
    expect(document.activeElement).toBe(trigger);
    expect(dialog).toBeTruthy();
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
      screen
        .getAllByTestId('task-progress-row')
        .every(
          (row) =>
            row.className.includes('min-h-7') &&
            row.className.includes('items-start') &&
            row.className.includes('py-1') &&
            !row.className.split(' ').includes('h-7'),
        ),
    ).toBe(true);
    expect(screen.getByText('Inspect the panel').className).toContain('text-popover-foreground');
    expect(screen.getByText('Inspect the panel').className).not.toContain('text-muted-foreground');
    expect(screen.getByText('Map the native plan').className).toContain('text-muted-foreground');
    expect(screen.getByText('Map the native plan').className).not.toContain('line-through');
    expect(screen.getByText('Map the native plan').className).not.toContain('decoration-');
    expect(screen.getByText('Map the native plan').closest('li')?.className).not.toContain(
      'opacity-',
    );
    expect(screen.queryByTestId('task-progress-completed-toggle')).toBeNull();
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it.each(checklistCases)(
    'renders one checklist trigger with accessible progress and the full popover for $name',
    async ({ items, completed }) => {
      render(TaskProgressControl, { props: { tasks: items, presentation: 'checklist' } });

      const trigger = screen.getByTestId('task-progress-trigger');
      expect(trigger.getAttribute('aria-label')).toBe(
        `Task progress: ${completed} of ${items.length} completed`,
      );
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(screen.getByTestId('task-progress-checklist-icon')).toBeTruthy();
      expect(trigger.querySelector('[data-testid="task-progress-icon-stack"]')).toBeNull();
      expect(trigger.querySelector('[data-testid="task-progress-status-icon"]')).toBeNull();
      expect(trigger.querySelector('[data-testid="task-progress-overflow-indicator"]')).toBeNull();

      trigger.focus();
      expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();
      await fireEvent.click(trigger);
      const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
      await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
      expect(screen.getAllByTestId('task-progress-row')).toHaveLength(items.length);
      expect(dialog.querySelectorAll('[data-testid="task-progress-row-status-icon"]')).toHaveLength(
        items.length,
      );
    },
  );

  it('caps mixed-state crescents at five slots with running frontmost and neutral overflow', () => {
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
      'running',
    ]);
    expect(
      icons.map(
        (icon) =>
          icon.querySelector<HTMLElement>('[data-icon]')?.dataset.icon ??
          icon.querySelector<HTMLElement>('[data-slot="intent-mark-loader"]')?.dataset.slot,
      ),
    ).toEqual(['check', 'circle', 'clock', 'intent-mark-loader']);
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
    expect(stackItems).toHaveLength(5);
    expect(stackItems.map((item) => item.dataset.taskId ?? item.dataset.taskStatus)).toEqual([
      'completed',
      'pending',
      'waiting',
      'running',
      'overflow',
    ]);
    expect(stackItems.slice(1).every((item) => item.className.includes('-ml-1.75'))).toBe(true);
    expect(stackItems.slice(1).every((item) => !item.className.includes('-ml-2'))).toBe(true);
    expect(
      stackItems.map((item) => item.style.zIndex || item.className.match(/z-[0-9]+/)?.[0]),
    ).toEqual(['z-0', '1', '2', '6', '5']);
    expect(icons[0].dataset.completedCount).toBe('2');
    expect(icons.at(-1)?.querySelector('[data-slot="intent-mark-loader"]')).not.toBeNull();
    expect(icons.at(-1)?.innerHTML).not.toContain('animate-spin');
    const overflow = screen.getByTestId('task-progress-overflow-indicator');
    expect(overflow.dataset.overflowCount).toBe('3');
  });

  it('reuses the compact status indicators in every flat row', async () => {
    render(TaskProgressControl, { props: { tasks: allStatusTasks } });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    await screen.findByRole('dialog', { name: 'Agent tasks' });

    const rowIcons = screen.getAllByTestId('task-progress-row-status-icon');
    expect(rowIcons).toHaveLength(allStatusTasks.length);
    expect(rowIcons.every((icon) => icon.className.includes('size-3.5'))).toBe(true);
    expect(rowIcons.every((icon) => !icon.className.includes('size-4'))).toBe(true);
    expect(rowIcons.map((icon) => icon.dataset.taskStatus)).toEqual(
      allStatusTasks
        .filter((task) => task.status !== 'completed')
        .concat(allStatusTasks.filter((task) => task.status === 'completed'))
        .map((task) => task.status),
    );
    for (const icon of rowIcons) {
      expect(icon.className).toContain('mt-0.5');
    }
  });

  it.each(['light', 'dark'] as const)(
    'uses opaque background disks without border, outline, ring, or shadow classes in %s mode',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.classList.toggle('light', theme === 'light');
      render(TaskProgressControl, { props: { tasks: allStatusTasks } });
      await fireEvent.click(screen.getByTestId('task-progress-trigger'));
      await screen.findByRole('dialog', { name: 'Agent tasks' });

      const indicators = [
        ...screen.getAllByTestId('task-progress-status-icon'),
        ...screen.getAllByTestId('task-progress-row-status-icon'),
        screen.getByTestId('task-progress-overflow-indicator'),
      ];
      for (const indicator of indicators) {
        const classes = indicator.className.split(' ');
        const backgroundClass = classes.find((className) => className.startsWith('bg-'));
        expect(backgroundClass).toBe('bg-background');
        expect(backgroundClass).not.toContain('/');
        expect(indicator.className).toContain('text-foreground');
        expect(classes).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/^(?:border|outline|ring|shadow)(?:-|$)/)]),
        );
        expect(indicator.className).not.toMatch(
          /(?:primary|green|blue|workspace-status-unread|opacity-|\/[0-9])/,
        );
      }
    },
  );

  it('keeps every stack disk borderless inside the unchanged 14px box', () => {
    render(TaskProgressControl, { props: { tasks: allStatusTasks } });

    for (const indicator of screen.getAllByTestId('task-progress-status-icon')) {
      expect(indicator.className).toContain('size-3.5');
      expect(indicator.className.split(' ')).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^(?:border|outline|ring|shadow)(?:-|$)/)]),
      );
    }
  });

  it('clamps normal and shimmered titles to two lines with full accessible text', async () => {
    const longPendingTitle = 'Inspect every part of the panel before completing the visual review';
    const longRunningTitle = 'Move the running task progress title into exactly two compact lines';
    render(TaskProgressControl, {
      props: {
        tasks: [
          { id: 'long-pending', title: longPendingTitle, status: 'pending' },
          { id: 'long-running', title: longRunningTitle, status: 'running' },
        ],
      },
    });
    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    await screen.findByRole('dialog', { name: 'Agent tasks' });

    const pendingTitle = screen.getByText(longPendingTitle);
    const runningShimmer = screen.getByText(longRunningTitle);
    const runningTitle = runningShimmer.parentElement;
    expect(pendingTitle.className).toContain('line-clamp-2');
    expect(pendingTitle.className).not.toContain('truncate');
    expect(runningTitle?.className).toContain('line-clamp-2');
    expect(runningShimmer.className).toContain('line-clamp-2');
    expect(runningShimmer.className).not.toContain('truncate');
    expect(pendingTitle.getAttribute('title')).toBe(longPendingTitle);
    expect(runningTitle?.getAttribute('title')).toBe(longRunningTitle);
    expect(screen.getByLabelText(`Not Started: ${longPendingTitle}`)).toBeTruthy();
    expect(screen.getByLabelText(`In Progress: ${longRunningTitle}`)).toBeTruthy();
  });

  it('shows exactly one solid completed disk when all tasks are complete', () => {
    render(TaskProgressControl, {
      props: { tasks: tasks.map((task) => ({ ...task, status: 'completed' as const })) },
    });

    const icons = screen.getAllByTestId('task-progress-status-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0].dataset.taskStatus).toBe('completed');
    expect(icons[0].dataset.completedCount).toBe('5');
    expect(icons[0].className).not.toContain('border');
    expect(icons[0].className).not.toContain('shadow');
  });

  it.each(['status-stack', 'checklist'] as const)(
    'shows progress help on hover without opening the %s task list',
    async (presentation) => {
      render(TaskProgressControl, { props: { tasks, presentation } });
      const trigger = screen.getByTestId('task-progress-trigger');

      await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });

      expect(
        await screen.findByRole('tooltip', {
          name: 'Task progress: 2 of 5 completed',
          hidden: true,
        }),
      ).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();
    },
  );

  it.each(['status-stack', 'checklist'] as const)(
    'opens the %s task list from click, Enter, and Space and closes predictably',
    async (presentation) => {
      render(TaskProgressControl, { props: { tasks, presentation } });
      const trigger = screen.getByTestId('task-progress-trigger');
      const outside = document.createElement('button');
      document.body.append(outside);

      trigger.focus();
      expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();

      await fireEvent.click(trigger);
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
      await fireEvent.click(trigger);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());

      await fireEvent.keyDown(trigger, { key: 'Enter' });
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      await fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());
      expect(document.activeElement).toBe(trigger);

      await fireEvent.keyDown(trigger, { key: ' ' });
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      await fireEvent.keyDown(trigger, { key: ' ' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());
      await fireEvent.keyDown(trigger, { key: ' ' });
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      outside.focus();
      await fireEvent.focusIn(outside);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());
      expect(document.activeElement).toBe(outside);
      outside.remove();
    },
  );

  it('closes the trigger tooltip while the task list is open and restores it after close', async () => {
    render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');

    await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    await screen.findByRole('tooltip', { hidden: true });
    await fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Agent tasks' });
    await waitFor(() => expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull());

    await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    await fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());
    await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip', { hidden: true })).toBeTruthy();
  });

  it.each(['status-stack', 'checklist'] as const)(
    'keeps the %s tooltip dismissed after an outside pointer close until a new help cycle',
    async (presentation) => {
      render(TaskProgressControl, { props: { tasks, presentation } });
      const trigger = screen.getByTestId('task-progress-trigger');
      const tooltipTrigger = trigger.closest('span');
      if (!tooltipTrigger) throw new Error('Task progress tooltip trigger wrapper is missing');
      const outside = document.createElement('button');
      document.body.append(outside);

      await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
      await screen.findByRole('tooltip', { hidden: true });
      await fireEvent.click(trigger);
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      await new Promise((resolve) => setTimeout(resolve, 20));

      await fireEvent.pointerDown(outside, { pointerType: 'mouse', button: 0 });
      outside.focus();
      await fireEvent.focusIn(outside);
      await fireEvent.pointerUp(outside, { pointerType: 'mouse', button: 0 });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());

      await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
      await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(document.querySelector('[role="tooltip"]:not([data-state="closed"])')).toBeNull();

      await fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
      await fireEvent.pointerLeave(tooltipTrigger, { pointerType: 'mouse' });
      await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
      await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
      await waitFor(() =>
        expect(document.querySelector('[role="tooltip"]:not([data-state="closed"])')).toBeTruthy(),
      );

      await fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
      await fireEvent.pointerLeave(tooltipTrigger, { pointerType: 'mouse' });
      await fireEvent.click(trigger);
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fireEvent.pointerDown(outside, { pointerType: 'mouse', button: 0 });
      outside.focus();
      await fireEvent.focusIn(outside);
      await fireEvent.pointerUp(outside, { pointerType: 'mouse', button: 0 });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());
      expect(document.querySelector('[role="tooltip"]:not([data-state="closed"])')).toBeNull();

      trigger.focus();
      await fireEvent.focusIn(trigger);
      await waitFor(() =>
        expect(document.querySelector('[role="tooltip"]:not([data-state="closed"])')).toBeTruthy(),
      );
      outside.remove();
    },
  );

  it.each(['status-stack', 'checklist'] as const)(
    'clears pending %s tooltip suppression when the outside pointer is cancelled',
    async (presentation) => {
      render(TaskProgressControl, { props: { tasks, presentation } });
      const trigger = screen.getByTestId('task-progress-trigger');
      const outside = document.createElement('button');
      document.body.append(outside);

      await fireEvent.click(trigger);
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      await fireEvent.pointerDown(outside, {
        pointerType: 'mouse',
        pointerId: 7,
        button: 0,
      });
      await fireEvent.pointerCancel(outside, { pointerType: 'mouse', pointerId: 7 });
      await fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());

      await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
      await waitFor(() =>
        expect(document.querySelector('[role="tooltip"]:not([data-state="closed"])')).toBeTruthy(),
      );
      outside.remove();
    },
  );

  it.each(['status-stack', 'checklist'] as const)(
    'clears dismissed %s tooltip suppression when the task trigger remounts',
    async (presentation) => {
      const view = render(TaskProgressControl, { props: { tasks, presentation } });
      const trigger = screen.getByTestId('task-progress-trigger');
      const outside = document.createElement('button');
      document.body.append(outside);

      await fireEvent.click(trigger);
      await screen.findByRole('dialog', { name: 'Agent tasks' });
      await fireEvent.pointerDown(outside, { pointerType: 'mouse', button: 0 });
      outside.focus();
      await fireEvent.focusIn(outside);
      await fireEvent.pointerUp(outside, { pointerType: 'mouse', button: 0 });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());

      await view.rerender({ tasks: [], presentation });
      expect(screen.queryByTestId('task-progress-trigger')).toBeNull();
      await view.rerender({ tasks, presentation });
      const remountedTrigger = screen.getByTestId('task-progress-trigger');
      await fireEvent.pointerMove(remountedTrigger, { pointerType: 'mouse' });
      await waitFor(() =>
        expect(document.querySelector('[role="tooltip"]:not([data-state="closed"])')).toBeTruthy(),
      );
      outside.remove();
    },
  );

  it('uses one atomic status node and coalesces task update bursts without an initial announcement', async () => {
    vi.useFakeTimers();
    const view = render(TaskProgressControl, { props: { tasks } });
    const announcement = screen.getByRole('status');

    expect(announcement.textContent).toBe('');
    expect(announcement.getAttribute('aria-live')).toBe('polite');
    expect(announcement.getAttribute('aria-atomic')).toBe('true');
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);

    await fireEvent.click(screen.getByTestId('task-progress-trigger'));
    await tick();
    expect(screen.getByTestId('task-progress-scroll-region').hasAttribute('aria-live')).toBe(false);

    await view.rerender({
      tasks: tasks.map((task) =>
        task.id === 'running' ? { ...task, status: 'waiting' as const } : task,
      ),
    });
    await view.rerender({
      tasks: tasks.map((task) =>
        task.id === 'running' ? { ...task, status: 'completed' as const } : task,
      ),
    });
    await vi.advanceTimersByTimeAsync(119);
    expect(announcement.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(announcement.textContent).toBe('Complete: Move the task progress');
    expect(announcement.textContent).not.toContain('Inspect the panel');
    vi.useRealTimers();
  });

  it('retains every task in a bounded vertically scrollable long-list popover', async () => {
    const longTasks: TaskProgressItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: `task-${index}`,
      title: `Task ${index}`,
      status: index === 10 ? 'running' : index >= 9 ? 'completed' : 'pending',
    }));
    render(TaskProgressControl, { props: { tasks: longTasks } });

    const trigger = screen.getByTestId('task-progress-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('Task progress: 2 of 12 completed');
    await fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
    const scrollRegion = screen.getByTestId('task-progress-scroll-region');

    expect(dialog.className).toContain('max-h-(--bits-popover-content-available-height)');
    expect(scrollRegion.className).toContain('max-h-64');
    expect(scrollRegion.className).toContain('overflow-y-auto');
    expect(scrollRegion.className).toContain('overscroll-contain');
    expect(screen.getAllByTestId('task-progress-row').map((row) => row.dataset.taskId)).toEqual(
      longTasks
        .filter((task) => task.status !== 'completed')
        .concat(longTasks.filter((task) => task.status === 'completed'))
        .map((task) => task.id),
    );
  });

  it('keeps the flat list and trigger focus through live task movement', async () => {
    const view = render(TaskProgressControl, { props: { tasks } });
    const trigger = screen.getByTestId('task-progress-trigger');
    trigger.focus();
    await fireEvent.click(trigger);
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
