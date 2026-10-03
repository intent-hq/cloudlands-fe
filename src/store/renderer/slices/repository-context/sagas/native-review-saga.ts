import { ownedActionChannel } from '$store/renderer/utils/owned-action-channel';
import { buffers, eventChannel } from 'redux-saga';
import { flush, getContext, put, race, take, takeEvery } from 'typed-redux-saga';
import {
  createChannelFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@themislib/themis/saga';
import { appClient } from '$lib/client';
import { repositoryRootKey } from '$shared/types/repository-context';
import type {
  NativeReviewOwner,
  NativeReviewSession,
  NativeReviewObservation,
  NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
import {
  NativeReviewInputSchema,
  NativeReviewOwnerSchema,
} from '$shared/types/native-review-operation';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectNativeReviewForOwner,
  selectNativeReviewOccupancy,
} from '../repository-context-selectors';
import {
  nativeReviewEditRequested,
  nativeReviewCompanionRequested,
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

type Update = { owner?: NativeReviewOwner } & (
  | { type: 'ready'; session: NativeReviewSession }
  | { type: 'retired'; kind: NativeReviewRetirement }
  | { type: 'observation-failed' }
  | { type: 'unavailable' }
);
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
    selectPrincipalActionContext,
    function* ({ payload: admission }: SelectorChannelPayload<string | null>) {
      if (!admission) return;
      yield* takeEvery(nativeReviewEditRequested, function* ({ payload: [supplied, input] }) {
        const owner: NativeReviewOwner = { ...supplied, root: { ...supplied.root } };
        if (
          owner.admission !== admission ||
          owner.hostContext === null ||
          (yield* selectWorkspaceActionContext.effect(owner.root.workspaceId)) !==
            owner.hostContext ||
          (yield* selectPrincipalActionContext.effect()) !== admission ||
          (yield* selectNativeReviewOccupancy.effect(owner.attemptId))
        )
          return;
        const parsed = NativeReviewInputSchema.safeParse(input);
        if (
          !parsed.success ||
          repositoryRootKey(parsed.data.review.root) !== repositoryRootKey(owner.root)
        )
          return;
        const originalStore = yield* getContext<{
          dispatch: (action: ReturnType<typeof nativeReviewObserved>) => unknown;
        }>('reduxStore');
        const hostChanges = yield* createChannelFromSelector(
          selectWorkspaceActionContext,
          owner.root.workspaceId,
        );
        type Child = {
          owner: NativeReviewOwner;
          session?: NativeReviewSession;
          stop?: () => void;
          busy: boolean;
          claimed: boolean;
          ended: boolean;
        };
        let child: Child | undefined;
        const commands = yield* ownedActionChannel(
          [
            workspaceUnmounted.type,
            nativeReviewEditRequested.type,
            nativeReviewEditEnded.type,
            nativeReviewConfirmRequested.type,
            nativeReviewReconcileRequested.type,
            nativeReviewCompanionRequested.type,
          ],
          (action: { type: string; payload?: unknown[] }) => {
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
              (same(candidate, owner) || (!!child && same(candidate, child.owner))) &&
              (action.type === nativeReviewEditEnded.type ||
                action.type === nativeReviewConfirmRequested.type ||
                action.type === nativeReviewReconcileRequested.type ||
                action.type === nativeReviewCompanionRequested.type)
            );
          },
          buffers.expanding(8),
        );
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
            child?.stop?.();
            void child?.session?.release();
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
            (yield* selectPrincipalActionContext.effect()) !== admission ||
            (yield* selectWorkspaceActionContext.effect(owner.root.workspaceId)) !==
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
              (yield* selectPrincipalActionContext.effect()) !== admission ||
              (yield* selectWorkspaceActionContext.effect(owner.root.workspaceId)) !==
                owner.hostContext
            )
              return;
            if (result.update) {
              const update = result.update,
                observedOwner = update.owner ?? owner;
              if (update.type === 'ready')
                yield* put(nativeReviewPreviewReceived(observedOwner, update.session.preview));
              else if (update.type === 'retired') {
                yield* put(nativeReviewRetired(observedOwner, update.kind));
                if (update.kind === 'closed' && child) {
                  child.ended = true;
                  child.stop?.();
                  void child.session?.release();
                  if (same(observedOwner, owner))
                    yield* put(nativeReviewRetired(child.owner, 'closed'));
                }
              } else if (update.type === 'unavailable')
                yield* put(nativeReviewUnavailable(observedOwner));
              else if (update.type === 'observation-failed') {
                const original = yield* selectNativeReviewOccupancy.effect(observedOwner.attemptId);
                if (original && same(original.owner, observedOwner))
                  yield* put(
                    nativeReviewObserved(observedOwner, {
                      current: false,
                      execute: original.observation?.execute ?? null,
                      reconciliation: original.observation?.reconciliation ?? null,
                      uncertain: original.observation?.uncertain ?? true,
                    }),
                  );
              }
            } else if (result.command) {
              const command = result.command;
              if (command.type === nativeReviewEditRequested.type) {
                const next = (command as ReturnType<typeof nativeReviewEditRequested>).payload[0];
                const prior = yield* selectNativeReviewOccupancy.effect(next.attemptId);
                if (prior?.status === 'closed' || prior?.status === 'unavailable') continue;
              }
              const suppliedOwner = (command as ReturnType<typeof nativeReviewEditEnded>)
                .payload[0];
              const activeChild =
                command.type !== workspaceUnmounted.type &&
                child &&
                same(suppliedOwner, child.owner)
                  ? child
                  : undefined;
              if (command.type === nativeReviewEditEnded.type && activeChild) {
                activeChild.ended = true;
                activeChild.stop?.();
                void activeChild.session?.release();
                yield* put(nativeReviewEditCleared(activeChild.owner));
                continue;
              }
              if (
                command.type === nativeReviewEditEnded.type ||
                command.type === workspaceUnmounted.type ||
                command.type === nativeReviewEditRequested.type
              )
                return;
              if (command.type === nativeReviewCompanionRequested.type) {
                const [originalOwner, proposed] = (
                  command as ReturnType<typeof nativeReviewCompanionRequested>
                ).payload;
                if (
                  child ||
                  !same(originalOwner, owner) ||
                  !session?.prepareCompanion ||
                  busy ||
                  !parsed.data.review.companion ||
                  !NativeReviewOwnerSchema.safeParse(proposed).success ||
                  proposed.attemptId === owner.attemptId ||
                  proposed.admission !== owner.admission ||
                  proposed.hostContext !== owner.hostContext ||
                  !proposed.root ||
                  repositoryRootKey(proposed.root) !== repositoryRootKey(owner.root) ||
                  (yield* selectNativeReviewOccupancy.effect(proposed.attemptId))
                )
                  continue;
                const original = yield* selectNativeReviewForOwner.effect(owner),
                  executed = original?.observation?.execute;
                if (
                  !original ||
                  original.status === 'unavailable' ||
                  !executed?.success ||
                  executed.state !== 'settled' ||
                  original.observation?.uncertain ||
                  executed.reviewExecution?.outcome.status !== 'not-attempted' ||
                  executed.reviewExecution.gitReceipts.length !== 1 ||
                  executed.reviewExecution.gitReceipts[0].stage !== 'commit'
                )
                  continue;
                const captured: Child = (child = {
                  owner: { ...proposed, root: { ...proposed.root } },
                  busy: false,
                  claimed: false,
                  ended: false,
                });
                yield* put(nativeReviewEditStarted(captured.owner));
                const reserved = yield* selectNativeReviewOccupancy.effect(
                  captured.owner.attemptId,
                );
                if (
                  !reserved ||
                  !same(reserved.owner, captured.owner) ||
                  reserved.status !== 'capturing'
                ) {
                  captured.ended = true;
                  continue;
                }
                const parentSession = session;
                busy = true;
                void Promise.resolve()
                  .then(() =>
                    stopped || captured.ended ? undefined : parentSession.prepareCompanion!(),
                  )
                  .then(
                    (opened) => {
                      busy = false;
                      if (!opened) return;
                      captured.session = opened;
                      if (stopped || captured.ended) {
                        void opened.release();
                        return;
                      }
                      try {
                        captured.stop = opened.onRetired((kind) =>
                          send({ type: 'retired', kind, owner: captured.owner }),
                        );
                        if (stopped || captured.ended) {
                          captured.stop();
                          void opened.release();
                          return;
                        }
                        send({ type: 'ready', session: opened, owner: captured.owner });
                      } catch {
                        captured.ended = true;
                        void opened.release();
                        send({ type: 'unavailable', owner: captured.owner });
                      }
                    },
                    () => {
                      busy = false;
                      send({ type: 'unavailable', owner: captured.owner });
                    },
                  );
                continue;
              }
              const activeOwner = activeChild?.owner ?? owner;
              const activeSession = activeChild ? activeChild.session : session;
              if (!activeSession || (activeChild ? activeChild.busy || activeChild.ended : busy))
                continue;
              const view = yield* selectNativeReviewForOwner.effect(activeOwner);
              if (!view || view.status === 'closed' || view.status === 'unavailable') continue;
              let work: Promise<NativeReviewObservation>;
              if (command.type === nativeReviewConfirmRequested.type) {
                if ((activeChild ? activeChild.claimed : claimed) || view.status !== 'ready')
                  continue;
                if (activeChild) {
                  activeChild.claimed = true;
                  activeChild.busy = true;
                } else {
                  claimed = true;
                  busy = true;
                }
                yield* put(nativeReviewCommandStarted(activeOwner));
                const interrupted = yield* flush(commands);
                if (
                  (yield* selectPrincipalActionContext.effect()) !== admission ||
                  (yield* selectWorkspaceActionContext.effect(owner.root.workspaceId)) !==
                    owner.hostContext
                )
                  return;
                const childState = activeChild
                  ? yield* selectNativeReviewOccupancy.effect(activeOwner.attemptId)
                  : undefined;
                if (
                  activeChild &&
                  (interrupted.length > 0 ||
                    (childState?.status === 'closed' && same(childState.owner, activeOwner))) &&
                  interrupted.every(
                    (pending) =>
                      pending.type === nativeReviewEditEnded.type &&
                      same(
                        (pending as ReturnType<typeof nativeReviewEditEnded>).payload[0],
                        activeOwner,
                      ),
                  )
                ) {
                  activeChild.ended = true;
                  activeChild.stop?.();
                  void activeChild.session?.release();
                  yield* put(nativeReviewEditCleared(activeOwner));
                  continue;
                }
                if (
                  interrupted.length ||
                  (yield* selectNativeReviewForOwner.effect(activeOwner))?.status !== 'pending'
                )
                  return;
                try {
                  work = activeSession.confirm(
                    (command as ReturnType<typeof nativeReviewConfirmRequested>).payload[1],
                  );
                } catch {
                  work = Promise.reject(new Error('NATIVE_REVIEW_UNAVAILABLE'));
                }
              } else {
                if (activeChild) activeChild.busy = true;
                else busy = true;
                try {
                  work = activeSession.reconcile();
                } catch {
                  work = Promise.reject(new Error('NATIVE_REVIEW_UNAVAILABLE'));
                }
              }
              // This issued future owns only a result recorder, not the command worker's
              // lifetime. The reducer retains the exact owner's history after closure
              // without reopening occupancy or making it current for another owner.
              void work
                .then(
                  (observation) => {
                    if (activeChild) activeChild.busy = false;
                    else busy = false;
                    originalStore.dispatch(nativeReviewObserved(activeOwner, observation));
                  },
                  () => {
                    if (activeChild) activeChild.busy = false;
                    else busy = false;
                    send({ type: 'observation-failed', owner: activeOwner });
                  },
                )
                .catch(() => send({ type: 'observation-failed', owner: activeOwner }));
            }
          }
        } finally {
          hostChanges.close();
          commands.close();
          updates.close();
          yield* put(nativeReviewEditCleared(owner));
          if (child) yield* put(nativeReviewEditCleared(child.owner));
        }
      });
    },
  );
}
