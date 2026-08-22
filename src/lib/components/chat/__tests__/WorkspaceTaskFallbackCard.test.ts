/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceTask } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

afterEach(cleanup);
warmImport(() => import('../WorkspaceTaskFallbackCard.svelte'));

const tasks: WorkspaceTask[] = [
  { id: 'pending', title: 'Pending task', status: 'not_started' },
  { id: 'active', title: 'Active task', status: 'in_progress' },
  { id: 'waiting', title: 'Waiting task', status: 'waiting' },
  { id: 'discussion', title: 'Discussion task', status: 'discussion_needed' },
  { id: 'blocked', title: 'Blocked task', status: 'blocked' },
  { id: 'review', title: 'Review task', status: 'review_required' },
  { id: 'done', title: 'Done task', status: 'complete' },
];

async function renderCard(initialTasks: WorkspaceTask[] = tasks) {
  const Card = (await import('../WorkspaceTaskFallbackCard.svelte')).default;
  return render(Card, { props: { tasks: initialTasks } });
}

describe('WorkspaceTaskFallbackCard', () => {
  it('renders every supported visible status with localized text and non-color icons', async () => {
    await renderCard();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-task-status'))).toEqual([
      'not_started',
      'in_progress',
      'waiting',
      'discussion_needed',
      'blocked',
      'review_required',
      'complete',
    ]);
    expect(screen.getByText('Not Started')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Discussion Needed')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Review Required')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(rows[1].querySelector('[data-icon="spinner"]')).toBeTruthy();
    expect(rows[4].querySelector('[data-icon="triangle-exclamation"]')).toBeTruthy();
    expect(rows[5].querySelector('[data-icon="eye"]')).toBeTruthy();
    expect(rows[6].querySelector('[data-icon="check"]')).toBeTruthy();
  });

  it('reacts to live canonical status updates', async () => {
    const view = await renderCard([{ id: 'task', title: 'Live task', status: 'in_progress' }]);
    expect(screen.getByText('In Progress')).toBeTruthy();

    await view.rerender({ tasks: [{ id: 'task', title: 'Live task', status: 'complete' }] });
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.getByText('1 / 1 complete')).toBeTruthy();
  });

  it('wraps long task titles in narrow panels and honors reduced motion', async () => {
    await renderCard([
      {
        id: 'task',
        title: 'A-very-long-workspace-task-that-must-wrap-inside-a-narrow-chat-panel',
        status: 'in_progress',
      },
    ]);
    const card = screen.getByTestId('workspace-task-fallback-card');
    const title = screen.getByText(/A-very-long-workspace-task/);
    const spinner = screen
      .getByRole('listitem', { current: 'step' })
      .querySelector('[data-icon="spinner"]');
    expect(card.className).toContain('min-w-0');
    expect(card.className).toContain('max-w-full');
    expect(title.className).toContain('break-words');
    expect(title.className).toContain('whitespace-normal');
    expect(spinner?.className.baseVal ?? spinner?.getAttribute('class')).toContain(
      'motion-reduce:animate-none',
    );
  });

  it('does not render an empty card', async () => {
    await renderCard([]);
    expect(screen.queryByTestId('workspace-task-fallback-card')).toBeNull();
  });
});
