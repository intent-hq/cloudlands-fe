/**
 * Dock composer screen evidence orchestration: capture, annotate sessions,
 * clip recording and native mark events for the active conversation pair.
 *
 * The root native-session saga installs the pair's `DockEvidenceNativeService`
 * with `configureDockEvidenceNative`. Until then every request reports
 * `unavailable`; nothing is faked. Pixels live in the pair's composer context
 * items; evidence state references them by id.
 */
import { eventChannel, buffers } from 'redux-saga';
import {
  call,
  delay,
  fork,
  put,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import {
  captureDockPlacementBinding,
  isDockBindingCurrent,
  isDockCapabilitiesObserved,
  probeDockAttachmentCapabilities,
} from '$features/hud/composer/dock-evidence-placement';
import {
  currentDockServerCapabilities,
  selectDockBackendBinding,
  selectDockComposerEvidence,
} from '../dock-conversation-selectors';
import type { DockAnnotationMediaState } from '$shared/dock-annotation';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store as appStore } from '$store/renderer/store';
import type { DockEvidencePrivacyPane } from '$shared/dock-evidence-ipc';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  mintPlacementIdempotencyKey,
  placeAttachmentViaTransport,
} from '$lib/components/chat/input/attachment-placement';
import {
  applyDockCapture,
  dockEvidenceId,
  isDockAttachmentPath,
  dockGeometryBounds,
  sanitizeDockAnnotationIssue,
  numberDockMarks,
  DOCK_EVIDENCE_LIMITS,
  type DockCapturedPixels,
  type DockClipFile,
  type DockComposerEvidence,
  type DockEvidenceErrorCode,
  type DockEvidenceImage,
  type DockEvidenceNativeEvent,
  type DockEvidenceNativeService,
  type DockMarkTool,
  type DockNativeResult,
  reusableDockImage,
  undoableDockMark,
  redoableDockMark,
  parkedDockSessionImage,
  type DockParkedImage,
  recordingDockClip,
  dockClipReferenceId,
} from '$shared/dock-evidence';
import { readDockLastTool, rememberDockLastTool } from '../dock-composer-last-tool';
import {
  annotationIssueNotice,
  annotationStartNotice,
  screenPermissionNotice,
  showDockEvidenceNotice,
  type DockEvidenceNotice,
} from '$features/hud/composer/dock-evidence-notice';
import { DOCK_MARK_TOOLS } from '$shared/dock-evidence';
import { setComposerContextItems } from '../../transient-ui/transient-ui-slice';
import { selectComposerContextItems } from '../../transient-ui/transient-ui-selectors';
import { getPrincipalActionContext } from '../../principal/principal-context';
import {
  dockEvidenceAnnotationChanged,
  dockEvidenceMarkRejected,
  dockEvidenceAnnotationIssue,
  dockEvidenceAnnotationEndRequested,
  dockEvidenceCapabilitiesChanged,
  dockEvidenceServerCapabilitiesObserved,
  dockEvidenceServerCapabilitiesProbeRequested,
  openDockConversationRequested,
  dockEvidenceAnnotationToggleRequested,
  dockEvidenceToolRemembered,
  dockEvidenceCaptureFailed,
  dockEvidenceCaptureRequested,
  dockEvidenceCaptureStarted,
  dockEvidenceSessionRetired,
  dockEvidenceClipChanged,
  dockEvidenceClipRemoveRequested,
  dockEvidenceDictationChanged,
  dockEvidenceDictationFinished,
  dockEvidenceImageCaptured,
  dockEvidenceImageRemoved,
  dockEvidenceImageRemoveRequested,
  dockEvidenceMarkAdded,
  dockEvidenceMarkRemoved,
  dockEvidenceMarkUndone,
  dockEvidenceAnnotationUndoRequested,
  dockEvidenceAnnotationRedoRequested,
  dockEvidenceAnnotationUndone,
  dockEvidenceAnnotationRedone,
  dockEvidenceReferencesEdited,
  dockEvidenceRecordToggleRequested,
  dockEvidenceBarMediaChanged,
  dockEvidenceToolSelectRequested,
  dockEvidenceMouseModeRequested,
  dockEvidenceOpenSettingsRequested,
  dockFeedbackRequested,
  selectDockConversationAgentRequested,
  dockEvidenceToolSet,
} from '../dock-conversation-slice';

let nativeService: DockEvidenceNativeService | null = null;
let unsubscribeNative: (() => void) | null = null;
const nativeListeners = new Set<(event: DockEvidenceNativeEvent) => void>();

/** Install (or remove) the native boundary. Events from a replaced service stop immediately. */
export function configureDockEvidenceNative(service: DockEvidenceNativeService | null): void {
  unsubscribeNative?.();
  unsubscribeNative = null;
  // Answers belong to the replaced native session, which releases its holds on retirement.
  if (nativeService !== service) {
    pendingMarkAnswers.clear();
    markAnswersOverflowed = false;
  }
  nativeService = service;
  if (service)
    unsubscribeNative = service.subscribe((event) => {
      for (const listener of nativeListeners) listener(event);
    });
  appStore.dispatch(
    dockEvidenceCapabilitiesChanged(
      service ? (service.capabilities ?? { capture: true, annotate: false, record: false }) : null,
    ),
  );
}

type DictationMarkSink = (pair: { workspaceId: string; agentId: string }, markId: string) => void;
/** Remove `service` only if it is still the installed boundary (a successor is never removed). */
export function retireDockEvidenceNative(
  service: DockEvidenceNativeService,
  workspaceId: string,
  agentId: string,
): boolean {
  if (nativeService !== service) return false;
  // No yield: old replies cannot run between retirement and boundary removal,
  // and a successor can never have its transient draft or mark sink cleared here.
  appStore.dispatch(dockEvidenceSessionRetired(workspaceId, agentId, crypto.randomUUID()));
  setDockDictationMarkSink(null);
  configureDockEvidenceNative(null);
  return true;
}

let dictationMarkSink: DictationMarkSink | null = null;
/**
 * The live dictation owner stamps each mark on its audio clock (word-timed chip
 * placement). Installed by the dictation session; null when none is live.
 */
export function setDockDictationMarkSink(sink: DictationMarkSink | null): void {
  dictationMarkSink = sink;
}

export function evidenceOf(workspaceId: string, agentId: string): DockComposerEvidence | undefined {
  return getItem(appStore.state.dockConversation.evidence, dockEvidenceId(workspaceId, agentId));
}

/** Only the open, current-authority conversation pair may mutate evidence. */
function activePair(workspaceId: string, agentId: string): boolean {
  const dock = appStore.state.dockConversation;
  return (
    dock.workspaceId === workspaceId &&
    dock.agentId === agentId &&
    !!dock.authority &&
    dock.authority === getPrincipalActionContext(appStore.state)
  );
}

/** Banner notice for the pair; its "Open Settings" goes through the native-session owner. */
function* notice(
  workspaceId: string,
  agentId: string,
  value: DockEvidenceNotice,
): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  yield* call(showDockEvidenceNotice, value, (pane: DockEvidencePrivacyPane) =>
    appStore.dispatch(dockEvidenceOpenSettingsRequested(workspaceId, agentId, pane)),
  );
}

function toolFor(workspaceId: string): DockMarkTool {
  const dock = appStore.state.dockConversation;
  return dock.toolByWorkspace[workspaceId] ?? dock.rememberedToolByWorkspace[workspaceId] ?? 'pick';
}

function pixelsFor(workspaceId: string, agentId: string, image: DockEvidenceImage) {
  const item = selectComposerContextItems
    .select(appStore.state, workspaceId, agentId)
    .find((row) => row.id === image.contextItemId);
  if (!item?.imageData || !item.imageMimeType) return null;
  return {
    base64: item.imageData,
    mimeType: item.imageMimeType as DockCapturedPixels['mimeType'],
    width: image.width,
    height: image.height,
    displayScale: image.displayScale,
    capturedAt: image.capturedAt,
    ...(image.hash ? { hash: image.hash } : {}),
  };
}

/** Add one screenshot as a context item plus evidence image; null when refused. */
function* addCapturedImage(
  workspaceId: string,
  agentId: string,
  pixels: DockCapturedPixels,
  source: DockEvidenceImage['source'],
): SagaGenerator<DockEvidenceImage | null> {
  const native = pixels.image;
  if (native) {
    // Native identity must describe these exact pixels.
    if (
      typeof native.id !== 'string' ||
      !native.id ||
      typeof native.contextItemId !== 'string' ||
      !native.contextItemId ||
      native.width !== pixels.width ||
      native.height !== pixels.height ||
      native.displayScale !== pixels.displayScale
    ) {
      yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, 'failed'));
      return null;
    }
    // A repeated delivery of the same native capture is not a second tile.
    const existing = evidenceOf(workspaceId, agentId)?.images.find((row) => row.id === native.id);
    if (existing) {
      // Settles a pending capture without a tile or an accepted-capture flash.
      yield* put(dockEvidenceImageCaptured(workspaceId, agentId, existing));
      return existing;
    }
  }
  const id = native?.id ?? crypto.randomUUID();
  const image: DockEvidenceImage = native
    ? {
        id,
        contextItemId: native.contextItemId,
        width: native.width,
        height: native.height,
        displayScale: native.displayScale,
        capturedAt: native.capturedAt,
        source: native.source,
        ...(native.hash ? { hash: native.hash } : pixels.hash ? { hash: pixels.hash } : {}),
      }
    : {
        id,
        contextItemId: `dock-evidence:${id}`,
        width: pixels.width,
        height: pixels.height,
        displayScale: pixels.displayScale,
        capturedAt: pixels.capturedAt,
        source,
        ...(pixels.hash ? { hash: pixels.hash } : {}),
      };
  const current = evidenceOf(workspaceId, agentId);
  const outcome = current ? applyDockCapture(current, image) : { outcome: 'added' as const };
  if (outcome.outcome === 'limit' || outcome.outcome === 'invalid') {
    yield* put(
      dockEvidenceCaptureFailed(
        workspaceId,
        agentId,
        outcome.outcome === 'limit' ? 'limit' : 'failed',
      ),
    );
    return null;
  }
  const extension = pixels.mimeType.split('/')[1] ?? 'png';
  const item: ContextItem = {
    id: image.contextItemId,
    type: 'file',
    // A file name, not prose: the composer never shows evidence items as pills.
    label: `screenshot-${pixels.capturedAt.replace(/[^0-9]/g, '')}.${extension}`,
    imageData: pixels.base64,
    imageMimeType: pixels.mimeType,
  };
  const replaced = outcome.outcome === 'replaced' ? outcome.replaced.contextItemId : null;
  const items = selectComposerContextItems
    .select(appStore.state, workspaceId, agentId)
    .filter((row) => row.id !== replaced && row.id !== image.contextItemId);
  yield* put(setComposerContextItems(workspaceId, agentId, [...items, item]));
  yield* put(dockEvidenceImageCaptured(workspaceId, agentId, image));
  return image;
}

function* capture({
  payload: [workspaceId, agentId],
}: ReturnType<typeof dockEvidenceCaptureRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const evidence = evidenceOf(workspaceId, agentId);
  if (evidence?.capture.pending) return;
  // An open session image without marks is reused rather than duplicated.
  const sessionImage = evidence?.annotation?.imageId;
  if (sessionImage && !evidence.marks.some((mark) => mark.imageId === sessionImage)) return;
  const service = nativeService;
  if (!service) {
    yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, 'unavailable'));
    return;
  }
  yield* put(dockEvidenceCaptureStarted(workspaceId, agentId));
  let result: DockNativeResult<DockCapturedPixels>;
  try {
    result = yield* call([service, service.captureDisplay]);
  } catch {
    result = { ok: false, error: 'failed' };
  }
  if (nativeService !== service || !activePair(workspaceId, agentId)) return;
  if (!result.ok) {
    yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, result.error));
    if (result.error === 'permission')
      yield* notice(workspaceId, agentId, screenPermissionNotice('capture'));
    return;
  }
  yield* addCapturedImage(workspaceId, agentId, result.value, 'capture');
}

function* startSession(
  workspaceId: string,
  agentId: string,
  tool: DockMarkTool,
  mode: 'live' | 'still' | 'dictation',
  stillImageId?: string,
): SagaGenerator<void> {
  const service = nativeService;
  // Dictation's click-to-pick session is implicit; only an annotate start reports refusals.
  const visible = mode !== 'dictation';
  if (!service) {
    yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, 'unavailable'));
    if (visible) yield* notice(workspaceId, agentId, annotationStartNotice('unavailable'));
    return;
  }
  const image = stillImageId
    ? evidenceOf(workspaceId, agentId)?.images.find((row) => row.id === stillImageId)
    : undefined;
  const pixels = image ? pixelsFor(workspaceId, agentId, image) : null;
  if (stillImageId && (!image || !pixels)) return;
  const id = crypto.randomUUID();
  // Immediate feedback: the session shows (button, header, placeholder) while the
  // overlay opens. Ending it meanwhile ends the start; a refusal takes it back.
  yield* put(
    dockEvidenceAnnotationChanged(workspaceId, agentId, { id, mode, imageId: image?.id ?? null }),
  );
  const ours = () => evidenceOf(workspaceId, agentId)?.annotation?.id === id;
  // The tool bar shows the composer's Screenshot/Record from its first frame.
  if (visible) yield* sendBarMedia(workspaceId, agentId);
  let result: DockNativeResult<void>;
  try {
    result = yield* call([service, service.startAnnotation], {
      id,
      tool,
      mode,
      ...(image && pixels ? { still: { imageId: image.id, pixels } } : {}),
    });
  } catch {
    result = { ok: false, error: 'failed' };
  }
  if (!activePair(workspaceId, agentId)) {
    if (result.ok) yield* endNative(service, id);
    return;
  }
  if (!result.ok) {
    // Ended or replaced while opening: that was the person's choice, not a failure.
    if (!ours()) return;
    yield* put(dockEvidenceAnnotationChanged(workspaceId, agentId, null));
    yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, result.error));
    if (visible)
      yield* notice(workspaceId, agentId, annotationStartNotice(result.error, result.detail));
    return;
  }
  if (!ours()) {
    yield* endNative(service, id);
    return;
  }
  yield* syncMarks(workspaceId, agentId);
}

/**
 * Recently ended annotation sessions → their pair, so a late native gesture id
 * from that session is still settled (rejected) in the right draft. Bounded.
 */
const endedSessions = new Map<string, readonly [string, string]>();
function rememberEndedSession(sessionId: string, workspaceId: string, agentId: string): void {
  endedSessions.delete(sessionId);
  endedSessions.set(sessionId, [workspaceId, agentId]);
  while (endedSessions.size > 32) endedSessions.delete(endedSessions.keys().next().value!);
}

/**
 * End a native annotate session. Native may already have ended it (start refused or
 * timed out, the overlay's X, a display change) and then answers "unavailable"; that
 * is the state we want, never a failure that may stop this saga (and every later
 * annotate click with it).
 */
function* endNative(service: DockEvidenceNativeService, id: string): SagaGenerator<void> {
  try {
    yield* call([service, service.endAnnotation], id);
  } catch {
    // Already ended natively.
  }
}

function* endSession(workspaceId: string, agentId: string): SagaGenerator<void> {
  const session = evidenceOf(workspaceId, agentId)?.annotation;
  if (!session) return;
  rememberEndedSession(session.id, workspaceId, agentId);
  yield* put(dockEvidenceAnnotationChanged(workspaceId, agentId, null));
  const service = nativeService;
  if (service) yield* endNative(service, session.id);
}

/** How long a feedback entry waits for its conversation and native session. */
const DOCK_FEEDBACK_START_TIMEOUT_MS = 15_000;

/**
 * A feedback entry point: open the workspace's conversation (and its agent when
 * known), wait for that pair's native session, then start annotate with the
 * current tool. A newer request replaces this one; a timeout says so in the banner.
 */
function* startFeedback({
  payload: [workspaceId, agentId],
}: ReturnType<typeof dockFeedbackRequested>): SagaGenerator<void> {
  if (appStore.state.dockConversation.workspaceId !== workspaceId)
    yield* put(openDockConversationRequested(workspaceId));
  let agentRequested = false;
  const deadline = Date.now() + DOCK_FEEDBACK_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const dock = appStore.state.dockConversation;
    if (dock.workspaceId !== workspaceId) return; // Navigated elsewhere meanwhile.
    if (agentId && dock.agentId && dock.agentId !== agentId && !agentRequested) {
      agentRequested = true;
      yield* put(selectDockConversationAgentRequested(agentId));
    } else if (
      dock.agentId &&
      (!agentId || dock.agentId === agentId) &&
      activePair(workspaceId, dock.agentId) &&
      dock.nativeCapabilities?.annotate
    ) {
      const annotation = evidenceOf(workspaceId, dock.agentId)?.annotation;
      if (!annotation || annotation.mode === 'dictation')
        yield* put(dockEvidenceAnnotationToggleRequested(workspaceId, dock.agentId));
      return;
    }
    yield* delay(100);
  }
  const dock = appStore.state.dockConversation;
  if (dock.workspaceId === workspaceId && dock.agentId)
    yield* notice(workspaceId, dock.agentId, annotationStartNotice('unavailable'));
}

/**
 * Done on the tool bar. The marked session image already sits in the composer with its
 * marks drawn in; it is kept as is and the next mark starts a new image (native has
 * cleared the screen). With nothing marked yet, Done takes one plain capture instead.
 * A Mark-up session on a still image simply ends (its tile already holds the marks).
 */
function* commitAnnotation(workspaceId: string, agentId: string): SagaGenerator<void> {
  const evidence = evidenceOf(workspaceId, agentId);
  const session = evidence?.annotation;
  if (!evidence || !session) return;
  if (session.mode === 'still') {
    yield* endSession(workspaceId, agentId);
    return;
  }
  const marked =
    !!session.imageId && evidence.marks.some((mark) => mark.imageId === session.imageId);
  if (marked) {
    yield* put(dockEvidenceAnnotationChanged(workspaceId, agentId, { ...session, imageId: null }));
    yield* syncMarks(workspaceId, agentId);
    return;
  }
  yield* put(dockEvidenceCaptureRequested(workspaceId, agentId));
}

/**
 * Clear on the tool bar: the marks on screen go without being attached. A live
 * session's image exists only for those marks, so it is removed with them (its
 * chips too); a still session keeps its image and loses only its marks.
 */
function* clearAnnotation(workspaceId: string, agentId: string): SagaGenerator<void> {
  const evidence = evidenceOf(workspaceId, agentId);
  const imageId = evidence?.annotation?.imageId;
  if (!evidence?.annotation || !imageId) return;
  if (evidence.annotation.mode === 'still') {
    for (const mark of evidence.marks.filter((row) => row.imageId === imageId))
      yield* put(dockEvidenceMarkRemoved(workspaceId, agentId, mark.id));
    yield* syncMarks(workspaceId, agentId);
    return;
  }
  yield* removeImage(dockEvidenceImageRemoveRequested(workspaceId, agentId, imageId));
}

/** Cmd/Ctrl+Z while annotating: the session's newest mark goes (its image too if it was the only one). */
function* undoAnnotation({
  payload: [workspaceId, agentId],
}: ReturnType<typeof dockEvidenceAnnotationUndoRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const evidence = evidenceOf(workspaceId, agentId);
  const mark = undoableDockMark(evidence);
  if (!evidence?.annotation || !mark) return;
  const items = selectComposerContextItems.select(appStore.state, workspaceId, agentId);
  const onlyMark =
    evidence.annotation.mode === 'live' &&
    evidence.marks.filter((row) => row.imageId === mark.imageId).length === 1;
  const image = onlyMark ? evidence.images.find((row) => row.id === mark.imageId) : undefined;
  const item = image ? items.find((row) => row.id === image.contextItemId) : undefined;
  const parked: DockParkedImage | null =
    image && item?.imageData && item.imageMimeType
      ? {
          image,
          item: {
            id: item.id,
            label: item.label,
            imageData: item.imageData,
            imageMimeType: item.imageMimeType,
          },
        }
      : null;
  yield* put(dockEvidenceAnnotationUndone(workspaceId, agentId, parked));
  if (parked)
    yield* put(
      setComposerContextItems(
        workspaceId,
        agentId,
        items.filter((row) => row.id !== parked.item.id),
      ),
    );
  yield* syncMarks(workspaceId, agentId);
}

/** Cmd/Ctrl+Shift+Z while annotating: the newest undone mark returns with its number and capture. */
function* redoAnnotation({
  payload: [workspaceId, agentId],
}: ReturnType<typeof dockEvidenceAnnotationRedoRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const evidence = evidenceOf(workspaceId, agentId);
  if (!evidence || !redoableDockMark(evidence)) return;
  const entry = evidence.annotationHistory!.redo.at(-1)!;
  const parked = entry.image;
  if (parked)
    yield* put(
      setComposerContextItems(workspaceId, agentId, [
        ...selectComposerContextItems
          .select(appStore.state, workspaceId, agentId)
          .filter((row) => row.id !== parked.item.id),
        { ...parked.item, type: 'file' },
      ]),
    );
  yield* put(dockEvidenceAnnotationRedone(workspaceId, agentId));
  const restored = evidenceOf(workspaceId, agentId)?.marks.some((row) => row.id === entry.mark.id);
  // Refused (for example no room for the image): its bytes do not stay behind.
  if (!restored && parked)
    yield* put(
      setComposerContextItems(
        workspaceId,
        agentId,
        selectComposerContextItems
          .select(appStore.state, workspaceId, agentId)
          .filter((row) => row.id !== parked.item.id),
      ),
    );
  yield* syncMarks(workspaceId, agentId);
}

function* toggleAnnotation({
  payload: [workspaceId, agentId, stillImageId],
}: ReturnType<typeof dockEvidenceAnnotationToggleRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const session = evidenceOf(workspaceId, agentId)?.annotation;
  if (session && session.mode !== 'dictation' && !stillImageId) {
    yield* endSession(workspaceId, agentId);
    return;
  }
  if (session) yield* endSession(workspaceId, agentId);
  const tool = toolFor(workspaceId);
  yield* put(dockEvidenceToolSet(workspaceId, tool));
  yield* startSession(workspaceId, agentId, tool, stillImageId ? 'still' : 'live', stillImageId);
}

function* selectTool({
  payload: [workspaceId, agentId, tool],
}: ReturnType<typeof dockEvidenceToolSelectRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  yield* put(dockEvidenceToolSet(workspaceId, tool));
  const session = evidenceOf(workspaceId, agentId)?.annotation;
  const service = nativeService;
  // Choosing a tool while the mic is live turns its implicit pick session into an
  // annotate session; marks still insert their chips at the dictation point.
  if (session?.mode === 'dictation') {
    yield* endSession(workspaceId, agentId);
    yield* startSession(workspaceId, agentId, tool, 'live');
  } else if (session && service) {
    try {
      yield* call([service, service.setAnnotationTool], session.id, tool);
    } catch {
      // The session already ended natively; its end event clears it here.
    }
  } else if (!session) yield* startSession(workspaceId, agentId, tool, 'live');
}

/** Native draws outlines and badges; the renderer's numbering is authoritative. */
function* syncMarks(workspaceId: string, agentId: string): SagaGenerator<void> {
  const evidence = evidenceOf(workspaceId, agentId);
  const session = evidence?.annotation;
  const service = nativeService;
  if (!evidence || !session || !service) return;
  const marks = numberDockMarks(evidence)
    .filter(({ mark }) => mark.imageId === session.imageId)
    .map(({ n, mark }) => ({ n, tool: mark.tool, geometry: mark.geometry }));
  try {
    yield* call([service, service.syncMarks], session.id, marks);
  } catch {
    // A failed redraw never changes evidence; the next mark change resyncs.
  }
}

/**
 * Mark answers native has not confirmed, keyed by gesture id, for the installed
 * service only. Native holds that mark's speech words (and its Stop) until it gets
 * an answer, so a lost answer is retained and retried with the same value
 * (idempotent on the native side), never assumed delivered.
 */
const pendingMarkAnswers = new Map<string, { sessionId: string; accepted: boolean }>();
/**
 * No unconfirmed answer is ever evicted (native may hold it indefinitely). Past
 * this many, a new one cannot be retained, so the session fails closed instead:
 * every Stop/Send barrier stays false until the native session is replaced.
 */
const PENDING_MARK_ANSWERS = 1024;
let markAnswersOverflowed = false;

/** Per-attempt bound: a held answer never stalls event processing or a Stop. */
let markAnswerTimeoutMs = 2_500;

/** Test seam for the per-attempt answer bound (null restores the default). */
export function __setDockMarkAnswerTimeoutForTests(ms: number | null): void {
  markAnswerTimeoutMs = ms ?? 2_500;
}

/** One bounded delivery attempt; anything but a confirmed ok (including a timeout) is false. */
async function deliverMarkAnswer(
  service: DockEvidenceNativeService,
  sessionId: string,
  markId: string,
  accepted: boolean,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attempt = Promise.resolve()
      .then(() => service.reportMarkAcceptance!(sessionId, markId, accepted))
      .then((result) => result?.ok === true);
    const bound = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), markAnswerTimeoutMs);
    });
    return await Promise.race([attempt, bound]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Answer native for its own gesture id; a failed answer is kept for retry. */
function* answerNativeMark(
  sessionId: string,
  markId: string | null,
  accepted: boolean,
): SagaGenerator<void> {
  const service = nativeService;
  if (!markId || !service?.reportMarkAcceptance) return;
  // A decided answer never changes; only its delivery is retried.
  const decided = pendingMarkAnswers.get(markId);
  const answer = decided ?? { sessionId, accepted };
  if (!decided && pendingMarkAnswers.size >= PENDING_MARK_ANSWERS) markAnswersOverflowed = true;
  else pendingMarkAnswers.set(markId, answer);
  const delivered = yield* call(() =>
    deliverMarkAnswer(service, answer.sessionId, markId, answer.accepted),
  );
  if (delivered && nativeService === service && pendingMarkAnswers.get(markId) === answer)
    pendingMarkAnswers.delete(markId);
}

/**
 * Retry every unconfirmed mark answer (in order). True when none remain, i.e.
 * native is not holding speech for an answer this renderer owes it.
 */
export function* flushDockMarkAnswers(): SagaGenerator<boolean> {
  const service = nativeService;
  if (!service?.reportMarkAcceptance)
    return pendingMarkAnswers.size === 0 && !markAnswersOverflowed;
  for (const [markId, answer] of [...pendingMarkAnswers]) {
    const delivered = yield* call(() =>
      deliverMarkAnswer(service, answer.sessionId, markId, answer.accepted),
    );
    if (delivered && nativeService === service && pendingMarkAnswers.get(markId) === answer)
      pendingMarkAnswers.delete(markId);
  }
  return pendingMarkAnswers.size === 0 && !markAnswersOverflowed;
}

/**
 * Explicitly settle a refused native gesture id: native drops its held speech
 * reference, and any reference that already reached the queue is dropped too.
 */
function* rejectNativeMark(
  workspaceId: string,
  agentId: string,
  sessionId: string,
  markId: string | null,
): SagaGenerator<void> {
  if (!markId) return;
  yield* put(dockEvidenceMarkRejected(workspaceId, agentId, markId));
  yield* answerNativeMark(sessionId, markId, false);
}

function* onNativeMark(
  event: Extract<DockEvidenceNativeEvent, { type: 'mark' }>,
): SagaGenerator<void> {
  // Native-minted ids carry the real gesture time and may already be stamped into speech.
  const nativeId =
    typeof event.markId === 'string' && event.markId.length > 0 && event.markId.length <= 128
      ? event.markId
      : null;
  const owner = getItems(appStore.state.dockConversation.evidence).find(
    (row) => row.annotation?.id === event.sessionId,
  );
  if (!owner?.annotation) {
    // A late gesture from an ended session never joins any image; settle its speech chip.
    const ended = endedSessions.get(event.sessionId);
    if (ended) yield* rejectNativeMark(ended[0], ended[1], event.sessionId, nativeId);
    else yield* answerNativeMark(event.sessionId, nativeId, false);
    return;
  }
  const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
  if (!activePair(workspaceId, agentId)) {
    yield* rejectNativeMark(workspaceId, agentId, event.sessionId, nativeId);
    return;
  }
  let imageId = owner.annotation.imageId;
  // The first live mark, or a mark after the screen changed, starts a new image.
  if (event.capture) {
    const source = owner.annotation.mode === 'dictation' ? 'dictation' : 'annotate';
    // Capture, then annotate the same screen: the first mark lands on that capture.
    const reused =
      owner.annotation.imageId === null && owner.annotation.mode !== 'still'
        ? reusableDockImage(owner, event.capture)
        : null;
    const image = reused ?? (yield* addCapturedImage(workspaceId, agentId, event.capture, source));
    if (!image) {
      // Native already holds the refused pixels; ending this session stops later marks
      // from joining them or an older image. The limit/failed error stays visible.
      yield* rejectNativeMark(workspaceId, agentId, event.sessionId, nativeId);
      if (evidenceOf(workspaceId, agentId)?.annotation?.id === event.sessionId)
        yield* endSession(workspaceId, agentId);
      return;
    }
    imageId = image.id;
    const session = evidenceOf(workspaceId, agentId)?.annotation;
    if (session?.id === event.sessionId)
      yield* put(dockEvidenceAnnotationChanged(workspaceId, agentId, { ...session, imageId }));
  }
  // Undo set the session image aside, but the overlay still draws on it: a new mark
  // (no fresh capture) brings it back as the session image, then lands on it.
  const parked = !event.capture && !imageId ? parkedDockSessionImage(owner) : null;
  if (parked) {
    yield* put(
      setComposerContextItems(workspaceId, agentId, [
        ...selectComposerContextItems
          .select(appStore.state, workspaceId, agentId)
          .filter((row) => row.id !== parked.item.id),
        { ...parked.item, type: 'file' },
      ]),
    );
    yield* put(dockEvidenceImageCaptured(workspaceId, agentId, parked.image));
    const session = evidenceOf(workspaceId, agentId)?.annotation;
    if (
      session?.id === event.sessionId &&
      evidenceOf(workspaceId, agentId)?.images.some((row) => row.id === parked.image.id)
    ) {
      imageId = parked.image.id;
      yield* put(dockEvidenceAnnotationChanged(workspaceId, agentId, { ...session, imageId }));
    }
  }
  if (!imageId) {
    yield* rejectNativeMark(workspaceId, agentId, event.sessionId, nativeId);
    return;
  }
  const dictation = evidenceOf(workspaceId, agentId)?.dictation;
  // Reusing a native id is a duplicate delivery, not a new mark.
  if (nativeId && evidenceOf(workspaceId, agentId)?.marks.some((row) => row.id === nativeId)) {
    // Already stored: answer again (idempotent) so native never waits on a duplicate.
    yield* answerNativeMark(event.sessionId, nativeId, true);
    return;
  }
  const markId = nativeId ?? crypto.randomUUID();
  const gestureAt =
    typeof event.gestureAtEpochMs === 'number' && Number.isFinite(event.gestureAtEpochMs)
      ? event.gestureAtEpochMs
      : Date.now();
  yield* put(
    dockEvidenceMarkAdded(workspaceId, agentId, {
      id: markId,
      imageId,
      tool: event.tool,
      geometry: event.geometry,
      bounds: dockGeometryBounds(event.geometry),
      element: event.element,
      createdAt: gestureAt,
      ...(event.clipMs !== undefined ? { clipMs: event.clipMs } : {}),
      ...(event.clipMs !== undefined && recordingDockClip(evidenceOf(workspaceId, agentId))
        ? { clipId: recordingDockClip(evidenceOf(workspaceId, agentId))!.id }
        : {}),
      ...(dictation?.status === 'listening'
        ? { dictationOffsetMs: Math.max(0, gestureAt - dictation.startedAt) }
        : {}),
    }),
  );
  const accepted = evidenceOf(workspaceId, agentId)?.marks.some((row) => row.id === markId);
  if (accepted) yield* answerNativeMark(event.sessionId, nativeId, true);
  // Refused (limit or invalid geometry): settle a native id already stamped into speech.
  else yield* rejectNativeMark(workspaceId, agentId, event.sessionId, nativeId);
  // Native already stamped its own id at the click; only renderer-minted ids are stamped here.
  if (accepted && !nativeId && dictation?.status === 'listening')
    dictationMarkSink?.({ workspaceId, agentId }, markId);
  yield* syncMarks(workspaceId, agentId);
}

function* removeImage({
  payload: [workspaceId, agentId, imageId],
}: ReturnType<typeof dockEvidenceImageRemoveRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const image = evidenceOf(workspaceId, agentId)?.images.find((row) => row.id === imageId);
  if (!image) return;
  const items = selectComposerContextItems.select(appStore.state, workspaceId, agentId);
  yield* put(
    setComposerContextItems(
      workspaceId,
      agentId,
      items.filter((row) => row.id !== image.contextItemId),
    ),
  );
  yield* put(dockEvidenceImageRemoved(workspaceId, agentId, imageId));
  yield* syncMarks(workspaceId, agentId);
}

/**
 * While dictating, a recording's start and stop become text chips at the point of
 * speech ("Recording 2", "Recording 2 ends"), placed by the same audio clock as marks.
 */
function stampRecordingInSpeech(
  workspaceId: string,
  agentId: string,
  clipId: string,
  end: boolean,
): void {
  if (evidenceOf(workspaceId, agentId)?.dictation?.status !== 'listening') return;
  dictationMarkSink?.({ workspaceId, agentId }, dockClipReferenceId(clipId, end));
}

/** One clip of the pair's message by id. */
function clipOf(workspaceId: string, agentId: string, clipId: string) {
  return evidenceOf(workspaceId, agentId)?.clips.find((clip) => clip.id === clipId);
}

function* removeClip({
  payload: [workspaceId, agentId, clipId],
}: ReturnType<typeof dockEvidenceClipRemoveRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const clip = clipOf(workspaceId, agentId, clipId);
  if (!clip) return;
  yield* put(dockEvidenceClipChanged(workspaceId, agentId, clip.id, null));
  if (clip.contextItemId) {
    const items = selectComposerContextItems.select(appStore.state, workspaceId, agentId);
    yield* put(
      setComposerContextItems(
        workspaceId,
        agentId,
        items.filter((row) => row.id !== clip.contextItemId),
      ),
    );
  }
  const service = nativeService;
  // Removing a live recording discards it; its late result is ignored by id.
  if (clip.status === 'recording' && service) {
    yield* call([service, service.stopClip], clip.id);
    return;
  }
  // A finished clip's native temp file is no longer needed; best-effort and never re-stops.
  if (service?.releaseClip)
    yield* call(() =>
      service.releaseClip!(clip.id).catch(() => ({ ok: false as const, error: 'failed' as const })),
    );
}

/** Native: the user stopped (or the dock retired) before recording began; nothing was written. */
function clipCancelled(result: DockNativeResult<unknown>): boolean {
  return !result.ok && result.error === 'failed' && result.detail === 'cancelled';
}

function* toggleRecording({
  payload: [workspaceId, agentId],
}: ReturnType<typeof dockEvidenceRecordToggleRequested>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const evidence = evidenceOf(workspaceId, agentId);
  const clip = recordingDockClip(evidence);
  const service = nativeService;
  if (clip) {
    if (!service) return;
    stampRecordingInSpeech(workspaceId, agentId, clip.id, true);
    let result: DockNativeResult<DockClipFile>;
    try {
      result = yield* call([service, service.stopClip], clip.id);
    } catch {
      result = { ok: false, error: 'failed' };
    }
    if (nativeService === service)
      yield* finishClip(workspaceId, agentId, clip.id, result);
    return;
  }
  // Each finished recording is its own attachment; a new one starts beside them.
  if ((evidence?.clips.length ?? 0) >= DOCK_EVIDENCE_LIMITS.clips) return;
  // Refused before any native recording starts when the clip could not be stored.
  if (!(yield* clipStorable(workspaceId))) {
    yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, 'unsupported-workspace'));
    return;
  }
  if (!service) {
    yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, 'unavailable'));
    return;
  }
  if (nativeService !== service || !activePair(workspaceId, agentId)) return;
  const id = crypto.randomUUID();
  const hasMicAudio = evidence?.dictation?.status === 'listening';
  yield* put(
    dockEvidenceClipChanged(workspaceId, agentId, id, {
      id,
      status: 'recording',
      startedAt: Date.now(),
      durationMs: 0,
      hasMicAudio,
    }),
  );
  let started: DockNativeResult<void>;
  try {
    started = yield* call([service, service.startClip], id, {
      includeMic: hasMicAudio,
      maxMs: DOCK_EVIDENCE_LIMITS.clipMs,
    });
  } catch {
    started = { ok: false, error: 'failed' };
  }
  if (nativeService !== service || !activePair(workspaceId, agentId) || !clipOf(workspaceId, agentId, id)) return;
  if (started.ok) stampRecordingInSpeech(workspaceId, agentId, id, false);
  if (!started.ok && started.error === 'permission' && activePair(workspaceId, agentId)) {
    yield* put(dockEvidenceCaptureFailed(workspaceId, agentId, 'permission'));
    yield* notice(workspaceId, agentId, screenPermissionNotice('record'));
  }
  if (!started.ok && clipOf(workspaceId, agentId, id))
    yield* put(
      dockEvidenceClipChanged(
        workspaceId,
        agentId,
        id,
        clipCancelled(started)
          ? null
          : {
              id,
              status: 'failed',
              startedAt: Date.now(),
              durationMs: 0,
              hasMicAudio,
              error: started.error,
            },
      ),
    );
}

const completingClips = new Set<string>();

/** Claim before the first yield; both native completion routes share one placement. */
function* finishClip(
  workspaceId: string,
  agentId: string,
  clipId: string,
  result: DockNativeResult<DockClipFile>,
): SagaGenerator<void> {
  if (completingClips.has(clipId) || clipOf(workspaceId, agentId, clipId)?.status !== 'recording')
    return;
  completingClips.add(clipId);
  try {
    yield* placeFinishedClip(workspaceId, agentId, clipId, result);
  } finally {
    completingClips.delete(clipId);
  }
}

/** Place a finished clip as a workspace attachment; the clip stays blocking until placed. */
function* placeFinishedClip(
  workspaceId: string,
  agentId: string,
  clipId: string,
  result: DockNativeResult<DockClipFile>,
): SagaGenerator<void> {
  const clip = clipOf(workspaceId, agentId, clipId);
  if (!clip || !activePair(workspaceId, agentId)) return;
  const fail = (error: DockEvidenceErrorCode) =>
    put(
      dockEvidenceClipChanged(workspaceId, agentId, clipId, { ...clip, status: 'failed', error }),
    );
  if (!result.ok) {
    // Stopped before the first frame: no file exists, so no tile either.
    if (clipCancelled(result))
      yield* put(dockEvidenceClipChanged(workspaceId, agentId, clipId, null));
    // `limit` (too large to play back) keeps its code for a specific failed-tile message.
    else yield* fail(result.error);
    return;
  }
  const file = result.value;
  const service = nativeService;
  const idempotencyKey = mintPlacementIdempotencyKey();
  // The assistant workspace stores file references only where the current connection
  // advertised `chiefAttachments` (re-verified here: the backend may have changed).
  const binding = captureDockPlacementBinding();
  const storable = yield* clipStorable(workspaceId);
  if (!clipOf(workspaceId, agentId, clipId) || nativeService !== service) return;
  if (!storable || !isDockBindingCurrent(binding)) {
    yield* fail('unsupported-workspace');
    return;
  }
  // Size limits and chunking belong to the transport-aware placement below.
  if (!(file.size > 0)) {
    yield* fail('failed');
    return;
  }
  const durationMs = Math.min(DOCK_EVIDENCE_LIMITS.clipMs, Math.max(0, file.durationMs));
  const contextItemId = `dock-evidence:${clipId}`;
  const fileName = `clip-${clipId.slice(0, 8)}.${file.mimeType.split('/')[1] ?? 'webm'}`;
  const staged: ContextItem = {
    id: contextItemId,
    type: 'file',
    label: fileName,
    sourcePath: file.sourcePath,
    attachmentMimeType: file.mimeType,
    placementStatus: 'placing',
  };
  const withItem = (item: ContextItem) => [
    ...selectComposerContextItems
      .select(appStore.state, workspaceId, agentId)
      .filter((row) => row.id !== contextItemId),
    item,
  ];
  yield* put(setComposerContextItems(workspaceId, agentId, withItem(staged)));
  yield* put(
    dockEvidenceClipChanged(workspaceId, agentId, clipId, {
      ...clip,
      status: 'placing',
      durationMs,
      hasMicAudio: file.hasMicAudio,
      contextItemId,
    }),
  );
  try {
    const placed = yield* call(
      placeAttachmentViaTransport,
      workspaceId,
      fileName,
      {
        sourcePath: file.sourcePath,
        mimeType: file.mimeType,
        idempotencyKey,
      },
      undefined,
      undefined,
      // Every placement step stays on the connection this clip was verified against.
      () => !!clipOf(workspaceId, agentId, clipId) && isDockBindingCurrent(binding),
    );
    if (!clipOf(workspaceId, agentId, clipId)) return;
    yield* put(
      setComposerContextItems(
        workspaceId,
        agentId,
        withItem({
          ...staged,
          placementStatus: 'placed',
          attachmentId: placed.attachmentId,
          attachmentMimeType: placed.mimeType ?? file.mimeType,
          attachmentSize: placed.size,
        }),
      ),
    );
    yield* put(
      dockEvidenceClipChanged(workspaceId, agentId, clipId, {
        ...clip,
        status: 'ready',
        durationMs,
        hasMicAudio: file.hasMicAudio,
        contextItemId,
        // Playback derives only from the daemon-acknowledged placement path.
        ...(isDockAttachmentPath(placed.path) ? { path: placed.path } : {}),
      }),
    );
    // The daemon now owns the bytes; native may drop its finished temp file (never re-stops).
    const releasing = service;
    if (releasing?.releaseClip)
      yield* call(() =>
        releasing.releaseClip!(clipId).catch(() => ({
          ok: false as const,
          error: 'failed' as const,
        })),
      );
  } catch {
    if (!clipOf(workspaceId, agentId, clipId)) return;
    yield* put(
      setComposerContextItems(
        workspaceId,
        agentId,
        withItem({ ...staged, placementStatus: 'failed' }),
      ),
    );
    yield* put(
      dockEvidenceClipChanged(workspaceId, agentId, clipId, {
        ...clip,
        status: 'failed',
        durationMs,
        hasMicAudio: file.hasMicAudio,
        contextItemId,
        error: 'transport',
      }),
    );
  }
}

/**
 * Dictation leaves the screen fully usable (scroll, click, switch apps): marks
 * are made only in an explicit annotate session. A leftover implicit session ends.
 */
function* followDictation({
  payload: [workspaceId, agentId],
}: ReturnType<typeof dockEvidenceDictationChanged>): SagaGenerator<void> {
  if (!activePair(workspaceId, agentId)) return;
  const session = evidenceOf(workspaceId, agentId)?.annotation;
  if (session?.mode === 'dictation') yield* endSession(workspaceId, agentId);
}

function* endDictationSession({
  payload: [workspaceId, agentId],
}: ReturnType<typeof dockEvidenceDictationFinished>): SagaGenerator<void> {
  const evidence = evidenceOf(workspaceId, agentId);
  if (!evidence?.dictation && evidence?.annotation?.mode === 'dictation')
    yield* endSession(workspaceId, agentId);
}

/**
 * The composer's Screenshot/Record state for the annotate tool bar, per pair. Native
 * keeps the last one it got; it is sent on change and again before a session starts
 * (in case it changed while no native service was installed).
 */
const barMedia = new Map<string, DockAnnotationMediaState>();
function* sendBarMedia(workspaceId: string, agentId: string): SagaGenerator<void> {
  const media = barMedia.get(dockEvidenceId(workspaceId, agentId));
  const service = nativeService;
  if (!media || !service?.setAnnotationMedia) return;
  try {
    yield* call([service, service.setAnnotationMedia], media);
  } catch {
    // Best effort: the bar keeps its last state until the next change.
  }
}

/**
 * Screenshot or Record clicked on the tool bar: the composer's own action, under the
 * composer's own rules, checked again here because the bar may be a frame stale. A
 * permission-blocked control opens Screen Recording; Stop always works; a disabled
 * control (limit, unavailable, busy) does nothing.
 */
function* barMediaAction(
  workspaceId: string,
  agentId: string,
  action: 'capture' | 'record',
): SagaGenerator<void> {
  const view = selectDockComposerEvidence.select(appStore.state, workspaceId, agentId);
  if (action === 'record' && view.recording) {
    yield* put(dockEvidenceRecordToggleRequested(workspaceId, agentId));
    return;
  }
  if (view.captureError === 'permission') {
    yield* put(dockEvidenceOpenSettingsRequested(workspaceId, agentId, 'screen'));
    return;
  }
  if (action === 'capture') {
    if (view.capabilities.capture && !view.captureDisabled && !view.capturePending)
      yield* put(dockEvidenceCaptureRequested(workspaceId, agentId));
    return;
  }
  if (view.capabilities.record && view.clips.length < DOCK_EVIDENCE_LIMITS.clips)
    yield* put(dockEvidenceRecordToggleRequested(workspaceId, agentId));
}

function* watchNative(): SagaGenerator<void> {
  const channel = eventChannel<DockEvidenceNativeEvent>((emit) => {
    nativeListeners.add(emit);
    return () => nativeListeners.delete(emit);
  }, buffers.expanding(16));
  try {
    while (true) {
      const event = yield* take(channel);
      if (event.type === 'mark') yield* onNativeMark(event);
      else if (event.type === 'annotation-issue') {
        const issue = sanitizeDockAnnotationIssue(event);
        const owner =
          issue &&
          getItems(appStore.state.dockConversation.evidence).find(
            (row) => row.annotation?.id === issue.sessionId,
          );
        if (issue && owner) {
          const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
          if (activePair(workspaceId, agentId)) {
            yield* put(dockEvidenceAnnotationIssue(workspaceId, agentId, issue));
            yield* notice(workspaceId, agentId, annotationIssueNotice(issue));
          }
        }
      } else if (event.type === 'annotation-commit') {
        const owner = getItems(appStore.state.dockConversation.evidence).find(
          (row) => row.annotation?.id === event.sessionId,
        );
        if (owner) {
          const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
          if (activePair(workspaceId, agentId)) yield* fork(commitAnnotation, workspaceId, agentId);
        }
      } else if (event.type === 'annotation-clear') {
        const owner = getItems(appStore.state.dockConversation.evidence).find(
          (row) => row.annotation?.id === event.sessionId,
        );
        if (owner) {
          const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
          if (activePair(workspaceId, agentId)) yield* fork(clearAnnotation, workspaceId, agentId);
        }
      } else if (event.type === 'annotation-media') {
        const owner = getItems(appStore.state.dockConversation.evidence).find(
          (row) => row.annotation?.id === event.sessionId,
        );
        if (owner && (event.action === 'capture' || event.action === 'record')) {
          const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
          if (activePair(workspaceId, agentId))
            yield* fork(barMediaAction, workspaceId, agentId, event.action);
        }
      } else if (event.type === 'annotation-tool') {
        // Switched on the on-screen tool bar: native already uses it.
        const owner = getItems(appStore.state.dockConversation.evidence).find(
          (row) => row.annotation?.id === event.sessionId,
        );
        if (owner && (DOCK_MARK_TOOLS as readonly string[]).includes(event.tool)) {
          const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
          if (activePair(workspaceId, agentId))
            yield* put(dockEvidenceToolSet(workspaceId, event.tool));
        }
      } else if (event.type === 'annotation-ended') {
        const owner = getItems(appStore.state.dockConversation.evidence).find(
          (row) => row.annotation?.id === event.sessionId,
        );
        if (owner) {
          const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
          rememberEndedSession(event.sessionId, workspaceId, agentId);
          yield* put(dockEvidenceAnnotationChanged(workspaceId, agentId, null));
        }
      } else {
        const owner = getItems(appStore.state.dockConversation.evidence).find((row) =>
          row.clips.some((clip) => clip.id === event.clipId),
        );
        if (owner) {
          const [workspaceId, agentId] = JSON.parse(owner.id) as [string, string];
          yield* finishClip(workspaceId, agentId, event.clipId, event.result);
        }
      }
    }
  } finally {
    channel.close();
  }
}

/**
 * Assistant-workspace clips need the verified, still-current `chiefAttachments`
 * capability. With nothing observed for the current connection, read it first.
 */
function* clipStorable(workspaceId: string): SagaGenerator<boolean> {
  if (workspaceId !== CHIEF_WORKSPACE_ID) return true;
  if (!currentDockServerCapabilities(appStore.state)) yield* observeServerCapabilities();
  return currentDockServerCapabilities(appStore.state)?.chiefAttachments === true;
}

/** Read the current connection's acknowledged capabilities and publish them with their binding. */
function* observeServerCapabilities(): SagaGenerator<void> {
  const binding = captureDockPlacementBinding();
  const capabilities = yield* call(probeDockAttachmentCapabilities, binding);
  // Unobserved (hello not yet acknowledged, or unreadable) publishes nothing.
  if (!isDockBindingCurrent(binding) || !isDockCapabilitiesObserved(capabilities)) return;
  yield* put(
    dockEvidenceServerCapabilitiesObserved({
      backendId: binding.backendId,
      generation: binding.generation,
      ...capabilities,
    }),
  );
}

export function* dockEvidenceSaga(): SagaGenerator<void> {
  yield* fork(watchNative);
  yield* takeLatest(
    [openDockConversationRequested, dockEvidenceServerCapabilitiesProbeRequested],
    observeServerCapabilities,
  );
  // A backend switch or reconnect invalidates what was observed; read the new connection.
  yield* takeLatestFromSelector(selectDockBackendBinding, observeServerCapabilities);
  yield* takeEvery(dockEvidenceCaptureRequested, capture);
  yield* takeEvery(dockEvidenceAnnotationToggleRequested, toggleAnnotation);
  yield* takeLatest(dockFeedbackRequested, startFeedback);
  yield* takeEvery(dockEvidenceAnnotationEndRequested, function* ({ payload: [ws, agent] }) {
    if (!activePair(ws, agent)) return;
    yield* endSession(ws, agent);
  });
  yield* takeEvery(dockEvidenceToolSelectRequested, selectTool);
  yield* takeEvery(dockEvidenceAnnotationUndoRequested, undoAnnotation);
  yield* takeEvery(dockEvidenceAnnotationRedoRequested, redoAnnotation);
  // Mouse mode belongs to the native session only; the saved tool is unchanged.
  yield* takeEvery(dockEvidenceMouseModeRequested, function* ({ payload: [ws, agent] }) {
    if (!activePair(ws, agent)) return;
    const session = evidenceOf(ws, agent)?.annotation;
    const service = nativeService;
    if (!session || session.mode === 'dictation' || !service?.setAnnotationMouse) return;
    try {
      yield* call([service, service.setAnnotationMouse], session.id);
    } catch {
      // The session already ended natively.
    }
  });
  // First annotate ever uses pick; afterwards the last tool per workspace survives restarts.
  yield* takeEvery(openDockConversationRequested, function* ({ payload: [workspaceId] }) {
    const tool = readDockLastTool(appStore.state.connections.windowBackendId, workspaceId);
    if (tool) yield* put(dockEvidenceToolRemembered(workspaceId, tool));
  });
  yield* takeEvery(dockEvidenceToolSet, function* ({ payload: [workspaceId, tool] }) {
    yield* call(
      rememberDockLastTool,
      appStore.state.connections.windowBackendId,
      workspaceId,
      tool,
    );
  });
  yield* takeEvery(dockEvidenceImageRemoveRequested, removeImage);
  yield* takeEvery(dockEvidenceClipRemoveRequested, removeClip);
  yield* takeEvery(dockEvidenceRecordToggleRequested, toggleRecording);
  yield* takeLatest(dockEvidenceBarMediaChanged, function* ({ payload: [ws, agent, media] }) {
    if (!activePair(ws, agent)) return;
    barMedia.set(dockEvidenceId(ws, agent), media);
    yield* sendBarMedia(ws, agent);
  });
  yield* takeEvery(dockEvidenceDictationChanged, followDictation);
  yield* takeEvery(dockEvidenceDictationFinished, endDictationSession);
  yield* takeEvery(
    [dockEvidenceMarkUndone, dockEvidenceMarkRemoved, dockEvidenceReferencesEdited],
    function* ({ payload: [ws, agent] }) {
      yield* syncMarks(ws, agent);
    },
  );
}
