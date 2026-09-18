/**
 * @vitest-environment jsdom
 *
 * CreateButtonProgress: live daemon-driven stage label + 2px bottom bar on
 * the Create button. Before any frame arrives (sawFrame false) the fallback
 * label renders and no bar exists; frames flip it to phase label + percent +
 * determinate bar; percent/bar are monotonic (a lower late frame never moves
 * them backwards). Rendered through a harness that mounts the real Button via
 * `children`, so the bar's placement relative to the Button's internal slots
 * (a sibling overlay, never inside the label slot) is observable.
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
import CreateButtonProgress from './mocks/CreateButtonProgressHarness.svelte';

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
    workspaceCreateProgressReducer(mockStore.sliceState as WorkspaceCreateProgressState, action),
  );
  mockStore.emitState();
}

describe('CreateButtonProgress', () => {
  beforeEach(() => {
    setSliceState(workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID)));
  });

  it('renders the fallback label (and no bar) until the first frame arrives', () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace…' },
    });
    expect(screen.getByText('Preparing workspace…')).toBeTruthy();
    expect(screen.queryByTestId('create-progress-bar')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders the label inside the button and the bar as a sibling of it, outside the label slot', async () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace…' },
    });

    dispatchToSlice(workspaceCreateProgressReceived(PID, { phase: 'receiving', percent: 30 }));
    const bar = await screen.findByTestId('create-progress-bar');
    const label = screen.getByTestId('create-progress-label');
    const button = screen.getByRole('button');
    const labelSlot = button.querySelector('[data-slot="button-label"]');

    expect(labelSlot).not.toBeNull();
    expect(labelSlot!.contains(label)).toBe(true);
    expect(button.contains(bar)).toBe(false);
    expect(labelSlot!.contains(bar)).toBe(false);
    // Same wrapper hosts both: the bar's overlay layer sits beside the button, and
    // the box enclosing that layer also encloses the button.
    const overlay = bar.parentElement!;
    expect(overlay.contains(button)).toBe(false);
    expect(overlay.parentElement!.contains(button)).toBe(true);
  });

  it('shows phase label + percent and a width-matched bar once frames arrive', async () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace…' },
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
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('data-testid')).toBe('create-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 45%');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    expect(bar.getAttribute('aria-label')).toBe('Cloning repository…');
  });

  it('never moves percent or bar backwards on a lower late frame', async () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace…' },
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

  it('clamps an out-of-range daemon percent so text, bar, and ARIA agree at 100', async () => {
    render(CreateButtonProgress, {
      props: { progressId: PID, fallbackLabel: 'Preparing workspace…' },
    });

    dispatchToSlice(workspaceCreateProgressReceived(PID, { phase: 'receiving', percent: 150 }));
    await waitFor(() => {
      expect(screen.getByTestId('create-progress-label').textContent).toContain('100%');
    });
    const bar = screen.getByTestId('create-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 100%');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });
});
