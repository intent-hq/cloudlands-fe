import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addOptimisticNoteMock,
  createAgentMock,
  notesIpcMock,
  findByIdMock,
  getReduxStoreMock,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removeOptimisticNoteMock,
  selectWorkspaceDefaultModelMock,
} = vi.hoisted(() => ({
  addOptimisticNoteMock: vi.fn(),
  createAgentMock: vi.fn(),
  notesIpcMock: vi.fn(),
  findByIdMock: vi.fn(),
  getReduxStoreMock: vi.fn(),
  removeOptimisticNoteMock: vi.fn(),
  selectWorkspaceDefaultModelMock: vi.fn(),
}));

vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: { createAgent: createAgentMock },
}));

vi.mock('$lib/store/slices/workspace-notes/sagas/notes-ipc', () => ({
  notesIpc: notesIpcMock,
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: findByIdMock },
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-slice', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    addOptimisticNote: (...args: unknown[]) => ({ type: 'workspaceNotes/addOptimisticNote', payload: args }),
    removeOptimisticNote: (...args: unknown[]) => ({ type: 'workspaceNotes/removeOptimisticNote', payload: args }),
  };
});

vi.mock('$features/notes/utils/task-agent-message-builder', () => ({
  buildTaskNoteContent: vi.fn(() => 'task note content'),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: getReduxStoreMock,
  dispatch: (action: unknown) => action,
}));

vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: { select: selectWorkspaceDefaultModelMock },
}));

vi.mock('$lib/utils/task-agent-associations', () => ({
  addTaskAgentAssociation: vi.fn(),
  removeTaskAgentAssociation: vi.fn(),
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
    getReduxStoreMock.mockReturnValue({ getState: () => legacyState });
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

  it('uses the workspace default selector when assigning an agent to a task', async () => {
    const dispatch = vi.fn();

    await runAssignAgentTaskMenuAction({
      editor: null,
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '1' },
      debounceUpdate: vi.fn(),
      dispatch,
      logger,
    });

    expect(selectWorkspaceDefaultModelMock).toHaveBeenCalledWith(legacyState, 'ws-1');
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
    expect(dispatch).toHaveBeenCalledWith('agentLaunched', {
      agent: { id: 'agent-1', name: 'Task Agent' },
      autoOpenDrawer: false,
    });
  });

  it('uses the workspace default selector when launching task breakdown agents', async () => {
    const dispatch = vi.fn();

    await runTaskBreakdownTaskMenuAction({
      workspace,
      noteId: 'note-1',
      taskData: { text: 'Ship feature', position: '2', checked: false },
      dispatch,
      logger,
    });

    expect(selectWorkspaceDefaultModelMock).toHaveBeenCalledWith(legacyState, 'ws-1');
    expect(createAgentMock).toHaveBeenCalledWith(
      workspace,
      expect.objectContaining({ model: 'selector-workspace-model' }),
    );
    expect(createAgentMock.mock.calls[0][1].model).not.toBe(legacyState.model.selectedModel);
    expect(dispatch).toHaveBeenCalledWith('agentLaunched', {
      agent: { id: 'agent-2', name: 'Break down: Ship feature' },
      autoOpenDrawer: false,
    });
  });
});