/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanEntry } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

afterEach(cleanup);

warmImport(() => import('../ExecutionPlanCard.svelte'));

const entries: PlanEntry[] = [
  { content: 'Inspect the current renderer', priority: 'high', status: 'completed' },
  { content: 'Add the compact plan card', priority: 'high', status: 'in_progress' },
  { content: 'Run focused tests', priority: 'medium', status: 'pending' },
];

async function renderCard(planEntries: PlanEntry[] = entries) {
  const ExecutionPlanCard = (await import('../ExecutionPlanCard.svelte')).default;
  return render(ExecutionPlanCard, { props: { entries: planEntries } });
}

describe('ExecutionPlanCard', () => {
  it('renders completed, current, and pending rows with non-color cues', async () => {
    await renderCard();

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-plan-status'))).toEqual([
      'completed',
      'in_progress',
      'pending',
    ]);
    expect(rows[0].querySelector('[data-icon="check"]')).toBeTruthy();
    expect(rows[1].querySelector('[data-icon="spinner"]')).toBeTruthy();
    expect(rows[2].querySelector('[data-icon="circle"]')).toBeTruthy();
    expect(rows[0].textContent).toContain('Completed:');
    expect(rows[1].textContent).toContain('Current:');
    expect(rows[2].textContent).toContain('Pending:');
    expect(rows[1].getAttribute('aria-current')).toBe('step');
  });

  it('shows the current ordered step and completed terminal progress', async () => {
    const view = await renderCard();
    expect(screen.getByTestId('execution-plan-card').textContent).toContain('Step 2 / 3');

    await view.rerender({
      entries: entries.map((entry) => ({ ...entry, status: 'completed' as const })),
    });
    expect(screen.getByTestId('execution-plan-card').textContent).toContain('Step 3 / 3');
  });

  it('wraps long content without widening a narrow chat panel', async () => {
    await renderCard([
      {
        content: 'A-very-long-plan-entry-that-must-wrap-inside-a-narrow-chat-panel',
        priority: 'low',
        status: 'pending',
      },
    ]);

    const card = screen.getByTestId('execution-plan-card');
    const content = screen.getByRole('listitem').lastElementChild as HTMLElement;
    expect(card.className).toContain('min-w-0');
    expect(card.className).toContain('max-w-full');
    expect(content.className).toContain('break-words');
    expect(content.className).toContain('whitespace-normal');
  });

  it('disables current-step animation when reduced motion is requested', async () => {
    await renderCard();

    const spinner = screen
      .getByRole('listitem', { current: 'step' })
      .querySelector('[data-icon="spinner"]');
    expect(spinner?.className.baseVal ?? spinner?.getAttribute('class')).toContain(
      'motion-reduce:animate-none',
    );
  });

  it('does not show an empty plan card', async () => {
    await renderCard([]);
    expect(screen.queryByTestId('execution-plan-card')).toBeNull();
  });
});
