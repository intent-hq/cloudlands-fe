import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { runSaga } from 'redux-saga';
import {
  AgentStatus,
  type AgentMessage,
  type AgentSession,
} from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { sendMessage as sendAgentMessage } from '$features/agent/agent-stream-lifecycle';
import {
  emptyChatAgentState,
  chatInterrupted,
  chatErrorCleared,
  chatModelUnavailableCleared,
  chatSendFailed,
  chatSendStarted,
  chatStateReducer,
} from '../../chat-state/chat-state-slice';

import {
  activateAgentRequested,
  createAgentFromConfigRequested,
  forkAgentRequested,
  saveAgentSessionRequested,
} from '../../workspace-agents/workspace-agents-slice';
import { initialState as modelInitialState } from '../../model/model-slice';
import { initialState as providerSettingsInitialState } from '../../provider-settings/provider-settings-slice';
import {
  agentSessionEditAndRegenerateRequested,
  agentSessionForkSessionRequested,
  agentSessionLaunchAgentRequested,
  agentSessionRegenerateFromMessageRequested,
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionSendMessageRequested,
  agentSessionStopChatRequested,
  agentSessionReducer,
  bulkUpsertSessions,
  initialState,
  replaceMessages,
  updateMessage,
  upsertSession,
} from '../agent-session-slice';
import {
  initialState as workspaceInitialState,
  replaceWorkspaceList,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  handleAgentSessionEditAndRegenerateRequested,
  handleAgentSessionForkSessionRequested,
  handleAgentSessionLaunchAgentRequested,
  handleAgentSessionRegenerateFromMessageRequested,
  handleAgentSessionRetryLastMessageRequested,
  handleAgentSessionRetryWithModelRequested,
  handleAgentSessionSendMessageRequested,
  resolveSendWorkspace,
} from './agent-chat-effects-saga';
import {
  selectAgentActivationWaitComplete,
  selectAgentIsResponding,
} from '../agent-session-selectors';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock('$features/agent/agent-stream-lifecycle', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => loggerMock,
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: toastErrorMock },
}));

vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: { generateAgentId: vi.fn(() => 'agent-forked') },
}));

const AGENT = 'agent-flow';
const WS = 'ws-flow';

const workspace = {
  id: WS,
  name: 'Flow Workspace',
  path: '/tmp/flow',
  worktreePath: '/tmp/flow',
  repositoryPath: '/tmp/flow',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastAccessedAt: new Date(),
} as any;

function message(id: string, role: 'user' | 'assistant', contentBlocks: AgentMessage['contentBlocks']): AgentMessage {
  return { id, role, timestamp: '2024-01-01T00:00:00.000Z', contentBlocks } as AgentMessage;
}

function textMessage(id: string, role: 'user' | 'assistant', text: string): AgentMessage {
  return message(id, role, [{ type: 'text', text }]);
}

function makeState(
  messages: AgentMessage[],
  chatOverride: Record<string, unknown> = {},
  sessionOverride: Partial<AgentSession> = {},
) {
  const session = {
    id: AGENT,
    name: 'Source Agent',
    workspaceId: WS,
    backendSessionId: 'backend-flow',
    model: 'source-model',
    status: AgentStatus.Idle,
    isStreaming: false,
    isProcessing: false,
    messages,
    ...sessionOverride,
  } as AgentSession;
  return {
    agentSessions: agentSessionReducer(
      initialState,
      bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }),
    ),
    workspace: workspaceReducer(workspaceInitialState, replaceWorkspaceList([workspace])),
    chatState: {
      byAgentId: {
        [AGENT]: { ...emptyChatAgentState, agentId: AGENT, ...chatOverride },
      },
    },
    model: {
      ...modelInitialState,
      workspaceModels: { [WS]: 'workspace-model' },
    },
    providerSettings: {
      ...providerSettingsInitialState,
      activeProviderId: 'active-provider',
    },
    "@internal_storeUtility": { updatesLocked: false },
  } as any;
}

type RunHandlerOptions = {
  activationDelayMs?: number;
  resolveActivationPromise?: boolean;
  onActivationRequested?: () => void;
  onActivationStateApplied?: (state: any) => void;
  activatedSession?: (wsId: string, agentId: string) => AgentSession;
};

async function runHandler(handler: any, action: any, state: any, options: RunHandlerOptions = {}) {
  const dispatched: any[] = [];
  const subscribers = new Set<(state: any) => void>();
  const notify = () => subscribers.forEach((subscriber) => subscriber(state));
  const reduxStore = {
    getState: () => state,
    dispatch: (dispatchedAction: any) => dispatch(dispatchedAction),
    subscribe: (subscriber: (state: any) => void) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
  const reduce = (dispatchedAction: any, afterReduce?: (state: any) => void) => {
    state = {
      ...state,
      agentSessions: agentSessionReducer(state.agentSessions, dispatchedAction),
      chatState: chatStateReducer(state.chatState, dispatchedAction),
    };
    afterReduce?.(state);
    notify();
  };
  const dispatch = (dispatchedAction: any) => {
    dispatched.push(dispatchedAction);
    reduce(dispatchedAction);
    if (dispatchedAction.type === agentSessionSendMessageRequested.type) {
      dispatchedAction.success(undefined);
      const [agentId, wsId] = dispatchedAction.payload;
      if (!selectAgentIsResponding.select(state, agentId)) {
        Promise.resolve().then(() => dispatch(chatSendStarted(agentId, wsId)));
      }
    }
    if (dispatchedAction.type === agentSessionStopChatRequested.type) {
      dispatchedAction.success(undefined);
    }
    if (dispatchedAction.type === createAgentFromConfigRequested.type) {
      dispatchedAction.success({
        id: dispatchedAction.payload[1].id,
        name: dispatchedAction.payload[1].name,
        workspaceId: dispatchedAction.payload[0],
        model: dispatchedAction.payload[1].model,
        messages: [],
      } as AgentSession);
    }
    if (dispatchedAction.type === activateAgentRequested.type) {
      const [wsId, agentId] = dispatchedAction.payload;
      options.onActivationRequested?.();
      const applyActivationState = () => {
        const activatedSession = options.activatedSession?.(wsId, agentId) ?? ({
          id: agentId,
          name: 'Activated Agent',
          workspaceId: wsId,
          backendSessionId: 'backend-activated',
          activationState: AgentActivationState.ACTIVE,
          status: AgentStatus.Active,
          isStreaming: false,
          isProcessing: false,
          messages: [],
        } as AgentSession);
        reduce(
          bulkUpsertSessions([activatedSession], { preserveExplicitRuntimeFlags: false }),
          options.onActivationStateApplied,
        );
        if (options.resolveActivationPromise !== false) {
          dispatchedAction.success(activatedSession);
        }
      };
      if (options.activationDelayMs !== undefined) {
        setTimeout(applyActivationState, options.activationDelayMs);
      } else {
        applyActivationState();
      }
    }
  };
  await runSaga(
    {
      getState: () => state,
      dispatch,
      context: {
        reduxStore,
        readableStoreState: {
          subscribe: (subscriber: (state: any) => void) => {
            subscribers.add(subscriber);
            subscriber(state);
            return () => subscribers.delete(subscriber);
          },
        },
      },
    },
    handler,
    action,
  ).toPromise();
  return dispatched;
}

function first(dispatched: any[], type: string) {
  return dispatched.find((action) => action.type === type);
}

describe('agent-chat-effects saga migrated flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendAgentMessage).mockResolvedValue(undefined);
    if (typeof window !== 'undefined') {
      window.addEventListener = vi.fn();
    }
  });

  it('sends messages through the backend without registering stream DOM listeners', async () => {
    const action = agentSessionSendMessageRequested(AGENT, WS, 'hello');
    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'First request')]),
    );

    expect(sendAgentMessage).toHaveBeenCalledWith(
      AGENT,
      'hello',
      workspace,
      expect.objectContaining({ resetHistory: undefined }),
    );
    expect(dispatched.map((item) => item.type)).toContain(action.success.type);
    if (typeof window !== 'undefined') {
      expect(window.addEventListener).not.toHaveBeenCalled();
    }
  });

  it('activates pending agents, waits for session activation state, and sends with the known agent id', async () => {
    const events: string[] = [];
    let selectorCompleteAfterActivation = false;
    vi.mocked(sendAgentMessage).mockImplementationOnce(async () => {
      events.push('send');
    });
    const action = agentSessionSendMessageRequested(AGENT, WS, 'hello after activation');
    const pendingState = makeState([], {}, {
      backendSessionId: undefined,
      activationState: AgentActivationState.PENDING,
      status: AgentStatus.Pending,
    });
    expect(selectAgentActivationWaitComplete.select(pendingState, AGENT)).toBe(false);
    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      pendingState,
      {
        activationDelayMs: 0,
        resolveActivationPromise: false,
        onActivationRequested: () => events.push('activation-requested'),
        onActivationStateApplied: (state) => {
          selectorCompleteAfterActivation = selectAgentActivationWaitComplete.select(state, AGENT);
          events.push('activation-state');
        },
      },
    );

    const activationAction = first(dispatched, activateAgentRequested.type);
    let activationPromiseSettled = false;
    activationAction.promise.then(
      () => { activationPromiseSettled = true; },
      () => { activationPromiseSettled = true; },
    );

    expect(activationAction.payload).toEqual([WS, AGENT]);
    expect(dispatched.some((item) => item.type === upsertSession.type)).toBe(false);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      AGENT,
      'hello after activation',
      workspace,
      expect.objectContaining({ resetHistory: undefined }),
    );
    expect(events).toEqual(['activation-requested', 'activation-state', 'send']);
    expect(selectorCompleteAfterActivation).toBe(true);
    await Promise.resolve();
    expect(activationPromiseSettled).toBe(false);
    expect(dispatched.map((item) => item.type)).toContain(action.success.type);
  });

  it('routes activation error state through the send failure path', async () => {
    const action = agentSessionSendMessageRequested(AGENT, WS, 'hello after activation failure');
    const rejection = action.promise.catch((error) => error);
    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([], {}, {
        backendSessionId: undefined,
        activationState: AgentActivationState.PENDING,
        status: AgentStatus.Pending,
      }),
      {
        activatedSession: (wsId, agentId) => ({
          id: agentId,
          name: 'Activation Failed Agent',
          workspaceId: wsId,
          backendSessionId: undefined,
          activationState: AgentActivationState.ERROR,
          lastActivationError: 'Activation failed cleanly',
          status: AgentStatus.Pending,
          isStreaming: false,
          isProcessing: false,
          messages: [],
        } as AgentSession),
      },
    );
    await vi.dynamicImportSettled();

    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(first(dispatched, chatSendFailed.type).payload).toEqual([AGENT, 'Activation failed cleanly']);
    expect(dispatched.map((item) => item.type)).toContain(action.failure.type);
    expect(toastErrorMock).toHaveBeenCalledWith('Activation failed cleanly');
    expect(await rejection).toBe('Activation failed cleanly');
  });

  it('does not suppress a retry after a failed backend send', async () => {
    vi.mocked(sendAgentMessage)
      .mockRejectedValueOnce(new Error('Activation failed'))
      .mockResolvedValueOnce(undefined);
    const failedAction = agentSessionSendMessageRequested(AGENT, WS, 'retry me');
    failedAction.promise.catch(() => undefined);

    await runHandler(
      handleAgentSessionSendMessageRequested,
      failedAction,
      makeState([textMessage('u1', 'user', 'Hello')]),
    );
    await runHandler(
      handleAgentSessionSendMessageRequested,
      agentSessionSendMessageRequested(AGENT, WS, 'retry me'),
      makeState([textMessage('u1', 'user', 'Hello')]),
    );
    await vi.dynamicImportSettled();

    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
  });

  it('does not rate-limit rapid distinct sends inside the core send effect', async () => {
    await Promise.all([
      runHandler(
        handleAgentSessionSendMessageRequested,
        agentSessionSendMessageRequested(AGENT, WS, 'rapid fire 1'),
        makeState([textMessage('u1', 'user', 'Hello')]),
      ),
      runHandler(
        handleAgentSessionSendMessageRequested,
        agentSessionSendMessageRequested(AGENT, WS, 'rapid fire 2'),
        makeState([textMessage('u1', 'user', 'Hello')]),
      ),
    ]);

    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
  });

  it('handles backend send failures in the core send handler', async () => {
    vi.mocked(sendAgentMessage).mockRejectedValueOnce(new Error('Network failure'));
    const action = agentSessionSendMessageRequested(AGENT, WS, 'send fails');
    const rejection = action.promise.catch((error) => error);

    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'Hello')]),
    );
    await vi.dynamicImportSettled();

    expect(first(dispatched, chatSendFailed.type).payload).toEqual([AGENT, 'Network failure']);
    expect(dispatched.map((item) => item.type)).toContain(action.failure.type);
    expect(toastErrorMock).toHaveBeenCalledWith('Network failure');
    expect(await rejection).toBe('Network failure');
  });

  it('forwards userAppMessageId to the stream lifecycle send so the canonical message merges with the optimistic one', async () => {
    const action = agentSessionSendMessageRequested(AGENT, WS, 'hello', {
      userAppMessageId: 'app_msg_optimistic-test',
      optimisticMessageId: 'optimistic_test-1',
    });
    await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'First request')]),
    );

    expect(sendAgentMessage).toHaveBeenCalledWith(
      AGENT,
      'hello',
      workspace,
      expect.objectContaining({ userAppMessageId: 'app_msg_optimistic-test' }),
    );
  });

  it('marks the optimistic user message with an error on send failure instead of removing it', async () => {
    vi.mocked(sendAgentMessage).mockRejectedValueOnce(new Error('Network failure'));
    const optimisticMessage = {
      ...textMessage('optimistic_test-1', 'user', 'send fails'),
      appMessageId: 'app_msg_optimistic-test',
    };
    const action = agentSessionSendMessageRequested(AGENT, WS, 'send fails', {
      userAppMessageId: 'app_msg_optimistic-test',
      optimisticMessageId: 'optimistic_test-1',
    });
    action.promise.catch(() => undefined);

    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([optimisticMessage]),
    );
    await vi.dynamicImportSettled();

    const updateAction = first(dispatched, updateMessage.type);
    expect(updateAction).toBeDefined();
    expect(updateAction.payload).toEqual([
      AGENT,
      'optimistic_test-1',
      { error: 'Network failure' },
    ]);
  });

  it('logs the underlying error object so message and stack are not swallowed', async () => {
    const sendError = new Error('Backend exploded');
    vi.mocked(sendAgentMessage).mockRejectedValueOnce(sendError);
    const action = agentSessionSendMessageRequested(AGENT, WS, 'boom');
    action.promise.catch(() => undefined);

    await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'Hello')]),
    );
    await vi.dynamicImportSettled();

    expect(loggerMock.error).toHaveBeenCalledWith('Failed to send message', sendError, {
      agentId: AGENT,
    });
  });

  it('clears send state without a toast when the message guard blocks a send', async () => {
    const guardError = new Error('Duplicate message detected');
    guardError.name = 'MessageGuardError';
    vi.mocked(sendAgentMessage).mockRejectedValueOnce(guardError);
    const action = agentSessionSendMessageRequested(AGENT, WS, 'duplicate');
    const rejection = action.promise.catch((error) => error);

    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'Hello')]),
    );
    await vi.dynamicImportSettled();

    expect(first(dispatched, chatSendFailed.type).payload).toEqual([AGENT, '']);
    expect(dispatched.map((item) => item.type)).toContain(action.failure.type);
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(await rejection).toBe('Duplicate message detected');
  });

  it('routes interruption failures through chatInterrupted without send failed state', async () => {
    vi.mocked(sendAgentMessage).mockRejectedValueOnce(new Error('Agent interrupted'));
    const action = agentSessionSendMessageRequested(AGENT, WS, 'interrupt');
    const rejection = action.promise.catch((error) => error);

    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'Hello')]),
    );
    await vi.dynamicImportSettled();

    expect(first(dispatched, chatInterrupted.type).payload).toEqual([AGENT]);
    expect(first(dispatched, chatSendFailed.type)).toBeUndefined();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(await rejection).toBe('Agent interrupted');
  });

  it('handles validation failures before backend send', async () => {
    const action = agentSessionSendMessageRequested(AGENT, WS, '   ');
    const rejection = action.promise.catch((error) => error);

    const dispatched = await runHandler(
      handleAgentSessionSendMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'Hello')]),
    );
    await vi.dynamicImportSettled();

    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(first(dispatched, chatSendFailed.type).payload).toEqual([AGENT, 'Message cannot be empty']);
    expect(toastErrorMock).toHaveBeenCalledWith('Message cannot be empty');
    expect(await rejection).toBe('Message cannot be empty');
  });

  it('launches agents through the lower-level creation request and resolves with the created session', async () => {
    const action = agentSessionLaunchAgentRequested(WS, {
      name: 'Launch Agent',
      source: 'unit-test',
    }, { openAgent: true });
    const dispatched = await runHandler(
      handleAgentSessionLaunchAgentRequested,
      action,
      makeState([]),
    );
    const createAction = first(dispatched, createAgentFromConfigRequested.type);
    const createdSession = await action.promise;

    expect(createAction.payload).toEqual([
      WS,
      expect.objectContaining({
        id: 'agent-forked',
        name: 'Launch Agent',
        workspaceId: WorkspaceId(WS),
        model: 'workspace-model',
        provider: 'active-provider',
        source: 'unit-test',
      }),
      { openAgent: true },
    ]);
    expect(createdSession).toMatchObject({ id: 'agent-forked', model: 'workspace-model' });
    expect(dispatched.map((item) => item.type)).toContain(action.success.type);
  });

  it('propagates lower-level launch failures without resolving success', async () => {
    const action = agentSessionLaunchAgentRequested(WS, { name: 'Launch Agent' });
    const rejection = expect(action.promise).rejects.toBe('creation failed');
    const dispatched: any[] = [];
    await runSaga(
      {
        getState: () => makeState([]),
        dispatch: (dispatchedAction: any) => {
          dispatched.push(dispatchedAction);
          if (dispatchedAction.type === createAgentFromConfigRequested.type) {
            dispatchedAction.failure('creation failed');
          }
        },
      },
      handleAgentSessionLaunchAgentRequested,
      action,
    ).toPromise();

    expect(dispatched.map((item) => item.type)).toContain(action.failure.type);
    expect(dispatched.map((item) => item.type)).not.toContain(action.success.type);
    expect(loggerMock.error).not.toHaveBeenCalled();
    await rejection;
  });

  it('logs task-breakdown launch failures from the saga failure path', async () => {
    const action = agentSessionLaunchAgentRequested(WS, {
      name: 'Break down: Ship feature',
      agentType: 'task-breakdown',
      source: 'task-menu',
      metadata: { agentType: 'task-breakdown' },
    });
    const rejection = expect(action.promise).rejects.toBe('creation failed');
    const dispatched: any[] = [];
    await runSaga(
      {
        getState: () => makeState([]),
        dispatch: (dispatchedAction: any) => {
          dispatched.push(dispatchedAction);
          if (dispatchedAction.type === createAgentFromConfigRequested.type) {
            dispatchedAction.failure('creation failed');
          }
        },
      },
      handleAgentSessionLaunchAgentRequested,
      action,
    ).toPromise();

    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to launch task-breakdown agent:',
      'creation failed',
    );
    expect(dispatched.map((item) => item.type)).toContain(action.failure.type);
    expect(dispatched.map((item) => item.type)).not.toContain(action.success.type);
    await rejection;
  });

  it('truncates, persists, and resends edited user messages', async () => {
    const messages = [
      textMessage('u1', 'user', 'First'),
      textMessage('a1', 'assistant', 'Answer'),
      textMessage('u2', 'user', 'Original'),
      textMessage('a2', 'assistant', 'Old answer'),
    ];
    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, 'u2', 'Edited', { model: 'm' });
    const dispatched = await runHandler(handleAgentSessionEditAndRegenerateRequested, action, makeState(messages));
    const types = dispatched.map((item) => item.type);
    const addMessageAction = first(dispatched, 'agentSessions/addMessage');
    const sendPayload = first(dispatched, agentSessionSendMessageRequested.type).payload;

    expect(types.indexOf(chatSendStarted.type)).toBeLessThan(types.indexOf(replaceMessages.type));
    expect(first(dispatched, replaceMessages.type).payload).toEqual([AGENT, messages.slice(0, 2)]);
    expect(types.indexOf(replaceMessages.type)).toBeLessThan(types.indexOf('agentSessions/addMessage'));
    expect(first(dispatched, saveAgentSessionRequested.type).payload).toEqual([
      WS,
      AGENT,
      false,
      { allowTruncation: true },
    ]);
    expect(addMessageAction.payload[0]).toBe(AGENT);
    expect(addMessageAction.payload[1]).toMatchObject({
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Edited' }],
    });
    expect(sendPayload[0]).toBe(AGENT);
    expect(sendPayload[1]).toBe(WS);
    expect(sendPayload[2]).toBe('Edited');
    expect(sendPayload[3]).toMatchObject({ model: 'm', resetHistory: true });
    expect(sendPayload[3].userAppMessageId).toBe(addMessageAction.payload[1].appMessageId);
    expect(sendPayload[3].optimisticMessageId).toBe(addMessageAction.payload[1].id);
  });

  it('preserves media blocks when regenerating from an assistant message', async () => {
    const originalUser = message('u2', 'user', [
      { type: 'text', text: 'Regenerate this' },
      { type: 'image', data: 'img-data', mimeType: 'image/png' } as any,
      { type: 'file', data: 'file-data', mimeType: 'text/plain', fileName: 'note.txt' } as any,
    ]);
    const messages = [textMessage('u1', 'user', 'First'), textMessage('a1', 'assistant', 'Answer'), originalUser, textMessage('a2', 'assistant', 'Old answer')];
    const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a2');
    const dispatched = await runHandler(handleAgentSessionRegenerateFromMessageRequested, action, makeState(messages));
    const sendPayload = first(dispatched, agentSessionSendMessageRequested.type).payload;
    const addMessageAction = first(dispatched, 'agentSessions/addMessage');

    expect(first(dispatched, replaceMessages.type).payload).toEqual([AGENT, messages.slice(0, 2)]);
    expect(addMessageAction.payload[0]).toBe(AGENT);
    expect(addMessageAction.payload[1]).toMatchObject({
      role: 'user',
      contentBlocks: originalUser.contentBlocks,
    });
    expect(sendPayload[2]).toBe('Regenerate this');
    expect(sendPayload[3]).toMatchObject({
      resetHistory: true,
      contextItems: [
        { imageData: 'img-data', imageMimeType: 'image/png' },
        { fileData: 'file-data', fileMimeType: 'text/plain', label: 'note.txt' },
      ],
    });
    expect(sendPayload[3].userAppMessageId).toBe(addMessageAction.payload[1].appMessageId);
    expect(sendPayload[3].optimisticMessageId).toBe(addMessageAction.payload[1].id);
  });

  it('retries from conversation history with truncation, cleanup, and media preservation', async () => {
    const retryUser = message('u2', 'user', [
      { type: 'text', text: 'Retry this' },
      { type: 'image', data: 'img-data', mimeType: 'image/png' } as any,
    ]);
    const messages = [textMessage('u1', 'user', 'First'), textMessage('a1', 'assistant', 'Answer'), retryUser, textMessage('a2', 'assistant', 'Failed')];
    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    const dispatched = await runHandler(handleAgentSessionRetryLastMessageRequested, action, makeState(messages));
    const sendPayload = first(dispatched, agentSessionSendMessageRequested.type).payload;
    const addMessageAction = first(dispatched, 'agentSessions/addMessage');

    expect(first(dispatched, replaceMessages.type).payload).toEqual([AGENT, messages.slice(0, 2)]);
    expect(addMessageAction).toBeDefined();
    expect(addMessageAction.payload[0]).toBe(AGENT);
    expect(addMessageAction.payload[1].role).toBe('user');
    expect(addMessageAction.payload[1].contentBlocks).toEqual(retryUser.contentBlocks);
    expect(addMessageAction.payload[1].id).toMatch(/^optimistic_app_msg_/);
    expect(addMessageAction.payload[1].appMessageId).toMatch(/^app_msg_/);
    expect(dispatched.map((item) => item.type)).toEqual(expect.arrayContaining([
      chatErrorCleared.type,
      chatModelUnavailableCleared.type,
      saveAgentSessionRequested.type,
    ]));
    expect(sendPayload[2]).toBe('Retry this');
    expect(sendPayload[3]).toMatchObject({ resetHistory: true, contextItems: [{ imageData: 'img-data' }] });
    expect(sendPayload[3].userAppMessageId).toBe(addMessageAction.payload[1].appMessageId);
    expect(sendPayload[3].optimisticMessageId).toBe(addMessageAction.payload[1].id);
  });

  it('resolves retry success once the send enters responding state', async () => {
    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    const dispatched = await runHandler(
      handleAgentSessionRetryLastMessageRequested,
      action,
      makeState([textMessage('u1', 'user', 'First')], {
        lastAttemptedMessage: {
          text: 'Retry now',
          options: {
            model: 'retry-model',
            userAppMessageId: 'app_msg_retry-now',
            optimisticMessageId: 'optimistic_retry-now',
          },
        },
      }),
    );
    const types = dispatched.map((item) => item.type);
    const addMessageAction = first(dispatched, 'agentSessions/addMessage');
    const clearMessageErrorAction = first(dispatched, updateMessage.type);

    expect(addMessageAction.payload).toEqual([
      AGENT,
      expect.objectContaining({
        id: 'optimistic_retry-now',
        appMessageId: 'app_msg_retry-now',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Retry now' }],
      }),
    ]);
    expect(clearMessageErrorAction.payload).toEqual([
      AGENT,
      'optimistic_retry-now',
      { error: undefined },
    ]);
    expect(first(dispatched, agentSessionSendMessageRequested.type).payload).toEqual([
      AGENT,
      WS,
      'Retry now',
      {
        model: 'retry-model',
        userAppMessageId: 'app_msg_retry-now',
        optimisticMessageId: 'optimistic_retry-now',
      },
    ]);
    expect(types.indexOf(chatSendStarted.type)).toBeLessThan(
      types.indexOf(action.success.type),
    );
    expect(types.indexOf(agentSessionSendMessageRequested.type)).toBeLessThan(
      types.indexOf(chatSendStarted.type),
    );
  });

  it('retries the last attempted message with the requested model and clears model unavailable state', async () => {
    const action = agentSessionRetryWithModelRequested(AGENT, WS, 'new-model');
    const dispatched = await runHandler(
      handleAgentSessionRetryWithModelRequested,
      action,
      makeState([textMessage('u1', 'user', 'First')], {
        lastAttemptedMessage: { text: 'Retry now', options: { model: 'old-model' } },
        modelUnavailable: { failedModel: 'old-model', nextAvailableModel: 'new-model' },
      }),
    );
    const addMessageAction = first(dispatched, 'agentSessions/addMessage');
    const sendPayload = first(dispatched, agentSessionSendMessageRequested.type).payload;

    expect(addMessageAction).toBeDefined();
    expect(addMessageAction.payload[1]).toMatchObject({
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Retry now' }],
    });
    expect(sendPayload[0]).toBe(AGENT);
    expect(sendPayload[1]).toBe(WS);
    expect(sendPayload[2]).toBe('Retry now');
    expect(sendPayload[3]).toMatchObject({ model: 'new-model' });
    expect(sendPayload[3].userAppMessageId).toBe(addMessageAction.payload[1].appMessageId);
    expect(sendPayload[3].optimisticMessageId).toBe(addMessageAction.payload[1].id);
    expect(dispatched.map((item) => item.type)).toEqual(expect.arrayContaining([
      chatErrorCleared.type,
      chatModelUnavailableCleared.type,
      action.success.type,
    ]));
  });

  it('applies the requested model when retry-with-model falls back to conversation history', async () => {
    const retryUser = textMessage('u2', 'user', 'Retry this');
    const messages = [textMessage('u1', 'user', 'First'), textMessage('a1', 'assistant', 'Answer'), retryUser, textMessage('a2', 'assistant', 'Failed')];
    const action = agentSessionRetryWithModelRequested(AGENT, WS, 'fallback-model');
    const dispatched = await runHandler(handleAgentSessionRetryWithModelRequested, action, makeState(messages));
    const sendPayload = first(dispatched, agentSessionSendMessageRequested.type).payload;

    expect(first(dispatched, replaceMessages.type).payload).toEqual([AGENT, messages.slice(0, 2)]);
    const addMessageAction = first(dispatched, 'agentSessions/addMessage');

    expect(addMessageAction).toBeDefined();
    expect(addMessageAction.payload[1]).toMatchObject({
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Retry this' }],
    });
    expect(sendPayload[0]).toBe(AGENT);
    expect(sendPayload[1]).toBe(WS);
    expect(sendPayload[2]).toBe('Retry this');
    expect(sendPayload[3]).toMatchObject({ model: 'fallback-model', resetHistory: true });
    expect(sendPayload[3].userAppMessageId).toBe(addMessageAction.payload[1].appMessageId);
    expect(sendPayload[3].optimisticMessageId).toBe(addMessageAction.payload[1].id);
  });

  it('dispatches fork requests with cloned history and resolves the forked id', async () => {
    const messages = [textMessage('u1', 'user', 'First'), textMessage('a1', 'assistant', 'Answer'), textMessage('u2', 'user', 'Later')];
    const action = agentSessionForkSessionRequested(AGENT, WS, { forkFromMessageId: 'a1', switchToForked: true });
    const dispatched = await runHandler(handleAgentSessionForkSessionRequested, action, makeState(messages));
    const forkPayload = first(dispatched, forkAgentRequested.type).payload;

    expect(await action.promise).toBe('agent-forked');
    expect(forkPayload[0]).toBe(WS);
    expect(forkPayload[1]).toMatchObject({
      forkedAgentId: 'agent-forked',
      sourceAgentId: AGENT,
      model: 'source-model',
      forkPoint: 2,
      switchToForked: true,
    });
    expect(forkPayload[1].messages).toEqual(messages.slice(0, 2));
    expect(forkPayload[1].messages).not.toBe(messages);
  });
});

describe('resolveSendWorkspace', () => {
  async function runResolve(wsId: string, sessionWorkspaceId: string) {
    const state = makeState([]);
    return runSaga(
      {
        getState: () => state,
        dispatch: () => {},
        context: {
          readableStoreState: {
            subscribe: (subscriber: (value: any) => void) => {
              subscriber(state);
              return () => {};
            },
          },
        },
      },
      resolveSendWorkspace,
      wsId,
      sessionWorkspaceId,
    ).toPromise();
  }

  it('returns the Chief virtual workspace when wsId is the Chief id and the slice has no entry', async () => {
    const resolved = await runResolve(CHIEF_WORKSPACE_ID, CHIEF_WORKSPACE_ID);

    expect(resolved.id).toBe('__chief__');
    expect(resolved.title).toBe('Chief of Staff');
  });

  it('returns the Chief virtual workspace when only the session workspace is the Chief id', async () => {
    const resolved = await runResolve(WS, CHIEF_WORKSPACE_ID);

    expect(resolved.id).toBe('__chief__');
    expect(resolved.title).toBe('Chief of Staff');
  });

  it('throws for an unknown non-Chief workspace id', async () => {
    await expect(runResolve('ws-missing', 'ws-missing')).rejects.toThrow(
      'Workspace not found. Please try again.',
    );
  });
});