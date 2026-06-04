import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { WorkspaceId } from '$shared/types/branded-ids';
import AgentInitializationStatus from '../AgentInitializationStatus.svelte';
import { activateInitialAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  status: {
    current: { status: 'idle', attempt: 0 } as {
      status: 'idle' | 'activating' | 'active' | 'failed';
      attempt: number;
      error?: string;
      lastErrorKind?: 'timeout' | 'factory' | 'unknown';
    },
  },
}));

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mocks.dispatch,
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: {},
  },
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectInitialAgentActivationStatus: Object.assign(
    vi.fn(() => ({
      subscribe: (run: (value: typeof mocks.status.current) => void) => {
        run(mocks.status.current);
        return () => {};
      },
    })),
    { select: vi.fn(() => mocks.status.current) },
  ),
}));

const retryConfig = {
  id: 'agent-1',
  workspaceId: WorkspaceId('ws-1'),
  name: 'Initial Agent',
  metadata: { isInitialAgent: true },
};

function renderStatus() {
  return render(AgentInitializationStatus, {
    props: {
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      retryConfig,
    },
  });
}

describe('AgentInitializationStatus', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.status.current = { status: 'idle', attempt: 0 };
  });

  it.each(['active', 'activating'] as const)(
    'hides retry CTA when activation status is %s',
    (status) => {
      mocks.status.current = { status, attempt: 1 };

      renderStatus();

      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    },
  );

  it('shows retry CTA when activation status failed', () => {
    mocks.status.current = {
      status: 'failed',
      attempt: 1,
      error: 'Activation timed out',
      lastErrorKind: 'timeout',
    };

    renderStatus();

    expect(screen.getByRole('alert').textContent).toContain('Activation timed out');
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('dispatches the same activation request when retry is clicked', async () => {
    mocks.status.current = { status: 'failed', attempt: 1, error: 'factory failed' };

    renderStatus();
    await fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(mocks.dispatch).toHaveBeenCalledWith(
      activateInitialAgentRequested('ws-1', 'agent-1', retryConfig),
    );
  });
});
