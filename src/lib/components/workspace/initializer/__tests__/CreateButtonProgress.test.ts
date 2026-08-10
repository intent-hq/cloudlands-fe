/**
 * @vitest-environment jsdom
 *
 * CreateButtonProgress: live daemon-driven stage label + 2px bottom bar on
 * the Create button. Before any frame arrives (sawFrame false) the fallback
 * label renders and no bar exists; frames flip it to phase label + percent +
 * determinate bar; percent/bar are monotonic (a lower late frame never moves
 * them backwards).
 */
import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  beginWorkspaceCreateProgress,
  initialState,
  workspaceCreateProgressReceived,
  workspaceCreateProgressReducer,
} from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
import type { WorkspaceCreateProgressState } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-types';
import CreateButtonProgress from '../CreateButtonProgress.svelte';

const PID = '11111111-1111-4111-8111-111111111111';

const mockStore = vi.hoisted(() => ({
  sliceState: null as unknown,
  emitState: () => {},
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const appStore = createAppStoreMock({
    state: () => ({ workspaceCreateProgress: mockStore.sliceState }),
  });
  mockStore.emitState = () => appStore.emitState();
  return { store: appStore, appStore };
});

function setSliceState(state: WorkspaceCreateProgressState) {
  mockStore.sliceState = state;
}

function dispatchToSlice(action: Parameters<typeof workspaceCreateProgressReducer>[1]) {
  setSliceState(
    workspaceCreateProgressReducer(
      mockStore.sliceState as WorkspaceCreateProgressState,
      action,
    ),
  );
  mockStore.emitState();
}

describe('CreateButtonProgress', () => {
  beforeEach(() => {
    setSliceState(
      workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID)),
    );
  });

  it('renders the fallback label (and no bar) until the first frame arrives', () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace...' },
    });
    expect(screen.getByText('Preparing workspace...')).toBeTruthy();
    expect(screen.queryByTestId('create-progress-bar')).toBeNull();
  });

  it('shows phase label + percent and a width-matched bar once frames arrive', async () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace...' },
    });

    dispatchToSlice(
      workspaceCreateProgressReceived(PID, {
        phase: 'receiving',
        percent: 45,
        message: 'Receiving objects: 45%',
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('create-progress-label').textContent).toContain(
        'Cloning repository…',
      );
    });
    expect(screen.getByTestId('create-progress-label').textContent).toContain('45%');
    const bar = screen.getByTestId('create-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 45%');
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
  });

  it('never moves percent or bar backwards on a lower late frame', async () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace...' },
    });

    dispatchToSlice(workspaceCreateProgressReceived(PID, { phase: 'receiving', percent: 60 }));
    await waitFor(() => {
      expect(screen.getByTestId('create-progress-bar').getAttribute('style')).toContain(
        'width: 60%',
      );
    });

    dispatchToSlice(workspaceCreateProgressReceived(PID, { phase: 'resolving', percent: 50 }));
    await waitFor(() => {
      expect(screen.getByTestId('create-progress-label').textContent).toContain(
        'Resolving deltas…',
      );
    });
    expect(screen.getByTestId('create-progress-label').textContent).toContain('60%');
    const bar = screen.getByTestId('create-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 60%');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
  });
});
