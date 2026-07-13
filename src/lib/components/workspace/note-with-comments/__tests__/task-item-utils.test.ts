import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  hydrateTaskAgentAssociations,
  initialState,
  pruneTaskAgentAssociationsForNote,
  taskAgentAssociationsReducer,
} from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';

import {
  createTaskAgentAssociationKey,
  createTaskAgentAssociationKeyForAgent,
  getTaskAssociationKeyAtPosition,
  getTaskAssociationKeysInEditor,
  restoreTaskAgentAssociations,
} from '../task-item-utils';

function createTaskNode(textContent: string, attrs: Record<string, unknown> = {}) {
  return {
    type: { name: 'taskItem' },
    textContent,
    attrs,
  };
}

function createEditor(nodes: Array<{ pos: number; node: ReturnType<typeof createTaskNode> }>) {
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

describe('task item association utilities', () => {
  it('creates occurrence keys for duplicate task labels', () => {
    const editor = createEditor([
      { pos: 1, node: createTaskNode('Duplicate') },
      { pos: 5, node: createTaskNode('Unique') },
      { pos: 9, node: createTaskNode('Duplicate') },
    ]);

    expect(getTaskAssociationKeyAtPosition(editor, 9, 'Duplicate')).toBe(
      createTaskAgentAssociationKey('Duplicate', 1),
    );
    expect(getTaskAssociationKeysInEditor(editor)).toEqual([
      createTaskAgentAssociationKey('Duplicate', 0),
      'Duplicate',
      createTaskAgentAssociationKey('Unique', 0),
      'Unique',
      createTaskAgentAssociationKey('Duplicate', 1),
      'Duplicate',
    ]);
  });

  it('restores only the matching duplicate task by task key', () => {
    const first = createTaskNode('Duplicate');
    const second = createTaskNode('Duplicate');
    const editor = createEditor([
      { pos: 1, node: first },
      { pos: 5, node: second },
    ]);

    restoreTaskAgentAssociations(
      editor,
      [{
        taskText: 'Duplicate',
        taskKey: createTaskAgentAssociationKey('Duplicate', 1),
        agentId: 'agent-2',
        noteId: 'note-1',
        createdAt: 1,
      }],
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );

    expect(first.attrs.delegatedAgentId).toBeUndefined();
    expect(second.attrs.delegatedAgentId).toBe('agent-2');
  });

  it('uses delegated agent keys so duplicate deletion does not treat a reindexed sibling as stale task', () => {
    const remaining = createTaskNode('Duplicate', { delegatedAgentId: 'agent-2' });
    const editor = createEditor([{ pos: 1, node: remaining }]);

    const currentKeys = getTaskAssociationKeysInEditor(editor);

    expect(currentKeys).toEqual([
      createTaskAgentAssociationKeyForAgent('agent-2'),
      'Duplicate',
    ]);
    expect(currentKeys).not.toContain(createTaskAgentAssociationKeyForAgent('agent-1'));
    expect(currentKeys).not.toContain(createTaskAgentAssociationKey('Duplicate', 0));

    restoreTaskAgentAssociations(
      editor,
      [
        {
          taskText: 'Duplicate',
          taskKey: createTaskAgentAssociationKeyForAgent('agent-1'),
          agentId: 'agent-1',
          noteId: 'note-1',
          createdAt: 1,
        },
        {
          taskText: 'Duplicate',
          taskKey: createTaskAgentAssociationKeyForAgent('agent-2'),
          agentId: 'agent-2',
          noteId: 'note-1',
          createdAt: 2,
        },
      ],
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );

    expect(remaining.attrs.delegatedAgentId).toBe('agent-2');
  });

  it('does not restore a stale reindexed occurrence key when duplicate associations outnumber tasks', () => {
    const remaining = createTaskNode('Duplicate');
    const editor = createEditor([{ pos: 1, node: remaining }]);

    restoreTaskAgentAssociations(
      editor,
      [
        {
          taskText: 'Duplicate',
          taskKey: createTaskAgentAssociationKey('Duplicate', 0),
          agentId: 'agent-1',
          noteId: 'note-1',
          createdAt: 1,
        },
        {
          taskText: 'Duplicate',
          taskKey: createTaskAgentAssociationKey('Duplicate', 1),
          agentId: 'agent-2',
          noteId: 'note-1',
          createdAt: 2,
        },
      ],
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );

    expect(remaining.attrs.delegatedAgentId).toBeUndefined();
  });

  it('does not restore a removed agent after duplicate same-label prune and reindex', () => {
    const removedAssociation = {
      taskText: 'Duplicate',
      taskKey: createTaskAgentAssociationKey('Duplicate', 0),
      agentId: 'agent-1',
      noteId: 'note-1',
      createdAt: 1,
    };
    const remainingAssociation = {
      taskText: 'Duplicate',
      taskKey: createTaskAgentAssociationKey('Duplicate', 1),
      agentId: 'agent-2',
      noteId: 'note-1',
      createdAt: 2,
    };
    const state = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations('ws-1', {
        'note-1': {
          [removedAssociation.taskKey]: removedAssociation,
          [remainingAssociation.taskKey]: remainingAssociation,
        },
      }),
    );
    const remaining = createTaskNode('Duplicate');
    const editor = createEditor([{ pos: 1, node: remaining }]);

    const pruned = taskAgentAssociationsReducer(
      state,
      pruneTaskAgentAssociationsForNote('ws-1', 'note-1', getTaskAssociationKeysInEditor(editor)),
    );
    const prunedAssociations = Object.values(
      pruned.byWorkspaceId['ws-1']?.byNoteId['note-1'] ?? {},
    );
    restoreTaskAgentAssociations(
      editor,
      prunedAssociations,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );

    expect(prunedAssociations).toEqual([]);
    expect(remaining.attrs.delegatedAgentId).toBeUndefined();
  });
});