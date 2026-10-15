import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import StartupProgress from '../StartupProgress.svelte';
import type { StartupSnapshot } from '$shared/startup-status';

const snapshot: StartupSnapshot = {
  startupStatus: 1,
  attemptId: 'a',
  phase: 'indexing',
  elapsedMs: 5000,
  phaseElapsedMs: 5000,
  progressAgeMs: 0,
  retryAfterMs: 1000,
  progress: {
    completedNotes: 5,
    totalNotes: 20,
    processedSourceBytes: 5000,
    totalSourceBytes: 20000,
  },
};
afterEach(cleanup);
it('updates counts and estimates, hides stale work and never treats N/N as ready', async () => {
  const view = render(StartupProgress, { state: { snapshot, available: true } });
  expect(view.getByText(/5 of 20/)).toBeTruthy();
  expect(view.getByText(/Estimating/)).toBeTruthy();
  await view.rerender({
    state: { available: true, snapshot: { ...snapshot, estimatedRemainingMs: 2100 } },
  });
  expect(view.getByText(/About 3s/)).toBeTruthy();
  await view.rerender({
    state: { available: true, snapshot: { ...snapshot, estimatedRemainingMs: 8000 } },
  });
  expect(view.getByText(/About 8s/)).toBeTruthy();
  await view.rerender({
    state: {
      available: true,
      snapshot: { ...snapshot, progressAgeMs: 30000, estimatedRemainingMs: 8000 },
    },
  });
  expect(view.queryByText(/About/)).toBeNull();
  expect(view.getByText(/unchanged/)).toBeTruthy();
  await view.rerender({ state: { available: false, snapshot } });
  expect(view.queryByText(/5 of 20/)).toBeNull();
  expect(view.queryByText(/Elapsed/)).toBeNull();
  await view.rerender({
    state: {
      available: true,
      snapshot: {
        ...snapshot,
        phase: 'finalizing',
        finalizingStep: 'committing',
        progress: {
          completedNotes: 20,
          totalNotes: 20,
          processedSourceBytes: 20000,
          totalSourceBytes: 20000,
        },
      },
    },
  });
  expect(view.getByRole('heading').textContent).toMatch(/Finishing/);
  expect(view.queryByText(/About/)).toBeNull();
  await view.rerender({
    state: {
      available: true,
      snapshot: { ...snapshot, attemptId: 'b', phase: 'preparing', progress: undefined },
    },
  });
  expect(view.getByRole('heading').textContent).toMatch(/Starting/);
  expect(view.queryByText(/20 of 20/)).toBeNull();
});

it('shows no-count startup through services and ready without inventing indexing work', async () => {
  const preparing: StartupSnapshot = {
    startupStatus: 1,
    attemptId: 'lazy-boot',
    phase: 'preparing',
    elapsedMs: 1000,
    phaseElapsedMs: 1000,
    progressAgeMs: 0,
    retryAfterMs: 1000,
  };
  const view = render(StartupProgress, { state: { snapshot: preparing, available: true } });
  expect(view.getByRole('heading').textContent).toBe('Starting intentd');
  const expectNoIndexing = () => {
    expect(view.getByText(/Elapsed:/)).toBeTruthy();
    expect(
      view.queryByText(
        /Notes indexed|Rebuilding note indexes|Estimating remaining|About .*remaining/,
      ),
    ).toBeNull();
  };
  expectNoIndexing();
  await view.rerender({
    state: {
      available: true,
      snapshot: { ...preparing, phase: 'finalizing', finalizingStep: 'services' },
    },
  });
  expect(view.getByRole('heading').textContent).toBe('Finishing startup');
  expectNoIndexing();
  await view.rerender({
    state: {
      available: true,
      snapshot: { ...preparing, phase: 'ready', retryAfterMs: undefined },
    },
  });
  expect(view.getByRole('heading').textContent).toBe('Finishing startup');
  expectNoIndexing();
});
