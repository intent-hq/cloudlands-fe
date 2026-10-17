import type { AdmittedEventLifetimes } from '$features/events/event-recovery-coordinator';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { withRecoveryAdmissions } from '../../../middlewares/event-recovery';
import type { noteEventReceived, commentEventReceived } from '../workspace-notes-slice';

type NoteEvent = ReturnType<typeof noteEventReceived | typeof commentEventReceived>;
type AttributionEvent = { workspaceId?: unknown; noteId?: unknown };
type EventInput =
  { kind: 'note'; action: NoteEvent } | { kind: 'attribution'; payload: AttributionEvent };
export type NoteRecoveryEventJob = EventInput & {
  aborted: Promise<void>;
  complete: () => void;
};
let dispatch: ((input: EventInput) => Promise<void>) | undefined;

/** The installed saga owns completion, including teardown of buffered jobs. */
export function installNoteRecoveryDispatcher(emit: (job: NoteRecoveryEventJob) => void) {
  const pending = new Set<() => void>();
  const send = (input: EventInput) =>
    new Promise<void>((resolve) => {
      let abort!: () => void;
      const aborted = new Promise<void>((done) => {
        abort = done;
      });
      const complete = () => {
        pending.delete(cancel);
        resolve();
      };
      const cancel = () => {
        abort();
        complete();
      };
      pending.add(cancel);
      emit({ ...input, aborted, complete });
    });
  const cancelPending = () => {
    for (const cancel of [...pending]) cancel();
  };
  const offSession = rendererEventRecovery.onSession(() => cancelPending);
  dispatch = send;
  return () => {
    if (dispatch === send) dispatch = undefined;
    offSession();
    cancelPending();
  };
}

export function dispatchNoteRecoveryEvent(
  action: NoteEvent,
  lifetimes: AdmittedEventLifetimes,
): Promise<void> {
  return (
    dispatch?.({ kind: 'note', action: withRecoveryAdmissions(action, lifetimes) }) ??
    Promise.resolve()
  );
}

export function dispatchNoteAttributionRecoveryEvent(
  payload: AttributionEvent,
  lifetimes: AdmittedEventLifetimes,
): Promise<void> {
  return (
    dispatch?.({ kind: 'attribution', payload: withRecoveryAdmissions(payload, lifetimes) }) ??
    Promise.resolve()
  );
}
