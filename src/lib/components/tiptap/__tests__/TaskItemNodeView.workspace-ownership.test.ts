/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      vi.clearAllMocks();
    },
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
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToNote: mocks.navigate }));
vi.mock('$lib/components/tiptap/TaskNotePreview.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));

import TestTaskItemNodeView from './TestTaskItemNodeView.test.svelte';

function taskNote(workspaceId: string, title: string) {
  return { id: 'shared-task', workspaceId, title, metadata: { task: { status: 'not_started' } } };
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
  const editor = { state: { doc: { nodeAt: () => node } }, on: vi.fn(), off: vi.fn() } as any;
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

  it('uses the owner for status, delegation, and adjacent-panel navigation', async () => {
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
      openInAdjacentPanel: true,
      openInNewAdjacentPanel: true,
      sourcePanelId: 'panel-b',
    });
  });
});
