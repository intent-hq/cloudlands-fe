import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { updateTaskNoteStatus } from '$features/tasks/tasks-write-service';
import { notify } from '$lib/components/patterns/notify';
import TaskStatusIndicator from '../TaskStatusIndicator.svelte';

vi.mock('$features/tasks/tasks-write-service', () => ({ updateTaskNoteStatus: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const props = {
  workspaceId: WorkspaceId('ws-status'),
  noteId: NoteId('note-status'),
  status: 'not_started' as const,
};

describe('TaskStatusIndicator selection', () => {
  it('submits the selected identity once and disables changes while pending', async () => {
    let finish!: () => void;
    vi.mocked(updateTaskNoteStatus).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(TaskStatusIndicator, props);
    const trigger = screen.getByRole('combobox', {
      name: m.workspace_taskStatus_change_ariaLabel(),
    });
    await fireEvent.click(trigger);
    expect(
      screen
        .getByRole('option', { name: m.workspace_taskStatus_notStarted_label() })
        .getAttribute('aria-selected'),
    ).toBe('true');
    await fireEvent.pointerUp(
      screen.getByRole('option', { name: m.workspace_taskStatus_complete_label() }),
      { pointerType: 'mouse' },
    );
    expect(updateTaskNoteStatus).toHaveBeenCalledExactlyOnceWith(
      'ws-status',
      'note-status',
      'complete',
    );
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  });

  it('reports a rejected mutation and allows another selection', async () => {
    vi.mocked(updateTaskNoteStatus).mockRejectedValueOnce(new Error('offline'));
    render(TaskStatusIndicator, props);
    const trigger = screen.getByRole('combobox');
    await fireEvent.click(trigger);
    await fireEvent.pointerUp(
      screen.getByRole('option', { name: m.workspace_taskStatus_blocked_label() }),
      { pointerType: 'mouse' },
    );
    await waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not expose a value-changing control in readonly mode', () => {
    render(TaskStatusIndicator, { ...props, readonly: true });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(updateTaskNoteStatus).not.toHaveBeenCalled();
  });
});
