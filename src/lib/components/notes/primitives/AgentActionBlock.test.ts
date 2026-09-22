import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentActionBlock from './AgentActionBlock.svelte';

const { dispatchMock, toastErrorMock, toastSuccessMock, generateAgentIdMock, mocks } = vi.hoisted(
  () => ({
    dispatchMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    generateAgentIdMock: vi.fn(),
    mocks: {
      hidesAgentLifecycleActions: false,
      readable<T>(value: T) {
        return {
          subscribe(run: (value: T) => void) {
            run(value);
            return () => {};
          },
        };
      },
    },
  }),
);

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectHidesAgentLifecycleActions: () => mocks.readable(mocks.hidesAgentLifecycleActions),
}));

vi.mock('svelte-tiptap', async () => ({
  NodeViewWrapper: (await import('./__tests__/NodeViewWrapperMock.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faRobot: { iconName: 'robot' },
  faPlay: { iconName: 'play' },
  faArrowUpRightFromSquare: { iconName: 'arrow-up-right' },
  faCheck: { iconName: 'check' },
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./__tests__/AgentAvatarMock.svelte')).default,
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: {
    error: toastErrorMock,
    success: toastSuccessMock,
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
    generateAgentId: generateAgentIdMock,
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: { select: vi.fn(() => 'test-model') },
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

function renderBlock(updateAttributes = vi.fn(), data: Record<string, unknown> = {}) {
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
              ...data,
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
    mocks.hidesAgentLifecycleActions = false;
    generateAgentIdMock.mockReturnValue('agent-generated');
  });

  it('hides the run action when agent lifecycle actions are withheld', () => {
    mocks.hidesAgentLifecycleActions = true;
    renderBlock();

    expect(screen.queryByRole('button', { name: /run/i })).toBeNull();
    expect(screen.getByText('Run the confirmation task')).toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('keeps the open-agent action for an already-linked agent when lifecycle actions are withheld', async () => {
    mocks.hidesAgentLifecycleActions = true;
    renderBlock(vi.fn(), { createdByAgentId: 'agent-linked' });

    expect(screen.queryByRole('button', { name: /^run$/i })).toBeNull();
    await fireEvent.click(screen.getByTitle('View agent'));
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'appLayout/openAgentTabRequested',
        payload: expect.arrayContaining([
          'ws-1',
          expect.objectContaining({ agentId: 'agent-linked' }),
        ]),
      }),
    );
    expect(dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/createAgentFromConfigRequested' }),
    );
  });

  it('persists linked/running state only after agent creation is confirmed', async () => {
    const { updateAttributes } = renderBlock();

    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(updateAttributes).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: /running/i })
        .querySelector('[data-slot="intent-mark-loader"]'),
    ).not.toBeNull();

    const action = dispatchMock.mock.calls[0][0];
    // The agent name is derived from the primitive goal — the session must
    // stay self-renameable (nameExplicitlySet: false on the wire).
    expect(action.payload[1]).toEqual(
      expect.objectContaining({
        name: 'Run the confirmation task',
        nameExplicitlySet: false,
      }),
    );
    action.success({ id: 'agent-confirmed', name: 'Confirmed Agent' });

    await waitFor(() => expect(updateAttributes).toHaveBeenCalledTimes(1));
    expect(updateAttributes).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdByAgentId: 'agent-confirmed',
        lastRun: expect.objectContaining({ status: 'running' }),
      }),
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Agent action started');
  });

  it('clears running state and records the existing error state on creation failure', async () => {
    const { updateAttributes } = renderBlock();

    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    const action = dispatchMock.mock.calls[0][0];
    action.failure('creation failed');

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
    expect(toastErrorMock).toHaveBeenCalledWith('creation failed');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
