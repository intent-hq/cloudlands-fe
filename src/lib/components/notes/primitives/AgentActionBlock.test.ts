import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentActionBlock from './AgentActionBlock.svelte';

const mocks = vi.hoisted(() => {
  const mutableReadable = <T>(initial: T) => {
    let value = initial;
    const subscribers = new Set<(current: T) => void>();
    return {
      subscribe(run: (current: T) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
      set(next: T) {
        value = next;
        for (const subscriber of subscribers) subscriber(next);
      },
    };
  };
  return {
    dispatch: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    generateAgentId: vi.fn(),
    creationRequest: mutableReadable<
      | { requestId: string; agentId: string | null; loading: boolean; error: string | null }
      | undefined
    >(undefined),
  };
});

vi.mock('svelte-tiptap', async () => ({
  NodeViewWrapper: (await import('./__tests__/NodeViewWrapperMock.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faRobot: { iconName: 'robot' },
  faPlay: { iconName: 'play' },
  faSpinner: { iconName: 'spinner' },
  faArrowUpRightFromSquare: { iconName: 'arrow-up-right' },
  faCheck: { iconName: 'check' },
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./__tests__/AgentAvatarMock.svelte')).default,
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: {
    generateAgentId: mocks.generateAgentId,
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: { select: vi.fn(() => 'test-model') },
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentCreationRequest: Object.assign(() => mocks.creationRequest, {
    select: () => undefined,
  }),
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

function renderBlock(updateAttributes = vi.fn()) {
  return {
    updateAttributes,
    ...render(AgentActionBlock, {
      props: {
        node: {
          attrs: {
            data: {
              id: 'primitive-1',
              goal: 'Run the confirmation task',
              inputs: [],
            },
          },
        },
        updateAttributes,
        extension: { options: { workspaceId: 'ws-1' } },
      } as any,
    }),
  };
}

describe('AgentActionBlock creation confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateAgentId.mockReturnValue('agent-generated');
    mocks.creationRequest.set(undefined);
  });

  it('persists linked/running state only after agent creation is confirmed', async () => {
    const { updateAttributes } = renderBlock();

    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(updateAttributes).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    const action = mocks.dispatch.mock.calls[0][0];
    // The agent name is derived from the primitive goal — the session must
    // stay self-renameable (nameExplicitlySet: false on the wire).
    expect(action.payload[1]).toEqual(
      expect.objectContaining({
        name: 'Run the confirmation task',
        nameExplicitlySet: false,
      }),
    );
    mocks.creationRequest.set({
      requestId: action.payload[2].requestId,
      agentId: 'agent-confirmed',
      loading: false,
      error: null,
    });

    await waitFor(() => expect(updateAttributes).toHaveBeenCalledTimes(1));
    expect(updateAttributes).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdByAgentId: 'agent-confirmed',
        lastRun: expect.objectContaining({ status: 'running' }),
      }),
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Agent action started');
  });

  it('clears running state and records the existing error state on creation failure', async () => {
    const { updateAttributes } = renderBlock();

    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    const action = mocks.dispatch.mock.calls[0][0];
    mocks.creationRequest.set({
      requestId: action.payload[2].requestId,
      agentId: null,
      loading: false,
      error: 'creation failed',
    });

    await waitFor(() => expect(updateAttributes).toHaveBeenCalledTimes(1));
    const updatedData = updateAttributes.mock.calls[0][0].data;
    expect(updatedData.createdByAgentId).toBeUndefined();
    expect(updatedData.lastRun).toEqual(
      expect.objectContaining({
        status: 'error',
        errorMessage: 'creation failed',
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /run/i })).toBeTruthy());
    expect(mocks.toastError).toHaveBeenCalledWith('creation failed');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
