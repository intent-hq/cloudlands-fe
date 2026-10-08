import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  NoteDeleteClient,
  NoteDeleteKey,
  NoteDeleteReceipt,
  NoteDeleteStatusResponse,
} from '$lib/client/note-delete';
import type { Note } from '$shared/types';
const control = vi.hoisted(() => ({
  state: {} as any,
  dispatch: vi.fn(),
  prepare: vi.fn(),
  api: {} as any,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => control.state, dispatch: control.dispatch });
});
vi.mock('$lib/client', () => ({
  appClient: {
    notes: {
      get deletion() {
        return control.api;
      },
    },
  },
}));
vi.mock('$features/notes/note-delete-editors', () => ({
  prepareNoteDeleteEditors: control.prepare,
}));
import { store } from '$store/renderer/store';
import {
  workspaceNotesReducer,
  loadWorkspaceNotesSucceeded,
  applyNoteUpdated,
} from '../workspace-notes-slice';
import { noteDeleteSaga } from './note-delete-saga';
import { noteDeleteKey, noteDeleteDraftKey } from '../note-delete-state';
import {
  scheduleNoteDeleteRequested,
  cancelNoteDeleteRequested,
  checkNoteDeleteRequested,
  noteDeleteWorkspaceObserved,
  noteDeleteWorkspaceUnobserved,
  noteDeleteWorkspaceCheckRequested,
  noteDeleteRecoveryRetained,
  noteDeleteInputObserved,
  noteDeleteRecoveryReserved,
  noteDeleteRecoveryDiscarded,
} from '../workspace-notes-slice';
const epoch = 'c0e57cf0-775e-4a25-9e2d-3a8fb076b332';
const identity = { noteInstanceId: 'original', revision: 4, sourceRevision: 'r4' };
const scope = { workspaceId: 'ws', noteId: 'note' };
const getView = () =>
  control.state.workspaceNotes.deleteOperations?.[noteDeleteKey(1, 'ws', 'note')];
let task: Task;
let operation: NoteDeleteReceipt | null;
let tick: number;
let sequence: number;
let exists: boolean;
let callbacks = new Set<(event: any) => void>();
const release = vi.fn();
const current = vi.fn();
const flush = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
function status(request: {
  noteId?: string;
  operationKey?: NoteDeleteKey;
}): NoteDeleteStatusResponse {
  return {
    epoch,
    serverTickMs: tick,
    sequence,
    current: request.noteId && exists ? identity : null,
    pending:
      operation &&
      (operation.state === 'PENDING' ||
        operation.state === 'COMMITTING' ||
        operation.state === 'OUTCOME_UNKNOWN')
        ? [
            {
              operationKey: operation.operationKey,
              noteId: 'note',
              noteInstanceId: 'original',
              state: operation.state,
              sequence,
              deadlineTickMs: operation.deadlineTickMs,
              deleteAt: operation.deleteAt,
              canCancel: operation.state === 'PENDING',
            },
          ]
        : [],
    operation: request.operationKey
      ? (operation ?? {
          operationKey: request.operationKey,
          state: 'UNKNOWN',
          reason: 'unavailable',
        })
      : null,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  operation = null;
  tick = 1000;
  sequence = 0;
  exists = true;
  callbacks = new Set();
  control.state = {
    daemonHealth: { connectionGeneration: 1 },
    notePages: { byWorkspaceId: {} },
    workspaceNotes: workspaceNotesReducer(
      undefined,
      loadWorkspaceNotesSucceeded(['ws'], {
        ws: [
          {
            id: 'note',
            workspaceId: 'ws',
            title: 'Slim',
            content: '',
            contentLength: 9000,
            rev: 4,
          } as Note,
        ],
      }),
    ),
  };
  current.mockReturnValue(true);
  control.prepare.mockReset().mockResolvedValue({ current, release });
  control.api = {
    capability: vi.fn().mockResolvedValue(true),
    status: vi.fn(async (request) => status(request)),
    schedule: vi.fn(async (request) => {
      operation = {
        ...scope,
        operationKey: request.operationKey,
        noteInstanceId: 'original',
        state: 'PENDING',
        sequence: ++sequence,
        deadlineTickMs: tick + 15000,
        deleteAt: '2026-10-08T16:00:00Z',
        expiresTickMs: null,
        reason: null,
      };
      return { epoch, serverTickMs: tick, sequence, operation };
    }),
    cancel: vi.fn(async () => {
      operation = {
        ...operation!,
        state: 'CANCELLED',
        sequence: ++sequence,
        expiresTickMs: tick + 300000,
        reason: 'cancelled',
      };
      return { epoch, serverTickMs: tick, sequence, operation };
    }),
    subscribe: vi.fn((_ws, callback) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    }),
    onReconnected: vi.fn(() => () => {}),
  } satisfies NoteDeleteClient;
  const channel = stdChannel();
  control.dispatch.mockImplementation((action) => {
    if (action.asyncActionType === 'workspaceNotes/settleNoteContentRequested') {
      action.success(undefined);
      return;
    }
    control.state.workspaceNotes = workspaceNotesReducer(control.state.workspaceNotes, action);
    channel.put(action);
  });
  task = runSaga(
    { channel, dispatch: control.dispatch, getState: () => control.state },
    noteDeleteSaga,
  );
});
afterEach(async () => {
  task.cancel();
  await task.toPromise();
  await flush();
  vi.useRealTimers();
});
it('settles editors before scheduling an exact authoritative identity without any body read', async () => {
  const result = await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  expect(control.prepare).toHaveBeenCalledWith(
    expect.objectContaining({ backendGeneration: 1, ...scope }),
  );
  expect(current).toHaveBeenCalledWith('original');
  expect(control.api.schedule).toHaveBeenCalledWith(
    expect.objectContaining({
      ...scope,
      ...{
        noteInstanceId: 'original',
        expectedVersion: 4,
        sourceRevision: 'r4',
        undoDelayMs: 15000,
      },
    }),
  );
  expect(result).toMatchObject({ phase: 'pending', hidden: true, held: true });
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note.content).toBe('');
  expect(release).toHaveBeenCalledTimes(1);
});
it('flush failure preserves the note and never schedules', async () => {
  control.prepare.mockRejectedValue(new Error('strict conflict'));
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    'strict conflict',
  );
  expect(control.api.schedule).not.toHaveBeenCalled();
  expect(getView()).toMatchObject({ held: false, hidden: false, phase: 'failed' });
});
it('capability absence fails closed without a destructive fallback', async () => {
  control.api.capability.mockResolvedValue(false);
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    /unavailable/,
  );
  expect(control.api.status).not.toHaveBeenCalled();
  expect(control.api.schedule).not.toHaveBeenCalled();
  expect(getView().hidden).toBe(false);
});
it('an identity change after editor flush aborts before schedule', async () => {
  current.mockImplementation((instance?: string) => instance !== 'original');
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    /changed/,
  );
  expect(control.api.schedule).not.toHaveBeenCalled();
});
it('lost schedule acknowledgement retains one immutable key and reconciles rather than rescheduling', async () => {
  const schedule = control.api.schedule.getMockImplementation();
  control.api.schedule.mockImplementation(async (request: any) => {
    await schedule(request);
    throw new Error('lost ack');
  });
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    'lost ack',
  );
  const key = getView().request.operationKey;
  expect(getView()).toMatchObject({ phase: 'uncertain', held: true, hidden: false });
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    /pending/,
  );
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(control.api.schedule).toHaveBeenCalledTimes(1);
  expect(control.api.status).toHaveBeenLastCalledWith({ ...scope, operationKey: key });
  expect(getView()).toMatchObject({ phase: 'pending', hidden: true, canCancel: true });
});
it('confirmed Undo cancels the same operation and retains the original row', async () => {
  const original = control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note;
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  const key = getView().receipt.operationKey;
  await store.dispatch(cancelNoteDeleteRequested('ws', 'note'));
  expect(control.api.cancel).toHaveBeenCalledWith({ ...scope, operationKey: key });
  expect(getView()).toMatchObject({ phase: 'cancelled', held: false, hidden: false });
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note).toEqual(original);
});
it('expired UI authority never sends a cancellation or invents deletion success', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  await vi.advanceTimersByTimeAsync(15001);
  await expect(store.dispatch(cancelNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    /no longer/,
  );
  expect(control.api.cancel).not.toHaveBeenCalled();
  expect(getView().phase).toBe('pending');
});
it('snapshot absence cannot display a possibly deleted cached row', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  operation = null;
  exists = false;
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(getView()).toBeUndefined();
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note).toBeUndefined();
});
it('coalesces event bursts into bounded snapshots and unsubscribes on unmount', async () => {
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(51);
  expect(control.api.subscribe).toHaveBeenCalledTimes(1);
  expect(control.api.status).toHaveBeenCalledTimes(1);
  for (let n = 0; n < 1000; n++)
    for (const callback of callbacks) callback({ epoch, sequence: n + 1 });
  await vi.advanceTimersByTimeAsync(51);
  expect(control.api.status).toHaveBeenCalledTimes(2);
  store.dispatch(noteDeleteWorkspaceUnobserved('ws', 'panel'));
  expect(callbacks.size).toBe(0);
});
it('keeps physical schedule admission until a lost-owner request settles', async () => {
  let resolve!: (value: unknown) => void;
  control.api.schedule.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  const failedFirst = expect(first).rejects.toThrow(/backend changed/);
  await flush();
  control.state.daemonHealth.connectionGeneration = 2;
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    /pending/,
  );
  resolve({
    epoch,
    serverTickMs: tick,
    sequence: 1,
    operation: {
      ...scope,
      operationKey: getView().request.operationKey,
      noteInstanceId: 'original',
      state: 'PENDING',
      sequence: 1,
      deadlineTickMs: tick + 15000,
      deleteAt: '2026-10-08T16:00:00Z',
      expiresTickMs: null,
      reason: null,
    },
  });
  await failedFirst;
  expect(control.api.schedule).toHaveBeenCalledTimes(1);
  expect(
    control.state.workspaceNotes.deleteOperations[noteDeleteKey(2, 'ws', 'note')],
  ).toBeUndefined();
});
it('does not treat a historical cancellation as authority to reveal a newer active operation', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  const old = operation!;
  control.api.cancel.mockImplementation(async () => {
    const cancelled = {
      ...old,
      state: 'CANCELLED',
      sequence: ++sequence,
      expiresTickMs: tick + 300000,
      reason: 'cancelled',
    };
    operation = {
      ...old,
      operationKey: { ...old.operationKey, nonce: 'fb7e1bd2-e7b5-42b2-9d24-f3a8fc126114' },
      sequence: ++sequence,
    };
    control.api.status.mockImplementation(async (request: any) => ({
      ...status(request),
      operation: cancelled,
    }));
    return { epoch, serverTickMs: tick, sequence, operation: cancelled };
  });
  await expect(store.dispatch(cancelNoteDeleteRequested('ws', 'note'))).rejects.toThrow(
    /not confirmed/,
  );
  expect(getView()).toMatchObject({ hidden: true, held: true, phase: 'pending' });
});
it('bounds recovery polling and leaves uncertain state for explicit Check status', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  control.api.status.mockRejectedValue(new Error('offline'));
  control.api.status.mockClear();
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(control.api.status).toHaveBeenCalledTimes(3);
  expect(getView()).toMatchObject({ hidden: true, held: true, canCancel: false });
  await vi.advanceTimersByTimeAsync(60000);
  expect(control.api.status).toHaveBeenCalledTimes(3);
});

it.each(['cancelled', 'deleted'] as const)(
  'reconciles another authorized caller deletion after it is %s without reading a foreign receipt',
  async (outcome) => {
    const remoteKey = {
      epoch,
      issuedTickMs: tick,
      nonce: 'f87474b1-a044-4aa0-a4e2-d4ef47940f62',
    };
    operation = {
      ...scope,
      operationKey: remoteKey,
      noteInstanceId: 'original',
      state: 'PENDING',
      sequence: ++sequence,
      deadlineTickMs: tick + 15000,
      deleteAt: '2026-10-08T16:00:00Z',
      expiresTickMs: null,
      reason: null,
    };
    control.api.status.mockImplementation(async (request: any) => {
      if (request.operationKey) throw new Error('FORBIDDEN: receipt belongs to caller A');
      const response = status(request);
      return {
        ...response,
        pending: response.pending.map((marker) => ({ ...marker, canCancel: false })),
      };
    });
    // Caller B can observe current-note state but cannot read caller A's receipt.
    store.dispatch(noteDeleteWorkspaceObserved('ws', 'caller-b'));
    await vi.advanceTimersByTimeAsync(51);
    expect(getView()).toMatchObject({ held: true, hidden: true, canCancel: false });
    expect(control.api.schedule).not.toHaveBeenCalled();
    await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
    operation = null;
    exists = outcome === 'cancelled';
    sequence++;
    await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
    expect(control.api.status.mock.calls.every(([request]: any[]) => !request.operationKey)).toBe(
      true,
    );
    expect(control.api.cancel).not.toHaveBeenCalled();
    if (outcome === 'cancelled') {
      expect(getView()).toMatchObject({ held: false, hidden: false });
      expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note.id).toBe('note');
    } else {
      expect(getView()).toBeUndefined();
      expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note).toBeUndefined();
    }
  },
);

it('keeps a cancelled note held until canonical slim metadata reaches the confirmed revision', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  operation = {
    ...operation!,
    state: 'CANCELLED',
    sequence: ++sequence,
    expiresTickMs: tick + 300000,
    reason: 'cancelled',
  };
  control.api.status.mockImplementation(async (request: any) => ({
    ...status(request),
    current: { ...identity, revision: 5, sourceRevision: 'r5' },
  }));
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note.rev).toBe(4);
  expect(getView()).toMatchObject({ held: true, hidden: true, canCancel: false });
  store.dispatch(
    applyNoteUpdated('ws', 'note', {
      ...control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note,
      title: 'Changed during grace',
      rev: 5,
    }),
  );
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(getView()).toMatchObject({ held: false, hidden: false, canCancel: false });
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note).toMatchObject({
    title: 'Changed during grace',
    rev: 5,
    content: '',
  });
  expect(control.api.schedule).toHaveBeenCalledTimes(1);
});

it('retains owned receipt authority after cancellation becomes unavailable during commit', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  const ownedKey = operation!.operationKey;
  operation = { ...operation!, state: 'COMMITTING', sequence: ++sequence };
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  control.api.status.mockClear();
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(control.api.status).toHaveBeenCalledWith({ ...scope, operationKey: ownedKey });
  expect(control.api.cancel).not.toHaveBeenCalled();
});

it('learns caller receipt ownership from public canCancel and retains it during commit', async () => {
  const ownedKey = { epoch, issuedTickMs: tick, nonce: 'ec25ff6c-d65f-4796-a1f4-70ea0c76ec7c' };
  operation = {
    ...scope,
    operationKey: ownedKey,
    noteInstanceId: 'original',
    state: 'PENDING',
    sequence: ++sequence,
    deadlineTickMs: tick + 15000,
    deleteAt: '2026-10-08T16:00:00Z',
    expiresTickMs: null,
    reason: null,
  };
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'restored-panel'));
  await vi.advanceTimersByTimeAsync(51);
  expect(getView()).toMatchObject({ canCancel: true, held: true, hidden: true });
  expect(control.api.status).toHaveBeenCalledWith(scope);
  operation = { ...operation, state: 'COMMITTING', sequence: ++sequence };
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(getView()).toMatchObject({ canCancel: false, held: true, hidden: true });
  control.api.status.mockClear();
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(control.api.status).toHaveBeenCalledWith({ ...scope, operationKey: ownedKey });
  expect(control.api.schedule).not.toHaveBeenCalled();
});

it('coalesces a canonical metadata push into fresh authority before releasing a stale-row hold', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  operation = {
    ...operation!,
    state: 'CANCELLED',
    sequence: ++sequence,
    expiresTickMs: tick + 300000,
    reason: 'cancelled',
  };
  control.api.status.mockImplementation(async (request: any) => ({
    ...status(request),
    current: request.noteId ? { ...identity, revision: 5, sourceRevision: 'r5' } : null,
  }));
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'metadata-panel'));
  await vi.advanceTimersByTimeAsync(51);
  expect(getView()).toMatchObject({ held: true, hidden: true });
  control.api.status.mockClear();
  store.dispatch(
    applyNoteUpdated('ws', 'note', {
      ...control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note,
      title: 'Current metadata',
      rev: 5,
    }),
  );
  for (let n = 0; n < 20; n++) (store as typeof store & { emitState(): void }).emitState();
  expect(getView()).toMatchObject({ held: true, hidden: true });
  await vi.advanceTimersByTimeAsync(51);
  expect(getView()).toMatchObject({ held: false, hidden: false });
  expect(control.api.status).toHaveBeenCalledTimes(2);
  expect(control.api.status).toHaveBeenCalledWith({ workspaceId: 'ws' });
  expect(control.api.status).toHaveBeenCalledWith({
    ...scope,
    operationKey: operation!.operationKey,
  });
});

const registrationRefusal = () =>
  Object.assign(new Error('Registration capacity exhausted'), {
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
it('pauses typed registration refusal without changing the pending identity, hold or recovery draft', async () => {
  const pending = await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  const draft = {
    backendGeneration: 1,
    ...scope,
    ownerId: 'editor',
    content: 'unsaved',
    baseContent: 'original',
    rev: 4,
  };
  store.dispatch(noteDeleteRecoveryRetained(draft));
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(51);
  control.api.status.mockRejectedValue(registrationRefusal());
  await expect(store.dispatch(checkNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
  expect(getView()).toMatchObject({
    phase: 'pending',
    held: true,
    hidden: true,
    canCancel: false,
    failureCode: 'registration-limit',
    noteInstanceId: pending.noteInstanceId,
    ownedOperation: pending.ownedOperation,
  });
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBe(1);
  const calls = control.api.status.mock.calls.length;
  const capabilities = control.api.capability.mock.calls.length;
  for (let n = 0; n < 3; n++) {
    await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
    await expect(store.dispatch(cancelNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
    store.dispatch(noteDeleteInputObserved(draft));
    for (const callback of callbacks) callback({ epoch, sequence: ++sequence });
  }
  await vi.advanceTimersByTimeAsync(60000);
  expect(control.api.status).toHaveBeenCalledTimes(calls);
  expect(control.api.capability).toHaveBeenCalledTimes(capabilities);
  expect(control.api.schedule).toHaveBeenCalledTimes(1);
  expect(control.api.cancel).not.toHaveBeenCalled();
  expect(control.state.workspaceNotes.deleteRecoveryDrafts[noteDeleteDraftKey(draft)]).toEqual(
    draft,
  );
});
it('does not infer admission exhaustion from an error message', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  control.api.status.mockReset().mockRejectedValue(new Error('NOTE_DELETE_REGISTRATION_LIMIT'));
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(control.api.status).toHaveBeenCalledTimes(3);
  expect(control.state.workspaceNotes.deleteObservationPaused?.ws).toBeUndefined();
  expect(getView().failureCode).not.toBe('registration-limit');
});
it('keeps a pre-schedule refusal visible and never issues a destructive request', async () => {
  control.api.status.mockRejectedValue({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
    message: 'native refusal',
  });
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
  expect(getView()).toMatchObject({
    hidden: false,
    held: false,
    failureCode: 'registration-limit',
  });
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note.id).toBe('note');
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
  expect(control.api.status).toHaveBeenCalledTimes(1);
  expect(control.api.schedule).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(1);
});
it('re-evaluates on reconnect without refunding a hold or retrying a repeated refusal', async () => {
  const pending = await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(51);
  control.api.status.mockRejectedValue(registrationRefusal());
  await expect(store.dispatch(checkNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
  const reconnect = control.api.onReconnected.mock.calls[0][0];
  const calls = control.api.status.mock.calls.length;
  reconnect();
  expect(getView()).toMatchObject({
    held: true,
    hidden: true,
    ownedOperation: pending.ownedOperation,
  });
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(control.api.status).toHaveBeenCalledTimes(calls + 1);
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBe(1);
  control.api.status.mockImplementation(async (request: any) => status(request));
  reconnect();
  // Reconnect alone cannot certify the deletion outcome or credit availability.
  expect(getView().held).toBe(true);
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBe(1);
  await vi.advanceTimersByTimeAsync(51);
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBeUndefined();
  expect(getView()).toMatchObject({
    phase: 'pending',
    held: true,
    hidden: true,
    ownedOperation: pending.ownedOperation,
  });
  expect(getView().failureCode).toBeUndefined();
});
it('does not let an old connection refusal pause the new connection', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  let rejectOld!: (reason: unknown) => void;
  control.api.status.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(51);
  control.state.daemonHealth.connectionGeneration = 2;
  (store as unknown as { emitState(): void }).emitState();
  rejectOld(registrationRefusal());
  await flush();
  expect(control.state.workspaceNotes.deleteObservationPaused?.ws).not.toBe(2);
  await vi.advanceTimersByTimeAsync(51);
  expect(
    control.state.workspaceNotes.deleteOperations[noteDeleteKey(2, 'ws', 'note')],
  ).toMatchObject({ held: true, hidden: true });
  expect(control.state.workspaceNotes.deleteObservationPaused?.ws).not.toBe(2);
});
it('drops a coalesced self-retry when the in-flight observation hits the registration limit', async () => {
  let reject!: (reason: unknown) => void;
  control.api.status.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(51);
  for (const callback of callbacks) callback({ epoch, sequence: 3 });
  reject(registrationRefusal());
  await flush();
  await vi.advanceTimersByTimeAsync(60000);
  expect(control.api.status).toHaveBeenCalledTimes(1);
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBe(1);
});

it('retires paused preparation after authoritative lifecycle recovery without leaving the note busy', async () => {
  control.api.status.mockRejectedValue(registrationRefusal());
  await expect(store.dispatch(scheduleNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
  control.api.status.mockImplementation(async (request: any) => status(request));
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(51);
  expect(getView()).toMatchObject({ phase: 'failed', held: false, hidden: false });
  expect(getView().failureCode).toBeUndefined();
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBeUndefined();
  expect(control.api.schedule).not.toHaveBeenCalled();
});

it('allows one coalesced explicit admission check while paused and recovers after capacity is available', async () => {
  const pending = await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  control.api.status.mockRejectedValue(registrationRefusal());
  await expect(store.dispatch(checkNoteDeleteRequested('ws', 'note'))).rejects.toThrow();
  let rejectCheck!: (reason: unknown) => void;
  control.api.status.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectCheck = reject;
      }),
  );
  const before = control.api.status.mock.calls.length;
  const checks = [
    store.dispatch(checkNoteDeleteRequested('ws', 'note')),
    store.dispatch(checkNoteDeleteRequested('ws', 'note')),
  ];
  const settled = Promise.allSettled(checks);
  await flush();
  expect(control.api.status).toHaveBeenCalledTimes(before + 1);
  rejectCheck(registrationRefusal());
  expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected']);
  await vi.advanceTimersByTimeAsync(60000);
  expect(control.api.status).toHaveBeenCalledTimes(before + 1);
  expect(getView()).toMatchObject({
    held: true,
    hidden: true,
    ownedOperation: pending.ownedOperation,
    failureCode: 'registration-limit',
  });
  control.api.status.mockImplementation(async (request: any) => status(request));
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBeUndefined();
  expect(getView()).toMatchObject({
    held: true,
    hidden: true,
    ownedOperation: pending.ownedOperation,
  });
  expect(getView().failureCode).toBeUndefined();
  expect(control.api.schedule).toHaveBeenCalledTimes(1);
});
it('coalesces workspace manual admission checks without restarting automatic retry after another refusal', async () => {
  control.api.status.mockRejectedValue(registrationRefusal());
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
  await vi.advanceTimersByTimeAsync(51);
  expect(control.api.status).toHaveBeenCalledTimes(1);
  let rejectCheck!: (reason: unknown) => void;
  control.api.status.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectCheck = reject;
      }),
  );
  store.dispatch(noteDeleteWorkspaceCheckRequested('ws'));
  store.dispatch(noteDeleteWorkspaceCheckRequested('ws'));
  expect(control.state.workspaceNotes.deleteObservationChecking.ws).toBe(1);
  await vi.advanceTimersByTimeAsync(51);
  store.dispatch(noteDeleteWorkspaceCheckRequested('ws'));
  expect(control.api.status).toHaveBeenCalledTimes(2);
  rejectCheck(registrationRefusal());
  await flush();
  expect(control.state.workspaceNotes.deleteObservationChecking.ws).toBeUndefined();
  expect(control.state.workspaceNotes.deleteObservationPaused.ws).toBe(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(control.api.status).toHaveBeenCalledTimes(2);
});

it('does not let a retired observation clear a replacement observation busy state', async () => {
  const rejections: Array<(reason: unknown) => void> = [];
  control.api.status.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejections.push(reject);
      }),
  );
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'old-panel'));
  await vi.advanceTimersByTimeAsync(51);
  store.dispatch(noteDeleteWorkspaceUnobserved('ws', 'old-panel'));
  store.dispatch(noteDeleteWorkspaceObserved('ws', 'new-panel'));
  await vi.advanceTimersByTimeAsync(51);
  expect(control.api.status).toHaveBeenCalledTimes(2);
  rejections[0](registrationRefusal());
  await flush();
  expect(control.state.workspaceNotes.deleteObservationChecking.ws).toBe(1);
  store.dispatch(noteDeleteWorkspaceCheckRequested('ws'));
  expect(control.api.status).toHaveBeenCalledTimes(2);
  rejections[1](registrationRefusal());
  await flush();
  expect(control.state.workspaceNotes.deleteObservationChecking.ws).toBeUndefined();
});

// Terminal retirement must preserve unresolved work, rather than spend its finite slots.
it.each([257, 1025])(
  'does not charge %i confirmed absent deletions to unresolved operation limits',
  async (count) => {
    const pending = await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
    const draft = {
      backendGeneration: 1,
      ...scope,
      ownerId: 'recovery-owner',
      content: 'retained draft',
      baseContent: 'strict base',
      rev: 4,
    };
    store.dispatch(noteDeleteRecoveryRetained(draft));
    const receipts = new Map<string, NoteDeleteReceipt>();
    control.api.schedule.mockImplementation(async (request: any) => {
      const receipt: NoteDeleteReceipt = {
        workspaceId: request.workspaceId,
        noteId: request.noteId,
        noteInstanceId: request.noteInstanceId,
        operationKey: request.operationKey,
        state: 'DELETED',
        sequence: ++sequence,
        deadlineTickMs: tick,
        deleteAt: '2026-10-08T16:00:00Z',
        expiresTickMs: tick + 300000,
        reason: null,
      };
      receipts.set(request.noteId, receipt);
      return { epoch, serverTickMs: tick, sequence, operation: receipt };
    });
    control.api.status.mockImplementation(async (request: any) => {
      if (!request.noteId || request.noteId === 'note') return status(request);
      const receipt = receipts.get(request.noteId);
      return {
        epoch,
        serverTickMs: tick,
        sequence,
        current: receipt
          ? null
          : { noteInstanceId: 'instance-' + request.noteId, revision: 4, sourceRevision: 'r4' },
        pending: [],
        operation: request.operationKey ? receipt : null,
      };
    });
    for (let n = 0; n < count; n++) {
      const noteId = 'finished-' + n;
      store.dispatch(
        applyNoteUpdated(
          'ws',
          noteId,
          { id: noteId, workspaceId: 'ws', title: noteId, content: '', rev: 4 } as Note,
          control.state.workspaceNotes.byWorkspaceId.ws.deleteReadAuthority,
        ),
      );
      if (n === 0) {
        const owner = { ...draft, noteId };
        store.dispatch(noteDeleteRecoveryReserved(owner, true));
        store.dispatch(noteDeleteRecoveryRetained(owner));
      }
      await store.dispatch(scheduleNoteDeleteRequested('ws', noteId));
      await store.dispatch(checkNoteDeleteRequested('ws', noteId));
    }
    store.dispatch(noteDeleteWorkspaceObserved('ws', 'panel'));
    await vi.advanceTimersByTimeAsync(51);
    expect(control.state.workspaceNotes.deleteObservationErrors?.ws).toBeUndefined();
    expect(
      control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')],
    ).toMatchObject({ held: true, hidden: true, ownedOperation: pending.ownedOperation });
    expect(control.state.workspaceNotes.deleteRecoveryDrafts[noteDeleteDraftKey(draft)]).toEqual(
      draft,
    );
    expect(Object.keys(control.state.workspaceNotes.deleteOperations).length).toBeLessThan(256);
    expect(
      control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'finished-0')],
    ).toMatchObject({ held: true, hidden: true, terminalAbsent: expect.anything() });
    expect(
      control.state.workspaceNotes.deleteRecoveryDrafts[
        noteDeleteDraftKey({ ...draft, noteId: 'finished-0' })
      ].content,
    ).toBe(draft.content);
  },
);

it('does not retire historical DELETED receipts when targeted status names a replacement', async () => {
  const send = control.api.schedule.getMockImplementation();
  control.api.schedule.mockImplementation(async (request: any) => {
    const result = await send(request);
    operation = { ...result.operation, state: 'DELETED', sequence: ++sequence };
    control.api.status.mockImplementation(async (request: any) => ({
      ...status(request),
      current: { ...identity, noteInstanceId: 'replacement' },
      pending: [],
    }));
    return { epoch, serverTickMs: tick, sequence, operation };
  });
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  expect(getView()).toMatchObject({ held: true, hidden: true, failureCode: 'replaced' });
  expect(getView().terminalAbsent).toBeUndefined();
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note).toBeDefined();
});
it('keeps an absence unresolved while a physical committing operation still exists', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  operation = { ...operation!, state: 'COMMITTING', sequence: ++sequence };
  exists = false;
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(getView()).toMatchObject({ held: true, hidden: true, phase: 'uncertain' });
  expect(getView().terminalAbsent).toBeUndefined();
});
it('waits for a cancellation physical promise before retiring independently confirmed absence', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  let finishCancel!: (result: any) => void;
  control.api.cancel.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishCancel = resolve;
      }),
  );
  const cancellation = store.dispatch(cancelNoteDeleteRequested('ws', 'note'));
  const cancellationSettled = cancellation.catch(() => undefined);
  await flush();
  operation = { ...operation!, state: 'DELETED', sequence: ++sequence };
  exists = false;
  try {
    await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
    expect(getView()?.terminalAbsent).toBeDefined();
    expect(getView().held).toBe(true);
  } finally {
    finishCancel({ epoch, serverTickMs: tick, sequence, operation });
    await cancellationSettled;
  }
  expect(getView()).toBeUndefined();
});

it('does not consume an absence response after newer canonical metadata appeared during its request', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  let finish!: (result: NoteDeleteStatusResponse) => void;
  control.api.status.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const check = store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  await flush();
  const replacement = {
    id: 'note',
    workspaceId: 'ws',
    title: 'replacement',
    content: 'new text',
    rev: 5,
  } as Note;
  store.dispatch(applyNoteUpdated('ws', 'note', replacement));
  finish({
    epoch,
    serverTickMs: tick,
    sequence: ++sequence,
    current: null,
    pending: [],
    operation: null,
  });
  await check;
  expect(getView()).toMatchObject({ held: true, phase: 'uncertain' });
  expect(getView().terminalAbsent).toBeUndefined();
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note.content).toBe('new text');
});

it('retires a terminal editor pin after the exact reservation and retained draft are both released', async () => {
  await store.dispatch(scheduleNoteDeleteRequested('ws', 'note'));
  const owner = { backendGeneration: 1, ...scope, ownerId: 'editor' };
  store.dispatch(noteDeleteRecoveryReserved(owner, true));
  store.dispatch(noteDeleteRecoveryRetained({ ...owner, content: 'draft', baseContent: 'base' }));
  operation = { ...operation!, state: 'DELETED', sequence: ++sequence };
  exists = false;
  await store.dispatch(checkNoteDeleteRequested('ws', 'note'));
  expect(getView()?.terminalAbsent).toBeDefined();
  const calls = control.api.status.mock.calls.length;
  store.dispatch(noteDeleteRecoveryReserved(owner, false));
  expect(getView().held).toBe(true);
  store.dispatch(noteDeleteRecoveryDiscarded(owner));
  expect(getView()).toBeUndefined();
  expect(control.api.status).toHaveBeenCalledTimes(calls);
});
