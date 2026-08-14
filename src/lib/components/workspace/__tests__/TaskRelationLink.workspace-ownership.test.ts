/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const navigate = vi.fn();
  const notes = new Map([
    [
      'workspace-a',
      { id: 'shared-task', title: 'Relation from A', metadata: { task: { status: 'complete' } } },
    ],
    [
      'workspace-b',
      {
        id: 'shared-task',
        title: 'Relation from B',
        metadata: { task: { status: 'in_progress' } },
      },
    ],
  ]);
  const readStore = (store: any) => {
    let value: any;
    const unsubscribe = store.subscribe((next: any) => (value = next));
    unsubscribe();
    return value;
  };
  return { navigate, notes, readStore };
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: Object.assign(
    () => ({ subscribe: (run: any) => (run('workspace-a'), () => {}) }),
    { select: () => 'workspace-a' },
  ),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(
    (workspaceStore: any) => ({
      subscribe(run: any) {
        run(mocks.notes.get(mocks.readStore(workspaceStore)));
        return () => {};
      },
    }),
    { select: (_: any, workspaceId: string) => mocks.notes.get(workspaceId) },
  ),
  selectNotesVersion: () => ({ subscribe: (run: any) => (run(0), () => {}) }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: mocks.navigate,
  findSourcePanelId: () => 'panel-b',
}));

import TaskRelationLink from '../TaskRelationLink.svelte';

describe('TaskRelationLink workspace ownership', () => {
  beforeEach(() => mocks.navigate.mockClear());

  it('renders and opens the explicit owner when another workspace is active', async () => {
    render(TaskRelationLink, {
      props: { workspaceId: 'workspace-b', noteId: 'shared-task' as any },
    });

    expect(screen.getByText('Relation from B')).toBeTruthy();
    expect(screen.queryByText('Relation from A')).toBeNull();
    await fireEvent.click(screen.getByText('Relation from B'));

    expect(mocks.navigate).toHaveBeenCalledWith('shared-task', {
      workspaceId: 'workspace-b',
      openInAdjacentPanel: false,
      sourcePanelId: 'panel-b',
    });
  });
});
