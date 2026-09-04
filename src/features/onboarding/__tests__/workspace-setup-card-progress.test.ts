/**
 * @vitest-environment jsdom
 *
 * WorkspaceSetupCard live clone progress: with a `progressId` and daemon
 * frames (workspaceCreateProgress slice, PROTOCOL §5.1/§6.5) the repo step
 * shows the stage label + monotonic percent + determinate ARIA bar; without a
 * progressId (ChatPanel usage, older daemons) or before the first frame
 * (sawFrame false) the card renders the static text exactly as before.
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

const PID = '22222222-2222-4222-8222-222222222222';

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

vi.mock('$features/external-editors/components/OpenComboButton.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('svelte-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import WorkspaceSetupCard from '../messages/WorkspaceSetupCard.svelte';

function setSliceState(state: WorkspaceCreateProgressState) {
  mockStore.sliceState = state;
}

function dispatchToSlice(action: Parameters<typeof workspaceCreateProgressReducer>[1]) {
  setSliceState(
    workspaceCreateProgressReducer(mockStore.sliceState as WorkspaceCreateProgressState, action),
  );
  mockStore.emitState();
}

function renderCard(progressId?: string) {
  return render(WorkspaceSetupCard, {
    props: {
      repoName: 'my-repo',
      repoStatus: 'active' as const,
      branchStatus: 'active' as const,
      agentStatus: 'pending' as const,
      progressId,
    },
  });
}

describe('WorkspaceSetupCard live clone progress', () => {
  beforeEach(() => {
    setSliceState(workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID)));
  });

  it('renders the static repo step (no label/bar) without a progressId', () => {
    const result = renderCard(undefined);
    expect(result.container.textContent).toContain('Creating an isolated copy of');
    expect(screen.queryByTestId('setup-card-progress-label')).toBeNull();
    expect(screen.queryByTestId('setup-card-progress-bar')).toBeNull();
  });

  it('renders the static repo step until the first frame arrives (sawFrame false)', () => {
    const result = renderCard(PID);
    expect(result.container.textContent).toContain('Creating an isolated copy of');
    expect(screen.queryByTestId('setup-card-progress-bar')).toBeNull();
  });

  it('shows stage label + percent and an ARIA bar once frames arrive', async () => {
    const result = renderCard(PID);

    dispatchToSlice(
      workspaceCreateProgressReceived(PID, {
        phase: 'receiving',
        percent: 45,
        message: 'Receiving objects: 45%',
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('setup-card-progress-label').textContent).toContain(
        'Cloning repository…',
      );
    });
    expect(screen.getByTestId('setup-card-progress-label').textContent).toContain('45%');
    const bar = screen.getByTestId('setup-card-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 45%');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    // The live line replaces the static text on the repo step.
    expect(result.container.textContent).not.toContain('Creating an isolated copy of');
  });

  it('never moves percent or bar backwards on a lower late frame', async () => {
    renderCard(PID);

    dispatchToSlice(workspaceCreateProgressReceived(PID, { phase: 'receiving', percent: 60 }));
    await waitFor(() => {
      expect(screen.getByTestId('setup-card-progress-bar').getAttribute('style')).toContain(
        'width: 60%',
      );
    });

    dispatchToSlice(workspaceCreateProgressReceived(PID, { phase: 'resolving', percent: 50 }));
    await waitFor(() => {
      expect(screen.getByTestId('setup-card-progress-label').textContent).toContain(
        'Resolving deltas…',
      );
    });
    expect(screen.getByTestId('setup-card-progress-label').textContent).toContain('60%');
    const bar = screen.getByTestId('setup-card-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 60%');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
  });

  it('clamps an out-of-range daemon percent so text, bar, and ARIA agree at 100', async () => {
    renderCard(PID);

    dispatchToSlice(workspaceCreateProgressReceived(PID, { phase: 'receiving', percent: 150 }));
    await waitFor(() => {
      expect(screen.getByTestId('setup-card-progress-label').textContent).toContain('100%');
    });
    const bar = screen.getByTestId('setup-card-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 100%');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });
});
