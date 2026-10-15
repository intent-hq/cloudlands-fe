import { call, cancelled, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { CreateNoteRequest, Note } from '../../../../../shared/types';
import { WorkspaceId } from '../../../../../shared/types/branded-ids';
import type { NoteCreateResult, NotesClient } from '../../../../../lib/client/app-client';
import { m } from '../../../../../shared/paraglide/messages.js';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  isEditableMarkdownNote,
  isExplicitNoteCreationSupported,
} from '../workspace-notes-projections';
import type {
  ExplicitNoteCreatorIdentity,
  ExplicitNoteCreateOperation,
  ExplicitNoteCreateRequest,
} from '../workspace-notes-types';
import {
  createNotePersistRequested,
  explicitNoteCreatorOpened,
  explicitNoteCreatorAdmitted,
  explicitNoteCreatorReleased,
  explicitNoteCreatorsRetired,
  explicitNoteCreateQueued,
  explicitNoteCreateStarted,
  explicitNoteCreateSettled,
  clearWorkspaceNotesForWorkspaces,
  noteCreationAccepted,
} from '../workspace-notes-slice';

type CreateData = Omit<CreateNoteRequest, 'workspaceId'>;
export type NotesCreationDependencies = {
  notes: Pick<NotesClient, 'create'>;
  selectCreator: { effect(viewId: string): SagaGenerator<ExplicitNoteCreatorIdentity | undefined> };
  selectOperations: { effect(workspaceId: string): SagaGenerator<ExplicitNoteCreateOperation[]> };
  /** Final-boundary check includes readiness, authority/context and the registered canonical view. */
  isCurrent(identity: ExplicitNoteCreatorIdentity): boolean;
  /** Admission/publication requires current readiness and captured authority/context, before a view exists. */
  canPublish(identity: ExplicitNoteCreatorIdentity): boolean;
  dispatch(
    action: ReturnType<
      | typeof explicitNoteCreatorAdmitted
      | typeof explicitNoteCreateQueued
      | typeof explicitNoteCreateStarted
      | typeof explicitNoteCreateSettled
      | typeof explicitNoteCreatorsRetired
      | typeof noteCreationAccepted
    >,
  ): unknown;
};

/** One persist-request owner; source defaults stay opt-out and explicit hosts never infer identity. */
export function createNotesCreationSaga({
  explicit,
  sourceCreate,
  selectNoteById,
}: {
  explicit?: NotesCreationDependencies;
  sourceCreate?: (workspaceId: string, data: CreateData) => SagaGenerator<string | undefined>;
  selectNoteById: { effect(workspaceId: string, noteId: string): SagaGenerator<Note | undefined> };
}) {
  function* openCreator(action: ReturnType<typeof explicitNoteCreatorOpened>) {
    if (!explicit) return;
    const [identity] = action.payload;
    if (
      !identity.workspaceId ||
      !identity.viewId ||
      !identity.authority ||
      !identity.context ||
      !explicit.canPublish(identity)
    )
      return;
    const existing = yield* explicit.selectCreator.effect(identity.viewId);
    if (existing || !explicit.canPublish(identity)) return;
    explicit.dispatch(explicitNoteCreatorAdmitted(identity));
  }

  function* createExplicit(
    workspaceId: string,
    requestedData: CreateData,
    requestedIdentity: ExplicitNoteCreateRequest,
  ) {
    const data = {
      ...requestedData,
      ...(requestedData.tags ? { tags: [...requestedData.tags] } : {}),
    };
    const request = { ...requestedIdentity };
    if (
      !explicit ||
      !request.requestId?.trim() ||
      request.workspaceId !== workspaceId ||
      !isExplicitNoteCreationSupported(data) ||
      !explicit.isCurrent(request)
    )
      return undefined;
    const operations = yield* explicit.selectOperations.effect(workspaceId);
    if (
      operations.some(
        (operation) =>
          operation.requestId === request.requestId ||
          operation.status === 'queued' ||
          operation.status === 'running' ||
          operation.status === 'unknown',
      ) ||
      !explicit.isCurrent(request)
    )
      return undefined;
    explicit.dispatch(explicitNoteCreateQueued({ ...request, status: 'queued' }));
    const admitted = (yield* explicit.selectOperations.effect(workspaceId)).find(
      (operation) => operation.requestId === request.requestId,
    );
    if (!admitted || admitted.viewId !== request.viewId || admitted.status !== 'queued')
      return undefined;

    const host = explicit;
    const guard = { active: true, dispatched: false, settled: false };
    const current = () => guard.active && host.isCurrent(request);
    // This promise keeps only the operation receipt after cancellation. It never publishes into a departed view.
    async function send(): Promise<Note | undefined> {
      let result: NoteCreateResult;
      try {
        if (!current()) throw new Error(m.ui_reversibleActions_cancelled_message());
        result = await host.notes.create(
          { ...data, workspaceId: WorkspaceId(workspaceId) },
          {
            requireCreationReceipt: true,
            idempotencyKey: request.requestId,
            onDispatch() {
              if (guard.dispatched || !current())
                throw new Error(m.ui_reversibleActions_cancelled_message());
              host.dispatch(explicitNoteCreateStarted(request.requestId));
              if (!current()) throw new Error(m.ui_reversibleActions_cancelled_message());
              guard.dispatched = true;
            },
          },
        );
      } catch (error) {
        result = {
          success: false,
          createOutcome: guard.dispatched ? 'unknown' : 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const note = result.note;
      const confirmed =
        guard.dispatched &&
        result.success &&
        result.createOutcome === 'confirmed' &&
        isEditableMarkdownNote(note) &&
        note.workspaceId === workspaceId &&
        !!note.id;
      const status = confirmed
        ? 'confirmed'
        : result.createOutcome === 'unknown'
          ? 'unknown'
          : !guard.dispatched || result.createOutcome === 'failed'
            ? 'failed'
            : 'unknown';
      host.dispatch(
        explicitNoteCreateSettled(
          request.requestId,
          status,
          confirmed ? note?.id : undefined,
          confirmed ? note?.rev : undefined,
          result.error,
        ),
      );
      guard.settled = true;
      return confirmed ? note : undefined;
    }
    const isCreationCleanup = (action: { type: string; payload?: unknown }) => {
      if (action.type === explicitNoteCreatorsRetired.type) return true;
      if (!Array.isArray(action.payload)) return false;
      if (action.type === explicitNoteCreatorReleased.type)
        return action.payload[0] === request.viewId;
      if (action.type === clearWorkspaceNotesForWorkspaces.type)
        return Array.isArray(action.payload[0]) && action.payload[0].includes(workspaceId);
      return (
        (action.type === workspaceUnmounted.type || action.type === workspaceDeleted.type) &&
        action.payload[0] === workspaceId
      );
    };
    try {
      const { created } = yield* race({
        created: call(send),
        cleanup: take(isCreationCleanup),
      });
      if (!created || !current() || !host.canPublish(request)) return undefined;
      host.dispatch(noteCreationAccepted(workspaceId, created));
      const accepted = yield* selectNoteById.effect(workspaceId, created.id);
      return accepted && current() && host.canPublish(request) ? created.id : undefined;
    } finally {
      guard.active = false;
      if (!guard.settled)
        host.dispatch(
          explicitNoteCreateSettled(request.requestId, guard.dispatched ? 'unknown' : 'failed'),
        );
    }
  }

  function* persist(action: ReturnType<typeof createNotePersistRequested>) {
    const [workspaceId, data, request] = action.payload;
    try {
      const noteId = request
        ? yield* call(createExplicit, workspaceId, data, request)
        : sourceCreate
          ? yield* call(sourceCreate, workspaceId, data)
          : undefined;
      yield* put(action.success(noteId));
    } catch (error) {
      yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    } finally {
      if (yield* cancelled())
        yield* put(action.failure(new Error(m.ui_reversibleActions_cancelled_message())));
    }
  }

  return function* notesCreationSaga() {
    if (explicit) yield* takeEvery(explicitNoteCreatorOpened, openCreator);
    yield* takeEvery(createNotePersistRequested, persist);
  };
}
