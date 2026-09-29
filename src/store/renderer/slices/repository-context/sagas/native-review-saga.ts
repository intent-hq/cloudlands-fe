import { buffers, eventChannel } from 'redux-saga';
import { actionChannel, flush, put, race, take, takeEvery } from 'typed-redux-saga';
import {
  createChannelFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@augmentcode/themis/saga';
import { appClient } from '$lib/client';
import { repositoryRootKey } from '$shared/types/repository-context';
import type {
  NativeReviewOwner,
  NativeReviewSession,
  NativeReviewObservation,
  NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import { selectWorkspaceHostOperationContext } from '../../workspace/workspace-selectors';
import { NativeReviewInputSchema } from '$shared/types/native-review-operation';
import { selectPrincipalAdmissionContext } from '../../principal/principal-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectNativeReviewForOwner,
  selectNativeReviewOccupancy,
} from '../repository-context-selectors';
import {
  nativeReviewEditRequested,
  nativeReviewConfirmRequested,
  nativeReviewReconcileRequested,
  nativeReviewEditEnded,
  nativeReviewEditStarted,
  nativeReviewPreviewReceived,
  nativeReviewCommandStarted,
  nativeReviewObserved,
  nativeReviewRetired,
  nativeReviewUnavailable,
  nativeReviewEditCleared,
} from '../repository-context-slice';

type Update =
  | { type: 'ready'; session: NativeReviewSession }
  | { type: 'retired'; kind: NativeReviewRetirement }
  | { type: 'observed'; observation: NativeReviewObservation }
  | { type: 'observation-failed' }
  | { type: 'unavailable' };
function same(left: NativeReviewOwner, right: NativeReviewOwner) {
  return (
    left.attemptId === right.attemptId &&
    left.admission === right.admission &&
    left.hostContext === right.hostContext &&
    repositoryRootKey(left.root) === repositoryRootKey(right.root)
  );
}
/** Child of the existing root saga. Sessions and command claims never enter Redux. */
export function* nativeReviewSaga() {
  yield* takeLatestFromSelector(
    selectPrincipalAdmissionContext,
    function* ({ payload: admission }: SelectorChannelPayload<string | null>) {
      if (!admission) return;
      yield* takeEvery(nativeReviewEditRequested, function* ({ payload: [supplied, input] }) {
        const owner: NativeReviewOwner = { ...supplied, root: { ...supplied.root } };
        if (
          owner.admission !== admission ||
          owner.hostContext === null ||
          (yield* selectWorkspaceHostOperationContext.effect(owner.root.workspaceId)) !==
            owner.hostContext ||
          (yield* selectPrincipalAdmissionContext.effect()) !== admission ||
          (yield* selectNativeReviewOccupancy.effect(owner.attemptId))
        )
          return;
        const parsed = NativeReviewInputSchema.safeParse(input);
        if (
          !parsed.success ||
          repositoryRootKey(parsed.data.review.root) !== repositoryRootKey(owner.root)
        )
          return;
        const hostChanges = yield* createChannelFromSelector(
          selectWorkspaceHostOperationContext,
          owner.root.workspaceId,
        );
        const commands = yield* actionChannel((action: { type: string; payload?: unknown[] }) => {
          const first = action.payload?.[0];
          if (action.type === workspaceUnmounted.type) return first === owner.root.workspaceId;
          if (
            !first ||
            typeof first !== 'object' ||
            !('root' in first) ||
            !('attemptId' in first) ||
            !('admission' in first) ||
            !('hostContext' in first)
          )
            return false;
          const candidate = first as NativeReviewOwner;
          if (
            candidate.admission !== admission ||
            candidate.hostContext !== owner.hostContext ||
            !candidate.root
          )
            return false;
          if (action.type === nativeReviewEditRequested.type)
            return (
              candidate.attemptId !== owner.attemptId &&
              repositoryRootKey(candidate.root) === repositoryRootKey(owner.root)
            );
          return (
            same(candidate, owner) &&
            (action.type === nativeReviewEditEnded.type ||
              action.type === nativeReviewConfirmRequested.type ||
              action.type === nativeReviewReconcileRequested.type)
          );
        }, buffers.expanding(8));
        let session: NativeReviewSession | undefined,
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
          yield* put(nativeReviewEditStarted(owner));
          const started = yield* selectNativeReviewOccupancy.effect(owner.attemptId);
          if (
            (yield* flush(commands)).length ||
            (yield* selectPrincipalAdmissionContext.effect()) !== admission ||
            (yield* selectWorkspaceHostOperationContext.effect(owner.root.workspaceId)) !==
              owner.hostContext ||
            !started ||
            !same(started.owner, owner) ||
            started.status !== 'capturing'
          )
            return;
          void Promise.resolve()
            .then(() =>
              stopped
                ? undefined
                : appClient.workspaces.beginNativeReview(owner, parsed.data, (kind) =>
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
            const result = yield* race({
              update: take(updates),
              command: take(commands),
              host: take(hostChanges),
            });
            if (
              (yield* selectPrincipalAdmissionContext.effect()) !== admission ||
              (yield* selectWorkspaceHostOperationContext.effect(owner.root.workspaceId)) !==
                owner.hostContext
            )
              return;
            if (result.update) {
              const update = result.update;
              if (update.type === 'ready')
                yield* put(nativeReviewPreviewReceived(owner, update.session.preview));
              else if (update.type === 'retired')
                yield* put(nativeReviewRetired(owner, update.kind));
              else if (update.type === 'unavailable') yield* put(nativeReviewUnavailable(owner));
              else if (update.type === 'observation-failed') {
                const original = yield* selectNativeReviewOccupancy.effect(owner.attemptId);
                if (original && same(original.owner, owner))
                  yield* put(
                    nativeReviewObserved(owner, {
                      current: false,
                      execute: original.observation?.execute ?? null,
                      reconciliation: original.observation?.reconciliation ?? null,
                      uncertain: original.observation?.uncertain ?? true,
                    }),
                  );
              } else yield* put(nativeReviewObserved(owner, update.observation));
            } else if (result.command) {
              const command = result.command;
              if (command.type === nativeReviewEditRequested.type) {
                const next = (command as ReturnType<typeof nativeReviewEditRequested>).payload[0];
                const prior = yield* selectNativeReviewOccupancy.effect(next.attemptId);
                if (prior?.status === 'closed' || prior?.status === 'unavailable') continue;
              }
              if (
                command.type === nativeReviewEditEnded.type ||
                command.type === workspaceUnmounted.type ||
                command.type === nativeReviewEditRequested.type
              )
                return;
              if (!session || busy) continue;
              const view = yield* selectNativeReviewForOwner.effect(owner);
              if (!view || view.status === 'closed' || view.status === 'unavailable') continue;
              let work: Promise<NativeReviewObservation>;
              if (command.type === nativeReviewConfirmRequested.type) {
                if (claimed || view.status !== 'ready') continue;
                claimed = true;
                busy = true;
                yield* put(nativeReviewCommandStarted(owner));
                if (
                  (yield* flush(commands)).length ||
                  (yield* selectNativeReviewForOwner.effect(owner))?.status !== 'pending' ||
                  (yield* selectPrincipalAdmissionContext.effect()) !== admission ||
                  (yield* selectWorkspaceHostOperationContext.effect(owner.root.workspaceId)) !==
                    owner.hostContext
                )
                  return;
                try {
                  work = session.confirm(
                    (command as ReturnType<typeof nativeReviewConfirmRequested>).payload[1],
                  );
                } catch {
                  work = Promise.reject(new Error('NATIVE_REVIEW_UNAVAILABLE'));
                }
              } else {
                busy = true;
                try {
                  work = session.reconcile();
                } catch {
                  work = Promise.reject(new Error('NATIVE_REVIEW_UNAVAILABLE'));
                }
              }
              void work.then(
                (observation) => {
                  busy = false;
                  send({ type: 'observed', observation });
                },
                () => {
                  busy = false;
                  send({ type: 'observation-failed' });
                },
              );
            }
          }
        } finally {
          hostChanges.close();
          commands.close();
          updates.close();
          yield* put(nativeReviewEditCleared(owner));
        }
      });
    },
  );
}
