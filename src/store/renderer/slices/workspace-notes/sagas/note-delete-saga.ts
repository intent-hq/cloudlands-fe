import { call, take, takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import { prepareNoteDeleteEditors } from '$features/notes/note-delete-editors';
import { noteDeleteKey, type NoteDeleteView } from '../note-delete-state';
import {
  scheduleNoteDeleteRequested,
  cancelNoteDeleteRequested,
  checkNoteDeleteRequested,
  noteDeleteViewChanged,
  noteDeleteViewRetired,
  noteDeleteWorkspaceObserved,
  noteDeleteWorkspaceUnobserved,
  noteDeleteInputObserved,
  noteDeleteObservationFailed,
  noteDeleteObservationCheckingChanged,
  noteDeleteWorkspaceCheckRequested,
} from '../workspace-notes-slice';
import { selectNoteById } from '../workspace-notes-selectors';
import { settleNoteContentRequested, applyNoteDeleted } from '../workspace-notes-slice';
import type {
  NoteDeleteClient,
  NoteDeleteReceipt,
  NoteDeleteOperationResponse,
  NoteDeleteStatusResponse,
  NoteDeleteScheduleRequest,
} from '$lib/client/note-delete';

const MAX_OPERATIONS = 1024;
let scheduling = false;
let controls = 0;
const checking = new Map<string, Promise<NoteDeleteView | undefined>>();
const cancelling = new Map<string, Promise<NoteDeleteView>>();
const generation = () => store.state.daemonHealth.connectionGeneration;
const now = () => performance.now();
const current = (view: NoteDeleteView) => generation() === view.backendGeneration;
const lookup = (workspaceId: string, noteId: string) =>
  store.state.workspaceNotes.deleteOperations?.[noteDeleteKey(generation(), workspaceId, noteId)];
function publish(view: NoteDeleteView): NoteDeleteView {
  store.dispatch(noteDeleteViewChanged(view));
  return view;
}
function ownerCurrent(view: NoteDeleteView): boolean {
  return current(view) && lookup(view.workspaceId, view.noteId)?.owner === view.owner;
}
function client(): NoteDeleteClient {
  const value = appClient.notes.deletion;
  if (!value)
    throw new Error('Undo-safe deletion is unavailable on this backend. The note was kept.');
  return value;
}
async function control<T>(work: () => Promise<T>): Promise<T> {
  if (controls >= 4) throw new Error('Note deletion verification is busy. Check status again.');
  controls++;
  try {
    return await work();
  } finally {
    controls--;
  }
}
const registrationLimit = 'NOTE_DELETE_REGISTRATION_LIMIT';
function isRegistrationLimit(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === registrationLimit
  );
}
function workspacePaused(workspaceId: string): boolean {
  return store.state.workspaceNotes.deleteObservationPaused?.[workspaceId] === generation();
}
function requireRegistration(workspaceId: string, view?: NoteDeleteView): void {
  if (workspacePaused(workspaceId) || view?.failureCode === 'registration-limit')
    throw Object.assign(new Error('Note deletion verification is paused.'), {
      code: registrationLimit,
    });
}
function pauseWorkspace(workspaceId: string, backendGeneration: number): void {
  if (generation() !== backendGeneration) return;
  const observation = observations.get(workspaceId);
  if (observation) {
    if (observation.timer) clearTimeout(observation.timer);
    observation.timer = undefined;
    observation.again = false;
    observation.recheck = false;
    if (!observation.running)
      store.dispatch(noteDeleteObservationCheckingChanged(workspaceId, backendGeneration, false));
  }
  store.dispatch(
    noteDeleteObservationFailed(workspaceId, 'Verification paused', {
      backendGeneration,
      paused: true,
    }),
  );
  for (const view of observedViews(workspaceId))
    publish({ ...view, canCancel: false, failureCode: 'registration-limit' });
}
function clearWorkspacePause(workspaceId: string, backendGeneration: number): void {
  if (generation() === backendGeneration)
    store.dispatch(
      noteDeleteObservationFailed(workspaceId, null, { backendGeneration, paused: false }),
    );
}

function receiptView(
  previous: NoteDeleteView,
  result: NoteDeleteOperationResponse,
  started: number,
): NoteDeleteView {
  const operation = result.operation;
  if (operation.state === 'UNKNOWN')
    return {
      ...previous,
      phase: 'uncertain',
      held: true,
      canCancel: false,
      error: 'The deletion outcome is unknown. Check status before making another change.',
    };
  const receipt = operation as NoteDeleteReceipt;
  const pending = receipt.state === 'PENDING';
  const cancelled = receipt.state === 'CANCELLED';
  const deleted = receipt.state === 'DELETED';
  const retained = receipt.state === 'CONFLICT' || receipt.state === 'FAILED';
  return {
    ...previous,
    receipt,
    pending: undefined,
    epoch: result.epoch,
    sequence: result.sequence,
    noteInstanceId: receipt.noteInstanceId,
    phase: pending
      ? 'pending'
      : cancelled
        ? 'cancelled'
        : deleted
          ? 'deleted'
          : retained
            ? 'failed'
            : 'uncertain',
    held: !cancelled && !retained,
    hidden: cancelled || retained ? false : pending || deleted || previous.hidden,
    canCancel: pending,
    deadline: now() + Math.max(0, receipt.deadlineTickMs - result.serverTickMs - (now() - started)),
    settledAt: cancelled || retained ? now() : undefined,
    error: retained
      ? 'Deletion did not complete. The note was kept.'
      : !pending && !cancelled && !deleted
        ? 'Deletion is being verified. Check status.'
        : undefined,
  };
}

/** One physical preparation/schedule at a time, with no awaiting admission queue. */
async function schedule(workspaceId: string, noteId: string): Promise<NoteDeleteView> {
  requireRegistration(workspaceId, lookup(workspaceId, noteId));
  for (const view of Object.values(store.state.workspaceNotes.deleteOperations ?? {}))
    if (
      !view.held &&
      !view.hidden &&
      view.settledAt !== undefined &&
      now() - view.settledAt >= 300000
    )
      store.dispatch(noteDeleteViewRetired(view));
  if (!workspaceId || !noteId || noteId === 'spec') throw new Error('This note cannot be deleted.');
  if (scheduling || lookup(workspaceId, noteId)?.held)
    throw new Error('A note deletion is already pending. Check its status.');
  if (
    Object.keys(store.state.workspaceNotes.deleteOperations ?? {}).length >= MAX_OPERATIONS &&
    !lookup(workspaceId, noteId)
  )
    throw new Error('Too many pending note operations. Check status first.');
  const note = selectNoteById.select(store.state, workspaceId, noteId);
  if (!note) throw new Error('The note is no longer available.');
  scheduling = true;
  let view = publish({
    backendGeneration: generation(),
    workspaceId,
    noteId,
    owner: crypto.randomUUID(),
    phase: 'preparing',
    held: false,
    hidden: false,
    canCancel: false,
  });
  let editors: Awaited<ReturnType<typeof prepareNoteDeleteEditors>> | undefined;
  let issued: NoteDeleteScheduleRequest | undefined;
  let unavailable = false;
  try {
    editors = await prepareNoteDeleteEditors({
      backendGeneration: view.backendGeneration,
      workspaceId,
      noteId,
      noteInstanceId:
        store.state.notePages?.byWorkspaceId[workspaceId]?.notes[noteId]?.state?.scope
          .noteInstanceId,
    });
    requireRegistration(workspaceId, lookup(workspaceId, noteId));
    unavailable = !appClient.notes.deletion;
    const api = client();
    unavailable = !(await control(() => api.capability()));
    if (unavailable)
      throw new Error('Undo-safe deletion is unavailable on this backend. The note was kept.');
    requireRegistration(workspaceId, lookup(workspaceId, noteId));
    await store.dispatch(settleNoteContentRequested(workspaceId, noteId));
    if (!ownerCurrent(view) || !editors.current())
      throw new Error('The note editor changed before deletion.');
    requireRegistration(workspaceId, lookup(workspaceId, noteId));
    const context = await control(() => api.status({ workspaceId, noteId }));
    const selected = selectNoteById.select(store.state, workspaceId, noteId);
    if (
      !ownerCurrent(view) ||
      !context.current ||
      !editors.current(context.current.noteInstanceId) ||
      !selected
    )
      throw new Error('The note changed before deletion.');
    if (context.pending.length) {
      view = publish({
        ...view,
        noteInstanceId: context.current.noteInstanceId,
        pending: context.pending[0],
        phase: 'uncertain',
        held: true,
      });
      await reconcile(workspaceId, noteId);
      throw new Error('This note already has a pending deletion. Check status.');
    }
    if (selected.rev !== context.current.revision)
      throw new Error('The note changed before deletion.');
    const paged = store.state.notePages?.byWorkspaceId[workspaceId]?.notes[noteId];
    if (paged?.state?.scope && paged.state.scope.noteInstanceId !== context.current.noteInstanceId)
      throw new Error('The note identity changed before deletion.');
    issued = {
      workspaceId,
      noteId,
      noteInstanceId: context.current.noteInstanceId,
      expectedVersion: context.current.revision,
      sourceRevision: context.current.sourceRevision,
      operationKey: {
        epoch: context.epoch,
        issuedTickMs: context.serverTickMs,
        nonce: crypto.randomUUID(),
      },
      undoDelayMs: 15000,
    };
    // Preserve the key before sending. A lost acknowledgement must not mint a new intent.
    view = publish({
      ...view,
      noteInstanceId: issued.noteInstanceId,
      request: issued,
      ownedOperation: {
        backendGeneration: view.backendGeneration,
        operationKey: issued.operationKey,
      },
    });
    requireRegistration(workspaceId, lookup(workspaceId, noteId));
    const started = now();
    const response = await control(() => api.schedule(issued!));
    if (!ownerCurrent(view))
      throw new Error('The backend changed while deletion was being confirmed.');
    view = receiptView(view, response, started);
    if (view.phase === 'cancelled' || view.phase === 'failed') view.hidden = false;
    publish(view);
    if (view.phase === 'deleted') store.dispatch(applyNoteDeleted(workspaceId, noteId));
    return view;
  } catch (error) {
    if (isRegistrationLimit(error)) {
      pauseWorkspace(workspaceId, view.backendGeneration);
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    // Once sent, even a rejected replay cannot prove an earlier operation absent.
    if (ownerCurrent(view)) {
      const latest = lookup(workspaceId, noteId)!;
      view = publish({
        ...latest,
        phase: issued || latest.pending ? 'uncertain' : 'failed',
        held: !!issued || !!latest.pending,
        canCancel: false,
        error: message,
        failureCode: unavailable ? 'unavailable' : undefined,
        settledAt: issued || latest.pending ? undefined : now(),
      });
    }
    throw error;
  } finally {
    editors?.release(); // Component domain hold remains authoritative after local preparation ends.
    scheduling = false;
  }
}

async function reconcile(
  workspaceId: string,
  noteId: string,
  recheck = false,
): Promise<NoteDeleteView | undefined> {
  const prior = lookup(workspaceId, noteId);
  if (!prior) return undefined;
  if (!recheck) requireRegistration(workspaceId, prior);
  const key = noteDeleteKey(prior.backendGeneration, workspaceId, noteId);
  const existing = checking.get(key);
  if (existing) return existing;
  const work = (async () => {
    const api = client();
    const started = now();
    const status: NoteDeleteStatusResponse = await control(() =>
      api.status({
        workspaceId,
        noteId,
        ...(prior.ownedOperation?.backendGeneration === prior.backendGeneration
          ? { operationKey: prior.ownedOperation.operationKey }
          : {}),
      }),
    );
    if (!ownerCurrent(prior)) return lookup(workspaceId, noteId);
    if (
      prior.epoch === status.epoch &&
      (lookup(workspaceId, noteId)?.sequence ?? 0) > status.sequence
    )
      return lookup(workspaceId, noteId);
    let view = status.operation
      ? receiptView(prior, { ...status, operation: status.operation }, started)
      : prior;
    if (view.failureCode === 'registration-limit')
      view = { ...view, failureCode: undefined, error: undefined };
    clearWorkspacePause(workspaceId, prior.backendGeneration);
    // Snapshot absence alone never restores a cached row: this is a targeted current identity read.
    if (!status.current) {
      store.dispatch(applyNoteDeleted(workspaceId, noteId));
      view = { ...view, held: true, hidden: true, canCancel: false };
    } else if (prior.noteInstanceId && status.current.noteInstanceId !== prior.noteInstanceId) {
      view = {
        ...view,
        held: true,
        hidden: true,
        canCancel: false,
        failureCode: 'replaced',
        error:
          'The original note is no longer current. Reload this window to open the current note.',
      };
    } else if (status.pending.length === 0) {
      const canonical = selectNoteById.select(store.state, workspaceId, noteId);
      const pageScope =
        store.state.notePages?.byWorkspaceId[workspaceId]?.notes[noteId]?.state?.scope;
      const converged =
        canonical &&
        String(canonical.id) === noteId &&
        canonical.workspaceId === workspaceId &&
        canonical.rev === status.current.revision &&
        (!pageScope || pageScope.noteInstanceId === status.current.noteInstanceId);
      view = {
        ...view,
        noteInstanceId: status.current.noteInstanceId,
        phase: view.phase === 'preparing' ? 'failed' : view.phase,
        held: !converged,
        hidden: converged ? false : prior.hidden,
        canCancel: false,
        pending: undefined,
        waitingForSlimRevision: converged ? undefined : status.current.revision,
        error: converged
          ? undefined
          : 'Waiting for current note metadata. Check status after it arrives.',
      };
    } else {
      const pending = status.pending[0];
      view = {
        ...view,
        pending,
        waitingForSlimRevision: undefined,
        ownedOperation: pending.canCancel
          ? { backendGeneration: prior.backendGeneration, operationKey: pending.operationKey }
          : view.ownedOperation,
        noteInstanceId: status.current.noteInstanceId,
        phase: pending.state === 'PENDING' ? 'pending' : 'uncertain',
        held: true,
        hidden: true,
        canCancel: pending.state === 'PENDING' && pending.canCancel,
        deadline:
          now() + Math.max(0, pending.deadlineTickMs - status.serverTickMs - (now() - started)),
      };
    }
    return publish({ ...view, epoch: status.epoch, sequence: status.sequence });
  })();
  checking.set(key, work);
  try {
    return await work;
  } catch (error) {
    if (isRegistrationLimit(error)) pauseWorkspace(workspaceId, prior.backendGeneration);
    throw error;
  } finally {
    if (checking.get(key) === work) checking.delete(key);
  }
}
async function cancel(workspaceId: string, noteId: string): Promise<NoteDeleteView> {
  const prior = lookup(workspaceId, noteId);
  requireRegistration(workspaceId, prior);
  const key = noteDeleteKey(generation(), workspaceId, noteId);
  const existing = cancelling.get(key);
  if (existing) return existing;
  if (
    !(prior?.receipt || prior?.pending) ||
    !prior.canCancel ||
    prior.deadline === undefined ||
    prior.deadline <= now()
  )
    throw new Error('Undo is no longer available. Check deletion status.');
  const work = (async () => {
    publish({ ...prior, canCancel: false });
    const started = now();
    const response = await control(() =>
      client().cancel({
        workspaceId,
        noteId,
        operationKey: (prior.pending ?? prior.receipt)!.operationKey,
      }),
    );
    if (!ownerCurrent(prior))
      throw new Error('The backend changed while Undo was being confirmed.');
    let view = receiptView(prior, response, started);
    if (view.phase === 'cancelled') {
      // A historical cancellation receipt does not rule out a newer active operation.
      publish({ ...view, hidden: prior.hidden, held: true, canCancel: false });
      view = (await reconcile(workspaceId, noteId)) ?? view;
    } else publish(view);
    if (view.phase !== 'cancelled' || view.held)
      throw new Error(view.error ?? 'Undo was not confirmed. Check status.');
    return view;
  })();
  cancelling.set(key, work);
  try {
    return await work;
  } catch (error) {
    if (isRegistrationLimit(error)) pauseWorkspace(workspaceId, prior.backendGeneration);
    if (ownerCurrent(prior))
      publish({
        ...lookup(workspaceId, noteId)!,
        canCancel: false,
        error: error instanceof Error ? error.message : String(error),
      });
    throw error;
  } finally {
    if (cancelling.get(key) === work) cancelling.delete(key);
  }
}
/** Subscription leases own only callbacks/timers; authoritative markers live in Redux. */
interface Observation {
  workspaceId: string;
  owners: Set<string>;
  api: NoteDeleteClient;
  stop: () => void;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  again: boolean;
  recheck: boolean;
  disposed: boolean;
  attempts: number;
  backendGeneration: number;
  epoch?: string;
  sequence: number;
  notesVersion: number;
}
const observations = new Map<string, Observation>();
function observedViews(workspaceId: string) {
  return Object.values(store.state.workspaceNotes.deleteOperations ?? {}).filter(
    (view) => view.backendGeneration === generation() && view.workspaceId === workspaceId,
  );
}
function invalidate(observation: Observation, freshEvent = false, recheck = false) {
  if (observation.disposed || (workspacePaused(observation.workspaceId) && !recheck)) return;
  if (recheck) observation.recheck = true;
  if (freshEvent) observation.attempts = 0;
  if (observation.running) {
    observation.again = true;
    return;
  }
  if (observation.timer) clearTimeout(observation.timer);
  store.dispatch(noteDeleteObservationCheckingChanged(observation.workspaceId, generation(), true));
  observation.timer = setTimeout(() => {
    observation.timer = undefined;
    void refresh(observation);
  }, 50);
}
async function refresh(observation: Observation) {
  if (observation.disposed || observation.running) return;
  const recheck = observation.recheck;
  observation.recheck = false;
  if (workspacePaused(observation.workspaceId) && !recheck) return;
  observation.running = true;
  observation.again = false;
  const capturedGeneration = generation();
  try {
    if (!(await control(() => observation.api.capability()))) return;
    if (
      observation.disposed ||
      generation() !== capturedGeneration ||
      (workspacePaused(observation.workspaceId) && !recheck)
    )
      return;
    const snapshot = await control(() =>
      observation.api.status({ workspaceId: observation.workspaceId }),
    );
    if (observation.disposed || generation() !== capturedGeneration) return;
    if (observation.epoch === snapshot.epoch && snapshot.sequence < observation.sequence) return;
    observation.epoch = snapshot.epoch;
    observation.sequence = snapshot.sequence;
    // Only previously affected notes and the finite server pending snapshot are reconciled.
    // This is never a per-row query of the note list.
    const affected = new Set(
      observedViews(observation.workspaceId)
        .filter((v) => v.held || v.hidden || v.failureCode === 'registration-limit')
        .map((v) => v.noteId),
    );
    for (const marker of snapshot.pending) {
      if (affected.size >= 256 && !affected.has(marker.noteId))
        throw new Error('Too many unresolved note deletions. Check status.');
      affected.add(marker.noteId);
      if (!lookup(observation.workspaceId, marker.noteId)) {
        if (Object.keys(store.state.workspaceNotes.deleteOperations ?? {}).length >= MAX_OPERATIONS)
          throw new Error('Too many unresolved note deletions. Check status.');
        // Workspace markers can describe a historical incarnation. Do not hide the
        // current row until the targeted current-identity response matches it.
        publish({
          backendGeneration: capturedGeneration,
          workspaceId: observation.workspaceId,
          noteId: marker.noteId,
          noteInstanceId: marker.noteInstanceId,
          owner: crypto.randomUUID(),
          phase: 'uncertain',
          held: true,
          hidden: false,
          canCancel: false,
        });
      }
    }
    if (affected.size > 256) throw new Error('Too many unresolved note deletions. Check status.');
    for (const noteId of affected) {
      if (observation.disposed || generation() !== capturedGeneration) return;
      if (workspacePaused(observation.workspaceId) && !recheck) return;
      await reconcile(observation.workspaceId, noteId, recheck);
    }
    if (observation.disposed || generation() !== capturedGeneration) return;
    observation.attempts = 0;
    clearWorkspacePause(observation.workspaceId, capturedGeneration);
    // One bounded expiry verification. COMMITTING/unknown never becomes a local
    // deletion timer and is never interpreted as successful deletion.
    const deadlines = observedViews(observation.workspaceId)
      .filter((v) => v.canCancel && v.deadline !== undefined && v.deadline > now())
      .map((v) => v.deadline!);
    if (deadlines.length && !observation.again) {
      observation.timer = setTimeout(
        () => {
          observation.timer = undefined;
          invalidate(observation);
        },
        Math.max(1, Math.min(...deadlines) - now()),
      );
    }
  } catch (error) {
    if (observation.disposed || generation() !== capturedGeneration) return;
    if (isRegistrationLimit(error)) {
      pauseWorkspace(observation.workspaceId, capturedGeneration);
      return;
    }
    if (!observation.disposed && generation() === capturedGeneration)
      store.dispatch(
        noteDeleteObservationFailed(
          observation.workspaceId,
          error instanceof Error ? error.message : String(error),
        ),
      );
    for (const view of observedViews(observation.workspaceId).filter((v) => v.held))
      publish({
        ...view,
        canCancel: false,
        error: error instanceof Error ? error.message : String(error),
      });
    // Finite recovery, then a user-visible Check status action. Never mint another intent.
    if (
      ++observation.attempts < 3 &&
      !observation.disposed &&
      !workspacePaused(observation.workspaceId)
    )
      observation.timer = setTimeout(() => {
        observation.timer = undefined;
        invalidate(observation);
      }, 1000);
  } finally {
    observation.running = false;
    if (observations.get(observation.workspaceId) === observation)
      store.dispatch(
        noteDeleteObservationCheckingChanged(observation.workspaceId, capturedGeneration, false),
      );
    if (observation.again && !observation.disposed)
      invalidate(observation, false, observation.recheck);
  }
}
function observe(workspaceId: string, owner: string) {
  const existing = observations.get(workspaceId);
  if (existing) {
    if (existing.owners.size < 256) existing.owners.add(owner);
    return;
  }
  if (!appClient.notes.deletion || observations.size >= 64) return;
  const api = appClient.notes.deletion;
  const observation: Observation = {
    workspaceId,
    owners: new Set([owner]),
    api,
    stop: () => {},
    running: false,
    again: false,
    recheck: true,
    disposed: false,
    attempts: 0,
    backendGeneration: generation(),
    sequence: 0,
    notesVersion: store.state.workspaceNotes.byWorkspaceId[workspaceId]?.notesVersion ?? 0,
  };
  observations.set(workspaceId, observation);
  const offEvent = api.subscribe(workspaceId, (event) => {
    if (event.epoch === observation.epoch && event.sequence <= observation.sequence) return;
    // Coalesce arbitrary event bursts into one authoritative snapshot, no unbounded buffer.
    invalidate(observation, true);
  });
  const reset = () => {
    observation.backendGeneration = generation();
    for (const view of Object.values(store.state.workspaceNotes.deleteOperations ?? {})) {
      if (view.workspaceId !== workspaceId || !(view.held || view.hidden)) continue;
      const replacement = lookup(workspaceId, view.noteId);
      if (!replacement || replacement === view)
        publish({
          ...view,
          backendGeneration: generation(),
          owner: crypto.randomUUID(),
          phase: 'uncertain',
          held: true,
          canCancel: false,
        });
    }
    observation.backendGeneration = generation();
    observation.epoch = undefined;
    observation.sequence = 0;
    invalidate(observation, true, true);
  };
  const offReset = api.onReconnected(reset);
  const offStore = store.getReadableState().subscribe(() => {
    if (observation.backendGeneration !== generation()) {
      reset();
      return;
    }
    const version = store.state.workspaceNotes.byWorkspaceId[workspaceId]?.notesVersion ?? 0;
    if (version !== observation.notesVersion) {
      observation.notesVersion = version;
      if (observedViews(workspaceId).some((view) => view.waitingForSlimRevision !== undefined))
        invalidate(observation, true);
    }
  });
  observation.stop = () => {
    offEvent();
    offReset();
    offStore();
  };
  invalidate(observation, true, true);
}
function unobserve(workspaceId: string, owner: string) {
  const observation = observations.get(workspaceId);
  if (!observation) return;
  observation.owners.delete(owner);
  if (observation.owners.size) return;
  observation.disposed = true;
  if (observation.timer) clearTimeout(observation.timer);
  observation.stop();
  observations.delete(workspaceId);
  store.dispatch(
    noteDeleteObservationCheckingChanged(workspaceId, observation.backendGeneration, false),
  );
  // Empty observation failures have no operation owner once the last view unmounts.
  // Held operation markers keep their pause until authoritative lifecycle recovery.
  if (!observedViews(workspaceId).some((view) => view.failureCode === 'registration-limit'))
    clearWorkspacePause(workspaceId, generation());
  // Unmounting cancels observation, not a daemon operation or a pending physical RPC.
}
export function* noteDeleteSaga() {
  try {
    yield* takeEvery(noteDeleteWorkspaceCheckRequested, function* ({ payload: [workspaceId] }) {
      const observation = observations.get(workspaceId);
      // Explicit checks may try physical admission again after unrelated cleanup.
      // Never queue a second attempt behind a running check.
      if (observation && !observation.running) invalidate(observation, true, true);
    });
    yield* takeEvery(noteDeleteInputObserved, function* ({ payload: [scope] }) {
      if (scope.backendGeneration !== generation()) return;
      const view = lookup(scope.workspaceId, scope.noteId);
      if (!view?.held || view.phase === 'preparing') return;
      try {
        if (view.canCancel) yield* call(cancel, scope.workspaceId, scope.noteId);
        else yield* call(reconcile, scope.workspaceId, scope.noteId);
      } catch {
        /* The retained draft and operation's Check status UI remain authoritative. */
      }
    });
    yield* takeEvery(noteDeleteWorkspaceObserved, function* ({ payload: [workspaceId, owner] }) {
      observe(workspaceId, owner);
    });
    yield* takeEvery(noteDeleteWorkspaceUnobserved, function* ({ payload: [workspaceId, owner] }) {
      unobserve(workspaceId, owner);
    });
    yield* takeEvery(scheduleNoteDeleteRequested, function* (action) {
      try {
        const result = yield* call(schedule, ...action.payload);
        store.dispatch(action.success(result));
      } catch (error) {
        store.dispatch(action.failure(error instanceof Error ? error : new Error(String(error))));
      }
    });
    yield* takeEvery(cancelNoteDeleteRequested, function* (action) {
      try {
        const result = yield* call(cancel, ...action.payload);
        store.dispatch(action.success(result));
      } catch (error) {
        store.dispatch(action.failure(error instanceof Error ? error : new Error(String(error))));
      }
    });
    yield* takeEvery(checkNoteDeleteRequested, function* (action) {
      try {
        const result = yield* call(reconcile, ...action.payload, true);
        store.dispatch(action.success(result));
      } catch (error) {
        store.dispatch(action.failure(error instanceof Error ? error : new Error(String(error))));
      }
    });
    yield* take('workspaceNotes/noteDeleteObserverShutdown');
  } finally {
    for (const observation of observations.values()) {
      observation.disposed = true;
      if (observation.timer) clearTimeout(observation.timer);
      observation.stop();
      store.dispatch(
        noteDeleteObservationCheckingChanged(
          observation.workspaceId,
          observation.backendGeneration,
          false,
        ),
      );
    }
    observations.clear();
    // Physical promises keep their admission count until they actually settle.
  }
}
