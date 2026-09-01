// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

import { store as appStore } from '$store/renderer/store';
import {
  clearWorkspaceNotesForWorkspaces,
  loadWorkspaceNotesSucceeded,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import type { Note } from '$shared/types';

import NotesPanel from './NotesPanel.svelte';

const WORKSPACE_ID = 'notes-panel-toggle-test';
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
  it('renders a compact disabled Toggle without changing the note interaction', async () => {
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

    const onOpenNote = vi.fn();
    render(NotesPanel, { props: { workspaceId: WORKSPACE_ID, onOpenNote } });

    const noteButton = screen.getByRole('button', { name: 'Complete note' });
    const toggle = screen.getByRole('button', { name: 'Complete' });
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(true);

    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(onOpenNote).toHaveBeenLastCalledWith('complete-note');
    onOpenNote.mockClear();
    await fireEvent.click(noteButton);
    expect(onOpenNote).toHaveBeenLastCalledWith('complete-note');
  });
});
