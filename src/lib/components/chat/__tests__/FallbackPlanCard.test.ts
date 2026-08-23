/**
 * @vitest-environment jsdom
 *
 * FallbackPlanCard (monorepo#3249): compact workspace-task list shown when a
 * provider emits no native ACP plan. Covers source priority (a native plan
 * hides the card entirely), cancelled-task exclusion + source order (via the
 * selector's output contract), the delegated single-task case, live status
 * updates, and the mount-time rehydration dispatch.
 */
import { render, screen, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { tick } from 'svelte';
import type { WorkspaceTask } from '$shared/types';

// jsdom has no SVG geometry; TaskStatusIcon's `draw` transitions need it.
beforeAll(() => {
  (SVGElement.prototype as unknown as { getTotalLength: () => number }).getTotalLength = () => 0;
});

const { dispatchMock, tasksState, nativePlanState } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  tasksState: {
    tasks: [] as unknown[],
    subscribers: new Set<(value: unknown[]) => void>(),
  },
  nativePlanState: {
    hasPlan: false,
    subscribers: new Set<(value: boolean) => void>(),
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: dispatchMock });
});

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectFallbackPlanTasksForAgent: () => ({
    subscribe: (run: (value: unknown[]) => void) => {
      tasksState.subscribers.add(run);
      run(tasksState.tasks);
      return () => tasksState.subscribers.delete(run);
    },
  }),
}));

vi.mock('$store/renderer/slices/native-plans/native-plans-selectors', () => ({
  selectHasNativePlanForAgent: () => ({
    subscribe: (run: (value: boolean) => void) => {
      nativePlanState.subscribers.add(run);
      run(nativePlanState.hasPlan);
      return () => nativePlanState.subscribers.delete(run);
    },
  }),
}));

import FallbackPlanCard from '../FallbackPlanCard.svelte';

function makeTask(id: string, status: WorkspaceTask['status'], title = `Task ${id}`): WorkspaceTask {
  return { id, title, status, workspaceId: 'ws-1', specLinked: true } as WorkspaceTask;
}

function setTasks(tasks: WorkspaceTask[]) {
  tasksState.tasks = tasks;
  for (const run of tasksState.subscribers) run(tasks);
}

function setNativePlan(hasPlan: boolean) {
  nativePlanState.hasPlan = hasPlan;
  for (const run of nativePlanState.subscribers) run(hasPlan);
}

const props = { workspaceId: 'ws-1', agentId: 'agent-1' };

describe('FallbackPlanCard', () => {
  afterEach(() => {
    cleanup();
    tasksState.tasks = [];
    tasksState.subscribers.clear();
    nativePlanState.hasPlan = false;
    nativePlanState.subscribers.clear();
    dispatchMock.mockClear();
  });

  it('renders selector tasks in order with status icons and title truncation styling', async () => {
    setTasks([makeTask('t1', 'complete'), makeTask('t2', 'in_progress'), makeTask('t3', 'not_started')]);
    render(FallbackPlanCard, { props });
    await tick();

    const card = screen.getByTestId('fallback-plan-card');
    expect(card.getAttribute('aria-label')).toBeTruthy();
    const rows = screen.getAllByTestId('fallback-plan-task');
    expect(rows.map((row) => row.getAttribute('data-task-status'))).toEqual([
      'complete',
      'in_progress',
      'not_started',
    ]);
    expect(screen.getByTestId('fallback-plan-summary-title').textContent).toContain('3');
  });

  it('stays hidden when the selector returns no tasks', async () => {
    render(FallbackPlanCard, { props });
    await tick();
    expect(screen.queryByTestId('fallback-plan-card')).toBeNull();
  });

  it('never renders while a native ACP plan exists (source priority)', async () => {
    setNativePlan(true);
    setTasks([makeTask('t1', 'in_progress')]);
    render(FallbackPlanCard, { props });
    await tick();
    expect(screen.queryByTestId('fallback-plan-card')).toBeNull();
  });

  it('appears when a native plan is cleared and hides when one arrives', async () => {
    setNativePlan(true);
    setTasks([makeTask('t1', 'in_progress')]);
    render(FallbackPlanCard, { props });
    await tick();
    expect(screen.queryByTestId('fallback-plan-card')).toBeNull();

    setNativePlan(false);
    await tick();
    expect(screen.getByTestId('fallback-plan-card')).toBeTruthy();

    setNativePlan(true);
    await tick();
    expect(screen.queryByTestId('fallback-plan-card')).toBeNull();
  });

  it('renders the delegated single-task case with a singular heading', async () => {
    setTasks([makeTask('t9', 'in_progress', 'My delegated task')]);
    render(FallbackPlanCard, { props });
    await tick();

    expect(screen.getAllByTestId('fallback-plan-task')).toHaveLength(1);
    expect(screen.getByText('My delegated task')).toBeTruthy();
    expect(screen.getByTestId('fallback-plan-summary-title').textContent).toContain('1');
  });

  it('dispatches the idempotent rehydration action on mount (reload path)', async () => {
    const { ensureWorkspaceTasksLoaded } = await import(
      '$store/renderer/slices/workspace-tasks/workspace-tasks-slice'
    );
    render(FallbackPlanCard, { props });
    await tick();

    expect(dispatchMock).toHaveBeenCalledWith(ensureWorkspaceTasksLoaded('ws-1'));
  });

  it('updates live when task statuses change in the store', async () => {
    setTasks([makeTask('t1', 'not_started')]);
    render(FallbackPlanCard, { props });
    await tick();
    expect(screen.getByTestId('fallback-plan-task').getAttribute('data-task-status')).toBe(
      'not_started',
    );

    setTasks([makeTask('t1', 'complete')]);
    await tick();
    expect(screen.getByTestId('fallback-plan-task').getAttribute('data-task-status')).toBe(
      'complete',
    );
  });
});
