/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const activeSubscribers = new Set<(value: string) => void>();
  const stateSubscribers = new Set<() => void>();
  let active = 'workspace-a';
  const states = new Map<string, { initialized: boolean; notes: Map<string, any> }>();
  const dispatch = vi.fn();
  const navigate = vi.fn();
  const updateStatus = vi.fn();

  function workspaceState(id: string) {
    let state = states.get(id);
    if (!state) {
      state = { initialized: false, notes: new Map() };
      states.set(id, state);
    }
    return state;
  }

  function scopedReadable(workspaceStore: any, noteStore?: any) {
    return {
      subscribe(run: (value: any) => void) {
        let workspaceId = '';
        let noteId = '';
        const emit = () => {
          const state = workspaceState(workspaceId);
          run(noteStore ? state.notes.get(noteId) : { initialized: state.initialized });
        };
        const unsubscribeWorkspace = workspaceStore.subscribe((value: string) => {
          workspaceId = value;
          emit();
        });
        const unsubscribeNote = noteStore?.subscribe((value: string) => {
          noteId = value;
          emit();
        });
        stateSubscribers.add(emit);
        return () => {
          unsubscribeWorkspace();
          unsubscribeNote?.();
          stateSubscribers.delete(emit);
        };
      },
    };
  }

  return {
    dispatch,
    navigate,
    updateStatus,
    activeReadable: {
      subscribe(run: (value: string) => void) {
        activeSubscribers.add(run);
        run(active);
        return () => activeSubscribers.delete(run);
      },
    },
    reset() {
      active = 'workspace-a';
      states.clear();
      mocks.hidesAgentLifecycleActions = false;
      vi.clearAllMocks();
    },
    hidesAgentLifecycleActions: false,
    setActive(value: string) {
      active = value;
      activeSubscribers.forEach((run) => run(value));
    },
    setWorkspace(id: string, initialized: boolean, notes: any[]) {
      states.set(id, { initialized, notes: new Map(notes.map((note) => [note.id, note])) });
      stateSubscribers.forEach((emit) => emit());
    },
    noteReadable: (workspaceStore: any, noteStore: any) =>
      scopedReadable(workspaceStore, noteStore),
    stateReadable: (workspaceStore: any) => scopedReadable(workspaceStore),
    selectNote: (workspaceId: string, noteId: string) =>
      workspaceState(workspaceId).notes.get(noteId),
  };
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: () => mocks.activeReadable,
  selectWorkspaceById: { select: () => undefined },
  selectHidesAgentLifecycleActions: () => ({
    subscribe(run: (value: boolean) => void) {
      run(mocks.hidesAgentLifecycleActions);
      return () => {};
    },
  }),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentPreview: () => ({
    subscribe: (run: (value: undefined) => void) => (run(undefined), () => {}),
  }),
  selectAgentSession: Object.assign(
    () => ({ subscribe: (run: (value: undefined) => void) => (run(undefined), () => {}) }),
    { select: () => undefined },
  ),
  selectAgentIsResponding: Object.assign(
    () => ({ subscribe: (run: (value: boolean) => void) => (run(false), () => {}) }),
    { select: () => false },
  ),
}));
vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', () => ({
  selectChatReceivedFirstChunk: () => ({
    subscribe: (run: (value: boolean) => void) => (run(false), () => {}),
  }),
}));
vi.mock('$lib/components/tiptap/task-agent-polling-manager', () => ({
  taskAgentPollingManager: { register: vi.fn(), unregister: vi.fn() },
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(mocks.noteReadable, {
    select: (_: any, ws: string, id: string) => mocks.selectNote(ws, id),
  }),
  selectWorkspaceNotesState: mocks.stateReadable,
  selectSelectedNoteId: Object.assign(
    () => ({ subscribe: (run: any) => (run('spec'), () => {}) }),
    { select: () => 'spec' },
  ),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});
vi.mock('$features/tasks/tasks-write-service', () => ({
  updateTaskNoteStatus: mocks.updateStatus,
  createPrerequisiteTask: vi.fn(),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  delegateExistingTaskRequested: (...payload: unknown[]) => ({ type: 'delegate', payload }),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: mocks.navigate,
  findSourcePanelId: () => undefined,
}));

import { Editor, type JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import { CustomTaskItem } from '../CustomTaskItem';

import TestTaskItemNodeView from './TestTaskItemNodeView.test.svelte';

function taskNote(workspaceId: string, title: string, assignedAgentIds?: string[]) {
  return {
    id: 'shared-task',
    workspaceId,
    title,
    metadata: { task: { status: 'not_started', assignedAgentIds } },
  };
}

function linkedProps(workspaceId: string) {
  const text = {
    isText: true,
    marks: [{ type: { name: 'link' }, attrs: { href: 'intent://local/task/shared-task' } }],
  };
  const node = {
    attrs: {},
    nodeSize: 10,
    textContent: 'shared-task',
    content: { forEach: (p: any) => p({ content: { forEach: (visit: any) => visit(text) } }) },
  };
  const editor = {
    state: {
      doc: {
        nodeAt: () => node,
        content: { size: 0 },
        resolve: () => ({ parent: { type: { name: 'doc' } } }),
      },
    },
    on: vi.fn(),
    off: vi.fn(),
  } as any;
  return { node, editor, getPos: () => 0, workspaceId };
}

describe('TaskItemNodeView workspace ownership', () => {
  beforeEach(() => mocks.reset());

  it('keeps simultaneous same-id tasks scoped through active focus and opposite hydration states', async () => {
    mocks.setWorkspace('workspace-a', true, [taskNote('workspace-a', 'Task from A')]);
    mocks.setWorkspace('workspace-b', false, []);
    const viewA = render(TestTaskItemNodeView, { props: linkedProps('workspace-a') });
    const viewB = render(TestTaskItemNodeView, { props: linkedProps('workspace-b') });

    expect(viewA.container.textContent).toContain('Task from A');
    expect(viewB.container.textContent).toContain('Loading');
    mocks.setActive('workspace-b');
    expect(viewA.container.textContent).toContain('Task from A');
    expect(viewB.container.textContent).toContain('Loading');

    mocks.setWorkspace('workspace-b', true, [taskNote('workspace-b', 'Task from B')]);
    await waitFor(() => expect(viewB.container.textContent).toContain('Task from B'));
    expect(viewA.container.textContent).toContain('Task from A');
  });

  it('uses the owner for status, delegation, and source-panel navigation', async () => {
    mocks.setWorkspace('workspace-b', true, [taskNote('workspace-b', 'Task from B')]);
    const view = render(TestTaskItemNodeView, { props: linkedProps('workspace-b') });
    const panel = document.createElement('div');
    panel.dataset.panelId = 'panel-b';
    view.container.parentElement?.insertBefore(panel, view.container);
    panel.appendChild(view.container);

    await fireEvent.click(view.container.querySelector('.task-status-icon')!);
    await fireEvent.click(view.getByTitle('Assign to agent'));
    await fireEvent.click(view.getByText('Task from B').closest('button')!);

    expect(mocks.updateStatus).toHaveBeenCalledWith('workspace-b', 'shared-task', 'in_progress');
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'delegate',
      payload: ['workspace-b', 'shared-task', 'Task from B', false],
    });
    expect(mocks.navigate).toHaveBeenCalledWith('shared-task', {
      workspaceId: 'workspace-b',
      openInAdjacentPanel: false,
      openInNewAdjacentPanel: false,
      sourcePanelId: 'panel-b',
    });
  });

  it('withholds the assign affordance in a guest / collaborator window', async () => {
    mocks.hidesAgentLifecycleActions = true;
    mocks.setWorkspace('workspace-b', true, [taskNote('workspace-b', 'Task from B')]);
    const view = render(TestTaskItemNodeView, { props: linkedProps('workspace-b') });

    expect(view.getByText('Task from B')).toBeTruthy();
    expect(view.queryByTitle('Assign to agent')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'delegate' }));
  });

  it('opens the assigned agent with the task owner without opening the linked note', async () => {
    mocks.setWorkspace('workspace-b', true, [
      taskNote('workspace-b', 'Task from B', ['assigned-agent']),
    ]);
    const view = render(TestTaskItemNodeView, { props: linkedProps('workspace-b') });
    const panel = document.createElement('div');
    panel.dataset.panelId = 'panel-b';
    view.container.parentElement?.insertBefore(panel, view.container);
    panel.appendChild(view.container);

    const agentButton = await waitFor(() =>
      view.container.querySelector<HTMLButtonElement>('.task-agent-status'),
    );
    const row = view.container.querySelector<HTMLElement>('[data-task-item-row]');
    expect(agentButton).not.toBeNull();
    expect(row).not.toBeNull();
    expect(row?.querySelector('[data-task-row-title]')?.textContent).toContain('Task from B');
    expect(row?.querySelector('[data-task-agent-indicator]')).toBe(agentButton);
    expect(row?.querySelector('.status-content')).toBeNull();
    expect(view.container.querySelector('[data-task-note-preview]')).toBeNull();
    expect(agentButton!.parentElement?.closest('button')).toBeNull();

    await fireEvent.click(agentButton!);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'appLayout/openAgentTabRequested',
      payload: [
        'workspace-b',
        {
          agentId: 'assigned-agent',
          sourcePanelId: 'panel-b',
          openInAdjacentPanel: false,
        },
      ],
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe('TaskItemNodeView dependency adjacency in the editor', () => {
  let editor: Editor;
  let host: HTMLElement;

  const row = (id?: string, nested: JSONContent[] = []): JSONContent => ({
    type: 'taskItem',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: id ?? 'Plain task',
            ...(id
              ? { marks: [{ type: 'link', attrs: { href: `intent://local/task/${id}` } }] }
              : {}),
          },
        ],
      },
      ...nested,
    ],
  });
  const list = (...content: JSONContent[]): JSONContent => ({ type: 'taskList', content });
  const dependencyNote = (id: string) => ({ ...taskNote('workspace-a', id), id });
  function publish(
    dependsOn = ['previous'],
    unmetDependsOn = ['previous'],
    status = 'not_started',
  ) {
    mocks.setWorkspace('workspace-a', true, [
      dependencyNote('previous'),
      dependencyNote('other'),
      { ...dependencyNote('completed'), metadata: { task: { status: 'complete' } } },
      { ...dependencyNote('target'), metadata: { task: { status, dependsOn, unmetDependsOn } } },
    ]);
  }
  function mountEditor(content = [list(row('previous'), row('target'))]) {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        Document,
        Paragraph,
        Text,
        Link.configure({ openOnClick: false }),
        TaskList,
        CustomTaskItem.configure({ workspaceId: 'workspace-a' }),
      ],
      content: { type: 'doc', content },
    });
  }
  const badge = () =>
    host.querySelector('[data-linked-task-note-id="target"] [data-task-row-waits-on]');
  async function expectBadge(label: string | null) {
    await waitFor(() => {
      if (label === null) expect(badge()).toBeNull();
      else expect(badge()?.textContent?.trim()).toBe(label);
    });
  }

  beforeEach(() => {
    mocks.reset();
    publish();
  });
  afterEach(() => {
    editor?.destroy();
    host?.remove();
  });

  it('uses the previous label only for a sole total dependency and reacts to relation updates', async () => {
    mountEditor();
    await expectBadge('After Previous');
    publish(['previous', 'completed']);
    await expectBadge('Waits on 1');
    publish(['other'], ['other']);
    await expectBadge('Waits on 1');
    publish();
    await expectBadge('After Previous');
  });

  it.each([
    ['first row', [list(row('target'), row('previous'))]],
    ['non-adjacent dependency', [list(row('previous'), row('other'), row('target'))]],
    ['intervening plain row', [list(row('previous'), row(), row('target'))]],
    ['separate lists', [list(row('previous')), { type: 'paragraph' }, list(row('target'))]],
    ['parent task', [list(row('previous', [list(row('target'))]))]],
    [
      'nested descendant of previous sibling',
      [list(row('other', [list(row('previous'))]), row('target'))],
    ],
  ] satisfies [string, JSONContent[]][])(
    'does not cross the %s boundary',
    async (_name, content) => {
      mountEditor(content);
      await expectBadge('Waits on 1');
    },
  );

  it('recognizes adjacent siblings inside a nested task list', async () => {
    mountEditor([list(row('other', [list(row('previous'), row('target'))]))]);
    await expectBadge('After Previous');
  });

  it('updates when another row moves between a task and its dependency', async () => {
    mountEditor([list(row('previous'), row('target'), row('other'))]);
    await expectBadge('After Previous');
    const taskList = editor.state.doc.firstChild!;
    const previous = taskList.child(0);
    const target = taskList.child(1);
    const other = taskList.child(2);
    const otherPos = 1 + previous.nodeSize + target.nodeSize;
    editor.view.dispatch(
      editor.state.tr
        .delete(otherPos, otherPos + other.nodeSize)
        .insert(1 + previous.nodeSize, other),
    );
    await expectBadge('Waits on 1');
    editor.view.dispatch(
      editor.state.tr
        .delete(1 + previous.nodeSize, 1 + previous.nodeSize + other.nodeSize)
        .insert(otherPos, other),
    );
    await expectBadge('After Previous');
  });

  it('updates when the preceding link is edited without changing the dependent row', async () => {
    mountEditor();
    await expectBadge('After Previous');
    const targetView = host.querySelector('[data-linked-task-note-id="target"]');
    const previous = editor.state.doc.firstChild!.firstChild!;
    editor.view.dispatch(
      editor.state.tr
        .removeMark(3, previous.nodeSize - 1, editor.schema.marks.link)
        .addMark(
          3,
          previous.nodeSize - 1,
          editor.schema.marks.link.create({ href: 'intent://local/task/other' }),
        ),
    );
    await expectBadge('Waits on 1');
    expect(host.querySelector('[data-linked-task-note-id="target"]')).toBe(targetView);
  });

  it('keeps the unmet dependency tooltip navigable with the previous label', async () => {
    mountEditor();
    await expectBadge('After Previous');
    const trigger = badge()!.closest('[data-tooltip-trigger]')!;
    await fireEvent.focus(trigger);
    const link = await waitFor(() => {
      const button = document.querySelector('[role="tooltip"] button');
      expect(button?.textContent).toContain('previous');
      return button!;
    });
    await fireEvent.click(link, { ctrlKey: true });
    expect(mocks.navigate).toHaveBeenCalledWith('previous', {
      workspaceId: 'workspace-a',
      openInAdjacentPanel: true,
      sourcePanelId: undefined,
    });
  });

  it('keeps visibility daemon-owned, including when the projection is absent', async () => {
    mountEditor();
    await expectBadge('After Previous');
    publish(['previous'], []);
    await expectBadge(null);
    publish(['previous'], ['previous'], 'complete');
    await expectBadge(null);
    mocks.setWorkspace('workspace-a', true, [
      {
        ...dependencyNote('target'),
        metadata: {
          task: {
            status: 'not_started',
            dependsOn: ['previous'],
          },
        },
      },
    ]);
    await expectBadge(null);
    publish(['previous', 'other'], ['previous', 'other']);
    await expectBadge('Waits on 2');
  });
});
