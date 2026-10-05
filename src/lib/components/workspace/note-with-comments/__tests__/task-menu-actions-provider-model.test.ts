import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addOptimisticNoteMock,
  createAgentMock,
  createPrerequisiteMock,
  agentsCreateMock,
  findByIdMock,
  appStoreFactoryMock,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removeOptimisticNoteMock,
  selectSelectedModelMock,
  hidesAgentLifecycleActionsMock,
  creationDispatchMock,
} = vi.hoisted(() => ({
  addOptimisticNoteMock: vi.fn(),
  createAgentMock: vi.fn(),
  createPrerequisiteMock: vi.fn(),
  agentsCreateMock: vi.fn(),
  findByIdMock: vi.fn(),
  appStoreFactoryMock: vi.fn(),
  removeOptimisticNoteMock: vi.fn(),
  selectSelectedModelMock: vi.fn(),
  hidesAgentLifecycleActionsMock: vi.fn(() => false),
  creationDispatchMock: vi.fn(),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectHidesAgentLifecycleActions: { select: hidesAgentLifecycleActionsMock },
}));

vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: { createAgent: createAgentMock },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    tasks: { createPrerequisite: createPrerequisiteMock },
    agents: { create: agentsCreateMock },
  },
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: findByIdMock },
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-slice', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    addOptimisticNote: (...args: unknown[]) => ({
      type: 'workspaceNotes/addOptimisticNote',
      payload: args,
    }),
    removeOptimisticNote: (...args: unknown[]) => ({
      type: 'workspaceNotes/removeOptimisticNote',
      payload: args,
    }),
  };
});

vi.mock('$features/notes/utils/task-agent-message-builder', () => ({
  buildTaskNoteContent: vi.fn(() => 'task note content'),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => appStoreFactoryMock()?.getState?.() ?? {},
    dispatch: (...args: any[]) => appStoreFactoryMock()?.dispatch?.(...args),
  });
});

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: { select: selectSelectedModelMock },
}));

vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: {
    generateAgentId: vi.fn(() => 'agent-optimistic'),
    generateNoteId: vi.fn(() => 'note-optimistic'),
  },
}));

vi.mock('$shared/utils-client', () => ({
  stripMarkdownFormatting: vi.fn((value: string) => value),
}));

import { runAssignAgentTaskMenuAction } from '../task-menu-assign-agent-action';
import { runTaskBreakdownTaskMenuAction } from '../task-menu-task-breakdown-action';
import { createTaskAgentAssociationKeyForAgent } from '../task-item-utils';

function createEditorWithDuplicateTasks() {
  const nodes = [
    { pos: 1, node: { type: { name: 'taskItem' }, textContent: 'Ship feature', attrs: {} } },
    { pos: 5, node: { type: { name: 'taskItem' }, textContent: 'Ship feature', attrs: {} } },
  ];
  const state = {
    doc: {
      descendants(callback: (node: any, pos: number) => boolean | void) {
        for (const { node, pos } of nodes) {
          if (callback(node, pos) === false) break;
        }
      },
      nodeAt(pos: number) {
        return nodes.find((entry) => entry.pos === pos)?.node ?? null;
      },
    },
  };
  return {
    state,
    commands: { setTaskAgentId: vi.fn() },
    chain() {
      const commands: Array<(context: any) => boolean> = [];
      return {
        command(fn: (context: any) => boolean) {
          commands.push(fn);
          return this;
        },
        run() {
          const tr = {
            setMeta: vi.fn(),
            setNodeMarkup(pos: number, _type: unknown, attrs: Record<string, unknown>) {
              const match = nodes.find((entry) => entry.pos === pos);
              if (match) match.node.attrs = attrs;
            },
          };
          return commands.every((command) => command({ tr, state }));
        },
      };
    },
  } as any;
}

describe('task menu actions provider model', () => {
  const legacyState = {
    model: {
      selectedModel: 'legacy-global-model',
    },
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const workspace = { id: 'ws-1' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    hidesAgentLifecycleActionsMock.mockReturnValue(false);
    creationDispatchMock.mockImplementation((action) => {
      if (action.type === 'workspaceAgents/createAgentFromConfigRequested') {
        action.success({ id: 'agent-daemon-assigned', name: 'Task Agent' });
      }
    });
    appStoreFactoryMock.mockReturnValue({
      getState: () => legacyState,
      dispatch: creationDispatchMock,
    });
    selectSelectedModelMock.mockReturnValue('selector-workspace-model');
    findByIdMock.mockReturnValue({ title: 'Parent note' });
    createPrerequisiteMock.mockResolvedValue({
      success: true,
      id: 'task-note-1',
    });
    agentsCreateMock.mockResolvedValue({
      id: 'agent-daemon-assigned',
      name: 'Task Agent',
    });
    createAgentMock.mockResolvedValue({
      success: true,
      agent: { id: 'agent-2', name: 'Break down: Ship feature' },
    });
  });

  it('uses the provided workspace default model when assigning an agent to a task', async () => {
    const storeDispatch = vi.fn();

    await runAssignAgentTaskMenuAction({
      editor: null,
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '1' },
      parentNoteTitle: 'Parent note',
      model: 'selector-workspace-model',
      debounceUpdate: vi.fn(),
      storeDispatch,
      logger,
    });

    expect(createPrerequisiteMock).toHaveBeenCalledWith(
      'note-1',
      expect.any(String),
      expect.objectContaining({
        content: expect.any(String),
        status: 'not_started',
      }),
    );
    expect(creationDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceAgents/createAgentFromConfigRequested',
        payload: [
          'ws-1',
          expect.objectContaining({ workspaceId: 'ws-1', model: 'selector-workspace-model' }),
          { activateAgent: false, notifyOnError: false },
        ],
      }),
    );
    // No client-supplied agentId: the daemon assigns the agent id on create.
    expect(creationDispatchMock.mock.calls[0][0].payload[1]).not.toHaveProperty('agentId');
    expect(agentsCreateMock).not.toHaveBeenCalled();
  });

  it('refuses to assign an agent when agent lifecycle actions are hidden (multiplayer w4)', async () => {
    hidesAgentLifecycleActionsMock.mockReturnValue(true);
    const storeDispatch = vi.fn();
    const editor = createEditorWithDuplicateTasks();

    await runAssignAgentTaskMenuAction({
      editor,
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '1' },
      parentNoteTitle: 'Parent note',
      model: 'selector-workspace-model',
      debounceUpdate: vi.fn(),
      storeDispatch,
      logger,
    });

    expect(hidesAgentLifecycleActionsMock).toHaveBeenCalledWith(expect.anything(), 'ws-1');
    expect(createPrerequisiteMock).not.toHaveBeenCalled();
    expect(agentsCreateMock).not.toHaveBeenCalled();
    expect(storeDispatch).not.toHaveBeenCalled();
    // No optimistic "Spinning up…" marker is left on the task item either.
    expect(editor.state.doc.nodeAt(1).attrs).not.toHaveProperty('delegatedAgentId');
  });

  it('persists menu-assigned duplicate tasks keyed to the daemon-assigned agent id', async () => {
    const storeDispatch = vi.fn();

    await runAssignAgentTaskMenuAction({
      editor: createEditorWithDuplicateTasks(),
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '5' },
      parentNoteTitle: 'Parent note',
      model: 'selector-workspace-model',
      debounceUpdate: vi.fn(),
      storeDispatch,
      logger,
    });

    const addAssociationAction = storeDispatch.mock.calls.find(
      ([action]) => action.type === 'taskAgentAssociations/addTaskAgentAssociation',
    )?.[0];

    // The association (which syncs to the daemon via task.linkAgent) must be
    // keyed to the daemon-assigned id, never the local placeholder.
    expect(addAssociationAction.payload[2]).toMatchObject({
      taskText: 'Ship feature',
      taskKey: createTaskAgentAssociationKeyForAgent('agent-daemon-assigned'),
      agentId: 'agent-daemon-assigned',
    });
  });

  it('does not dispatch any task-agent association when task note creation fails', async () => {
    createPrerequisiteMock.mockResolvedValueOnce({ success: false, error: 'backend unavailable' });
    const storeDispatch = vi.fn();

    await runAssignAgentTaskMenuAction({
      editor: createEditorWithDuplicateTasks(),
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '5' },
      parentNoteTitle: 'Parent note',
      model: 'selector-workspace-model',
      debounceUpdate: vi.fn(),
      storeDispatch,
      logger,
    });

    // The placeholder id must never reach a daemon-synced store action.
    const addAssociationAction = storeDispatch.mock.calls.find(
      ([action]) => action.type === 'taskAgentAssociations/addTaskAgentAssociation',
    );
    expect(addAssociationAction).toBeUndefined();
    expect(agentsCreateMock).not.toHaveBeenCalled();
  });

  it('launches task breakdown agents through the saga-owned request', () => {
    const storeDispatch = vi.fn();
    appStoreFactoryMock.mockReturnValue({ getState: () => legacyState, dispatch: storeDispatch });

    runTaskBreakdownTaskMenuAction({
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '2', checked: false },
    });

    expect(storeDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agentSessions/launchAgentRequested',
        payload: [
          'ws-1',
          expect.objectContaining({
            name: 'Break down: Ship feature',
            // Derived name — flagged as not user-chosen so the agent can rename itself.
            nameExplicitlySet: false,
            agentType: 'task-breakdown',
            source: 'task-menu',
          }),
        ],
      }),
    );
    expect(storeDispatch.mock.calls[0][0].payload[1]).not.toHaveProperty('id');
    expect(storeDispatch.mock.calls[0][0].payload[1]).not.toHaveProperty('model');
  });

  it('waits for acknowledged creation before associating the task and retains captured workspace routing', async () => {
    creationDispatchMock.mockImplementation(() => undefined);
    const storeDispatch = vi.fn();
    const pending = runAssignAgentTaskMenuAction({
      editor: null,
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '1' },
      parentNoteTitle: 'Parent note',
      model: 'selector-workspace-model',
      debounceUpdate: vi.fn(),
      storeDispatch,
      logger,
    });
    await vi.waitFor(() => expect(creationDispatchMock).toHaveBeenCalledTimes(1));
    expect(
      storeDispatch.mock.calls.some(
        ([action]) => action.type === 'taskAgentAssociations/addTaskAgentAssociation',
      ),
    ).toBe(false);
    appStoreFactoryMock.mockReturnValue({ getState: () => ({ activeWorkspaceId: 'ws-other' }) });
    const action = creationDispatchMock.mock.calls[0][0];
    expect(action.payload[0]).toBe('ws-1');
    action.success({ id: 'acknowledged-agent' });
    await pending;
    expect(storeDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'taskAgentAssociations/addTaskAgentAssociation',
        payload: ['ws-1', 'note-1', expect.objectContaining({ agentId: 'acknowledged-agent' })],
      }),
    );
    expect(agentsCreateMock).not.toHaveBeenCalled();
  });

  it('preserves a created task note when its subsequent agent creation fails without associating a placeholder', async () => {
    creationDispatchMock.mockImplementation((action) => action.failure(new Error('host refused')));
    const storeDispatch = vi.fn();
    await runAssignAgentTaskMenuAction({
      editor: null,
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '1' },
      parentNoteTitle: 'Parent note',
      model: 'selector-workspace-model',
      debounceUpdate: vi.fn(),
      storeDispatch,
      logger,
    });
    expect(
      storeDispatch.mock.calls.some(
        ([action]) => action.type === 'taskAgentAssociations/addTaskAgentAssociation',
      ),
    ).toBe(false);
    expect(storeDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNotes/removeOptimisticNote',
        payload: ['ws-1', 'note-optimistic'],
      }),
    );
    expect(storeDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNotes/addOptimisticNote',
        payload: ['ws-1', expect.objectContaining({ id: 'task-note-1' })],
      }),
    );
  });
});
