import { ownedActionChannel } from '$store/renderer/utils/owned-action-channel';
import { buffers, eventChannel } from 'redux-saga';
import { flush, put, race, select, take, takeEvery } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import { repositoryRootKey } from '$shared/types/repository-context';
import type {
  RepositorySelectionEdit,
  RepositorySelectionSession,
  SelectionObservation,
  SelectionRetirement,
} from '$shared/types/repository-selection';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import type { StoreState } from '../../../types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectRepositorySelectionForEdit } from '../repository-context-selectors';
import {
  repositorySelectionEditRequested,
  repositorySelectionConfirmRequested,
  repositorySelectionReconcileRequested,
  repositorySelectionEditEnded,
  repositorySelectionEditStarted,
  repositorySelectionPreviewReceived,
  repositorySelectionCommandStarted,
  repositorySelectionObserved,
  repositorySelectionRetired,
  repositorySelectionUnavailable,
  repositorySelectionEditCleared,
} from '../repository-context-slice';

type Update =
  | { type: 'ready'; session: RepositorySelectionSession }
  | { type: 'retired'; kind: SelectionRetirement }
  | { type: 'observed'; observation: SelectionObservation }
  | { type: 'unavailable' };
function same(left: RepositorySelectionEdit, right: RepositorySelectionEdit) {
  return (
    left.editId === right.editId &&
    left.admission === right.admission &&
    repositoryRootKey(left.root) === repositoryRootKey(right.root)
  );
}
// A hidden closed record still belongs to its original worker and command claim.
function selectEditRecord(state: StoreState, editId: string) {
  const edits = state.repositoryContext.selectionEdits;
  return edits ? getItem(edits, editId) : undefined;
}
/** Child of the existing root saga. Sessions and command claims never enter Redux. */
export function* repositorySelectionSaga() {
  yield* takeLatestFromSelector(
    selectPrincipalActionContext,
    function* ({ payload: admission }: SelectorChannelPayload<string | null>) {
      if (!admission) return;
      yield* takeEvery(repositorySelectionEditRequested, function* ({ payload: [supplied] }) {
        const owner: RepositorySelectionEdit = { ...supplied, root: { ...supplied.root } };
        if (
          owner.admission !== admission ||
          (yield* selectPrincipalActionContext.effect()) !== admission ||
          (yield* select(selectEditRecord, owner.editId))
        )
          return;
        const commands = yield* ownedActionChannel(
          [
            workspaceUnmounted.type,
            repositorySelectionEditRequested.type,
            repositorySelectionEditEnded.type,
            repositorySelectionConfirmRequested.type,
            repositorySelectionReconcileRequested.type,
          ],
          (action: { type: string; payload?: unknown[] }) => {
            const first = action.payload?.[0];
            if (action.type === workspaceUnmounted.type) return first === owner.root.workspaceId;
            if (
              !first ||
              typeof first !== 'object' ||
              !('root' in first) ||
              !('editId' in first) ||
              !('admission' in first)
            )
              return false;
            const candidate = first as RepositorySelectionEdit;
            if (candidate.admission !== admission || !candidate.root) return false;
            if (action.type === repositorySelectionEditRequested.type)
              return (
                candidate.editId !== owner.editId &&
                repositoryRootKey(candidate.root) === repositoryRootKey(owner.root)
              );
            return (
              same(candidate, owner) &&
              (action.type === repositorySelectionEditEnded.type ||
                action.type === repositorySelectionConfirmRequested.type ||
                action.type === repositorySelectionReconcileRequested.type)
            );
          },
          buffers.expanding(8),
        );
        let session: RepositorySelectionSession | undefined,
          stopped = false,
          busy = false,
          claimed = false;
        let emit: (update: Update) => void = () => {};
        const updates = eventChannel<Update>((send) => {
          emit = send;
          return () => {
            stopped = true;
            void session?.release();
          };
        }, buffers.expanding(8));
        const send = (update: Update) => {
          if (!stopped) emit(update);
        };
        try {
          yield* put(repositorySelectionEditStarted(owner));
          const started = yield* select(selectEditRecord, owner.editId);
          if (
            (yield* flush(commands)).length ||
            (yield* selectPrincipalActionContext.effect()) !== admission ||
            !started ||
            !same(started.owner, owner) ||
            started.status !== 'capturing'
          )
            return;
          void Promise.resolve()
            .then(() =>
              stopped
                ? undefined
                : appClient.workspaces.beginRepositorySelectionEdit(owner, (kind) =>
                    send({ type: 'retired', kind }),
                  ),
            )
            .then(
              (opened) => {
                if (!opened) return;
                session = opened;
                if (stopped) void opened.release();
                else send({ type: 'ready', session: opened });
              },
              () => send({ type: 'unavailable' }),
            );
          while (true) {
            const result = yield* race({ update: take(updates), command: take(commands) });
            if ((yield* selectPrincipalActionContext.effect()) !== admission) return;
            if (result.update) {
              const update = result.update;
              if (update.type === 'ready')
                yield* put(repositorySelectionPreviewReceived(owner, update.session.preview));
              else if (update.type === 'retired')
                yield* put(repositorySelectionRetired(owner, update.kind));
              else if (update.type === 'unavailable')
                yield* put(repositorySelectionUnavailable(owner));
              else yield* put(repositorySelectionObserved(owner, update.observation));
            } else if (result.command) {
              const command = result.command;
              if (
                command.type === repositorySelectionEditEnded.type ||
                command.type === workspaceUnmounted.type ||
                command.type === repositorySelectionEditRequested.type
              )
                return;
              if (!session || busy) continue;
              const view = yield* selectRepositorySelectionForEdit.effect(owner);
              if (!view || view.status === 'closed' || view.status === 'unavailable') continue;
              let work: Promise<SelectionObservation>;
              if (command.type === repositorySelectionConfirmRequested.type) {
                if (claimed || view.status !== 'ready') continue;
                claimed = true;
                busy = true;
                yield* put(repositorySelectionCommandStarted(owner));
                if (
                  (yield* flush(commands)).length ||
                  (yield* selectPrincipalActionContext.effect()) !== admission
                )
                  return;
                try {
                  work = session.confirm(
                    (command as ReturnType<typeof repositorySelectionConfirmRequested>).payload[1],
                  );
                } catch {
                  work = Promise.reject(new Error('REPOSITORY_SELECTION_UNAVAILABLE'));
                }
              } else {
                busy = true;
                try {
                  work = session.reconcile();
                } catch {
                  work = Promise.reject(new Error('REPOSITORY_SELECTION_UNAVAILABLE'));
                }
              }
              void work.then(
                (observation) => {
                  busy = false;
                  send({ type: 'observed', observation });
                },
                () => {
                  busy = false;
                  send({
                    type: 'observed',
                    observation: { current: false, attempt: null, uncertain: true },
                  });
                },
              );
            }
          }
        } finally {
          commands.close();
          updates.close();
          yield* put(repositorySelectionEditCleared(owner));
        }
      });
    },
  );
}
