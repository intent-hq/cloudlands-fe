// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

import { store as appStore } from '$store/renderer/store';
import {
  clearWorkspaceNotesForWorkspaces,
  loadWorkspaceNotesSucceeded,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import type { Note } from '$shared/types';

import NotesPanel from './NotesPanel.svelte';

const WORKSPACE_ID = 'notes-panel-checkbox-test';
const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  appStore.init();
  globalThis.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  appStore.dispose();
});
afterEach(() => {
  cleanup();
  appStore.dispatch(clearWorkspaceNotesForWorkspaces([WORKSPACE_ID]));
});

describe('NotesPanel completed-task indicator', () => {
  it('renders a compact disabled checkbox without changing the note accessible name', () => {
    const note = {
      id: 'complete-note',
      workspaceId: WORKSPACE_ID,
      title: 'Complete note',
      content: '- [x] [Done](intent://local/task/done-task)',
      tags: [],
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    } as unknown as Note;
    const linkedTask = {
      id: 'done-task',
      workspaceId: WORKSPACE_ID,
      title: 'Done',
      content: '',
      tags: [],
      metadata: { task: { status: 'complete' } },
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    } as unknown as Note;
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([WORKSPACE_ID], { [WORKSPACE_ID]: [note, linkedTask] }),
    );

    render(NotesPanel, { props: { workspaceId: WORKSPACE_ID } });

    expect(screen.getByRole('button', { name: 'Complete note' })).toBeTruthy();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('data-state')).toBe('checked');
    expect(checkbox.hasAttribute('disabled')).toBe(true);
    expect(checkbox.className).toContain('w-3.5');
    expect(checkbox.className).toContain('h-3.5');
  });
});
