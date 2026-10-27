import { ANNOTATION_PALETTE } from '../utils/annotation-actions';
import { all, delay, put, takeEvery } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import type { AnnotationSessionState } from '$shared/annotation';
import {
  annotationDraftStarted,
  annotationFrameSaved,
  annotationMessageChanged,
  annotationDeliverySucceeded,
  annotationStateReceived,
  closeAnnotationRequested,
  getAnnotationStateRequested,
  loadAnnotationRecipientsRequested,
  loadAnnotationWorkspacesRequested,
  resolveAnnotationRecipientRequested,
  setAnnotationDestinationRequested,
  setAnnotationToolbarLayoutRequested,
  requestAnnotationSendRequested,
  requestAnnotationScreenshotRequested,
  reportAnnotationScreenshotRequested,
  reportAnnotationDeliveryRequested,
  annotationSubmissionRemembered,
  setAnnotationToolRequested,
  submitAnnotationRequested,
} from '$store/renderer/slices/annotation/annotation-slice';
import { AnnotationDeliveryError, type AnnotationSubmission } from '../annotation-types';

/** This fixture runs only local action handlers. It never starts the live annotation saga. */
export function installFeedbackPreview(options: {
  failFirst: boolean;
  deliveryDelayMs?: number;
  screenshotDelayMs?: number;
  failFirstScreenshotReport?: boolean;
  onDelivery: (attempts: AnnotationSubmission[]) => void;
}) {
  const startedAt = Date.now() - 24_000;
  const styles = getComputedStyle(document.documentElement);
  const color = (token: string) => `hsl(${styles.getPropertyValue(token).trim()})`;
  const palette = { ...ANNOTATION_PALETTE };
  const width = window.innerWidth;
  const height = window.innerHeight;
  const capture = (heading: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Annotation preview requires a 2D canvas context');
    context.fillStyle = color('--background');
    context.fillRect(0, 0, width, height);
    context.fillStyle = color('--muted');
    context.fillRect(32, 96, Math.max(1, width - 64), Math.max(1, height - 128));
    context.fillStyle = color('--foreground');
    context.font = '600 24px Inter, sans-serif';
    context.fillText(heading, 52, 62);
    context.font = '16px Inter, sans-serif';
    context.fillText('Navigation review', 58, 140);
    context.fillText('The preview should stay inside the window.', 58, 180);
    return canvas.toDataURL('image/png');
  };
  let session: AnnotationSessionState = {
    workspaceId: 'feedback-preview-workspace',
    workspaceTitle: 'Polish workspace navigation',
    tool: 'draw',
    phase: 'capturing',
    screenshotDataUrl: capture('After opening the workspace'),
    screenshotRevision: 3,
    startedAt,
    transcripts: ['[0:18] The preview is clipped when I move to the next workspace.'],
  };
  store.dispatch(annotationDraftStarted(startedAt));
  store.dispatch(annotationMessageChanged('Please keep the workspace preview inside the window.'));
  store.dispatch(
    annotationFrameSaved({
      id: `${startedAt}:1`,
      screenshotDataUrl: capture('Before opening the workspace'),
      actions: [{ kind: 'rectangle', origin: { x: 40, y: 110 }, end: { x: 440, y: 210 } }],
      palette,
      width,
      height,
      elapsedMs: 8000,
    }),
  );
  store.dispatch(
    annotationFrameSaved({
      id: `${startedAt}:2`,
      screenshotDataUrl: session.screenshotDataUrl,
      actions: [{ kind: 'pin', point: { x: 460, y: 170 }, number: 1, elapsedMs: 18000 }],
      palette,
      width,
      height,
      elapsedMs: 18000,
    }),
  );
  const attempts: AnnotationSubmission[] = [];
  let screenshotCount = 0;
  let screenshotReports = 0;
  function* fixtureSaga() {
    yield* all([
      takeEvery(setAnnotationToolbarLayoutRequested, function* (action) {
        yield* put(action.success(undefined));
      }),
      takeEvery(requestAnnotationScreenshotRequested, function* (action) {
        if (session.screenshotCapture?.status === 'ready') {
          yield* put(annotationStateReceived(session));
          yield* put(action.success(undefined));
          return;
        }
        const requestId = crypto.randomUUID();
        session = { ...session, screenshotCapture: { status: 'capturing', requestId } };
        yield* put(annotationStateReceived(session));
        yield* delay(options.screenshotDelayMs ?? 60);
        session = {
          ...session,
          screenshotCapture: {
            status: 'ready',
            requestId,
            screenshotDataUrl: capture(`Screenshot ${++screenshotCount}`),
            width,
            height,
            elapsedMs: Date.now() - startedAt,
          },
        };
        yield* put(annotationStateReceived(session));
        yield* put(action.success(undefined));
      }),
      takeEvery(reportAnnotationScreenshotRequested, function* (action) {
        if (options.failFirstScreenshotReport && screenshotReports++ === 0) {
          yield* put(action.failure(new Error('Controlled screenshot acknowledgement failure')));
          return;
        }
        const screenshot = session.screenshotCapture;
        const report = action.payload[0];
        if (screenshot?.status !== 'ready' || screenshot.requestId !== report.requestId) {
          yield* put(action.failure(new Error('Screenshot request is no longer current')));
          return;
        }
        session = {
          ...session,
          ...(report.saved && session.tool !== 'mouse'
            ? { screenshotDataUrl: screenshot.screenshotDataUrl }
            : {}),
          screenshotCapture: report.saved
            ? { status: 'saved', requestId: report.requestId }
            : { status: 'failed', requestId: report.requestId, error: 'limit' },
        };
        yield* put(annotationStateReceived(session));
        yield* put(action.success(undefined));
      }),
      takeEvery(getAnnotationStateRequested, function* (action) {
        yield* put(action.success({ success: true, state: session }));
      }),
      takeEvery(loadAnnotationWorkspacesRequested, function* (action) {
        yield* put(
          action.success([
            { id: session.workspaceId, title: session.workspaceTitle },
            { id: 'feedback-other-workspace', title: 'Website polish' },
          ]),
        );
      }),
      takeEvery(loadAnnotationRecipientsRequested, function* (action) {
        const workspaceId = action.payload[0];
        yield* put(
          action.success([
            {
              id: `${workspaceId}:main`,
              agentId: 'fake-main',
              workspaceId,
              name: 'Coordinator',
              kind: 'workspace',
              isDefault: true,
            },
            {
              id: `${workspaceId}:override`,
              agentId: 'fake-agent',
              workspaceId,
              name: 'Dock implementor',
              kind: 'workspace',
            },
          ]),
        );
      }),
      takeEvery(resolveAnnotationRecipientRequested, function* (action) {
        const [destination] = action.payload;
        yield* put(
          action.success({
            id: `${destination.workspaceId}:${destination.agentId ?? 'main'}`,
            agentId: destination.agentId ?? 'fake-main',
            workspaceId: destination.workspaceId,
            name: destination.agentId ? 'Dock implementor' : 'Coordinator',
            kind: 'workspace',
          }),
        );
      }),
      takeEvery(setAnnotationDestinationRequested, function* (action) {
        session = {
          ...session,
          destination: action.payload[0].destination,
          sendRequest: undefined,
          delivery: { status: 'idle' },
        };
        yield* put(annotationStateReceived(session));
        yield* put(action.success(undefined));
      }),
      takeEvery(requestAnnotationSendRequested, function* (action) {
        const requestId = action.payload[0].retryRequestId ?? crypto.randomUUID();
        session = {
          ...session,
          sendRequest: undefined,
          delivery: { status: 'preparing', requestId },
        };
        yield* put(annotationStateReceived(session));
        session = {
          ...session,
          screenshotRevision: session.screenshotRevision + (session.tool === 'mouse' ? 1 : 0),
          sendRequest: {
            requestId,
            destination: session.destination ?? {
              workspaceId: session.workspaceId,
              workspaceTitle: session.workspaceTitle,
              agentId: null,
            },
          },
          delivery: { status: 'sending', requestId },
        };
        yield* put(annotationStateReceived(session));
        yield* put(action.success(undefined));
      }),
      takeEvery(reportAnnotationDeliveryRequested, function* (action) {
        const report = action.payload[0];
        session = {
          ...session,
          delivery: { status: report.status, requestId: report.requestId, error: report.error },
        };
        yield* put(annotationStateReceived(session));
        yield* put(action.success(undefined));
      }),
      takeEvery(submitAnnotationRequested, function* (action) {
        yield* put(annotationSubmissionRemembered(action.payload[0]));
        attempts.push(structuredClone(action.payload[0]));
        options.onDelivery(attempts);
        if (options.deliveryDelayMs) yield* delay(options.deliveryDelayMs);
        if (options.failFirst && attempts.length === 1) {
          yield* put(action.failure(new AnnotationDeliveryError(false, 'Preview delivery failed')));
        } else {
          yield* put(annotationDeliverySucceeded());
          yield* put(action.success(undefined));
        }
      }),
      takeEvery(closeAnnotationRequested, function* (action) {
        yield* put(action.success(undefined));
      }),
      takeEvery(setAnnotationToolRequested, function* (action) {
        // Only returning from live mouse interaction starts a new evidence frame.
        const tool = action.payload[0];
        const newFrame = session.tool === 'mouse' && tool !== 'mouse';
        session = {
          ...session,
          screenshotRevision: session.screenshotRevision + (newFrame ? 1 : 0),
          phase: 'capturing',
          tool: action.payload[0],
          sendRequest: undefined,
          delivery: { status: 'idle' },
        };
        yield* put(annotationStateReceived(session));
        yield* put(action.success(undefined));
      }),
    ]);
  }
  const stop = store.runSaga(fixtureSaga);
  return {
    stop,
  };
}
