import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addOptimisticNoteMock,
  createAgentMock,
  notesIpcMock,
  findByIdMock,
  appStoreFactoryMock,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removeOptimisticNoteMock,
  selectWorkspaceDefaultModelMock,
} = vi.hoisted(() => ({
  addOptimisticNoteMock: vi.fn(),
  createAgentMock: vi.fn(),
  notesIpcMock: vi.fn(),
  findByIdMock: vi.fn(),
  appStoreFactoryMock: vi.fn(),
  removeOptimisticNoteMock: vi.fn(),
  selectWorkspaceDefaultModelMock: vi.fn(),
}));

vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: { createAgent: createAgentMock },
}));

vi.mock('$lib/utils/notes-ipc', () => ({
  notesIpc: notesIpcMock,
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: findByIdMock },
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-slice', async (importOriginal) => {
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

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => appStoreFactoryMock()?.getState?.() ?? {},
    dispatch: (...args: any[]) => appStoreFactoryMock()?.dispatch?.(...args),
  });
});

vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: { select: selectWorkspaceDefaultModelMock },
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
      workspaceModels: { 'ws-1': 'legacy-workspace-model' },
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
    appStoreFactoryMock.mockReturnValue({ getState: () => legacyState });
    selectWorkspaceDefaultModelMock.mockReturnValue('selector-workspace-model');
    findByIdMock.mockReturnValue({ title: 'Parent note' });
    notesIpcMock.mockResolvedValue({
      ok: true,
      data: {
        note: { id: 'task-note-1' },
        agent: { id: 'agent-1', name: 'Task Agent' },
      },
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

    expect(notesIpcMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        workspaceId: 'ws-1',
        dependentNoteId: 'note-1',
        options: expect.objectContaining({
          agentConfig: expect.objectContaining({
            model: 'selector-workspace-model',
          }),
        }),
      }),
    );
    expect(notesIpcMock.mock.calls[0][1].options.agentConfig.model).not.toBe(
      legacyState.model.workspaceModels['ws-1'],
    );
  });

  it('persists menu-assigned duplicate tasks with a stable agent key', async () => {
    notesIpcMock.mockResolvedValueOnce({ ok: false, error: 'backend unavailable' });
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

    expect(addAssociationAction.payload[2]).toMatchObject({
      taskText: 'Ship feature',
      taskKey: createTaskAgentAssociationKeyForAgent('agent-optimistic'),
      agentId: 'agent-optimistic',
    });
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
            agentType: 'task-breakdown',
            source: 'task-menu',
          }),
        ],
      }),
    );
    expect(storeDispatch.mock.calls[0][0].payload[1]).not.toHaveProperty('id');
    expect(storeDispatch.mock.calls[0][0].payload[1]).not.toHaveProperty('model');
  });
});
