import { AnnotationDeliveryError } from '$features/annotation/annotation-types';
import {
  selectAnnotationDeliveryPending,
  selectAnnotationUncertainMessageId,
} from '../annotation-selectors';
import {
  loadAnnotationRecipients,
  loadAnnotationWorkspaces,
  resolveAnnotationRecipient,
  submitAnnotation,
} from '$features/annotation/annotation-submit-service';
import { all, call, cancelled, join, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { invokeAnnotationTransport } from '$features/annotation/annotation-transport';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import type { AnnotationSessionState, AnnotationStateResult } from '$shared/annotation';
import { ANNOTATION_CHANNELS } from '$shared/ipc/channels';
import { takeEveryFromElectronChannel } from '$store/renderer/utils/ipc-channel';
import {
  addAnnotationTranscriptRequested,
  annotationStateReceived,
  closeAnnotationRequested,
  getAnnotationStateRequested,
  reviewAnnotationRequested,
  setAnnotationToolRequested,
  startAnnotationRequested,
  loadAnnotationRecipientsRequested,
  loadAnnotationWorkspacesRequested,
  submitAnnotationRequested,
  annotationDeliveryPending,
  annotationDeliverySucceeded,
  annotationDeliveryUncertain,
  setAnnotationDestinationRequested,
  setAnnotationToolbarLayoutRequested,
  requestAnnotationSendRequested,
  requestAnnotationScreenshotRequested,
  reportAnnotationScreenshotRequested,
  reportAnnotationDeliveryRequested,
  resolveAnnotationRecipientRequested,
} from '../annotation-slice';

type VoidRequestAction =
  | ReturnType<typeof startAnnotationRequested>
  | ReturnType<typeof setAnnotationToolRequested>
  | ReturnType<typeof addAnnotationTranscriptRequested>
  | ReturnType<typeof reviewAnnotationRequested>
  | ReturnType<typeof closeAnnotationRequested>
  | ReturnType<typeof setAnnotationToolbarLayoutRequested>
  | ReturnType<typeof setAnnotationDestinationRequested>
  | ReturnType<typeof requestAnnotationSendRequested>
  | ReturnType<typeof requestAnnotationScreenshotRequested>
  | ReturnType<typeof reportAnnotationScreenshotRequested>
  | ReturnType<typeof reportAnnotationDeliveryRequested>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function* runVoidRequest(
  action: VoidRequestAction,
  channel: Parameters<typeof invokeAnnotationTransport>[0],
  payload: unknown,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(
      invokeAnnotationTransport<{ success: boolean; error?: string }>,
      channel,
      payload,
    );
    if (!result.success) {
      throw new Error(result.error ?? 'Annotation request failed');
    }
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Annotation request was cancelled')));
    }
  }
}

function* startAnnotationWorker(action: ReturnType<typeof startAnnotationRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.START, action.payload[0]);
}

function* getAnnotationStateWorker(action: ReturnType<typeof getAnnotationStateRequested>) {
  let settled = false;
  try {
    const result = yield* call(
      invokeAnnotationTransport<AnnotationStateResult>,
      ANNOTATION_CHANNELS.GET_STATE,
      {},
    );
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Annotation request was cancelled')));
    }
  }
}

function* setAnnotationToolWorker(action: ReturnType<typeof setAnnotationToolRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.SET_TOOL, { tool: action.payload[0] });
}

function* addAnnotationTranscriptWorker(
  action: ReturnType<typeof addAnnotationTranscriptRequested>,
) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.ADD_TRANSCRIPT, {
    text: action.payload[0],
    ...(action.payload[1] === undefined ? {} : { startedAt: action.payload[1] }),
  });
}

function* setToolbarLayoutWorker(action: ReturnType<typeof setAnnotationToolbarLayoutRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.SET_TOOLBAR_LAYOUT, action.payload[0]);
}

function* setDestinationWorker(action: ReturnType<typeof setAnnotationDestinationRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.SET_DESTINATION, action.payload[0]);
}

function* requestSendWorker(action: ReturnType<typeof requestAnnotationSendRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.REQUEST_SEND, action.payload[0]);
}

function* reportDeliveryWorker(action: ReturnType<typeof reportAnnotationDeliveryRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.REPORT_DELIVERY, action.payload[0]);
}

function* requestScreenshotWorker(action: ReturnType<typeof requestAnnotationScreenshotRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.REQUEST_SCREENSHOT, action.payload[0]);
}

function* reportScreenshotWorker(action: ReturnType<typeof reportAnnotationScreenshotRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.REPORT_SCREENSHOT, action.payload[0]);
}

function* resolveRecipientWorker(action: ReturnType<typeof resolveAnnotationRecipientRequested>) {
  let settled = false;
  try {
    const recipient = yield* call(resolveAnnotationRecipient, action.payload[0], action.payload[1]);
    yield* put(action.success(recipient));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Annotation request was cancelled')));
  }
}

function* reviewAnnotationWorker(action: ReturnType<typeof reviewAnnotationRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.REVIEW, {});
}

function* closeAnnotationWorker(action: ReturnType<typeof closeAnnotationRequested>) {
  yield* runVoidRequest(action, ANNOTATION_CHANNELS.CLOSE, {});
}

function* annotationStateEventWorker(state: AnnotationSessionState) {
  yield* put(annotationStateReceived(state));
}

function* annotationStateEventSaga(): SagaGenerator<void> {
  if (!isElectronPlatform()) return;
  const task = yield* takeEveryFromElectronChannel(
    ANNOTATION_CHANNELS.STATE_CHANGED,
    annotationStateEventWorker,
  );
  yield* join(task);
}

function* loadWorkspacesWorker(action: ReturnType<typeof loadAnnotationWorkspacesRequested>) {
  let settled = false;
  try {
    const workspaces = yield* call(loadAnnotationWorkspaces);
    yield* put(action.success(workspaces));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Annotation request was cancelled')));
  }
}

function* loadRecipientsWorker(action: ReturnType<typeof loadAnnotationRecipientsRequested>) {
  let settled = false;
  try {
    const recipients = yield* call(loadAnnotationRecipients, action.payload[0]);
    yield* put(action.success(recipients));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Annotation request was cancelled')));
  }
}

function* submitWorker(action: ReturnType<typeof submitAnnotationRequested>) {
  if (yield* selectAnnotationDeliveryPending.effect()) {
    yield* put(action.failure(new Error('Annotation delivery is already pending')));
    return;
  }
  yield* put(annotationDeliveryPending(true));
  let settled = false;
  try {
    yield* call(submitAnnotation, action.payload[0]);
    yield* put(annotationDeliverySucceeded());
    yield* put(action.success(undefined));
    settled = true;
  } catch (error) {
    const uncertain =
      (error instanceof AnnotationDeliveryError && error.uncertain) ||
      Boolean(yield* selectAnnotationUncertainMessageId.effect());
    if (uncertain) yield* put(annotationDeliveryUncertain(action.payload[0].messageId));
    yield* put(
      action.failure(
        uncertain ? new AnnotationDeliveryError(true, toError(error).message) : toError(error),
      ),
    );
    settled = true;
  } finally {
    yield* put(annotationDeliveryPending(false));
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Annotation request was cancelled')));
  }
}

export function* annotationSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(loadAnnotationWorkspacesRequested, loadWorkspacesWorker),
    takeEvery(loadAnnotationRecipientsRequested, loadRecipientsWorker),
    takeEvery(submitAnnotationRequested, submitWorker),
    takeEvery(startAnnotationRequested, startAnnotationWorker),
    takeEvery(setAnnotationDestinationRequested, setDestinationWorker),
    takeEvery(setAnnotationToolbarLayoutRequested, setToolbarLayoutWorker),
    takeEvery(requestAnnotationSendRequested, requestSendWorker),
    takeEvery(requestAnnotationScreenshotRequested, requestScreenshotWorker),
    takeEvery(reportAnnotationScreenshotRequested, reportScreenshotWorker),
    takeEvery(reportAnnotationDeliveryRequested, reportDeliveryWorker),
    takeEvery(resolveAnnotationRecipientRequested, resolveRecipientWorker),
    takeEvery(getAnnotationStateRequested, getAnnotationStateWorker),
    takeEvery(setAnnotationToolRequested, setAnnotationToolWorker),
    takeEvery(addAnnotationTranscriptRequested, addAnnotationTranscriptWorker),
    takeEvery(reviewAnnotationRequested, reviewAnnotationWorker),
    takeEvery(closeAnnotationRequested, closeAnnotationWorker),
    call(annotationStateEventSaga),
  ]);
}
