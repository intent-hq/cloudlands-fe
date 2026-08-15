import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '$shared/types';
import {
  buildTaskProgressSegments,
  formatTaskStatusValueText,
  normalizeTaskStatusBars,
} from './task-status-display';

const everyStatus: TaskStatus[] = [
  'not_started',
  'waiting',
  'discussion_needed',
  'blocked',
  'in_progress',
  'review_required',
  'complete',
  'cancelled',
];

describe('task status progress mapping', () => {
  it('keeps exact included status detail while emitting three ordered visual segments', () => {
    const statusBars = normalizeTaskStatusBars(everyStatus);

    expect(statusBars.map(({ status, count }) => [status, count])).toEqual([
      ['complete', 1],
      ['in_progress', 1],
      ['review_required', 1],
      ['discussion_needed', 1],
      ['blocked', 1],
      ['waiting', 1],
      ['not_started', 1],
    ]);
    expect(buildTaskProgressSegments(statusBars)).toEqual([
      { visualState: 'completed', count: 1 },
      { visualState: 'striped', count: 5 },
      { visualState: 'not-started', count: 1 },
    ]);
    expect(formatTaskStatusValueText(statusBars, 'Task progress')).toBe(
      '1 complete, 1 in progress, 1 review required, 1 discussion needed, 1 blocked, 1 waiting, 1 not started',
    );
  });

  it('uses the canonical fallback total when detailed tasks are stale', () => {
    const statusBars = normalizeTaskStatusBars(['complete'], {
      total: 5,
      completed: 2,
      inProgress: 1,
    });

    expect(statusBars).toEqual([
      { status: 'complete', count: 2 },
      { status: 'in_progress', count: 1 },
      { status: 'not_started', count: 2 },
    ]);
    expect(buildTaskProgressSegments(statusBars).reduce((sum, bar) => sum + bar.count, 0)).toBe(5);
  });

  it('clamps malformed fallback counts without exceeding the total', () => {
    const statusBars = normalizeTaskStatusBars([], {
      total: 3,
      completed: 5,
      inProgress: 4,
    });

    expect(statusBars).toEqual([{ status: 'complete', count: 3 }]);
    expect(buildTaskProgressSegments(statusBars)).toEqual([{ visualState: 'completed', count: 3 }]);
  });
});
