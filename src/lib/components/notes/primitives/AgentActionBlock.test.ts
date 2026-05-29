import {
  describe,
  expect,
  it,
  beforeEach,
  vi,
} from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import AgentActionBlock from './AgentActionBlock.svelte';

const {
  dispatchMock,
  toastErrorMock,
  toastSuccessMock,
  generateAgentIdMock,
} = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  generateAgentIdMock: vi.fn(),
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
  faSpinner: { iconName: 'spinner' },
  faArrowUpRightFromSquare: { iconName: 'arrow-up-right' },
  faCheck: { iconName: 'check' },
}));

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./__tests__/AuggieAvatarMock.svelte')).default,
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: {
    generateAgentId: generateAgentIdMock,
  },
}));

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: { select: vi.fn(() => 'test-model') },
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
    generateAgentIdMock.mockReturnValue('agent-generated');
  });

  it('persists linked/running state only after agent creation is confirmed', async () => {
    const { updateAttributes } = renderBlock();

    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(updateAttributes).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();

    const action = dispatchMock.mock.calls[0][0];
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
    expect(updatedData.lastRun).toEqual(expect.objectContaining({
      status: 'error',
      errorMessage: 'creation failed',
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: /run/i })).toBeTruthy());
    expect(toastErrorMock).toHaveBeenCalledWith('creation failed');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});