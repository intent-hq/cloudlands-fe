/**
 * StartupProgress renders a daemon startup snapshot
 * (docs/protocol/startup-readiness.md) without inventing work the daemon did
 * not report, and never presents a stale or failed snapshot as current.
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { DaemonStartupState, StartupSnapshot } from '$shared/daemon-startup';
import StartupProgress from '../StartupProgress.svelte';

const preparing: StartupSnapshot = {
  startupStatus: 1,
  attemptId: 'boot-a',
  phase: 'preparing',
  elapsedMs: 4200,
  phaseElapsedMs: 4200,
  progressAgeMs: 0,
  retryAfterMs: 1000,
};
const indexing: StartupSnapshot = {
  ...preparing,
  phase: 'indexing',
  progress: {
    completedNotes: 5,
    totalNotes: 20,
    processedSourceBytes: 5000,
    totalSourceBytes: 20000,
  },
};

function starting(snapshot: StartupSnapshot | null, available = true): DaemonStartupState {
  return { state: 'starting', snapshot, available };
}

function heading(view: ReturnType<typeof render>): string {
  return view.getByRole('heading').textContent?.trim() ?? '';
}

afterEach(cleanup);

describe('StartupProgress', () => {
  it("shows today's no-count startup without inventing indexing work", async () => {
    const view = render(StartupProgress, { state: starting(preparing) });
    const preparingHeading = heading(view);
    expect(view.getByTestId('daemon-startup-elapsed').textContent).toMatch(/4/);
    expect(view.queryByTestId('daemon-startup-notes')).toBeNull();
    expect(view.queryByTestId('daemon-startup-estimate')).toBeNull();

    await view.rerender({
      state: starting({ ...preparing, phase: 'finalizing', finalizingStep: 'services' }),
    });
    const finalizingHeading = heading(view);
    expect(finalizingHeading).not.toBe(preparingHeading);
    expect(view.queryByTestId('daemon-startup-notes')).toBeNull();
    expect(view.queryByTestId('daemon-startup-estimate')).toBeNull();

    // Ready is still "finishing" until the fresh hello reports connected.
    await view.rerender({
      state: starting({ ...preparing, phase: 'ready', retryAfterMs: undefined }),
    });
    expect(heading(view)).toBe(finalizingHeading);
  });

  it('shows indexing counts and the estimate, and hides the estimate once progress stalls', async () => {
    const view = render(StartupProgress, { state: starting(indexing) });
    const notes = view.getByTestId('daemon-startup-notes').textContent ?? '';
    expect(notes).toMatch(/5/);
    expect(notes).toMatch(/20/);
    const estimating = view.getByTestId('daemon-startup-estimate').textContent;

    await view.rerender({ state: starting({ ...indexing, estimatedRemainingMs: 8000 }) });
    const estimate = view.getByTestId('daemon-startup-estimate').textContent ?? '';
    expect(estimate).toMatch(/8/);
    expect(estimate).not.toBe(estimating);

    await view.rerender({
      state: starting({ ...indexing, progressAgeMs: 30_000, estimatedRemainingMs: 8000 }),
    });
    const stalled = view.getByTestId('daemon-startup-estimate').textContent ?? '';
    expect(stalled).not.toBe(estimate);
    expect(stalled).not.toMatch(/8/);
  });

  it('never presents a cached snapshot as current once a status read failed', async () => {
    const view = render(StartupProgress, { state: starting(indexing) });
    const live = heading(view);
    await view.rerender({ state: starting(indexing, false) });
    expect(heading(view)).not.toBe(live);
    expect(view.queryByTestId('daemon-startup-elapsed')).toBeNull();
    expect(view.queryByTestId('daemon-startup-notes')).toBeNull();
  });

  it('shows a failed start as a failure, whether reported by state or snapshot', async () => {
    const view = render(StartupProgress, {
      state: { state: 'failed', snapshot: null, available: false, message: 'x' },
    });
    const failedHeading = heading(view);
    expect(view.queryByTestId('daemon-startup-elapsed')).toBeNull();

    const failedSnapshot: StartupSnapshot = {
      ...preparing,
      phase: 'failed',
      retryAfterMs: undefined,
      failure: { code: 'startup-failed', message: 'Daemon startup failed. Check daemon logs.' },
    };
    await view.rerender({
      state: { state: 'failed', snapshot: failedSnapshot, available: true, message: 'x' },
    });
    expect(heading(view)).toBe(failedHeading);
    expect(view.queryByTestId('daemon-startup-elapsed')).toBeNull();

    await view.rerender({ state: starting(preparing) });
    expect(heading(view)).not.toBe(failedHeading);
  });
});
