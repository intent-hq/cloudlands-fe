import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addOptimisticNoteMock,
  createAgentMock,
  createPrerequisiteNoteMock,
  findByIdMock,
  getReduxStoreMock,
  removeOptimisticNoteMock,
  selectWorkspaceDefaultModelMock,
} = vi.hoisted(() => ({
  addOptimisticNoteMock: vi.fn(),
  createAgentMock: vi.fn(),
  createPrerequisiteNoteMock: vi.fn(),
  findByIdMock: vi.fn(),
  getReduxStoreMock: vi.fn(),
  removeOptimisticNoteMock: vi.fn(),
  selectWorkspaceDefaultModelMock: vi.fn(),
}));

vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: { createAgent: createAgentMock },
}));

vi.mock('$features/notes/notes.client', () => ({
  notesClient: { createPrerequisiteNote: createPrerequisiteNoteMock },
}));

vi.mock('$features/notes/notes.store.svelte', () => ({
  notesStateManager: {
    addOptimisticNote: addOptimisticNoteMock,
    findById: findByIdMock,
    removeOptimisticNote: removeOptimisticNoteMock,
  },
}));

vi.mock('$features/notes/utils/task-agent-message-builder', () => ({
  buildTaskNoteContent: vi.fn(() => 'task note content'),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: getReduxStoreMock,
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
    createPrerequisiteNoteMock.mockResolvedValue({
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
    expect(createPrerequisiteNoteMock).toHaveBeenCalledWith(
      'ws-1',
      'note-1',
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          model: 'selector-workspace-model',
        }),
      }),
    );
    expect(createPrerequisiteNoteMock.mock.calls[0][2].agentConfig.model).not.toBe(
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