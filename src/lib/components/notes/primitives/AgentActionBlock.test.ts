import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentActionBlock from './AgentActionBlock.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  agentCreationFinished,
  workspaceAgentsReducer,
  initialState,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

const { dispatchMock, toastErrorMock, toastSuccessMock, generateAgentIdMock, mocks } = vi.hoisted(
  () => ({
    dispatchMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    generateAgentIdMock: vi.fn(),
    mocks: {
      workspaceAgents: {} as any,
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

vi.mock('@fortawesome/free-solid-svg-icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fortawesome/free-solid-svg-icons')>()),
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

vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: {
    generateAgentId: generateAgentIdMock,
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({
      workspaceAgents: mocks.workspaceAgents,
      model: { defaultProviderId: 'direct', providerModels: { direct: 'direct-model' } },
      providerCatalog: {
        byWorkspaceId: {
          'ws-1': {
            catalog: { providers: [] },
            settings: [
              { path: 'model.defaultProvider', value: 'workspace-provider' },
              {
                path: 'model.providerDefaults',
                value: { 'workspace-provider': 'workspace-model' },
              },
            ],
            readiness: {},
            specialists: [],
          },
        },
      },
    }),
    dispatch: dispatchMock,
  });
});

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
    mocks.workspaceAgents = initialState;
    dispatchMock.mockImplementation((action) => {
      mocks.workspaceAgents = workspaceAgentsReducer(mocks.workspaceAgents, action);
      (appStore as any).emitState();
    });
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
        workspaceId: 'ws-1',
        provider: 'workspace-provider',
        model: 'workspace-model',
      }),
    );
    action.success({ id: 'agent-confirmed', name: 'Confirmed Agent' });
    await Promise.resolve();
    expect(updateAttributes).not.toHaveBeenCalled();
    appStore.dispatch(
      agentCreationFinished({
        ...action.payload[2].consumer,
        workspaceId: 'ws-1',
        seq: action.seq,
        status: 'success',
        agentId: 'agent-confirmed',
        completedAt: '2026-09-30T00:00:00.000Z',
      }),
    );

    await waitFor(() => expect(updateAttributes).toHaveBeenCalledTimes(1));
    expect(updateAttributes).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdByAgentId: 'agent-confirmed',
        lastRun: expect.objectContaining({ status: 'running' }),
      }),
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('clears running state and records the existing error state on creation failure', async () => {
    const { updateAttributes } = renderBlock();

    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    const action = dispatchMock.mock.calls[0][0];
    action.failure('creation failed');
    appStore.dispatch(
      agentCreationFinished({
        ...action.payload[2].consumer,
        workspaceId: 'ws-1',
        seq: action.seq,
        status: 'failure',
        error: 'creation failed',
        completedAt: '2026-09-30T00:00:00.000Z',
      }),
    );

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
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('ignores a completion for a previous primitive after the node view is reused', async () => {
    const { updateAttributes, rerender } = renderBlock();
    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    const first = dispatchMock.mock.calls[0][0];
    await rerender({
      node: { attrs: { data: { id: 'primitive-2', goal: 'A different task', inputs: [] } } },
    } as any);
    appStore.dispatch(
      agentCreationFinished({
        ...first.payload[2].consumer,
        workspaceId: 'ws-1',
        seq: first.seq,
        status: 'success',
        agentId: 'old-agent',
        completedAt: '2026-09-30T00:00:00.000Z',
      }),
    );
    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(updateAttributes).not.toHaveBeenCalled();
    const second = dispatchMock.mock.calls.find(
      ([action]) =>
        action.type === 'workspaceAgents/createAgentFromConfigRequested' && action !== first,
    )?.[0];
    expect(second.payload[2].consumer.resourceId).toBe('primitive-2');
    expect(second.seq).not.toBe(first.seq);
  });

  it('releases its consumer on unmount so a late result cannot update the document', async () => {
    const { updateAttributes, unmount } = renderBlock();
    await fireEvent.click(screen.getByRole('button', { name: /run/i }));
    const action = dispatchMock.mock.calls[0][0];
    unmount();
    appStore.dispatch(
      agentCreationFinished({
        ...action.payload[2].consumer,
        workspaceId: 'ws-1',
        seq: action.seq,
        status: 'success',
        agentId: 'late-agent',
        completedAt: '2026-09-30T00:00:00.000Z',
      }),
    );
    expect(updateAttributes).not.toHaveBeenCalled();
    expect(mocks.workspaceAgents.creationOutcomes.ids).toEqual([]);
  });
});
