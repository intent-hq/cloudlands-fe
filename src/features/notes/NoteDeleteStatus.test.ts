import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NoteDeleteView } from '$store/renderer/slices/workspace-notes/note-delete-state';
const control = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => control.state, dispatch: control.dispatch });
});
import { store } from '$store/renderer/store';
import NoteDeleteStatus from './NoteDeleteStatus.svelte';
import { noteDeleteKey } from '$store/renderer/slices/workspace-notes/note-delete-state';
import { noteDeleteUiTarget } from './note-delete-ui';
let pending: NoteDeleteView;
const emit = () => (store as unknown as { emitState(): void }).emitState();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  control.dispatch.mockReset();
  pending = {
    backendGeneration: 1,
    workspaceId: 'ws',
    noteId: 'note',
    owner: 'owner',
    phase: 'pending',
    held: true,
    hidden: true,
    canCancel: true,
    deadline: performance.now() + 15000,
    noteInstanceId: 'original',
    receipt: {
      workspaceId: 'ws',
      noteId: 'note',
      noteInstanceId: 'original',
      state: 'PENDING',
      sequence: 1,
      deadlineTickMs: 15000,
      expiresTickMs: null,
      reason: null,
      deleteAt: '2026-10-08T15:00:00Z',
      operationKey: { epoch: 'epoch', nonce: 'nonce', issuedTickMs: 0 },
    },
  };
  control.state = {
    daemonHealth: { connectionGeneration: 1 },
    workspaceNotes: {
      deleteOperations: { [noteDeleteKey(1, 'ws', 'note')]: pending },
    },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('removes expired Undo while retaining reachable status verification for a hidden note', async () => {
  const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(pending) } });
  expect(component.getByRole('button', { name: 'Undo' })).toBeTruthy();
  await vi.advanceTimersByTimeAsync(15000);
  await tick();
  expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
  control.dispatch.mockImplementation((action) => action.success(pending));
  await fireEvent.click(component.getByRole('button', { name: 'Check status' }));
  expect(control.dispatch.mock.calls[0][0]).toMatchObject({
    asyncActionType: 'workspaceNotes/checkNoteDeleteRequested',
    payload: ['ws', 'note'],
  });
  expect(control.dispatch).toHaveBeenCalledTimes(1);
});
it('waits for cancellation acknowledgement and prevents duplicate Undo clicks', async () => {
  let request: any;
  control.dispatch.mockImplementation((action) => {
    request = action;
  });
  const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(pending) } });
  const undo = component.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
  await fireEvent.click(undo);
  expect(undo.disabled).toBe(true);
  await fireEvent.click(undo);
  expect(control.dispatch).toHaveBeenCalledTimes(1);
  const cancelled: NoteDeleteView = {
    ...pending,
    phase: 'cancelled',
    held: false,
    hidden: false,
    canCancel: false,
  };
  control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = cancelled;
  emit();
  request.success(cancelled);
  await tick();
  expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
  expect(control.dispatch.mock.calls[0][0]).toMatchObject({
    asyncActionType: 'workspaceNotes/cancelNoteDeleteRequested',
    payload: ['ws', 'note'],
  });
});
it('retains status access after uncertain cancellation and disables controls for a replaced intent', async () => {
  control.dispatch.mockImplementation((action) =>
    action.failure(new Error('Lost acknowledgement')),
  );
  const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(pending) } });
  await fireEvent.click(component.getByRole('button', { name: 'Undo' }));
  await tick();
  expect(component.getByRole('alert')).toBeTruthy();
  expect(component.getByRole('button', { name: 'Check status' })).toBeTruthy();
  control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = {
    ...pending,
    owner: 'replacement',
  };
  emit();
  await tick();
  expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
  expect(component.queryByRole('button', { name: 'Check status' })).toBeNull();
});

it('keeps verification available for a historical cancellation whose current identity is unresolved', async () => {
  const historical = {
    ...pending,
    phase: 'cancelled' as const,
    held: true,
    hidden: true,
    canCancel: false,
  };
  control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = historical;
  const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(historical) } });
  expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
  control.dispatch.mockImplementation((action) => action.success(historical));
  await fireEvent.click(component.getByRole('button', { name: 'Check status' }));
  expect(control.dispatch.mock.calls[0][0]).toMatchObject({
    asyncActionType: 'workspaceNotes/checkNoteDeleteRequested',
    payload: ['ws', 'note'],
  });
});

it.each([undefined, 'unavailable'] as const)(
  'uses typed capability feedback only for failure code %s',
  (failureCode) => {
    const failed: NoteDeleteView = {
      ...pending,
      phase: 'failed',
      held: false,
      hidden: false,
      canCancel: false,
      failureCode,
      error: 'unavailable',
      receipt: undefined,
    };
    control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = failed;
    const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(failed) } });
    expect(component.getByRole('status').textContent).toBe(
      failureCode === 'unavailable'
        ? 'This backend does not support Undo-safe deletion. The note was kept.'
        : 'Deletion could not be completed. Check status.',
    );
    expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
  },
);

it('retargets the mounted status view when its note changes', async () => {
  const other: NoteDeleteView = {
    ...pending,
    workspaceId: 'other-ws',
    noteId: 'other-note',
    owner: 'other-owner',
    phase: 'failed',
    failureCode: 'unavailable',
    held: false,
    hidden: false,
    canCancel: false,
    receipt: undefined,
  };
  control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'other-ws', 'other-note')] = other;
  const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(pending) } });
  expect(component.getByRole('button', { name: 'Undo' })).toBeTruthy();
  await component.rerender({ target: noteDeleteUiTarget(other) });
  // The selector mock samples readable arguments on state emission.
  emit();
  await tick();
  expect(component.getByRole('status').textContent).toBe(
    'This backend does not support Undo-safe deletion. The note was kept.',
  );
  expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
});

it.each(['cancelled', 'deleted', 'uncertain'] as const)(
  'prioritizes current-note replacement guidance over the historical %s result',
  (phase) => {
    const replaced: NoteDeleteView = {
      ...pending,
      phase,
      failureCode: 'replaced',
      held: true,
      hidden: true,
      canCancel: false,
    };
    control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = replaced;
    const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(replaced) } });
    expect(component.getByRole('status').textContent).toBe(
      'This note was replaced. Reload this window to open the current note.',
    );
    expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(control.dispatch).not.toHaveBeenCalled();
  },
);

it.each(['pending', 'cancelled', 'deleted', 'preparing'] as const)(
  'keeps an explicit busy-guarded check when capacity pause overrides historical %s phase',
  async (phase) => {
    const paused: NoteDeleteView = {
      ...pending,
      phase,
      failureCode: 'registration-limit',
      canCancel: false,
    };
    control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = paused;
    const component = render(NoteDeleteStatus, { props: { target: noteDeleteUiTarget(paused) } });
    const check = component.getByRole('button', { name: 'Check status' }) as HTMLButtonElement;
    expect(check.disabled).toBe(false);
    expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
    let request: any;
    control.dispatch.mockImplementation((action) => {
      request = action;
    });
    await fireEvent.click(check);
    expect(check.disabled).toBe(true);
    await fireEvent.click(check);
    expect(control.dispatch).toHaveBeenCalledTimes(1);
    const rejected = expect(request.promise).rejects.toThrow('still full');
    request.failure(new Error('still full'));
    await rejected;
    await vi.waitFor(() => expect(check.disabled).toBe(false));
    expect(component.queryByRole('button', { name: 'Undo' })).toBeNull();
    control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = pending;
    emit();
    await tick();
    expect(component.getByRole('button', { name: 'Undo' })).toBeTruthy();
  },
);
